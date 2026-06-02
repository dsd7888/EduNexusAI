export const SYLLABUS_EXTRACT_SYSTEM_PROMPT = `You are a precise academic syllabus parser for Indian engineering universities. Extract structured data exactly as written — do not infer or generate content not present in the document.`;

export const SYLLABUS_EXTRACT_USER_PROMPT = `Extract all structured data from this syllabus PDF.

Output ONLY valid JSON. First char {, last char }. No markdown. No preamble.

{
  "course": {
    "code": string,
    "name": string,
    "prerequisites": string[],
    "credits": number,
    "theory_hours_per_week": number,
    "practical_hours_per_week": number
  },
  "exam_scheme": {
    "theory_ce": number,
    "theory_ese": number,
    "practical_ce": number | null,
    "practical_ese": number | null,
    "tutorial_marks": number | null,
    "total_marks": number
  },
  "modules": [
    {
      "module_number": number,
      "name": string,
      "content": string,
      "hours": number,
      "weightage_percent": number,
      "section_number": number,
      "btl_levels": string[]
    }
  ],
  "course_outcomes": [
    {
      "co_code": string,
      "description": string
    }
  ],
  "co_po_mapping": [
    {
      "co_code": string,
      "po_code": string,
      "strength": number
    }
  ],
  "co_pso_mapping": [
    {
      "co_code": string,
      "pso_code": string,
      "strength": number
    }
  ],
  "practicals": [
    {
      "sr_no": number,
      "name": string,
      "hours": number
    }
  ],
  "textbooks": string[],
  "reference_books": string[]
}`;
