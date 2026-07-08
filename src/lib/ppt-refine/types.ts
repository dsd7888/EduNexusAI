// change_summary values that mean "nothing was actually enhanced" but for a
// specific, distinct reason (a genuine AI no-op, a failed batch, or a fit
// revert). Kept in this pure-types module (no server-only deps) so both the
// server-side refiner/assembler and the client results page can share one
// source of truth for the literal strings instead of duplicating them.
export const NO_CHANGE_SUMMARY = 'No changes needed.';
export const BATCH_FAILURE_SUMMARY = 'Refinement failed — original content preserved.';
export const REVERT_SUMMARY = 'Refined content did not fit the slide — original kept.';

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
