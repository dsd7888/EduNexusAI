export interface ExtractedCourse {
  code: string;
  name: string;
  prerequisites: string[];
  credits: number;
  theory_hours_per_week: number;
  practical_hours_per_week: number;
}

export interface ExtractedExamScheme {
  theory_ce: number | null;
  theory_ese: number | null;
  practical_ce: number | null;
  practical_ese: number | null;
  tutorial_marks: number | null;
  total_marks: number | null;
}

export interface ExtractedModule {
  module_number: number;
  name: string;
  content: string;
  hours: number;
  weightage_percent: number;
  section_number: number;
  btl_levels: string[];
}

export interface ExtractedCourseOutcome {
  co_code: string;
  description: string;
}

export interface ExtractedCoPoMap {
  co_code: string;
  po_code: string;
  strength: number;
}

export interface ExtractedCoPsoMap {
  co_code: string;
  pso_code: string;
  strength: number;
}

export interface ExtractedPractical {
  sr_no: number;
  name: string;
  hours: number;
}

export interface ExtractedSyllabus {
  course: ExtractedCourse;
  exam_scheme: ExtractedExamScheme;
  modules: ExtractedModule[];
  course_outcomes: ExtractedCourseOutcome[];
  co_po_mapping: ExtractedCoPoMap[];
  co_pso_mapping: ExtractedCoPsoMap[];
  practicals: ExtractedPractical[];
  textbooks: string[];
  reference_books: string[];
}
