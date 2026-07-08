"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import {
  IDLE_TIMEOUT_MS,
  getStoredSessionId,
  setStoredSessionId,
  startSession,
  endSession,
  clearStoredSessionId,
} from "@/lib/session/client";

// Real-interaction events only. Deliberately NOT `mousemove` — passive cursor
// movement would keep resetting the timer and effectively disable idle detection.
const INTERACTION_EVENTS: (keyof WindowEventMap)[] = [
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
];

const INTERACTION_UPDATE_THROTTLE_MS = 5_000; // perf throttle on the listener itself
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const IDLE_CHECK_INTERVAL_MS = 60 * 1000; // 60 s

/**
 * Mounts inside the authenticated (faculty/student/superadmin) layouts. Tracks real
 * user interaction independently of token/network state and actively signs the user
 * out after IDLE_TIMEOUT_MS of inactivity. Also emits the activity heartbeats that
 * measure "hours used" for the pilot analysis page.
 *
 * Everything here is best-effort: a failed session call must never block app usage.
 */
export function useIdleSessionTracking(): void {
  const router = useRouter();

  const lastInteractionAtRef = useRef<number>(Date.now());
  // The lastInteractionAt value captured at the moment of the previous heartbeat, so
  // we can tell whether the user actually did anything during the last window.
  const lastHeartbeatInteractionRef = useRef<number>(0);
  // Perf throttle: last time the interaction listener actually wrote the ref.
  const lastListenerWriteRef = useRef<number>(0);
  const loggedOutRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    // 1. Ensure a session row exists for this tab (fresh login, not a refresh).
    (async () => {
      if (!getStoredSessionId()) {
        const id = await startSession();
        if (id && !cancelled) {
          // already stored by startSession; nothing else to do
        } else if (!id) {
          console.error("[idle-tracking] could not start session (continuing)");
        }
      }
    })();

    // 2. Interaction listeners → advance lastInteractionAt (throttled writes).
    const handleInteraction = () => {
      const now = Date.now();
      if (now - lastListenerWriteRef.current < INTERACTION_UPDATE_THROTTLE_MS) return;
      lastListenerWriteRef.current = now;
      lastInteractionAtRef.current = now;
    };
    for (const ev of INTERACTION_EVENTS) {
      window.addEventListener(ev, handleInteraction, { passive: true });
    }

    // Heartbeat sender — only fires if the user actually interacted since last time.
    const sendHeartbeat = async () => {
      const sessionId = getStoredSessionId();
      if (!sessionId) return;
      try {
        const res = await fetch("/api/session/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        // 404 → the row was replaced/reset (e.g. DB reset before pilot). Start fresh.
        if (res.status === 404) {
          clearStoredSessionId();
          const newId = await startSession();
          if (newId) setStoredSessionId(newId);
        }
      } catch (err) {
        console.error("[idle-tracking] heartbeat failed:", err);
      }
    };

    // 3. Heartbeat interval — skip entirely if the whole window was idle.
    const heartbeatTimer = setInterval(() => {
      const last = lastInteractionAtRef.current;
      if (last > lastHeartbeatInteractionRef.current) {
        lastHeartbeatInteractionRef.current = last;
        void sendHeartbeat();
      }
    }, HEARTBEAT_INTERVAL_MS);

    // 4. Idle check — active signOut after IDLE_TIMEOUT_MS of no interaction.
    const idleTimer = setInterval(() => {
      if (loggedOutRef.current) return;
      if (Date.now() - lastInteractionAtRef.current > IDLE_TIMEOUT_MS) {
        loggedOutRef.current = true;
        void (async () => {
          await endSession("idle_timeout"); // best-effort, short timeout inside
          try {
            const supabase = createBrowserClient();
            await supabase.auth.signOut();
          } catch (err) {
            console.error("[idle-tracking] signOut failed:", err);
          }
          router.replace("/login?reason=idle_timeout");
        })();
      }
    }, IDLE_CHECK_INTERVAL_MS);

    // 6. On tab hidden, flush one more heartbeat if there was recent activity, so
    //    last_activity_at is as fresh as possible. Nothing on beforeunload (unreliable).
    const handleVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      if (lastInteractionAtRef.current > lastHeartbeatInteractionRef.current) {
        lastHeartbeatInteractionRef.current = lastInteractionAtRef.current;
        void sendHeartbeat();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      for (const ev of INTERACTION_EVENTS) {
        window.removeEventListener(ev, handleInteraction);
      }
      clearInterval(heartbeatTimer);
      clearInterval(idleTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [router]);
}
