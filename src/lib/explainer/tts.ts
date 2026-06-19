/**
 * Text-to-speech for explainer narration via Google Cloud TTS REST API.
 *
 * No SDK: we POST to texttospeech.googleapis.com directly. Auth is either an
 * API key (GOOGLE_CLOUD_TTS_KEY) or a service-account credentials file
 * (GOOGLE_APPLICATION_CREDENTIALS), from which we mint a short-lived OAuth
 * access token using a self-signed RS256 JWT (Node `crypto`, still no SDK).
 *
 * This module NEVER throws. If TTS isn't configured it returns null up front.
 * If an individual segment fails, that slot is null and the rest proceed — one
 * bad segment must not sink the whole voiceover.
 */

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import type { NarrativeSegment } from "./types";

const TTS_AVAILABLE = !!(
  process.env.GOOGLE_CLOUD_TTS_KEY ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS
);

const SYNTHESIZE_URL =
  "https://texttospeech.googleapis.com/v1/text:synthesize";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TTS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

const VOICE_BY_GENDER = {
  female: { name: "en-IN-Neural2-A", ssmlGender: "FEMALE" as const },
  male: { name: "en-IN-Neural2-C", ssmlGender: "MALE" as const },
} as const;

// ─── Auth ──────────────────────────────────────────────────────────────────

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}
let cachedToken: CachedToken | null = null;

/**
 * Mint (and cache) an OAuth access token from the GOOGLE_APPLICATION_CREDENTIALS
 * service-account JSON via a signed JWT bearer grant. Returns null on any
 * failure — the caller falls back to skipping TTS rather than throwing.
 */
async function getAccessToken(): Promise<string | null> {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) return null;

  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.token;
  }

  try {
    const creds = JSON.parse(await readFile(credPath, "utf8")) as {
      client_email?: string;
      private_key?: string;
    };
    if (!creds.client_email || !creds.private_key) return null;

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64url(
      JSON.stringify({
        iss: creds.client_email,
        scope: TTS_SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      })
    );
    const signingInput = `${header}.${claims}`;
    const signature = base64url(
      crypto.sign("RSA-SHA256", Buffer.from(signingInput), creds.private_key)
    );
    const assertion = `${signingInput}.${signature}`;

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!res.ok) {
      console.warn(`[tts] token exchange failed: ${res.status}`);
      return null;
    }
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) return null;

    cachedToken = {
      token: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return cachedToken.token;
  } catch (error) {
    console.warn(
      `[tts] could not load credentials: ${error instanceof Error ? error.message : "unknown"}`
    );
    return null;
  }
}

/**
 * Resolve the request URL and headers for whichever auth mechanism is set.
 * Prefers the API key (simpler); falls back to a bearer token from ADC.
 */
async function resolveAuth(): Promise<
  { url: string; headers: Record<string, string> } | null
> {
  const apiKey = process.env.GOOGLE_CLOUD_TTS_KEY;
  if (apiKey) {
    return {
      url: `${SYNTHESIZE_URL}?key=${encodeURIComponent(apiKey)}`,
      headers: { "Content-Type": "application/json" },
    };
  }
  const token = await getAccessToken();
  if (token) {
    return {
      url: SYNTHESIZE_URL,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    };
  }
  return null;
}

// ─── Synthesis ─────────────────────────────────────────────────────────────

async function synthesizeOne(
  text: string,
  voiceName: string,
  ssmlGender: "FEMALE" | "MALE",
  auth: { url: string; headers: Record<string, string> }
): Promise<string> {
  const res = await fetch(auth.url, {
    method: "POST",
    headers: auth.headers,
    body: JSON.stringify({
      input: { text },
      voice: {
        languageCode: "en-IN",
        name: voiceName,
        ssmlGender,
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 0.92, // slightly slower for clarity
        pitch: 0.0,
        effectsProfileId: ["headphone-class-device"],
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`TTS synthesize failed: ${res.status}`);
  }
  const json = (await res.json()) as { audioContent?: string };
  if (!json.audioContent) {
    throw new Error("TTS response missing audioContent");
  }
  return json.audioContent; // base64 MP3
}

/**
 * Generate one base64 MP3 per segment, in parallel. Returns null if TTS is
 * unavailable (not configured, or auth could not be resolved). Otherwise
 * returns an array aligned 1:1 with `segments`; failed segments are null.
 */
export async function generateVoiceover(
  segments: NarrativeSegment[],
  voice: "male" | "female" = "female"
): Promise<(string | null)[] | null> {
  if (!TTS_AVAILABLE) return null;

  const auth = await resolveAuth();
  if (!auth) return null;

  const { name: voiceName, ssmlGender } = VOICE_BY_GENDER[voice];

  const settled = await Promise.allSettled(
    segments.map((seg) =>
      synthesizeOne(seg.narration, voiceName, ssmlGender, auth)
    )
  );

  return settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    console.warn(
      `[tts] segment ${i} failed: ${
        result.reason instanceof Error ? result.reason.message : result.reason
      }`
    );
    return null;
  });
}
