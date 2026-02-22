export interface QuizQuestion {
  id: string;
  question: string;
  type: "mcq" | "true_false" | "short";
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
  questionTypes: ("mcq" | "true_false" | "short")[];
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
    questionTypes.length === 3
      ? "Include a mix of mcq, true_false, and short questions."
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
- **mcq**: Provide options array ["A", "B", "C", "D"]. correctAnswer = letter of correct option (e.g. "A").
- **true_false**: No options array. correctAnswer = "True" or "False".
- **short**: No options array. correctAnswer = concise 1-2 sentence model answer.
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
        type === "mcq" || type === "true_false" || type === "short";
      if (!validType || !question) continue;

      const correctAnswer = String(item?.correctAnswer ?? "");
      const explanation = String(item?.explanation ?? "");
      const difficulty = item?.difficulty;
      const validDifficulty =
        difficulty === "easy" || difficulty === "medium" || difficulty === "hard";
      if (!correctAnswer || !explanation || !validDifficulty) continue;

      const options =
        Array.isArray(item?.options) && type === "mcq"
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
