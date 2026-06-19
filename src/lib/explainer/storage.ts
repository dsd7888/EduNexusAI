/**
 * Storage layer for explainers: Supabase Storage upload/download of the
 * self-contained HTML player, signed-URL minting, and short-code allocation.
 *
 * All functions take an admin (service-role) client — uploads, downloads, and
 * the uniqueness check run server-side and intentionally bypass RLS. The
 * `explainers` bucket is created by the 20260604000000_explainers.sql migration.
 */

import { randomBytes } from "node:crypto";
import type { createAdminClient } from "@/lib/db/supabase-server";

type AdminClient = ReturnType<typeof createAdminClient>;

export const EXPLAINER_BUCKET = "explainers";

// URL-safe, lowercase + digits — no ambiguous characters needed since codes are
// machine-generated and never typed by hand. 36^8 ≈ 2.8e12 keyspace.
const SHORT_CODE_ALPHABET = "0123456789abcdefghijkmnpqrstuvwxyz"; // omit l/o
const SHORT_CODE_LENGTH = 8;
const SHORT_CODE_MAX_ATTEMPTS = 6;

function randomShortCode(): string {
  const bytes = randomBytes(SHORT_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    out += SHORT_CODE_ALPHABET[bytes[i] % SHORT_CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Allocate a short_code not already present in the explainers table. Retries on
 * the (astronomically unlikely) collision; throws if it cannot find a free code.
 */
export async function generateUniqueShortCode(
  admin: AdminClient
): Promise<string> {
  for (let attempt = 0; attempt < SHORT_CODE_MAX_ATTEMPTS; attempt++) {
    const code = randomShortCode();
    const { data, error } = await admin
      .from("explainers")
      .select("id")
      .eq("short_code", code)
      .maybeSingle();
    if (error) {
      throw new Error(`short_code uniqueness check failed: ${error.message}`);
    }
    if (!data) return code;
  }
  throw new Error("could not allocate a unique short_code");
}

/** Upload the HTML player. Returns the storage path. */
export async function uploadExplainerHtml(
  admin: AdminClient,
  userId: string,
  shortCode: string,
  html: string
): Promise<string> {
  const path = `${userId}/${shortCode}.html`;
  const { error } = await admin.storage
    .from(EXPLAINER_BUCKET)
    .upload(path, new TextEncoder().encode(html), {
      contentType: "text/html; charset=utf-8",
      upsert: true,
    });
  if (error) {
    throw new Error(`explainer upload failed: ${error.message}`);
  }
  return path;
}

/** Mint a signed URL for the stored HTML, or null on failure. */
export async function createExplainerSignedUrl(
  admin: AdminClient,
  storagePath: string,
  ttlSeconds: number
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(EXPLAINER_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data) {
    console.warn(
      `[explainer/storage] signed URL failed for ${storagePath}: ${error?.message ?? "unknown"}`
    );
    return null;
  }
  return data.signedUrl;
}

/** Download the stored HTML as a string, or null if it cannot be read. */
export async function fetchExplainerHtml(
  admin: AdminClient,
  storagePath: string
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(EXPLAINER_BUCKET)
    .download(storagePath);
  if (error || !data) {
    console.warn(
      `[explainer/storage] download failed for ${storagePath}: ${error?.message ?? "missing"}`
    );
    return null;
  }
  return await data.text();
}
