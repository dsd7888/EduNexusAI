/**
 * Chat "Visualize" pipeline prompts — CLASSIFY → GENERATE.
 *
 * The Visualize button on an assistant message runs exactly two AI calls:
 *   1. buildVizClassifyPrompt  → chat_viz_classify (Flash, responseSchema)
 *   2. one of the generation builders below, chosen by the classified vizType.
 *
 * Adding a fourth vizType (e.g. "illustration" → Imagen) means: add it to
 * VIZ_TYPES, add a VIZ_REGISTRY entry, add the builder. The route itself never
 * changes shape — same per-content-type routing precedent as routeDiagramModel
 * in router.ts (CLAUDE_CONTEXT §3).
 */

// ─── vizType taxonomy ────────────────────────────────────────────────────────
// Lives in vizTypes.ts — the client-safe half, shared with the browser panel.
// See that file for why the split is by runtime rather than by concern.

import { VIZ_TYPES, type VizPayloadKind, type VizType } from "./vizTypes";

export { VIZ_TYPES };
export type { VizClassification, VizPayloadKind, VizType } from "./vizTypes";

/**
 * Narrow by design: only the three fields the route consumes. Irrelevant
 * optional fields in a responseSchema remove the model's natural stopping
 * pressure under constrained decoding and cause runaway token cost
 * (CLAUDE_CONTEXT §19) — never widen this "just in case".
 */
export const VIZ_CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    vizType: { type: "string", enum: [...VIZ_TYPES] },
    rationale: { type: "string", maxLength: 200 },
    coreConcept: { type: "string", maxLength: 300 },
    conceptualFallback: { type: "boolean" },
  },
  required: ["vizType", "rationale", "coreConcept", "conceptualFallback"],
} as const;

/** Mermaid source only — single maxLength-bounded field, same reasoning. */
export const VIZ_DIAGRAM_SCHEMA = {
  type: "object",
  properties: {
    mermaid: { type: "string", maxLength: 2000 },
  },
  required: ["mermaid"],
} as const;

// ─── Shared design system ────────────────────────────────────────────────────

/**
 * The single source of the platform's visual language (CLAUDE_CONTEXT §15).
 * Interpolated verbatim into every generation prompt that draws pixels — never
 * restate these tokens inline in another prompt, or the two drift and chat
 * visuals stop matching explainer visuals.
 */
const VIZ_DESIGN_SYSTEM = `<design_system>
These values are FIXED. Use them exactly — do not substitute your own palette.

  --bg:      #0F172A   page canvas
  --surface: #1E293B   cards, boxes, control bar
  --text:    #F1F5F9   all primary text
  --muted:   #94A3B8   captions, axis ticks, secondary labels
  --default: #3B82F6   blue   — resting/neutral elements
  --active:  #F59E0B   amber  — the element under consideration RIGHT NOW
  --success: #10B981   green  — settled/final/correct elements
  --accent:  #8B5CF6   purple — merged/derived/highlighted elements
  --error:   #EF4444   red    — invalid states only

Font: Inter, loaded with a system fallback stack. Do NOT fetch webfonts:
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
Canvas: 16:9 aspect ratio, dark (--bg) background, generous spacing —
padding >= 24px on the outer frame, >= 16px between logical groups.
Color carries MEANING, not decoration: if an element is amber it must be
because it is the active one, and it must return to blue when it is not.
</design_system>`;

/**
 * Anti-explainer-failure clauses. Every layout bug we shipped in the first
 * explainer pass traces to one of these: AI-chosen pixel coordinates, text
 * overflowing an unsized box, a rAF loop that never settles, or a Reset that
 * only half-restored state. The model supplies CONTENT; these rules force the
 * deterministic scaffold to supply LAYOUT (CLAUDE_CONTEXT §15, §19).
 */
