"use client";

import { useIdleSessionTracking } from "@/hooks/useIdleSessionTracking";

// Invisible mount point for session tracking + idle auto-logout. Placed inside the
// authenticated faculty/student/superadmin layouts only. It performs NO auth gating
// (that stays proxy.ts's job) — it assumes it's already inside an authenticated layout
// and only reacts to idle time by calling supabase.auth.signOut().
export function SessionTracker(): null {
  useIdleSessionTracking();
  return null;
}
