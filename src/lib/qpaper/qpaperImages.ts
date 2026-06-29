/**
 * Question-image plumbing shared by every paper-rendering surface.
 *
 * A bank question may carry an attached image (its `image_path` in the
 * `question-images` bucket). That path is threaded through the assembled paper
 * onto each atomic unit (SubQuestion / QuestionPart / PoolItem). This module is
 * the single place that turns those paths into renderable assets so the three
 * export surfaces stay in lock-step:
 *
 *   - the web preview needs a signed URL  → {@link attachQuestionImageUrls}
 *   - the PDF and Word builders need bytes → {@link loadPaperImages}
 *
 * {@link imageDisplaySize} gives both builders one sizing rule so the PDF and
 * the Word document render the same image at the same proportions.
 */

import type { createAdminClient } from "@/lib/db/supabase-server";
import {
  createQuestionImageSignedUrl,
  downloadQuestionImage,
} from "@/lib/qbank/image-storage";
import type { AssembledPaper } from "./builder";

type AdminClient = ReturnType<typeof createAdminClient>;

/** A renderable, format-detected image keyed by its storage path. */
export interface EmbeddedImage {
  bytes: Uint8Array;
  /** Format both pdf-lib and docx can embed; unsupported formats are dropped. */
  format: "jpg" | "png";
  /** Natural pixel dimensions (used to preserve aspect ratio on both surfaces). */
  width: number;
  height: number;
}

/** storage path → decoded image bytes + dimensions. */
export type PaperImageMap = Map<string, EmbeddedImage>;

/** Carries an optional attached image; satisfied by SubQuestion/QuestionPart/PoolItem. */
interface ImageUnit {
  image_path?: string | null;
  image_url?: string | null;
}

/** Every atomic unit of the paper that can carry an image, in document order. */
function imageUnits(paper: AssembledPaper): ImageUnit[] {
  const units: ImageUnit[] = [];
  for (const section of paper.sections) {
    for (const q of section.questions) {
      for (const sub of q.sub_parts ?? []) units.push(sub);
      for (const part of q.parts ?? []) units.push(part);
      for (const item of q.items ?? []) units.push(item);
    }
  }
  return units;
}

/** Distinct, non-empty image paths referenced anywhere in the paper. */
function imagePaths(paper: AssembledPaper): string[] {
  const paths = imageUnits(paper)
    .map((u) => u.image_path)
    .filter((p): p is string => !!p);
  return Array.from(new Set(paths));
}

// ─── format + dimension detection ───────────────────────────────────────────

/** PNG IHDR carries width/height as big-endian uint32 at byte 16 / 20. */
function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** Walk JPEG segments to the start-of-frame marker that holds the dimensions. */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 2; // skip SOI (FFD8)
  while (off + 9 < b.length) {
    if (dv.getUint8(off) !== 0xff) {
      off++;
      continue;
    }
    const marker = dv.getUint8(off + 1);
    // SOF0–SOF15 hold the frame dimensions (excluding the non-frame C4/C8/CC).
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      return { height: dv.getUint16(off + 5), width: dv.getUint16(off + 7) };
    }
    // Standalone markers (no length payload): RSTn, SOI, EOI, TEM.
    if (
      (marker >= 0xd0 && marker <= 0xd9) ||
      marker === 0x01 ||
      marker === 0xff
    ) {
      off += 2;
      continue;
    }
    off += 2 + dv.getUint16(off + 2); // skip this segment by its length
  }
  return null;
}

/** Detect a pdf-lib/docx-embeddable image and read its natural size. */
function decodeImage(bytes: Uint8Array): EmbeddedImage | null {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const size = pngSize(bytes);
    if (size) return { bytes, format: "png", ...size };
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const size = jpegSize(bytes);
    if (size) return { bytes, format: "jpg", ...size };
  }
  // gif / webp / undecodable — skip embedding (the preview still shows them).
  return null;
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Mint a signed URL for every imaged atomic unit, mutating the paper in place so
 * the web preview can display them. Failures leave `image_url` unset (no image).
 */
export async function attachQuestionImageUrls(
  admin: AdminClient,
  paper: AssembledPaper,
  ttlSeconds = 3600
): Promise<void> {
  const units = imageUnits(paper).filter((u) => u.image_path);
  if (units.length === 0) return;
  // Dedupe URL minting per path; one signed URL is reused across shared paths.
  const urlByPath = new Map<string, string | null>();
  await Promise.all(
    Array.from(new Set(units.map((u) => u.image_path as string))).map(
      async (path) => {
        urlByPath.set(
          path,
          await createQuestionImageSignedUrl(admin, path, ttlSeconds)
        );
      }
    )
  );
  for (const u of units) {
    u.image_url = urlByPath.get(u.image_path as string) ?? null;
  }
}

/**
 * Download + decode every distinct image referenced by the paper, for the
 * server-side PDF/Word builders. Unsupported or unreadable images are omitted
 * (the builders then simply skip them), so this never throws.
 */
export async function loadPaperImages(
  admin: AdminClient,
  paper: AssembledPaper
): Promise<PaperImageMap> {
  const map: PaperImageMap = new Map();
  await Promise.all(
    imagePaths(paper).map(async (path) => {
      const bytes = await downloadQuestionImage(admin, path);
      if (!bytes) return;
      const decoded = decodeImage(bytes);
      if (decoded) map.set(path, decoded);
    })
  );
  return map;
}

/** Max on-page image footprint (PDF points). Word converts these to pixels. */
const MAX_IMG_W_PT = 240;
const MAX_IMG_H_PT = 220;
/** 1px @ 96dpi = 0.75pt; used to avoid upscaling tiny images past their size. */
const PX_TO_PT = 0.75;

/**
 * The shared display size (in PDF points) for an image of natural pixel
 * dimensions `w × h`: fit within the max box, preserve aspect ratio, and never
 * upscale beyond the source. Both builders call this so the two exports match.
 */
export function imageDisplaySize(
  w: number,
  h: number
): { width: number; height: number } {
  const naturalWpt = Math.max(1, w) * PX_TO_PT;
  let width = Math.min(MAX_IMG_W_PT, naturalWpt);
  let height = (width * h) / Math.max(1, w);
  if (height > MAX_IMG_H_PT) {
    height = MAX_IMG_H_PT;
    width = (height * w) / Math.max(1, h);
  }
  return { width, height };
}

/** PDF points → pixels (docx ImageRun transformation is in px). */
export const PT_TO_PX = 1 / PX_TO_PT;