const VIZ_LAYOUT_SAFETY = `<layout_safety>
These rules are NOT style suggestions. Violating any one of them produces a
visibly broken visualization. They override anything else in this prompt.

1. LAYOUT IS FLEXBOX/GRID ONLY. Never position text with absolute pixel
   coordinates. No \`position:absolute; left:340px; top:120px\` for a label,
   ever. Let the browser compute positions.
2. EVERY LABEL LIVES INSIDE A SIZED BOX. Any box holding text declares its
   own width (or flex-basis) plus:
     overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
   A label may be clipped to an ellipsis. A label may NEVER escape its box or
   overlap a neighbour.
3. MOTION IS CSS TRANSITIONS ONLY. Use \`transition: <prop> 300ms ease\`.
   NO requestAnimationFrame loops, NO setInterval animation, NO physics. State
   changes flip a class or a style value; the browser tweens it.
4. RESET IS IDEMPOTENT. Pressing Reset from ANY state — mid-play, at the end,
   or immediately after another Reset — must restore the exact initial state:
   step index 0, original data, all timers cleared, all classes cleared.
   Render from a single \`render()\` function driven by a state object; never
   mutate the DOM incrementally in a way Reset would have to undo by hand.
5. NO EXTERNAL RESOURCES. No CDN scripts, no webfonts, no remote images, no
   fetch/XHR. The document must render fully offline.
6. FIXED FRAME, NO PAGE SCROLL. The whole visualization fits its 16:9 frame.
   If content would overflow, reduce the number of elements — never let the
   body scroll.
</layout_safety>`;

/**
 * Size contract for the two freeform-HTML generation calls.
 *
 * Both run on Pro, where gemini.ts pins maxOutputTokens to 32768 regardless of
 * the router's per-task maxTokens (CLAUDE_CONTEXT §19), and neither can carry a
 * responseSchema — the output is an HTML document, not JSON. That removes the
 * constrained-decoding stopping pressure whose absence caused the ~18× slower /
 * ~12× costlier runaway documented in §19. This prompt-level ceiling is the
 * mitigation that does not require touching the shared provider.
 *
 * Verify against ai_call_logs.output_tokens for chat_visualize / chat_viz_plot;
 * if typical outputs run past ~8k tokens, this contract is not holding and the
 * decision needs revisiting with data.
 */
const VIZ_SIZE_CONTRACT = `<size_contract>
The complete document must be UNDER 250 LINES.

If the concept will not fit, simplify the VISUALIZATION — fewer elements, fewer
steps, a narrower slice of the concept. NEVER simplify the layout discipline to
buy room: the rules in <layout_safety> are not negotiable for any concept at any
size. A small correct visualization teaches; a large broken one does not.

Do not pad. No decorative markup, no unused CSS classes, no defensive branches
for states your visualization cannot reach, no commentary. Stop when the
document is complete.
</size_contract>`;

// ─── CALL 1 — classifier ─────────────────────────────────────────────────────

/**
 * Picks the visual form for one assistant answer. Runs on Flash with
 * VIZ_CLASSIFY_SCHEMA and thinkingBudget 0.
 */
