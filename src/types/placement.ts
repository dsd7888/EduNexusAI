// ─── Enums (mirror DB) ────────────────────────────────────────────────────────

export type SchoolDiscipline =
  | 'engineering' | 'commerce' | 'science'
  | 'architecture' | 'management' | 'pharmacy' | 'law';

export type PlacementTarget =
  | 'service_it'        // TCS, Infosys, Wipro, Cognizant, Capgemini, Accenture
  | 'product'           // Google, Microsoft tier
  | 'core_engineering'  // L&T, Bosch, Tata Motors
  | 'bfsi'              // HDFC, ICICI, Deloitte
  | 'consulting'        // McKinsey, ZS, Accenture Strategy
  | 'startup';

export type DifficultyBand = 'easy' | 'medium' | 'hard';

// ─── OA Pattern ───────────────────────────────────────────────────────────────

export interface OASection {
  name: string;
  weight_percent: number;
  question_count: number | null;
  time_minutes: number;
}

export interface OAPattern {
  sections: OASection[];
}

// ─── Company Round ─────────────────────────────────────────────────────────────

export interface CompanyRound {
  round: number;
  name: string;
  type: 'aptitude' | 'technical' | 'hr' | 'communication' | 'mixed' | 'coding';
}

// ─── Syllabus Relevance ────────────────────────────────────────────────────────

export interface SyllabusRelevanceItem {
  subject_name: string;
  module_name: string;
  relevance: 'high' | 'medium';
}

// ─── Company Profile ───────────────────────────────────────────────────────────

