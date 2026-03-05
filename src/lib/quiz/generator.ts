export interface QuizQuestion {
  id: string;
  question: string;
  type: "mcq" | "true_false" | "short" | "multiple_correct" | "match";
  options?: string[];
  correctAnswer: string;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
  unit?: string;
}

export function buildQuizPrompt(options: {
  subjectName: string;
  syllabusContent: string;
  questionCount: number;
  difficulty: "easy" | "medium" | "hard" | "mixed";
  questionTypes: ("mcq" | "true_false" | "short" | "multiple_correct" | "match")[];
  selectedTopics?: string[];
  focusTopic?: string;
}): string {
  const {
    subjectName,
    syllabusContent,
    questionCount,
    difficulty,
    questionTypes,
    selectedTopics,
    focusTopic,
  } = options;

  const topicScope =
    selectedTopics && selectedTopics.length > 0
      ? focusTopic
        ? `Generate questions ONLY from "${focusTopic}" within these selected topics: ${selectedTopics.join(", ")}. Use the full syllabus as background context.`
        : `Generate questions ONLY from these selected topics: ${selectedTopics.join(", ")}. Use the full syllabus as background context.`
      : "Generate questions spread across the full syllabus.";

  const difficultyScope =
    difficulty === "mixed"
      ? "Distribute difficulty roughly equally: about one-third easy, one-third medium, one-third hard."
      : `All questions must be ${difficulty} difficulty.`;

  const typeList = questionTypes.join(", ");
  const typeScope =
    questionTypes.length === 5
      ? "Include a mix of mcq, true_false, short, multiple_correct, and match questions."
      : `Only use these question types: ${typeList}.`;

  return `You are an expert university tutor creating a quiz for ${subjectName}.

SYLLABUS CONTENT:
${syllabusContent}

YOUR TASK:
- Generate exactly ${questionCount} questions.
- ${topicScope}
- ${difficultyScope}
- ${typeScope}

QUESTION FORMAT RULES:
- **mcq**: Provide options array of exactly 4 options, e.g. ["Option A", "Option B", "Option C", "Option D"]. correctAnswer = letter of the correct option (e.g. "A").
- **multiple_correct**: Provide options array of 4-5 options. Exactly 2-3 of these options must be correct. correctAnswer must be a pipe-separated list of the exact correct options in their text form (e.g. "Option A|Option C"). Do NOT include incorrect options in correctAnswer. Never return fewer than 4 options or more than 5.
- **true_false**: No options array. correctAnswer = "True" or "False".
- **short**: No options array. correctAnswer = concise 1-2 sentence model answer.
- **match**:
  - type: "match"
  - question.text: Describe the two columns clearly, for example:
    "Match the following:\n\nColumn A:\n1. [term1]\n2. [term2]\n3. [term3]\n4. [term4]\n\nColumn B:\n(a) [def1]\n(b) [def2]\n(c) [def3]\n(d) [def4]"
  - options: array of EXACTLY 4 combination options, just like MCQ, for example:
    ["1-a, 2-b, 3-c, 4-d", "1-b, 2-a, 3-d, 4-c", "1-c, 2-d, 3-a, 4-b", "1-a, 2-c, 3-d, 4-b"]
    Only ONE of these combinations is fully correct. Other options must be plausible (partially right) but wrong overall.
  - correctAnswer: the one correct combination string, e.g. "1-a, 2-c, 3-b, 4-d".
  - The student will see these options exactly like an MCQ and will pick one option.
- **explanation**: Must be educational, explaining WHY the answer is correct. Do NOT just restate the answer.
- **unit**: Optional, e.g. "Unit 1: Laws of Thermodynamics".

OUTPUT FORMAT:
Return ONLY a valid JSON object. No markdown, no backticks, no preamble. Example:
{
  "title": "string describing what this quiz covers",
  "questions": [
    {
      "id": "q1",
      "question": "string",
      "type": "mcq",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "A",
      "explanation": "educational explanation of why A is correct",
      "difficulty": "easy",
      "unit": "Unit 1: Laws of Thermodynamics"
    }
  ]
}`;
}

export function buildSocraticHintPrompt(options: {
  question: string;
  subjectName: string;
  unit?: string;
}): string {
  const { question, subjectName, unit } = options;

  return `You are a friendly senior student helping a junior with ${subjectName}${unit ? ` (${unit})` : ""}.

The student is stuck on this question:
"${question}"

Give ONE Socratic hint. Do NOT reveal the answer. Do NOT narrow it down to one option.

- Ask a guiding question, OR
- Point to the relevant concept/principle they should think about

Keep it to 2-3 sentences max. Friendly, encouraging tone.

NEVER say "the answer is", "correct answer", "the right answer", or similar.`;
}

export function parseQuizResponse(rawText: string): QuizQuestion[] | null {
  try {
    let text = String(rawText ?? "").trim();
    if (!text) return null;

    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    }

    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;

    const obj = parsed as Record<string, unknown>;
    const questions = obj?.questions;
    if (!Array.isArray(questions) || questions.length < 1) return null;

    const result: QuizQuestion[] = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q || typeof q !== "object") continue;
      const item = q as Record<string, unknown>;
      const id = String(item?.id ?? `q${i + 1}`);
      const question = String(item?.question ?? "");
      const type = item?.type;
      const validType =
        type === "mcq" ||
        type === "true_false" ||
        type === "short" ||
        type === "multiple_correct" ||
        type === "match";
      if (!validType || !question) continue;

      const correctAnswer = String(item?.correctAnswer ?? "");
      const explanation = String(item?.explanation ?? "");
      const difficulty = item?.difficulty;
      const validDifficulty =
        difficulty === "easy" || difficulty === "medium" || difficulty === "hard";
      if (!correctAnswer || !explanation || !validDifficulty) continue;

      const options =
        Array.isArray(item?.options) &&
        (type === "mcq" || type === "multiple_correct" || type === "match")
          ? (item.options as string[]).map(String)
          : undefined;
      const unit =
        item?.unit != null ? String(item.unit) : undefined;

      result.push({
        id,
        question,
        type,
        options,
        correctAnswer,
        explanation,
        difficulty,
        unit,
      });
    }

    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}