export function buildVizClassifyPrompt(options: {
  subjectName: string;
  sourceContent: string;
}): string {
  const { subjectName, sourceContent } = options;

  return `<role>
You are a visualization director for an engineering tutoring platform. A student
has just read the tutor answer below and tapped "Visualize". Your ONLY job is to
decide which of three visual forms would teach this content best, and to name the
one idea worth visualizing.
</role>

<subject>${subjectName}</subject>

<source_answer>
${sourceContent}
</source_answer>

<viz_types>
Choose EXACTLY ONE.

"interactive" — the insight is SEEING CHANGE OVER STEPS, or VARYING A PARAMETER
and watching the result move. Processes, algorithms, step-by-step mechanisms.
  Examples: merge sort walking an array; a TCP three-way handshake; round-robin
  CPU scheduling; Newton-Raphson converging on a root; a paging replacement run.
  Ask: "would a Next/Prev button, or a slider, BE the explanation?" If yes →
  interactive.

"diagram" — the insight is STATIC STRUCTURE, FLOW, or RELATIONSHIP. Nothing
changes over time; the shape of the thing IS the point. Rendered as Mermaid.
  Examples: a three-tier system architecture; an OSI layer stack; a taxonomy of
  scheduling algorithms; how a public and private key flow through signing and
  verification; a software development lifecycle.
  Ask: "could this be drawn once on a whiteboard and be complete?" If yes →
  diagram.

"plot" — the insight is a MATHEMATICAL RELATIONSHIP or CURVE. One quantity
against another, drawn from a formula.
  Examples: a normal distribution; a P-V curve for an isothermal process; a
  sine wave; a Big-O growth comparison; a Bode magnitude plot.
  Ask: "does this have axes?" If yes → plot.
</viz_types>

<tie_breakers>
- Steps AND a formula (e.g. gradient descent) → "interactive". Watching it move
  beats seeing the curve alone.
- A curve AND a parameter to vary (e.g. how sigma changes a Gaussian) → "plot".
  The plot generator can carry one slider; that is enough.
- Structure AND a walkthrough of that structure (e.g. a DNS resolution path)
  → "interactive" only if the ORDER of traversal matters; otherwise "diagram".
- A WORKED NUMERICAL SOLUTION — "solve this with these values", a derivation
  carried through to a number, a substitution chain → "interactive", as a
  step-through of the SOLUTION STAGES. Never "plot".
  Test: "is the answer a sequence of algebraic or arithmetic moves?" If yes →
  step-through. The insight is the ORDER OF OPERATIONS — which quantity gets
  substituted when, and why. Plotting one solved instance draws a single point
  or one frozen curve and teaches nothing about the method; that is decoration.
  Each step of the walkthrough is one algebraic move, captioned with the
  reason for it.
</tie_breakers>

<conceptual_fallback>
Some answers have no real visual content: a definition, an exam tip, an
anecdote, a comparison made purely in prose. You must still choose a vizType —
this student pressed a button and must get something.

In that case: choose "diagram", draw a structural map of the IDEAS in the
answer (their relationships, groupings, contrasts), and set
conceptualFallback = true.

Set conceptualFallback = true ONLY in this situation. When the content has a
genuine process, structure, or curve of its own — i.e. almost always — it is
false. Do not use it to hedge a difficult call; use it only when you would
otherwise be inventing a picture that the content does not actually have.
</conceptual_fallback>

<fields>
vizType     — one of: interactive | diagram | plot
rationale   — under 200 chars. Why this form fits THIS content. Not a summary
              of the answer; a justification of the choice.
coreConcept — under 300 chars. The ONE thing the visualization must make
              obvious, phrased as an instruction to the artist. Be concrete
              and specific to the source answer — name the actual algorithm,
              structure, or formula, not a generic topic.
              GOOD: "Show merge sort splitting [38,27,43,3] to single elements,
                     then merging back up, highlighting the compared pair."
              BAD:  "Show how sorting works."
conceptualFallback — boolean. See <conceptual_fallback> above. Almost always
              false.
</fields>

Return JSON only.`;
}

// ─── CALL 2a — interactive ───────────────────────────────────────────────────

/**
 * The quality anchor for the interactive prompt.
 *
 * DO NOT shorten this to save prompt tokens. Its length IS its function.
 * Models copy visible discipline far more reliably than they follow abstract
 * instructions to be disciplined — the anti-explainer-failure rules in
 * VIZ_LAYOUT_SAFETY only reliably land because this example demonstrably obeys
 * every one of them: precomputed step data, one `state` object, a single
 * `render()` that is the only DOM writer, CSS transitions instead of a rAF
 * loop, controls disabled at the boundaries, and a `reset()` that is idempotent
 * from any state including mid-play.
 *
 * This is the §15 lesson (AI supplies content, deterministic scaffolds supply
 * layout) applied where no scaffold is available: chat visualizations are
 * open-ended, so we cannot hand the model a pattern library the way the
 * explainer renderer does. A complete worked example is the closest available
 * substitute. Replacing it with a description of itself reintroduces exactly
 * the layout failures §15 documents.
 *
 * It also anchors the size contract in the prompt (~85 lines vs the stated
 * 250-line ceiling), so "keep it under 250 lines" reads as consistent framing
 * rather than an arbitrary cap.
 */
