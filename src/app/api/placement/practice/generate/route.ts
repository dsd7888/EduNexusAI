import type { NextRequest } from "next/server";

import { routeAI } from "@/lib/ai/router";
import { createAdminClient, createServerClient } from "@/lib/db/supabase-server";
import { getModulesForBranch, PRACTICE_MODULES } from "@/lib/placement/modules";
import { getBranchFallbackSyllabus } from "@/lib/placement/fallbackSyllabus";
import { cleanQuestions } from "@/lib/placement/generator";
import {
  getPracticeQuestionsFromBank,
  savePracticeToBank,
} from "@/lib/placement/bankManager";

function parsePlacementQuestions(raw: string): any[] | null {
  // Attempt 1: direct parse after cleaning fences
  try {
    const clean = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed) && parsed.length >= 3) return cleanQuestions(parsed);
  } catch {}

  // Attempt 2: extract JSON array between first [ and last ]
  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      const slice = raw.slice(start, end + 1);
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed) && parsed.length >= 3) return cleanQuestions(parsed);
    }
  } catch {}

  // Attempt 3: fix common trailing comma issues then parse
  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start !== -1 && end !== -1) {
      const slice = raw
        .slice(start, end + 1)
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]");
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed) && parsed.length >= 3) return cleanQuestions(parsed);
    }
  } catch {}

  // Attempt 4: truncation recovery — salvage complete objects
  try {
    const start = raw.indexOf("[");
    if (start !== -1) {
      const slice = raw.slice(start);
      const objects: any[] = [];
      let depth = 0;
      let objStart = -1;

      for (let i = 0; i < slice.length; i++) {
        if (slice[i] === "{") {
          if (depth === 0) objStart = i;
          depth++;
        } else if (slice[i] === "}") {
          depth--;
          if (depth === 0 && objStart !== -1) {
            try {
              const obj = JSON.parse(slice.slice(objStart, i + 1));
              if (obj.question && obj.answer) objects.push(obj);
            } catch {}
            objStart = -1;
          }
        }
      }

      if (objects.length >= 3) return cleanQuestions(objects);
    }
  } catch {}

  return null;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check — student only
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, branch, semester")
      .eq("id", user.id)
      .single();

    if (profileError || !profile || profile.role !== "student") {
      return Response.json({ error: "Forbidden: Students only" }, { status: 403 });
    }

    // 2. Parse body: { moduleId: string }
    const body = await request.json().catch(() => ({} as any));
    const moduleId = typeof body?.moduleId === "string" ? body.moduleId.trim() : "";
    if (!moduleId) {
      return Response.json({ error: "moduleId is required" }, { status: 400 });
    }

    // 3. Find module (exact → fuzzy → inferred → last-resort)
    // Try exact match first
    let module = PRACTICE_MODULES.find((m) => m.id === moduleId);

    // Fuzzy match: find closest module by checking if moduleId
    // contains or matches any module id
    if (!module) {
      module = PRACTICE_MODULES.find(
        (m) =>
          moduleId.includes(m.id) ||
          m.id.includes(moduleId) ||
          moduleId.replace(/_/g, "") === m.id.replace(/_/g, "")
      );
    }

    // Category fallback: if subcategory is unknown, find by category
    if (!module) {
      // Detect category from the slug
      const quantKeywords = [
        "profit",
        "loss",
        "interest",
        "compound",
        "simple",
        "percent",
        "ratio",
        "speed",
        "distance",
        "time",
        "work",
        "pipe",
        "average",
        "number",
        "series",
        "data",
      ];
      const logicalKeywords = [
        "syllogism",
        "coding",
        "decoding",
        "blood",
        "relation",
        "direction",
        "seating",
        "arrangement",
        "input",
        "output",
        "puzzle",
        "logical",
      ];
      const verbalKeywords = [
        "reading",
        "comprehension",
        "verbal",
        "grammar",
        "vocabulary",
        "synonym",
        "antonym",
        "fill",
        "blank",
        "error",
        "para",
        "jumble",
        "sentence",
      ];
      const technicalKeywords = [
        "technical",
        "algorithm",
        "data_structure",
        "network",
        "database",
        "operating",
        "system",
        "thermodynamic",
        "fluid",
        "mechanical",
        "circuit",
        "programming",
      ];

      const slug = moduleId.toLowerCase();

      let inferredCategory: "quantitative" | "logical" | "verbal" | "technical" =
        "quantitative";
      if (verbalKeywords.some((k) => slug.includes(k))) {
        inferredCategory = "verbal";
      } else if (logicalKeywords.some((k) => slug.includes(k))) {
        inferredCategory = "logical";
      } else if (technicalKeywords.some((k) => slug.includes(k))) {
        inferredCategory = "technical";
      } else if (quantKeywords.some((k) => slug.includes(k))) {
        inferredCategory = "quantitative";
      }

      // Pick first module in that category for student's branch
      const branchModules = getModulesForBranch(profile?.branch ?? "");
      module =
        branchModules.find((m) => m.category === inferredCategory) ??
        PRACTICE_MODULES.find((m) => m.category === inferredCategory);

      console.log(
        `[practice/generate] Unknown moduleId "${moduleId}" → inferred category "${inferredCategory}" → using module "${module?.id}"`
      );
    }

    // Last resort: general quantitative practice
    if (!module) {
      module = PRACTICE_MODULES.find((m) => m.id === "profit_loss");
      console.warn(
        `[practice/generate] Could not match "${moduleId}" → falling back to profit_loss`
      );
    }

    if (!module) {
      return Response.json({ error: "Module not found" }, { status: 404 });
    }

    // Try bank first
    const banked = await getPracticeQuestionsFromBank({
      moduleId: moduleId,
      branch: profile.branch ?? null,
      studentId: user.id,
      totalNeeded: 12,
    });

    if (banked && banked.questions.length >= 10) {
      console.log(`[practice/generate] Served ${banked.questions.length} from bank`);

      await savePracticeToBank({
        moduleId,
        branch: profile.branch ?? null,
        studentId: user.id,
        questions: [],
        usedBankIds: banked.bankIds,
      });

      return Response.json({
        questions: banked.questions,
        module: {
          id: moduleId,
          matchedId: module.id,
          label: module.label,
          category: module.category,
        },
        source: "bank",
      });
    }

    // 4. Student profile already loaded (branch, semester)
    const studentBranch = (profile.branch ?? "Engineering") as string;

    // 5. Fetch syllabus content for student's branch (combine + slice to 3000 chars)
    const { data: subjects } = await adminClient
      .from("subjects")
      .select("id")
      .eq("branch", studentBranch);

    const subjectIds = (subjects ?? []).map((s: any) => s.id as string);

    let combinedSyllabus = "";
    if (subjectIds.length > 0) {
      const { data: rows } = await adminClient
        .from("subject_content")
        .select("content")
        .in("subject_id", subjectIds);

      combinedSyllabus = (rows ?? [])
        .map((r: any) => String(r.content ?? ""))
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 3000);
    }

    const syllabusContent =
      combinedSyllabus && combinedSyllabus.trim().length > 0
        ? combinedSyllabus
        : getBranchFallbackSyllabus(studentBranch);

    // 6. Build focused practice prompt
    const topicLabel = module.label;
    const topicDescription =
      moduleId !== module.id
        ? `${moduleId.replace(/_/g, " ")} (${module.description})`
        : module.description;
    const prompt = `You are a placement preparation expert.
Generate exactly 12 focused practice questions on: "${topicLabel}" — specifically: ${topicDescription}

Student branch: ${studentBranch} Engineering

${module.category === "technical" ? `Academic syllabus for context:\n${syllabusContent}` : ""}

TOPIC FOCUS: Every single question must be about ${module.label}.
This is a focused practice session — no mixed topics.

LEARNING MODE: These questions are for learning, not just testing.
- Questions should cover different aspects/difficulty levels of ${module.label}
- Start with 3-4 foundational questions
- Move to 4-5 intermediate application questions
- End with 3-4 challenging questions
- Each explanation must TEACH the concept, not just confirm the answer
  (2-4 sentences showing the method, formula, and why it works)

QUESTION COUNT: Exactly 12 questions.

Return ONLY valid JSON array:
[{
  "id": "q1",
  "category": "${module.category}",
  "subcategory": "${moduleId}",
  "difficulty_level": "foundational|intermediate|advanced",
  "question": "...",
  "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
  "answer": "A",
  "explanation": "Teaching explanation: concept used, why this is correct, common mistake to avoid.",
  "difficulty": "medium"
}]

Begin with [ and end with ]. Nothing else.`;

    // 7. Call routeAI('placement_gen', { ... })
    const result = await routeAI("placement_gen", {
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = String(result.content ?? "");
    const questions = parsePlacementQuestions(rawText);

    if (!questions || questions.length < 8) {
      return Response.json(
        {
          error: "generation_failed",
          message: "Could not generate enough practice questions. Please try again.",
        },
        { status: 500 }
      );
    }

    try {
      await savePracticeToBank({
        moduleId,
        branch: profile.branch ?? null,
        studentId: user.id,
        questions,
        usedBankIds: [],
      });
      console.log(
        `[practice/generate] Saved ${questions.length} to practice bank`
      );
    } catch (err) {
      console.error("[practice/generate] Bank save failed:", err);
    }

    return Response.json({
      questions,
      module: {
        id: moduleId,
        matchedId: module.id,
        label: module.label,
        category: module.category,
      },
      source: "generated",
    });
  } catch (err) {
    console.error("[placement/practice/generate] error:", err);
    return Response.json(
      { error: "Failed to generate practice questions" },
      { status: 500 }
    );
  }
}

