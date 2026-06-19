import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/db/supabase-server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { routeAI } from "@/lib/ai/router";
import type {
  PlacementCompanyProfile,
  PlacementBankQuestion,
} from "@/types/placement";

export const maxDuration = 60;

// ─── Constants ────────────────────────────────────────────────────────────────

type Track = "aptitude" | "verbal" | "domain" | "communication";
type Difficulty = "easy" | "medium" | "hard";

const VALID_TRACKS = new Set<Track>([
  "aptitude",
  "verbal",
  "domain",
  "communication",
]);

// Domain topics that produce a mixed 4 MCQ + 4 fill_code session
const FILL_CODE_TOPICS = new Set([
  "SQL",
  "DBMS",
  "OOP",
  "OS",
  "Networks",
  "DSA",
]);

const SYSTEM_PROMPT =
  "You are a placement preparation expert specializing in Indian campus recruitment. " +
  "Generate MCQ questions exactly matching the format used by Indian IT companies in their Online Assessments.";

const FILL_CODE_SYSTEM_PROMPT =
  "You are an expert programming instructor creating code completion questions for Indian campus placement preparation. " +
  "Each question should test genuine conceptual understanding, not syntax memorization.";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      description: "Array of MCQ questions",
      items: {
        type: "object",
        properties: {
          question_text: {
            type: "string",
            description: "The complete question text",
          },
          options: {
            type: "array",
            description: "Exactly 4 answer options",
            items: {
              type: "object",
              properties: {
                key: {
                  type: "string",
                  description: "Option label: A, B, C, or D",
                },
                text: {
                  type: "string",
                  description: "The option text",
                },
              },
              required: ["key", "text"],
            },
          },
          correct_answer: {
            type: "string",
            description: "The key of the correct option: A, B, C, or D",
          },
          explanation: {
            type: "string",
            description:
              "Method in one line, then calculation, then answer. No uncertainty.",
          },
          difficulty: {
            type: "string",
            description: "easy, medium, or hard",
          },
          topic_bucket: {
            type: "string",
            description: "Specific sub-topic bucket e.g. quant_arithmetic",
          },
        },
        required: [
          "question_text",
          "options",
          "correct_answer",
          "explanation",
          "difficulty",
          "topic_bucket",
        ],
      },
    },
  },
  required: ["questions"],
};

