/**
 * Shared <p:sldSz> parsing — the ONE place slide-canvas dimensions are read.
 *
 * Both the extractor (which records the uploaded deck's size on ExtractedDeck)
 * and the assembler (which scales new-slide geometry to that size) call this,
 * so the two can never drift apart on either the parse or the fallback default.
 */

/** Default canvas when <p:sldSz> is missing: 16:9 widescreen (13.333" × 7.5"). */
export const DEFAULT_WIDTH_EMU = 12192000;
export const DEFAULT_HEIGHT_EMU = 6858000;

export interface SlideCanvas {
  widthEmu: number;
  heightEmu: number;
}

/**
 * Read the slide canvas size (EMU) from a ppt/presentation.xml string. Falls
 * back to 16:9 widescreen when the <p:sldSz> tag is absent or unparseable.
 */
export function parseSlideSize(presentationXml: string): SlideCanvas {
  const m = presentationXml.match(/<p:sldSz[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  if (m) {
    return { widthEmu: parseInt(m[1], 10), heightEmu: parseInt(m[2], 10) };
  }
  return { widthEmu: DEFAULT_WIDTH_EMU, heightEmu: DEFAULT_HEIGHT_EMU };
}
