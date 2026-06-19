import { toast } from "sonner";

/** A row from GET /api/explainer/list. */
export interface ExplainerListItem {
  id: string;
  short_code: string;
  topic: string;
  duration_seconds: number | null;
  has_audio: boolean;
  created_at: string;
  subject_name: string | null;
  module_name: string | null;
  storage_url: string;
}

/** What the right-hand preview panel needs to show one explainer. */
export interface PreviewExplainer {
  id: string;
  short_code: string;
  topic: string;
  duration_seconds: number | null;
  has_audio: boolean;
  /** Inline HTML for a freshly generated explainer (instant preview). */
  srcDoc?: string;
  /** Same-origin URL (/e/[code]) for an existing explainer. */
  url?: string;
}

export type PreviewState =
  | { kind: "empty" }
  | { kind: "generating" }
  | { kind: "error"; message: string }
  | { kind: "result"; explainer: PreviewExplainer };

/** Seconds → "m:ss" (e.g. 95 → "1:35"). Returns "—" for nullish input. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** The public, shareable URL for an explainer short code. */
export function explainerShareUrl(shortCode: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/e/${shortCode}`;
}

/** Copy the shareable link to the clipboard and toast "Copied!". */
export async function copyExplainerLink(shortCode: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(explainerShareUrl(shortCode));
    toast.success("Copied!");
  } catch {
    toast.error("Could not copy link");
  }
}