const FILL_CODE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question_text: {
            type: "string",
            description: "Context: what this code does and what is missing",
          },
          code_before_blank: {
            type: "string",
            description: "Code lines before the blank, with line numbers",
          },
          code_after_blank: {
            type: "string",
            description: "Code lines after the blank, with line numbers",
          },
          blank_description: {
            type: "string",
            description: "What the missing line should do",
          },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                text: { type: "string", description: "The actual code line" },
              },
              required: ["key", "text"],
            },
          },
          correct_answer: { type: "string" },
          explanation: {
            type: "string",
            description:
              "Why this line is correct and what the others would do wrong",
          },
          language: { type: "string" },
        },
        required: [
          "question_text",
          "code_before_blank",
          "code_after_blank",
          "blank_description",
          "options",
          "correct_answer",
          "explanation",
          "language",
        ],
      },
    },
  },
  required: ["questions"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isValidGenerated(q: unknown): boolean {
  if (!q || typeof q !== "object") return false;
  const c = q as Record<string, unknown>;
  return (
    typeof c.question_text === "string" &&
    c.question_text.trim() !== "" &&
    Array.isArray(c.options) &&
    (c.options as unknown[]).length === 4 &&
    typeof c.correct_answer === "string" &&
    ["A", "B", "C", "D"].includes(c.correct_answer)
  );
}

function isValidFillCode(q: unknown): boolean {
  if (!q || typeof q !== "object") return false;
  const c = q as Record<string, unknown>;
  return (
    typeof c.question_text === "string" &&
    c.question_text.trim() !== "" &&
    typeof c.code_before_blank === "string" &&
    typeof c.code_after_blank === "string" &&
    typeof c.blank_description === "string" &&
    typeof c.language === "string" &&
    Array.isArray(c.options) &&
    (c.options as unknown[]).length === 4 &&
    typeof c.correct_answer === "string" &&
    ["A", "B", "C", "D"].includes(c.correct_answer)
  );
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildPrompt(
  track: Track,
  topic: string,
  difficulty: Difficulty,
  company: PlacementCompanyProfile | null,
  count = 8
): string {
  const companyLine = company
    ? `Company context: ${company.name} (${company.difficulty_band} difficulty band)`
    : "";

  return (
    `Generate ${count} multiple choice questions for Indian campus placement preparation.\n` +
    `Topic: ${topic}\n` +
    `Track: ${track}\n` +
    `Difficulty: ${difficulty}\n` +
    (companyLine ? `${companyLine}\n` : "") +
    `\nRequirements:\n` +
    `- Each question must be solvable in under 90 seconds\n` +
    `- Use realistic values typical in Indian campus OA papers\n` +
    `- Distractors must be plausible (common mistakes, not random)\n` +
    `- Explanation: state the method in one line, then the calculation, then the answer. No self-correction or uncertainty.\n` +
    `- For aptitude: use standard shortcut methods\n` +
    `- For verbal: test patterns common in TCS/Infosys/Wipro assessments\n` +
    `- For domain: test conceptual understanding with scenario distractors\n` +
    `- For communication: use fresh-graduate workplace scenarios`
  );
}

function buildFillCodePrompt(topic: string): string {
  return (
    `Generate 4 code completion questions for ${topic}.\n` +
    `Each question shows a code snippet with ONE line missing.\n` +
    `The missing line is the most conceptually important line.\n` +
    `Languages: Python or Java (student's choice — use Python as default for DS/Algo, Java for OOP).\n` +
    `\nThe blank should test: understanding of the concept, not syntax memorization.`
  );
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;

    const { user } = authResult;
    const body = await request.json() as {
      track?: unknown;
      topic?: unknown;
      company_slug?: unknown;
    };
    const { track, topic, company_slug } = body;

    if (!track || !VALID_TRACKS.has(track as Track)) {
      return apiError(
        "Invalid track. Must be one of: aptitude, verbal, domain, communication",
        400
      );
    }
    if (!topic || typeof topic !== "string" || topic.trim() === "") {
      return apiError("topic is required", 400);
    }

    const validTrack = track as Track;
    const cleanTopic = topic.trim();
    const adminClient = createAdminClient();
    const isFillCodeMix =
      validTrack === "domain" && FILL_CODE_TOPICS.has(cleanTopic);
    const companySlugStr =
      company_slug && typeof company_slug === "string" ? company_slug : null;

    // ── Step 1: Fetch student mastery to determine difficulty ──────────────────
    const { data: mastery } = await adminClient
      .from("placement_topic_mastery")
      .select("current_difficulty, sessions_count")
      .eq("student_id", user.id)
      .eq("track", validTrack)
      .eq("topic", cleanTopic)
      .maybeSingle();

    const difficultyToServe: Difficulty =
      (mastery?.current_difficulty as Difficulty | undefined) ?? "easy";

    try {
      // ── Step 2: Get recently seen question IDs ─────────────────────────────
      const { data: recentAttempts } = await adminClient
        .from("placement_question_attempts")
        .select("question_id")
        .eq("student_id", user.id)
        .eq("topic", cleanTopic)
        .gte(
          "attempted_at",
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        );

      const seenIds = (recentAttempts ?? []).map((a) => a.question_id);

      // ── Step 3: Check bank ─────────────────────────────────────────────────
      if (isFillCodeMix) {
        // Need >= 4 MCQ + >= 4 fill_code from bank
        const buildBankQuery = (questionType: string) => {
          let q = adminClient
            .from("placement_question_bank")
            .select("*")
            .eq("track", validTrack)
            .eq("topic", cleanTopic)
            .eq("difficulty", difficultyToServe)
            .eq("is_active", true)
            .eq("question_type", questionType);
          if (seenIds.length > 0) {
            q = q.filter("id", "not.in", `(${seenIds.join(",")})`);
          }
          return q
            .order("quality_score", { ascending: false, nullsFirst: false })
            .limit(10);
        };

        const [{ data: mcqData }, { data: fcData }] = await Promise.all([
          buildBankQuery("mcq"),
          buildBankQuery("fill_code"),
        ]);

        const mcqBank = (mcqData ?? []) as PlacementBankQuestion[];
        const fcBank = (fcData ?? []) as PlacementBankQuestion[];

        if (mcqBank.length >= 4 && fcBank.length >= 4) {
          return apiSuccess({
            questions: [
              ...shuffle(mcqBank).slice(0, 4),
              ...shuffle(fcBank).slice(0, 4),
            ],
            topic: cleanTopic,
            track: validTrack,
            difficulty: difficultyToServe,
            source: "bank",
            generated_at: new Date().toISOString(),
          });
        }
      } else {
        // Standard MCQ bank check
        let bankQuery = adminClient
          .from("placement_question_bank")
          .select("*")
          .eq("track", validTrack)
          .eq("topic", cleanTopic)
          .eq("difficulty", difficultyToServe)
          .eq("is_active", true);

        if (seenIds.length > 0) {
          bankQuery = bankQuery.filter(
            "id",
            "not.in",
            `(${seenIds.join(",")})`
          );
        }

        const { data: candidates } = await bankQuery
          .order("quality_score", { ascending: false, nullsFirst: false })
          .limit(20);

        const bankCandidates = (candidates ?? []) as PlacementBankQuestion[];

        if (bankCandidates.length >= 6) {
          return apiSuccess({
            questions: shuffle(bankCandidates).slice(0, 6),
            topic: cleanTopic,
            track: validTrack,
            difficulty: difficultyToServe,
            source: "bank",
            generated_at: new Date().toISOString(),
          });
        }
      }

      // ── Step 4: Fetch company context (shared for both paths) ──────────────
      let company: PlacementCompanyProfile | null = null;
      if (companySlugStr) {
        const { data } = await adminClient
          .from("placement_company_profiles")
          .select("*")
          .eq("slug", companySlugStr)
          .eq("is_active", true)
          .maybeSingle();
        company = data ?? null;
      }

      // ── Step 5: Generate via AI ────────────────────────────────────────────
      if (isFillCodeMix) {
        return await generateFillCodeMix(
          adminClient,
          validTrack,
          cleanTopic,
          difficultyToServe,
          company,
          companySlugStr
        );
      }

      // Standard MCQ generation with retry
      type GeneratedQuestion = {
        question_text: string;
        options: Array<{ key: string; text: string }>;
        correct_answer: string;
        explanation: string;
        difficulty: string;
        topic_bucket: string;
      };

      const prompt = buildPrompt(validTrack, cleanTopic, difficultyToServe, company);
      let questions: GeneratedQuestion[] | null = null;
      let lastError: string | null = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await routeAI("placement_prep", {
            messages:       [{ role: "user", content: prompt }],
            systemPrompt:   SYSTEM_PROMPT,
            thinkingBudget: 0,
            maxTokens:      4000,
            responseSchema: RESPONSE_SCHEMA,
          });

          const raw = String(result.content ?? "");
          const parsed = JSON.parse(raw) as { questions?: unknown[] };
          const validated = (parsed.questions ?? []).filter(
            isValidGenerated
          ) as GeneratedQuestion[];

          if (validated.length >= 4) {
            questions = validated;
            break;
          }

          lastError = `Only ${validated.length} valid questions generated`;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          console.error(
            `[placement-prep] Generation attempt ${attempt} failed:`,
            lastError
          );
        }
      }

      if (!questions || questions.length < 4) {
        return NextResponse.json(
          {
            error: "Failed to generate questions after 2 attempts",
            detail: lastError,
          },
          { status: 500 }
        );
      }

      const validQuestions = questions;

      const insertRows = validQuestions.map((q) => ({
        track: validTrack,
        topic: cleanTopic,
        topic_bucket: q.topic_bucket || null,
        difficulty: difficultyToServe,
        question_text: q.question_text,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        question_type: "mcq",
        company_context: companySlugStr,
      }));

      const { data: insertedRows, error: insertError } = await adminClient
        .from("placement_question_bank")
        .insert(insertRows)
        .select();

      if (insertError || !insertedRows || insertedRows.length === 0) {
        console.error("[placement-prep] Bank insert error:", insertError);
        const fallback = validQuestions.slice(0, 6).map((q, i) => ({
          id: `gen_${Date.now()}_${i}`,
          track: validTrack,
          topic: cleanTopic,
          topic_bucket: q.topic_bucket || null,
          difficulty: difficultyToServe,
          question_text: q.question_text,
          options: q.options,
          correct_answer: q.correct_answer,
          explanation: q.explanation,
          question_type: "mcq",
          times_served: 0,
          times_correct: 0,
          avg_time_seconds: null,
          quality_score: null,
          company_context: null,
          generated_at: new Date().toISOString(),
          is_active: true,
        }));
        return apiSuccess({
          questions: fallback,
          topic: cleanTopic,
          track: validTrack,
          difficulty: difficultyToServe,
          source: "generated",
          generated_at: new Date().toISOString(),
        });
      }

      return apiSuccess({
        questions: shuffle(insertedRows as PlacementBankQuestion[]).slice(0, 6),
        topic: cleanTopic,
        track: validTrack,
        difficulty: difficultyToServe,
        source: "generated",
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[placement-prep] Unexpected handler error:", err);
      return NextResponse.json(
        { error: "Service temporarily unavailable. Please retry." },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error("[placement-prep] Error:", error instanceof Error ? error.message : error);
    return apiError("Internal server error", 500);
  }
}

// ─── Fill-code mix generation ─────────────────────────────────────────────────

type GeneratedMCQ = {
  question_text: string;
  options: Array<{ key: string; text: string }>;
  correct_answer: string;
  explanation: string;
  difficulty: string;
  topic_bucket: string;
};

type GeneratedFillCode = {
  question_text: string;
  code_before_blank: string;
  code_after_blank: string;
  blank_description: string;
  options: Array<{ key: string; text: string }>;
  correct_answer: string;
  explanation: string;
  language: string;
};

async function generateFillCodeMix(
  adminClient: ReturnType<typeof createAdminClient>,
  track: Track,
  topic: string,
  difficulty: Difficulty,
  company: PlacementCompanyProfile | null,
  companySlugStr: string | null
): Promise<Response> {
  const mcqPrompt = buildPrompt(track, topic, difficulty, company, 4);
  const fcPrompt = buildFillCodePrompt(topic);

  const [mcqResult, fcResult] = await Promise.allSettled([
    routeAI("placement_prep", {
      messages:       [{ role: "user", content: mcqPrompt }],
      systemPrompt:   SYSTEM_PROMPT,
      thinkingBudget: 0,
      maxTokens:      3000,
      responseSchema: RESPONSE_SCHEMA,
    }),
    routeAI("placement_prep", {
      messages:       [{ role: "user", content: fcPrompt }],
      systemPrompt:   FILL_CODE_SYSTEM_PROMPT,
      thinkingBudget: 0,
      maxTokens:      6000,
      responseSchema: FILL_CODE_RESPONSE_SCHEMA,
    }),
  ]);

  let mcqQuestions: GeneratedMCQ[] = [];
  let fcQuestions: GeneratedFillCode[] = [];

  if (mcqResult.status === "fulfilled") {
    try {
      const parsed = JSON.parse(String(mcqResult.value.content ?? "")) as { questions?: unknown[] };
      mcqQuestions = (parsed.questions ?? []).filter(isValidGenerated) as GeneratedMCQ[];
    } catch {
      console.error("[placement-prep] MCQ parse error in fill_code mix");
    }
  } else {
    console.error("[placement-prep] MCQ call failed:", mcqResult.reason);
  }

  if (fcResult.status === "fulfilled") {
    try {
      const parsed = JSON.parse(String(fcResult.value.content ?? "")) as { questions?: unknown[] };
      fcQuestions = (parsed.questions ?? []).filter(isValidFillCode) as GeneratedFillCode[];
    } catch {
      console.error("[placement-prep] fill_code parse error");
    }
  } else {
    console.error("[placement-prep] fill_code call failed:", fcResult.reason);
  }

  if (mcqQuestions.length < 2 && fcQuestions.length < 2) {
    return NextResponse.json(
      { error: "Failed to generate questions after 2 attempts", detail: "Both MCQ and fill_code generation failed" },
      { status: 500 }
    );
  }

  const now = new Date().toISOString();

  const mcqRows = mcqQuestions.map((q) => ({
    track,
    topic,
    topic_bucket: q.topic_bucket || null,
    difficulty,
    question_text: q.question_text,
    options: q.options,
    correct_answer: q.correct_answer,
    explanation: q.explanation,
    question_type: "mcq",
    company_context: companySlugStr,
  }));

  const fcRows = fcQuestions.map((q) => ({
    track,
    topic,
    topic_bucket: null,
    difficulty,
    question_text: q.question_text,
    options: q.options,
    correct_answer: q.correct_answer,
    explanation: q.explanation,
    question_type: "fill_code",
    code_context: {
      language: q.language,
      before_blank: q.code_before_blank,
      after_blank: q.code_after_blank,
      blank_description: q.blank_description,
    },
    company_context: null,
  }));

  const { data: insertedRows, error: insertError } = await adminClient
    .from("placement_question_bank")
    .insert([...mcqRows, ...fcRows])
    .select();

  if (insertError || !insertedRows || insertedRows.length === 0) {
    console.error("[placement-prep] fill_code mix bank insert error:", insertError);
    // Fallback: return unpersisted
    const fallbackMcq = mcqQuestions.slice(0, 4).map((q, i) => ({
      id: `gen_mcq_${Date.now()}_${i}`,
      track, topic, topic_bucket: q.topic_bucket || null, difficulty,
      question_text: q.question_text, options: q.options,
      correct_answer: q.correct_answer, explanation: q.explanation,
      question_type: "mcq" as const,
      times_served: 0, times_correct: 0, avg_time_seconds: null,
      quality_score: null, company_context: null, generated_at: now, is_active: true,
    }));
    const fallbackFc = fcQuestions.slice(0, 4).map((q, i) => ({
      id: `gen_fc_${Date.now()}_${i}`,
      track, topic, topic_bucket: null, difficulty,
      question_text: q.question_text, options: q.options,
      correct_answer: q.correct_answer, explanation: q.explanation,
      question_type: "fill_code" as const,
      code_context: {
        language: q.language,
        before_blank: q.code_before_blank,
        after_blank: q.code_after_blank,
        blank_description: q.blank_description,
      },
      times_served: 0, times_correct: 0, avg_time_seconds: null,
      quality_score: null, company_context: null, generated_at: now, is_active: true,
    }));
    return apiSuccess({
      questions: [...fallbackMcq, ...fallbackFc],
      topic, track, difficulty,
      source: "generated",
      generated_at: now,
    });
  }

  return apiSuccess({
    questions: insertedRows as PlacementBankQuestion[],
    topic, track, difficulty,
    source: "generated",
    generated_at: now,
  });
}