const VIZ_INTERACTIVE_EXAMPLE = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0F172A; color: #F1F5F9; padding: 24px;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
    display: flex; flex-direction: column; gap: 16px;
    aspect-ratio: 16/9; overflow: hidden;
  }
  h1 { font-size: 20px; font-weight: 600; }
  .caption {
    background: #1E293B; border-radius: 8px; padding: 12px 16px;
    font-size: 14px; color: #94A3B8; min-height: 44px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row { display: flex; gap: 12px; justify-content: center; flex: 1; align-items: center; }
  .cell {
    width: 72px; height: 72px; flex: 0 0 72px;
    display: flex; align-items: center; justify-content: center;
    background: #3B82F6; border-radius: 12px;
    font-size: 22px; font-weight: 700;
    transition: background 300ms ease, transform 300ms ease;
    overflow: hidden;
  }
  .cell.active { background: #F59E0B; transform: translateY(-8px); }
  .cell.done   { background: #10B981; }
  .controls { display: flex; gap: 12px; align-items: center; }
  button {
    background: #1E293B; color: #F1F5F9; border: 1px solid #334155;
    border-radius: 8px; padding: 10px 18px; font-size: 14px;
    font-family: inherit; cursor: pointer; transition: background 200ms ease;
  }
  button:hover:not(:disabled) { background: #334155; }
  button:disabled { opacity: 0.4; cursor: default; }
  .step-count { font-size: 13px; color: #94A3B8; margin-left: auto; }
</style>
</head>
<body>
  <h1>Linear search — scanning for 43</h1>
  <div class="caption" id="caption"></div>
  <div class="row" id="row"></div>
  <div class="controls">
    <button id="prev">Prev</button>
    <button id="play">Play</button>
    <button id="next">Next</button>
    <button id="reset">Reset</button>
    <span class="step-count" id="count"></span>
  </div>

<script>
  // ---- Data + precomputed steps. Steps are pure data: index i => a frame. ----
  var DATA = [38, 27, 43, 3, 9];
  var TARGET = 43;
  var STEPS = DATA.map(function (v, i) {
    return {
      cursor: i,
      found: v === TARGET,
      caption: v === TARGET
        ? 'Index ' + i + ' holds ' + v + ' — match found, search stops.'
        : 'Index ' + i + ' holds ' + v + ' — not ' + TARGET + ', move right.'
    };
  });
  var LAST = STEPS.findIndex(function (s) { return s.found; });
  STEPS = STEPS.slice(0, LAST + 1);

  // ---- Single state object. Every visual fact derives from this. ----
  var state = { step: 0, playing: false };
  var timer = null;

  // ---- One render(). Never touch the DOM anywhere else. ----
  function render() {
    var frame = STEPS[state.step];
    var row = document.getElementById('row');
    row.innerHTML = '';
    DATA.forEach(function (v, i) {
      var cell = document.createElement('div');
      cell.className = 'cell'
        + (i === frame.cursor && frame.found ? ' done' : '')
        + (i === frame.cursor && !frame.found ? ' active' : '');
      cell.textContent = v;
      row.appendChild(cell);
    });
    document.getElementById('caption').textContent = frame.caption;
    document.getElementById('count').textContent =
      'Step ' + (state.step + 1) + ' of ' + STEPS.length;
    document.getElementById('prev').disabled = state.step === 0;
    document.getElementById('next').disabled = state.step === STEPS.length - 1;
    document.getElementById('play').textContent = state.playing ? 'Pause' : 'Play';
  }

  function go(step) {
    state.step = Math.max(0, Math.min(STEPS.length - 1, step));
    if (state.step === STEPS.length - 1) stop();
    render();
  }
  function stop() {
    state.playing = false;
    if (timer) { clearInterval(timer); timer = null; }
  }
  // ---- Reset is idempotent: safe from any state, including after Reset. ----
  function reset() { stop(); state.step = 0; render(); }

  document.getElementById('next').onclick = function () { stop(); go(state.step + 1); };
  document.getElementById('prev').onclick = function () { stop(); go(state.step - 1); };
  document.getElementById('reset').onclick = reset;
  document.getElementById('play').onclick = function () {
    if (state.playing) { stop(); render(); return; }
    if (state.step === STEPS.length - 1) state.step = 0;
    state.playing = true;
    timer = setInterval(function () { go(state.step + 1); }, 900);
    render();
  };

  reset();
</script>
</body>
</html>`;

export function buildVizInteractivePrompt(options: {
  subjectName: string;
  coreConcept: string;
  sourceContent: string;
}): string {
  const { subjectName, coreConcept, sourceContent } = options;

  return `<role>
You are building a single interactive visualization for an engineering student
who just read the tutor answer below and asked to SEE it. Output ONE
self-contained HTML document. It renders inside a sandboxed iframe with no
network access.
</role>

<subject>${subjectName}</subject>

<core_concept>
${coreConcept}
</core_concept>

<source_answer>
${sourceContent}
</source_answer>

${VIZ_DESIGN_SYSTEM}

<interactivity>
MANDATORY. A static picture is a failed response. Pick the control that fits the
content — do not add all three:

- STEP-THROUGH (Next / Prev / Play / Reset) — for processes, algorithms, and
  mechanisms. The default choice. Precompute the frames as an array of plain
  data objects, then index into it. Never compute a frame "live" during play.
- PARAMETER SLIDER with live redraw — for relationships where one input governs
  the picture. Label the slider with its quantity AND unit, and show the current
  value as text next to it.
- HOVER-REVEAL annotations — for structures where each part needs a note. Only
  when neither of the above applies; it is the weakest of the three.

Whatever you choose: the student must be able to reach EVERY meaningful state
using the controls, and the caption must explain what they are looking at in that
state. The caption changes with the state — a fixed caption is a failed response.
</interactivity>

${VIZ_LAYOUT_SAFETY}

${VIZ_SIZE_CONTRACT}

<worked_example>
Below is a complete, correct response for a simpler concept (linear search).
Match its STRUCTURE exactly — precomputed step data, one \`state\` object, one
\`render()\` reading that state, CSS transitions, an idempotent \`reset()\`,
disabled controls at the boundaries, a caption that tracks the step.

Do NOT copy its content. Your visualization is about the core_concept above.
Match the discipline, not the subject.

${VIZ_INTERACTIVE_EXAMPLE}
</worked_example>

<output>
Return ONLY the HTML document — starting with <!DOCTYPE html> and ending with
</html>. No markdown fence, no commentary, no explanation before or after.
</output>`;
}

// ─── CALL 2b — diagram (Mermaid) ─────────────────────────────────────────────

export function buildVizDiagramPrompt(options: {
  subjectName: string;
  coreConcept: string;
  sourceContent: string;
}): string {
  const { subjectName, coreConcept, sourceContent } = options;

  return `<role>
You are drawing ONE Mermaid diagram for an engineering student who just read the
tutor answer below and asked to see its structure.
</role>

<subject>${subjectName}</subject>

<core_concept>
${coreConcept}
</core_concept>

<source_answer>
${sourceContent}
</source_answer>

<direction>
- \`flowchart LR\` for flows, pipelines, and sequences — anything that reads as
  "A then B then C". Left-to-right keeps step labels readable.
- \`flowchart TD\` for hierarchies, taxonomies, and decision trees — anything
  with a single root and branching children.
Choose based on the content, not habit.
</direction>

<hygiene>
These rules exist because the renderer fails or the labels become unreadable
otherwise. They are hard constraints:
- 4 to 16 nodes. Fewer than 4 is not worth drawing; more than 16 is unreadable
  at chat width. If the concept needs more, draw only its most important layer.
- Max 4 words per label, node labels and edge labels alike.
- NO parentheses, underscores, or curly braces anywhere inside a label.
  Write "public key" not "public_key". Write "hash the data" not "hash(data)".
- Node IDs: short and alphanumeric (A, B, C1, step2). Labels go in brackets.
- No styling directives, no classDef, no click handlers, no subgraph unless the
  grouping is genuinely part of the concept.
</hygiene>

<output>
Return JSON with a single "mermaid" field holding the diagram source only —
no markdown fence inside the string, no commentary.
</output>`;
}

// ─── CALL 2c — plot ──────────────────────────────────────────────────────────

export function buildVizPlotPrompt(options: {
  subjectName: string;
  coreConcept: string;
  sourceContent: string;
}): string {
  const { subjectName, coreConcept, sourceContent } = options;

  return `<role>
You are plotting ONE mathematical relationship for an engineering student who
just read the tutor answer below. Output ONE self-contained HTML document. It
renders inside a sandboxed iframe with no network access.
</role>

<subject>${subjectName}</subject>

<core_concept>
${coreConcept}
</core_concept>

<source_answer>
${sourceContent}
</source_answer>

${VIZ_DESIGN_SYSTEM}

<computed_plot>
THE CENTRAL RULE: the curve is COMPUTED, never drawn by hand.

You must NOT write an SVG path with coordinates you chose yourself. A
hand-written \`<path d="M 50 200 C 120 80 ...">\` is a failed response — those
curves are always subtly wrong, and they cannot respond to a slider.

Instead, write JavaScript that:
1. Defines the actual formula as a function, e.g.
     function f(x) { return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(...); }
   Use the real formula from the source answer. If the answer states constants
   or units, use those exact values.
2. Samples it across the domain — 200+ points — into an array.
3. Maps data coordinates to SVG coordinates through explicit scale functions:
     function sx(x) { return PAD + (x - X_MIN) / (X_MAX - X_MIN) * PLOT_W; }
     function sy(y) { return PAD + PLOT_H - (y - Y_MIN) / (Y_MAX - Y_MIN) * PLOT_H; }
4. Builds the path string by joining those mapped points, and assigns it with
   \`path.setAttribute('d', ...)\`.
5. Draws axes, tick marks, and gridlines the same way — in code, from the scale
   functions, in a loop. Not as hand-placed literals.
</computed_plot>

<plot_requirements>
- Axis labels on BOTH axes, each naming the quantity AND its unit where the
  concept has one: "Pressure (kPa)", "Time (s)", "Probability density".
  If a quantity is genuinely dimensionless, label it without a unit.
- Gridlines in a muted colour behind the curve; the curve in --default, at
  2px or thicker, with no fill unless the concept is about area under it.
- Tick labels on both axes, at readable intervals, in --muted.
- A title line naming the relationship being plotted.
- ONE slider, WHERE THE RELATIONSHIP ALLOWS: pick the single parameter that
  most changes the shape (sigma for a Gaussian, temperature for an isotherm,
  frequency for a wave). Moving it recomputes the samples and re-assigns the
  path — the axes and scales stay fixed so the change is legible. Label the
  slider with the parameter, its unit, and its live value.
  If the relationship has no meaningful free parameter, omit the slider rather
  than inventing one.
</plot_requirements>

${VIZ_LAYOUT_SAFETY}

${VIZ_SIZE_CONTRACT}

<output>
Return ONLY the HTML document — starting with <!DOCTYPE html> and ending with
</html>. No markdown fence, no commentary, no explanation before or after.
</output>`;
}

// ─── Per-vizType generation registry ─────────────────────────────────────────

interface VizGenerationSpec {
  task: string;
  payloadKind: VizPayloadKind;
  buildPrompt: (options: {
    subjectName: string;
    coreConcept: string;
    sourceContent: string;
  }) => string;
}

/**
 * vizType → how to generate it. The route reads this table and never branches
 * on vizType itself, so a fourth type is one entry plus one builder.
 *
 * The panel's loading copy and labels live in vizTypes.ts rather than here:
 * the browser needs them, and this module cannot be imported client-side
 * without shipping every prompt with it.
 */
export const VIZ_REGISTRY: Record<VizType, VizGenerationSpec> = {
  interactive: {
    task: "chat_visualize",
    payloadKind: "html",
    buildPrompt: buildVizInteractivePrompt,
  },
  diagram: {
    task: "chat_viz_diagram",
    payloadKind: "mermaid",
    buildPrompt: buildVizDiagramPrompt,
  },
  plot: {
    task: "chat_viz_plot",
    payloadKind: "html",
    buildPrompt: buildVizPlotPrompt,
  },
};