export interface PlacementCompanyProfile {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  company_type: PlacementTarget;
  is_mass_recruiter: boolean;
  min_cgpa: number | null;
  backlogs_allowed: boolean;
  allowed_branches: string[] | null;
  oa_pattern: OAPattern | null;
  rounds: CompanyRound[] | null;
  avg_prep_weeks: number | null;
  difficulty_band: DifficultyBand | null;
  syllabus_relevance: SyllabusRelevanceItem[] | null;
  campus_notes: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// ─── Placement Drive ──────────────────────────────────────────────────────────

export interface PlacementDrive {
  id: string;
  company_id: string;
  school: string;
  drive_date: string;           // ISO date string
  registration_deadline: string | null;
  eligible_branches: string[] | null;
  eligible_min_cgpa: number | null;
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  // joined
  company?: PlacementCompanyProfile;
}

// ─── Readiness Scores ─────────────────────────────────────────────────────────

export interface ReadinessScores {
  aptitude: number;       // 0–100
  verbal: number;
  domain: number;
  coding: number;
  communication: number;
  overall: number;        // weighted composite
}

// ─── Resume Data ──────────────────────────────────────────────────────────────

export interface ResumeProject {
  id: string;
  title: string;
  tech_stack: string[];
  description: string;
  github_url: string | null;
  live_url: string | null;
  from_mini_project: boolean;
}

export interface ResumeCertification {
  id: string;
  name: string;
  issuer: string;
  year: string;
  url: string | null;
}

export interface ResumeData {
  summary: string;
  skills: string[];
  projects: ResumeProject[];
  certifications: ResumeCertification[];
  achievements: ResumeAchievement[];
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
}

// ─── Student Placement Profile ────────────────────────────────────────────────

export interface StudentPlacementProfile {
  id: string;
  student_id: string;
  cgpa: number | null;
  active_backlogs: number;
  history_backlogs: number;
  primary_target: PlacementTarget;
  dream_companies: string[];      // slugs
  open_to_relocation: boolean;
  readiness_aptitude: number;
  readiness_verbal: number;
  readiness_domain: number;
  readiness_coding: number;
  readiness_communication: number;
  readiness_overall: number;
  resume_data: ResumeData;
  resume_completeness: number;
  prep_streak_days: number;
  last_active_date: string | null;
  setup_complete: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Company Fit (computed client-side) ───────────────────────────────────────

export type FitLevel = 'ready' | 'close' | 'needs_work';

export interface CompanyFit {
  company: PlacementCompanyProfile;
  fit_level: FitLevel;           // ready ≥75 | close 50–74 | needs_work <50
  fit_score: number;             // 0–100
  top_gaps: string[];            // max 2, shown on dashboard card
  is_eligible: boolean;
  ineligibility_reason: string | null;  // "CGPA below 6.5" etc.
}

// ─── Topic Bucket (for post-test intelligence) ────────────────────────────────

export type TopicBucket =
  | 'quant_arithmetic'
  | 'quant_algebra'
  | 'quant_geometry'
  | 'quant_data_interpretation'
  | 'logical_series'
  | 'logical_arrangement'
  | 'logical_syllogism'
  | 'logical_coding_decoding'
  | 'verbal_reading_comprehension'
  | 'verbal_grammar'
  | 'verbal_vocabulary'
  | 'verbal_para_completion'
  | 'pseudo_code'
  | 'core_os'
  | 'core_dbms'
  | 'core_networks'
  | 'core_oop'
  | 'core_dsa_concepts';

export interface TopicAccuracy {
  bucket: TopicBucket;
  attempted: number;
  correct: number;
  accuracy_percent: number;      // computed: (correct/attempted)*100
  is_focus_zone: boolean;        // accuracy < 50% AND attempted >= 5
}

// ─── Daily Task ───────────────────────────────────────────────────────────────

export type TaskType =
  | 'aptitude_drill'
  | 'verbal_drill'
  | 'domain_revision'
  | 'mock_oa'
  | 'hr_practice'
  | 'resume_update'
  | 'mini_project';

export interface DailyTask {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  estimated_minutes: number;
  company_context: string | null;   // "Targets TCS NQT pattern"
  action_url: string;               // deep link into prep tracks
  is_complete: boolean;
}

// ─── Company Arrival Mode ─────────────────────────────────────────────────────

export interface ArrivalMode {
  drive: PlacementDrive;
  company: PlacementCompanyProfile;
  days_remaining: number;
  is_eligible: boolean;
  ineligibility_reason: string | null;
  fit_score: number;
  daily_plan: DailyTask[];          // recalculated per day remaining
  campus_notes: string | null;
}

// ─── Placement Target Labels (UI) ─────────────────────────────────────────────

export const TARGET_LABELS: Record<PlacementTarget, string> = {
  service_it:        'IT Services',
  product:           'Product Companies',
  core_engineering:  'Core Engineering',
  bfsi:              'Banking & Finance',
  consulting:        'Consulting',
  startup:           'Startups',
};

export const DISCIPLINE_LABELS: Record<SchoolDiscipline, string> = {
  engineering:  'Engineering',
  commerce:     'Commerce & Business',
  science:      'Sciences',
  architecture: 'Architecture & Design',
  management:   'Management',
  pharmacy:     'Pharmacy',
  law:          'Law',
};

// Weighted readiness formula per target type
// Keys = readiness dimensions, values = weight (must sum to 1.0)
export const READINESS_WEIGHTS: Record<PlacementTarget, Record<keyof ReadinessScores, number>> = {
  service_it: {
    aptitude: 0.35, verbal: 0.25, domain: 0.15, coding: 0.15, communication: 0.10, overall: 0,
  },
  product: {
    aptitude: 0.20, verbal: 0.10, domain: 0.25, coding: 0.35, communication: 0.10, overall: 0,
  },
  core_engineering: {
    aptitude: 0.25, verbal: 0.15, domain: 0.40, coding: 0.05, communication: 0.15, overall: 0,
  },
  bfsi: {
    aptitude: 0.30, verbal: 0.20, domain: 0.25, coding: 0.05, communication: 0.20, overall: 0,
  },
  consulting: {
    aptitude: 0.25, verbal: 0.20, domain: 0.20, coding: 0.05, communication: 0.30, overall: 0,
  },
  startup: {
    aptitude: 0.20, verbal: 0.15, domain: 0.25, coding: 0.30, communication: 0.10, overall: 0,
  },
};

// FitLevel thresholds
export const FIT_THRESHOLDS = { ready: 75, close: 50 } as const;

export function computeFitLevel(score: number): FitLevel {
  if (score >= FIT_THRESHOLDS.ready) return 'ready';
  if (score >= FIT_THRESHOLDS.close) return 'close';
  return 'needs_work';
}

export function computeOverallReadiness(
  scores: Omit<ReadinessScores, 'overall'>,
  target: PlacementTarget
): number {
  const w = READINESS_WEIGHTS[target];
  return Math.round(
    scores.aptitude      * w.aptitude      +
    scores.verbal        * w.verbal        +
    scores.domain        * w.domain        +
    scores.coding        * w.coding        +
    scores.communication * w.communication
  );
}

// ─── Question Bank ────────────────────────────────────────────────────────────

export interface PlacementBankQuestion {
  id: string;
  track: string;
  topic: string;
  topic_bucket: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  question_text: string;
  options: Array<{ key: string; text: string }>;
  correct_answer: string;
  explanation: string;
  times_served: number;
  times_correct: number;
  avg_time_seconds: number | null;
  quality_score: number | null;
  company_context: string | null;
  generated_at: string;
  is_active: boolean;
  question_type?: 'mcq' | 'fill_code';
  code_context?: {
    language: string;
    before_blank: string;
    after_blank: string;
    blank_description: string;
  };
}

export interface PlacementTopicMastery {
  id: string;
  student_id: string;
  track: string;
  topic: string;
  attempts_count: number;
  correct_count: number;
  sessions_count: number;
  recent_accuracy: number;
  current_difficulty: 'easy' | 'medium' | 'hard';
  last_practiced_at: string | null;
  updated_at: string;
}

export interface DrillSession {
  questions: PlacementBankQuestion[];
  topic: string;
  track: string;
  difficulty: 'easy' | 'medium' | 'hard';
  source: 'bank' | 'generated';
  generated_at: string;
}

export interface DrillAttempt {
  question_id: string;
  selected_answer: string | null;  // null = skipped
  is_correct: boolean;
  is_skipped: boolean;
  time_spent_seconds: number;
}

export interface ResumeEducation {
  degree: string           // "B.Tech"
  branch: string           // "Computer Science and Engineering"
  university: string       // "P.P. Savani University"
  cgpa: string             // "7.8" — string to allow "7.8/10" format
  year_of_passing: string  // "2026"
  relevant_courses: string[] // max 6
}

export interface ResumeProject {
  id: string
  title: string
  tech_stack: string[]     // ["React", "Node.js", "PostgreSQL"]
  bullets: string[]        // 2-3 bullet points, specific verb + outcome
  github_url: string | null
  live_url: string | null
  duration: string | null  // "Jan 2024 – Mar 2024"
}

export interface ResumeInternship {
  id: string
  company: string
  role: string
  duration: string         // "May 2024 – Jul 2024"
  bullets: string[]        // 2-3 bullets
  location: string | null
}

export interface ResumeCertification {
  id: string
  name: string
  issuer: string
  year: string
  url: string | null
}

export interface ResumeAchievement {
  id: string
  text: string             // single line, specific
}

export interface ResumeData {
  // Personal
  full_name: string
  email: string
  phone: string
  linkedin_url: string | null
  github_url: string | null
  portfolio_url: string | null

