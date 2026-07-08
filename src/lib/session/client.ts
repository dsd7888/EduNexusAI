"use client";

// Client-side helpers for session tracking (Checkpoint 3). Shared by the idle-tracking
// hook and every manual-logout call site so the "end this session" behaviour is
// identical everywhere. All calls are best-effort — session bookkeeping must never
// block or break app usage.

export const SESSION_STORAGE_KEY = "ai_session_id";

// 2 hours of inactivity ends the session. Single source of truth — Checkpoint 4's
// constants.ts re-exports this rather than duplicating the literal.
export const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export function getStoredSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionId(id: string): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    // sessionStorage unavailable (private mode etc.) — proceed without persistence.
  }
}

export function clearStoredSessionId(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// POST /api/session/start and store the returned id. Fire-and-forget; returns the id
// on success or null on failure (never throws).
export async function startSession(): Promise<string | null> {
  try {
    const res = await fetch("/api/session/start", { method: "POST" });
    if (!res.ok) return null;
    const data = (await res.json()) as { sessionId?: string };
    if (data?.sessionId) {
      setStoredSessionId(data.sessionId);
      return data.sessionId;
    }
    return null;
  } catch (err) {
    console.error("[session] start failed:", err);
    return null;
  }
}

// POST /api/session/end for a manual logout / idle timeout. Best-effort with a short
// timeout so it can't hang a logout; always clears the stored id afterwards.
export async function endSession(
  reason: "idle_timeout" | "manual_logout",
  timeoutMs = 3000
): Promise<void> {
  const sessionId = getStoredSessionId();
  clearStoredSessionId();
  if (!sessionId) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch("/api/session/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, reason }),
      signal: controller.signal,
      keepalive: true,
    });
  } catch {
    // best-effort — the session may already be gone
  } finally {
    clearTimeout(timer);
  }
}
