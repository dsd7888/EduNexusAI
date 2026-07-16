import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import { loadSubjectContext } from "@/lib/subjectContext";
import { generatePracticalSections } from "@/lib/labmanual/generator";
import { computePracticalFingerprint } from "@/lib/labmanual/fingerprint";
import {
  DIFFICULTIES,
  MAX_PRACTICALS_PER_REQUEST,
  type Difficulty,
  type LabManualDoc,
  type LabManualWarning,
  type PracticalManualSection,
} from "@/lib/labmanual/types";
import type { AILogContext } from "@/lib/ai/providers/types";
import type { NextRequest } from "next/server";

const MODEL_USED = "gemini-2.5-flash";

function parseDifficultyMap(raw: unknown): Record<number, Difficulty> {
  const out: Record<number, Difficulty> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = Number(k);
    const val = String(v);
    if (Number.isFinite(key) && (DIFFICULTIES as string[]).includes(val)) {
      out[key] = val as Difficulty;
    }
  }
  return out;
}

function parseInstructionMap(raw: unknown): Record<number, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = Number(k);
    if (Number.isFinite(key) && typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const subjectId = String(body.subjectId ?? "").trim();
    if (!subjectId) return apiError("subjectId is required", 400);

    const practicalNos = Array.isArray(body.practicalNos)
      ? Array.from(
          new Set(
            (body.practicalNos as unknown[])
              .map((n) => Math.trunc(Number(n)))
              .filter((n) => Number.isFinite(n)),
          ),
        )
      : [];
    if (practicalNos.length === 0) {
      return apiError("practicalNos must contain at least one practical", 400);
    }
    // The route's 120s budget assumes at most 4 concurrent Flash calls — the
    // client chunks larger units rather than this route silently truncating.
    if (practicalNos.length > MAX_PRACTICALS_PER_REQUEST) {
      return apiError(
        `At most ${MAX_PRACTICALS_PER_REQUEST} practicals per request (got ${practicalNos.length})`,
        400,
      );
    }

    const denied = await assertSubjectAccess(adminClient, profile.role, user.id, subjectId);
    if (denied) return denied;

    const force = Boolean(body.force);
    const language =
      typeof body.language === "string" && body.language.trim()
        ? body.language.trim()
        : null;
    const difficulties = parseDifficultyMap(body.difficulties);
    const instructions = parseInstructionMap(body.instructions);

    const ctx = await loadSubjectContext(subjectId);
    if (ctx.practicals.length === 0) {
      return apiError("This subject has no practicals", 400);
    }
    const known = new Set(ctx.practicals.map((p) => p.sr_no));
    const unknownNos = practicalNos.filter((n) => !known.has(n));
    if (unknownNos.length > 0) {
      return apiError(
        `Practical(s) ${unknownNos.join(", ")} are not in this subject's syllabus`,
        400,
      );
    }

    // The learning path is per-faculty state, so unit context comes from the
    // caller's own manual rather than a shared cache.
    const { data: manualRow } = await adminClient
      .from("lab_manuals")
      .select("doc")
      .eq("subject_id", subjectId)
      .eq("faculty_id", user.id)
      .maybeSingle();
    const doc = (manualRow as { doc: LabManualDoc } | null)?.doc ?? null;
    const path = doc?.path ?? null;

    // ── Cache lookup: hit requires fingerprint match AND difficulty match ────
    // Language rides inside the fingerprint, so a Python entry can never serve a
    // faculty who chose C (§3 note b).
    const sections: PracticalManualSection[] = [];
    const warnings: LabManualWarning[] = [];
    const perPracticalFromCache: Record<number, boolean> = {};
    const toGenerate: number[] = [];
    const fingerprints = new Map<number, string>();

    for (const n of practicalNos) {
      fingerprints.set(n, computePracticalFingerprint(ctx, n, language));
    }

    if (!force) {
      const { data: cachedRows } = await adminClient
        .from("lab_manual_cache")
        .select("practical_no, difficulty, payload, syllabus_fingerprint")
        .eq("subject_id", subjectId)
        .in("practical_no", practicalNos);

      const rows = (cachedRows ?? []) as {
        practical_no: number;
        difficulty: string;
        payload: PracticalManualSection;
        syllabus_fingerprint: string | null;
      }[];

      for (const n of practicalNos) {
        const wanted = difficulties[n] ?? "standard";
        const hit = rows.find(
          (r) =>
            r.practical_no === n &&
            r.difficulty === wanted &&
            r.syllabus_fingerprint === fingerprints.get(n),
        );
        // A per-practical custom instruction is a deliberate override of whatever
        // is cached, so it always forces a fresh generation.
        if (hit && !instructions?.[n]) {
          sections.push(hit.payload);
          perPracticalFromCache[n] = true;
        } else {
          toGenerate.push(n);
        }
      }
    } else {
      toGenerate.push(...practicalNos);
    }

    let failed: number[] = [];
    if (toGenerate.length > 0) {
      const logContext: AILogContext = {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: profile.role,
        subjectId,
        subjectCode: ctx.subjectCode,
        jobId: crypto.randomUUID(),
        relatedContentId: null,
        feature: "lab_manual",
      };

      const result = await generatePracticalSections(
        {
          ctx,
          practicalNos: toGenerate,
          language,
          path,
          difficulties,
          instructions,
        },
        logContext,
      );
      failed = result.failed;
      warnings.push(...result.warnings);

      for (const section of result.sections) {
        sections.push(section);
        perPracticalFromCache[section.practicalNo] = false;

        // Do NOT write a PERSONALISED generation into the shared cache. A
        // per-practical customInstruction ("use recursion only", "frame it
        // around our lab kit") is binding for the requester, but the cache
        // exists to share NEUTRAL generations — persisting a tailored one would
        // silently make one faculty's constraint every colleague's default. The
        // requester still gets their section; the shared cache keeps whatever
        // neutral version was there.
        if (instructions?.[section.practicalNo]) continue;

        const { error: upsertError } = await adminClient.from("lab_manual_cache").upsert(
          {
            subject_id: subjectId,
            practical_no: section.practicalNo,
            difficulty: section.difficulty,
            payload: section,
            syllabus_fingerprint: fingerprints.get(section.practicalNo),
            generated_by: user.id,
            model_used: MODEL_USED,
          },
          { onConflict: "subject_id,practical_no,difficulty" },
        );
        if (upsertError) {
          console.warn(
            `[labmanual generate] cache upsert failed for #${section.practicalNo}:`,
            upsertError.message,
          );
        }
      }
    }

    sections.sort((a, b) => a.practicalNo - b.practicalNo);

    return apiSuccess({
      sections,
      warnings,
      perPracticalFromCache,
      failed,
      modelUsed: MODEL_USED,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[labmanual generate] error:", message);
    return apiError("Failed to generate lab manual sections", 500);
  }
}
