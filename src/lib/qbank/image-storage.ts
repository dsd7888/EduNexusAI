/**
 * Storage layer for question images: upload to the `question-images` bucket
 * and mint signed URLs for serving.  Mirrors the shape of
 * src/lib/explainer/storage.ts — same admin-client approach, same path
 * convention ({ownerId}/{uuid}.ext), same signed-URL helper.
 *
 * All functions take an admin (service-role) client so uploads and URL minting
 * run server-side and bypass RLS.
 */

import { randomUUID } from "node:crypto";
import type { createAdminClient } from "@/lib/db/supabase-server";

type AdminClient = ReturnType<typeof createAdminClient>;

export const QUESTION_IMAGES_BUCKET = "question-images";

const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Returns the file extension for an allowed MIME type, or null if not allowed. */
export function resolveImageExt(mimeType: string): string | null {
  return ALLOWED_MIME_TO_EXT[mimeType] ?? null;
}

/**
 * Upload a base64-encoded image to the question-images bucket.
 * Path: `{facultyId}/{uuid}.{ext}` — mirrors uploadExplainerHtml's path shape.
 * Returns the storage path (never a URL).
 * Throws on upload failure so the caller can abort the DB insert.
 */
export async function uploadQuestionImage(
  admin: AdminClient,
  facultyId: string,
  base64Data: string,
  mimeType: string
): Promise<string> {
  const ext = resolveImageExt(mimeType);
  if (!ext) throw new Error(`Unsupported image MIME type: ${mimeType}`);

  const bytes = Buffer.from(base64Data, "base64");
  const path = `${facultyId}/${randomUUID()}.${ext}`;

  const { error } = await admin.storage
    .from(QUESTION_IMAGES_BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`question image upload failed: ${error.message}`);
  return path;
}

/**
 * Mint a short-lived signed URL for a stored question image.
 * Returns null and logs a warning on failure — callers treat null as "no image".
 */
export async function createQuestionImageSignedUrl(
  admin: AdminClient,
  storagePath: string,
  ttlSeconds: number
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(QUESTION_IMAGES_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);

  if (error || !data) {
    console.warn(
      `[qbank/image-storage] signed URL failed for ${storagePath}: ${error?.message ?? "unknown"}`
    );
    return null;
  }
  return data.signedUrl;
}
