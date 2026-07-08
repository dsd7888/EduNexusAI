// change_summary values that mean "nothing was actually enhanced" but for a
// specific, distinct reason (a genuine AI no-op, a failed batch, or a fit
// revert). Kept in this pure-types module (no server-only deps) so both the
// server-side refiner/assembler and the client results page can share one
// source of truth for the literal strings instead of duplicating them.
export const NO_CHANGE_SUMMARY = 'No changes needed.';
export const BATCH_FAILURE_SUMMARY = 'Refinement failed — original content preserved.';
export const REVERT_SUMMARY = 'Refined content did not fit the slide — original kept.';

// change_summary for a slide the faculty member deliberately DID NOT select for
// refinement. It never reaches the AI (no call, no cost) and its source file is
// left byte-identical. It belongs in the same "unchanged" bucket as the no-op /
// revert / batch-failure summaries on the results view, but is worded as an
// explicit human choice ("not selected") rather than an AI outcome ("nothing to
// improve") so the per-slide detail panel reads distinctly for the two cases.
export const NOT_SELECTED_SUMMARY = 'Slide not selected for refinement — left unchanged.';

// change_summary overrides for a PARTIAL revert: the slide's file DID change
// (so it still counts as "Enhanced"), but one of title/body specifically was
// dropped back to the original because it couldn't be made to fit, while the
// other part landed as refined. The AI's original change_summary describes
// both parts changing, which would be misleading once one part reverts —
// these replace it with an accurate, part-specific message.
export const PARTIAL_REVERT_TITLE_SUMMARY =
  'Refined title did not fit the slide — original title kept; body was updated.';
export const PARTIAL_REVERT_BODY_SUMMARY =
  'Refined body did not fit the slide — original body kept; title was updated.';

export type SlideType =
  | 'title'
  | 'overview'
  | 'concept'
  | 'diagram'
  | 'example'
  | 'practice'
  | 'summary'
  | 'unknown';

export interface ExtractedSlide {
  index: number;
  title: string;
  type: SlideType;
  body_text: string[];
  has_image: boolean;
  has_diagram: boolean;
  speaker_notes: string;
  word_count: number;
  is_thin: boolean;
}

export interface ExtractedDeck {
  file_name: string;
  slide_count: number;
  slides: ExtractedSlide[];
  full_text_context: string;
  detected_topic: string;
  detected_level: 'basic' | 'intermediate' | 'advanced';
  /** Original slide dimensions in EMU (from <p:sldSz>). 16:9 widescreen ≈ 12192000 × 6858000. */
  original_width_emu: number;
  original_height_emu: number;
}

export interface RefinementOptions {
  // Content improvements
  improve_readability: boolean;
  expand_thin_sections: boolean;
  add_real_world_examples: boolean;
  add_visuals: boolean;
  add_practice_problems: boolean;
  simplify_content: boolean;
  add_summary_slide: boolean;
  add_key_insights: boolean;
  // Structure options
  allow_new_slides: boolean;
  subject_id: string | null;
  target_semester: number | null;
}

export interface SlideVisual {
  type: 'svg' | 'mermaid' | 'imagen';
  content: string;
  caption: string;
}

export interface RefinedSlide extends ExtractedSlide {
  refined_title: string;
  refined_body: string[];
  visual?: SlideVisual;
  is_new: boolean;
  change_summary: string;
}

export interface RefinedDeck {
  original_slide_count: number;
  refined_slide_count: number;
  slides: RefinedSlide[];
  changes_summary: string[];
}
