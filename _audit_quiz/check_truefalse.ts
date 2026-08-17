import { isAnswerCorrect } from "../src/lib/assessment/grading";
import type { SessionAnswerKey } from "../src/lib/assessment/runner";

const key: SessionAnswerKey = {
  slotId: "s1",
  bankQuestionId: null,
  subjectId: "x",
  moduleId: null,
  type: "true_false",
  correctAnswer: "True",
  explanation: "",
  questionText: "q",
  marks: 1,
  source: "ai_fresh",
  numericAnswer: null,
  numericTolerance: null,
} as unknown as SessionAnswerKey;

const probes = ["True", "true", "False", "false", "T", "F", "toaster", "tangerine", "falsehood", "  True  ", "1", ""];
for (const p of probes) {
  console.log(JSON.stringify(p), "->", isAnswerCorrect(key, p));
}
