/** Mirrors GET /api/assessment/mastery's response (CP-Q3 Part 5B). */

export type AssessmentDifficulty = "easy" | "medium" | "hard";

export interface PromotionProgress {
  targetTier: AssessmentDifficulty;
  correctNeeded: number;
  attemptsAvailable: number;
}

export interface MasteryModule {
  moduleId: string;
  moduleName: string;
  moduleNumber: number | null;
  accuracy: number;
  attemptsCount: number;
  currentDifficulty: AssessmentDifficulty;
  promotionProgress?: PromotionProgress;
}

export interface MasterySubject {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  aggregateMastery: number | null;
  moduleCount: number;
  practicedModuleCount: number;
  modules: MasteryModule[];
}

export interface MasteryHubResponse {
  subjects: MasterySubject[];
}