  // Education
  education: ResumeEducation[]

  // Skills — structured for ATS
  technical_skills: {
    languages: string[]      // ["Java", "Python", "SQL"]
    frameworks: string[]     // ["Spring Boot", "React"]
    tools: string[]          // ["Git", "Docker", "VS Code"]
    concepts: string[]       // ["DSA", "OOP", "DBMS", "OS"]
  }
  soft_skills: string[]      // max 4, only if genuinely demonstrable

  // Experience
  projects: ResumeProject[]
  internships: ResumeInternship[]

  // Extras
  certifications: ResumeCertification[]
  achievements: ResumeAchievement[]

  // Metadata
  last_updated: string
  completeness: number       // 0-100, computed
}

export interface ATSAnalysis {
  jd_text: string
  overall_score: number      // 0-100
  keyword_matches: Array<{
    keyword: string
    found_in_resume: boolean
    importance: 'high' | 'medium' | 'low'
    location_in_resume: string | null   // "skills > languages" or null
  }>
  missing_high_priority: string[]
  bullet_issues: Array<{
    section: string          // "projects[0].bullets[1]"
    original: string
    issue: string            // "No measurable outcome", "Vague verb"
    suggested: string        // Flash-rewritten version
  }>
  skill_gap_actions: Array<{
    skill: string
    how_to_add: string       // honest path to earning this skill
    time_estimate: string    // "2 weekends", "1 week"
    resource_url: string | null
    prep_track: string | null  // links to placement prep track
    prep_topic: string | null
  }>
  ats_tips: string[]         // 3-5 general tips specific to this JD
  _empty?: boolean
}

export interface ResumeVersion {
  id: string
  created_at: string
  jd_snippet: string | null  // first 100 chars of JD this was tailored for
  label: string              // "TCS Application", "General"
}
