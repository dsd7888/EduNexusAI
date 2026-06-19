/**
 * Explainer renderer — a PATTERN LIBRARY.
 *
 * renderExplainer(content) dispatches on content.pattern to one of the pattern
 * renderers below, each producing a complete, self-contained HTML document
 * (inline CSS + JS + Google-Fonts Inter, zero external deps besides the font).
 *
 * Architecture: every pattern computes, server-side and fully type-checked, a
 * list of FRAMES. A frame is a list of DOM ops ({ id, addClass, removeClass,
 * style, text, html }). One shared playback engine (ENGINE_JS) applies frame N
 * on forward play (so CSS transitions animate) and rebuilds-then-replays for
 * replay. This keeps the inline JS tiny and uniform while all pattern-specific
 * logic stays in TypeScript.
 *
 * Robustness: every renderer null-checks its arrays and never throws. If a
 * pattern's data is missing/incomplete, it degrades to a minimal valid
 * explainer (title + narration reveal). Unimplemented patterns (dp_table,
 * hierarchy_structure, definition_with_example, state_machine) fall through to
 * the concept-analogy renderer with a "coming soon" notice.
 */

import type {
  ArraySearchData,
  ArraySortData,
  CauseEffectData,
  ComparisonTableData,
  ConceptAnalogyData,
  ExtractedContent,
  FormulaDerivationData,
  GraphAlgorithmData,
  ProcessFlowData,
  StackQueueData,
  TreeTraversalData,
} from "./types";

// ─── Frame / op model (shared by every pattern) ─────────────────────────────

interface Op {
  id: string;
  addClass?: string;
  removeClass?: string;
  style?: Record<string, string>;
  text?: string;
  html?: string;
}
type Frame = Op[];

interface PatternRender {
  canvasInner: string;
  css?: string;
  frames: Frame[];
  captions: string[];
  durations: number[];
}

// ─── Geometry constants ─────────────────────────────────────────────────────

const CANVAS_W = 960;
const DEFAULT_SEGMENT_SECONDS = 4;

// ─── Escaping ───────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON safe to embed inside a <script> tag (neutralise `<`). */
function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null).replace(/</g, "\\u003c");
}

function dataOf<T>(content: ExtractedContent): T | undefined {
  const pd = content?.pattern_data as { data?: unknown } | undefined;
  return pd?.data as T | undefined;
}

/** Caption for frame i: prefer the authored narration, fall back to a label. */
function captionAt(
  content: ExtractedContent,
  i: number,
  fallback?: string
): string {
  const seg = content?.narrative_segments?.[i];
  return seg?.caption || fallback || "";
}

// ─── Shared design system (CSS) ─────────────────────────────────────────────

const COLOR_SCHEMES: Record<string, { primary: string; accent: string; dark: string }> = {
  blue: { primary: "#2563EB", accent: "#DBEAFE", dark: "#1E40AF" },
  green: { primary: "#16A34A", accent: "#DCFCE7", dark: "#15803D" },
  purple: { primary: "#7C3AED", accent: "#EDE9FE", dark: "#6D28D9" },
  amber: { primary: "#D97706", accent: "#FEF3C7", dark: "#B45309" },
};

function sharedCss(scheme: string): string {
  const s = COLOR_SCHEMES[scheme] ?? COLOR_SCHEMES.blue;
  return `
  :root{
    --primary:${s.primary}; --accent:${s.accent}; --dark:${s.dark};
    --color-default:#3B82F6; --color-active:#F59E0B; --color-success:#10B981;
    --color-error:#EF4444; --color-merged:#8B5CF6; --color-highlight:#EC4899;
    --bg:#0F172A; --surface:#1E293B; --surface-2:#334155;
    --text:#F1F5F9; --text-muted:#94A3B8; --border:#475569;
    --t-standard: all .4s cubic-bezier(.4,0,.2,1);
    --t-bounce: left .5s cubic-bezier(.34,1.56,.64,1), top .5s cubic-bezier(.34,1.56,.64,1);
    --t-snap: all .2s ease-out;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:#070b16;color:var(--text);
    font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;}
  #stage{width:${CANVAS_W}px;max-width:100%;margin:0 auto;padding:16px;}
  #canvas{position:relative;width:100%;aspect-ratio:16/9;background:var(--bg);
    border-radius:14px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.5);
    border:1px solid var(--border);}
  .zone-title{position:absolute;top:5%;left:0;right:0;text-align:center;
    font-size:24px;font-weight:800;color:var(--text);letter-spacing:.2px;}
  .zone-sub{position:absolute;top:14%;left:0;right:0;text-align:center;
    font-size:15px;color:var(--text-muted);}
  .zone-foot{position:absolute;bottom:4%;left:0;right:0;text-align:center;
    font-size:13px;color:var(--text-muted);}

  /* generic boxes / cells / nodes */
  .cell{position:absolute;width:72px;height:72px;border-radius:12px;
    display:flex;align-items:center;justify-content:center;font-weight:800;
    font-size:24px;color:#fff;background:var(--color-default);
    box-shadow:0 6px 16px rgba(0,0,0,.35);transition:var(--t-bounce),background .4s,opacity .4s,transform .4s;}
  .node{position:absolute;width:52px;height:52px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;font-weight:700;
    font-size:16px;color:#fff;background:var(--surface);border:2px solid var(--border);
    transition:var(--t-standard);transform:translate(-50%,-50%);}
  .pill{display:inline-flex;align-items:center;justify-content:center;
    min-width:40px;height:36px;padding:0 10px;margin:0 4px;border-radius:8px;
    background:var(--surface-2);color:var(--text);font-weight:700;font-size:15px;}

  /* semantic states */
  .s-default{background:var(--color-default);}
  .s-active{background:var(--color-active);}
  .s-success{background:var(--color-success);}
  .s-error{background:var(--color-error);}
  .s-merged{background:var(--color-merged);}
  .s-highlight{background:var(--color-highlight);}
  .node.s-active{background:var(--color-active);border-color:var(--color-active);}
  .node.s-visit{background:var(--color-highlight);border-color:var(--color-highlight);
    transform:translate(-50%,-50%) scale(1.25);box-shadow:0 0 0 6px rgba(236,72,153,.25);}
  .node.s-success{background:var(--color-success);border-color:var(--color-success);}
  .node.s-merged{background:var(--color-merged);border-color:var(--color-merged);}
  .eliminated{opacity:.2;}
  .pulse{animation:pulse .5s cubic-bezier(.34,1.56,.64,1);}
  .hidden{opacity:0;transform:translateY(14px);}
  .enter{animation:enterFade .45s cubic-bezier(.4,0,.2,1) both;}

  /* split / table / flow helpers */
  .panel{position:absolute;top:20%;height:62%;width:43%;background:var(--surface);
    border:1px solid var(--border);border-radius:12px;padding:14px;overflow:auto;}
  .panel.left{left:3%;} .panel.right{right:3%;}
  .panel h4{margin:0 0 8px;font-size:15px;color:var(--primary);}
  .map-row{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px;
    transition:var(--t-standard);}
  .bridge{position:absolute;left:46%;width:8%;top:20%;height:62%;display:flex;
    align-items:center;justify-content:center;color:var(--text-muted);font-size:22px;}
  .row{position:absolute;left:6%;right:6%;display:flex;align-items:center;
    gap:12px;background:var(--surface);border:1px solid var(--border);
    border-radius:10px;padding:10px 14px;transition:var(--t-standard);}
  .row .lhs,.row .rhs{flex:1;font-size:14px;}
  .row .rhs{text-align:right;}
  .row .mid{flex:0 0 30%;text-align:center;color:var(--text-muted);font-size:12px;
    text-transform:uppercase;letter-spacing:.5px;}
  .win{box-shadow:0 0 0 2px var(--color-success) inset;}
  .flow-box{position:absolute;left:50%;transform:translateX(-50%);min-width:200px;
    padding:10px 16px;border-radius:10px;background:var(--surface);
    border:1px solid var(--border);text-align:center;font-size:14px;
    transition:var(--t-standard);}
  .flow-box.decision{background:var(--dark);border-color:var(--primary);border-radius:14px;}
  .flow-box .ex{display:block;color:var(--text-muted);font-size:11px;margin-top:3px;}
  .chain-box{position:absolute;top:40%;transform:translateY(-50%);width:150px;
    padding:10px;border-radius:10px;background:var(--surface);border:1px solid var(--border);
    text-align:center;font-size:13px;transition:var(--t-standard);}
  .chain-box.root{border-color:var(--color-active);}
  .chain-box.final{border-color:var(--color-error);}
  .chain-ico{font-size:20px;display:block;margin-bottom:4px;}

  /* formula / stack-queue zones */
  .fzone{position:absolute;top:22%;left:6%;right:6%;bottom:18%;display:flex;
    flex-direction:column;align-items:center;justify-content:center;text-align:center;}
  .fexpr{font-size:34px;font-weight:800;color:var(--text);}
  .fexpr .hot{color:var(--color-active);}
  .fexpl{margin-top:14px;font-size:15px;color:var(--text-muted);max-width:80%;}
  .fsub{margin-top:14px;font-size:16px;color:var(--accent);}
  .sqzone{position:absolute;top:22%;left:0;right:0;bottom:16%;display:flex;
    align-items:center;justify-content:center;}
  .sqcol{display:flex;flex-direction:column-reverse;gap:6px;}
  .sqrow{display:flex;flex-direction:row;gap:6px;}
  .sqbox{width:64px;height:48px;border-radius:8px;background:var(--surface-2);
    color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;
    border:1px solid var(--border);animation:enterFade .35s both;}
  .badge{position:absolute;top:7%;right:5%;background:var(--surface);
    border:1px solid var(--primary);border-radius:8px;padding:6px 12px;
    font-size:14px;color:var(--accent);}
  .soon{position:absolute;top:7%;left:5%;background:var(--surface-2);
    border-radius:8px;padding:4px 10px;font-size:12px;color:var(--text-muted);}

  svg.edges{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
  svg.edges line{stroke:var(--border);stroke-width:2;transition:stroke .4s,stroke-width .4s;}
  svg.edges line.active{stroke:var(--color-active);stroke-width:3;}
  svg.edges line.path{stroke:var(--color-merged);stroke-width:3;}
  .edge-label{fill:var(--text-muted);font-size:11px;}
  #queue-zone{position:absolute;bottom:5%;left:0;right:0;text-align:center;
    font-size:13px;color:var(--text-muted);min-height:24px;}
  #out-zone{position:absolute;bottom:5%;left:0;right:0;display:flex;gap:6px;
    justify-content:center;}

  @keyframes enterFade{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
  @keyframes pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.18);}}

  /* shell: caption + controls */
  #caption-bar{height:80px;margin-top:12px;background:rgba(0,0,0,.9);
    border-radius:12px;display:flex;align-items:center;justify-content:center;
    padding:10px 20px;text-align:center;}
  #caption{font-size:18px;line-height:1.4;color:#fff;max-width:90%;
    transition:opacity .25s;}
  #controls{display:flex;align-items:center;gap:14px;margin-top:12px;}
  #play-btn{flex:0 0 auto;width:46px;height:46px;border:none;border-radius:50%;
    background:var(--primary);color:#fff;font-size:18px;cursor:pointer;
    display:flex;align-items:center;justify-content:center;transition:var(--t-snap);}
  #play-btn:hover{filter:brightness(1.1);}
  #progress{position:relative;flex:1;height:8px;background:var(--surface-2);
    border-radius:4px;}
  #progress-fill{position:absolute;left:0;top:0;height:100%;width:0;
    background:var(--primary);border-radius:4px;transition:width .3s ease;}
  #dots{display:flex;gap:6px;}
  .seg-dot{width:9px;height:9px;border-radius:50%;background:var(--surface-2);
    transition:var(--t-snap);}
  .seg-dot.done{background:var(--primary);}
  .seg-dot.active{background:var(--accent);transform:scale(1.3);}
  `;
}

// ─── Shared playback engine (no backticks / no ${} inside) ──────────────────

const ENGINE_JS = `
(function(){
  'use strict';
  var canvas=document.getElementById('canvas');
  var base=canvas?canvas.innerHTML:'';
  var F=window.__FRAMES||[], CAP=window.__CAPTIONS||[], DUR=window.__DURATIONS||[];
  var capEl=document.getElementById('caption');
  var btn=document.getElementById('play-btn');
  var fill=document.getElementById('progress-fill');
  var dots=[].slice.call(document.querySelectorAll('.seg-dot'));
  var N=F.length, cur=-1, playing=false, finished=false, timer=null;

  // Optional per-segment voiceover (best-effort; indexed by frame). The advance
  // timeline stays timer-driven so it never waits on a failed/blocked audio.
  var AUD=window.__AUDIO;
  var audioEls=(AUD&&AUD.length)?AUD.map(function(s){return s?new Audio(s):null;}):null;
  function pauseAudio(){ if(!audioEls) return; for(var i=0;i<audioEls.length;i++){ if(audioEls[i]){ try{audioEls[i].pause();}catch(e){} } } }
  function stopAudio(){ pauseAudio(); if(audioEls){ for(var i=0;i<audioEls.length;i++){ if(audioEls[i]){ try{audioEls[i].currentTime=0;}catch(e){} } } } }
  function playAudioFor(i){ if(!audioEls) return; pauseAudio(); var a=audioEls[i]; if(a){ try{ var p=a.play(); if(p&&p.catch) p.catch(function(){}); }catch(e){} } }

  function applyOp(o){
    var el=document.getElementById(o.id); if(!el) return;
    if(o.removeClass) o.removeClass.split(' ').forEach(function(c){ if(c) el.classList.remove(c); });
    if(o.addClass) o.addClass.split(' ').forEach(function(c){ if(c) el.classList.add(c); });
    if(o.style){ for(var k in o.style){ if(Object.prototype.hasOwnProperty.call(o.style,k)) el.style.setProperty(k,o.style[k]); } }
    if(o.html!=null) el.innerHTML=o.html;
    if(o.text!=null) el.textContent=o.text;
  }
  function applyFrame(i){ var f=F[i]||[]; for(var j=0;j<f.length;j++) applyOp(f[j]); }
  function setCaption(i){
    if(!capEl) return;
    capEl.style.opacity='0';
    setTimeout(function(){ capEl.textContent=CAP[i]||''; capEl.style.opacity='1'; }, 120);
  }
  function setProgress(i){
    if(fill) fill.style.width=(N<=0?0:Math.max(0,Math.min(1,(i+1)/N))*100)+'%';
    for(var d=0;d<dots.length;d++){
      if(d<=i) dots[d].classList.add('done'); else dots[d].classList.remove('done');
      if(d===i) dots[d].classList.add('active'); else dots[d].classList.remove('active');
    }
  }
  function icon(state){
    if(!btn) return;
    if(state==='pause'){ btn.innerHTML='&#10074;&#10074;'; }
    else if(state==='replay'){ btn.innerHTML='&#8635;'; }
    else { btn.innerHTML='&#9658;'; }
  }
  function advance(){
    if(cur>=N-1){ finished=true; playing=false; icon('replay'); return; }
    cur++; applyFrame(cur); setCaption(cur); setProgress(cur); playAudioFor(cur);
    if(playing){ clearTimeout(timer); timer=setTimeout(advance, (DUR[cur]||${DEFAULT_SEGMENT_SECONDS})*1000); }
  }
  function play(){ if(finished){ replay(); return; } playing=true; icon('pause'); advance(); }
  function pause(){ playing=false; clearTimeout(timer); pauseAudio(); icon('play'); }
  function replay(){ finished=false; cur=-1; stopAudio(); if(canvas) canvas.innerHTML=base; setProgress(-1); play(); }

  if(btn){ btn.addEventListener('click', function(){ if(finished) replay(); else if(playing) pause(); else play(); }); }
  if(N>0){ play(); } else { icon('replay'); }
})();
`;

// ─── HTML assembly ──────────────────────────────────────────────────────────

function assembleHtml(content: ExtractedContent, pr: PatternRender): string {
  const css = sharedCss(content?.color_scheme ?? "blue") + (pr.css ?? "");
  const dots = pr.frames.map(() => `<div class="seg-dot"></div>`).join("");
  const title = esc(
    content?.title || content?.subject_name || content?.pattern || "Explainer"
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <style>${css}</style>
</head>
<body>
  <div id="stage">
    <div id="canvas">${pr.canvasInner}</div>
    <div id="caption-bar"><div id="caption"></div></div>
    <div id="controls">
      <button id="play-btn" type="button" aria-label="Play">&#9658;</button>
      <div id="progress"><div id="progress-fill"></div></div>
      <div id="dots">${dots}</div>
    </div>
  </div>
  <script>
    window.__FRAMES=${safeJson(pr.frames)};
    window.__CAPTIONS=${safeJson(pr.captions)};
    window.__DURATIONS=${safeJson(pr.durations)};
    window.__AUDIO=null; /* per-segment audio data-URIs; injected by the generate route after TTS */
  </script>
  <script>${ENGINE_JS}</script>
</body>
</html>`;
}

/** A header (title + subtitle + optional notice) common to most canvases. */
function headerHtml(content: ExtractedContent, notice?: string): string {
  const soon = notice ? `<div class="soon">${esc(notice)}</div>` : "";
  return (
    soon +
    `<div class="zone-title">${esc(content?.title ?? "")}</div>` +
    `<div class="zone-sub">${esc(content?.subtitle ?? "")}</div>`
  );
}

/** Fallback frame set when a pattern has no usable data: reveal the narration. */
function narrationFrames(content: ExtractedContent): {
  frames: Frame[];
  captions: string[];
  durations: number[];
} {
  const segs = content?.narrative_segments ?? [];
  if (segs.length === 0) {
    return {
      frames: [[]],
      captions: [content?.subtitle || content?.title || ""],
      durations: [DEFAULT_SEGMENT_SECONDS],
    };
  }
  return {
    frames: segs.map(() => []),
    captions: segs.map((s, i) => s?.caption || captionAt(content, i)),
    durations: segs.map(() => DEFAULT_SEGMENT_SECONDS),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PATTERN 1 — array_sort
// ════════════════════════════════════════════════════════════════════════════

function renderArraySort(
  data: ArraySortData | undefined,
  content: ExtractedContent
): PatternRender {
  const values = Array.isArray(data?.values) ? data!.values : [];
  const steps = Array.isArray(data?.steps) ? data!.steps : [];
  const n = values.length;

  if (n === 0) {
    const nf = narrationFrames(content);
    return { canvasInner: headerHtml(content), ...nf };
  }

  const BOX = 72,
    GAP = 18;
  const totalW = n * BOX + (n - 1) * GAP;
  const startX = Math.max(8, (CANVAS_W - totalW) / 2);
  const slotX = (slot: number) => Math.round(startX + slot * (BOX + GAP));
  const TOP = "44%";

  let boxes = "";
  for (let k = 0; k < n; k++) {
    boxes += `<div id="as-${k}" class="cell s-default" style="left:${slotX(k)}px;top:${TOP}">${esc(values[k])}</div>`;
  }
  const algoName = esc(data?.algorithm_name || content?.title || "Sorting");
  const canvasInner =
    headerHtml(content) +
    `<div class="zone-sub" style="top:14%">${algoName}</div>` +
    boxes;

  // simulate: boxAtSlot[slot] = boxIndex (identity that carries its value)
  const boxAtSlot = values.map((_, k) => k);
  const sorted = new Set<number>();
  let prevActive: number[] = [];
  const frames: Frame[] = [];
  const captions: string[] = [];

  for (let s = 0; s < steps.length; s++) {
    const step = steps[s];
    const ops: Op[] = [];
    // revert previously-flashed boxes
    for (const b of prevActive) {
      ops.push({
        id: `as-${b}`,
        removeClass: "s-active s-highlight s-merged pulse",
        addClass: sorted.has(b) ? "s-success" : "s-default",
      });
    }
    prevActive = [];
    const idxs = Array.isArray(step?.indices) ? step.indices : [];
    switch (step?.action) {
      case "swap": {
        if (idxs.length >= 2) {
          const a = idxs[0],
            b = idxs[1];
          const boxA = boxAtSlot[a],
            boxB = boxAtSlot[b];
          if (boxA != null && boxB != null) {
            boxAtSlot[a] = boxB;
            boxAtSlot[b] = boxA;
            ops.push({ id: `as-${boxA}`, addClass: "s-active", style: { left: slotX(b) + "px" } });
            ops.push({ id: `as-${boxB}`, addClass: "s-active", style: { left: slotX(a) + "px" } });
            prevActive = [boxA, boxB];
          }
        }
        break;
      }
      case "sorted": {
        for (const slot of idxs) {
          const b = boxAtSlot[slot];
          if (b != null) {
            sorted.add(b);
            ops.push({ id: `as-${b}`, removeClass: "s-default s-active", addClass: "s-success pulse" });
          }
        }
        break;
      }
      case "pivot": {
        for (const slot of idxs) {
          const b = boxAtSlot[slot];
          if (b != null) {
            ops.push({ id: `as-${b}`, addClass: "s-highlight" });
            prevActive.push(b);
          }
        }
        break;
      }
      case "merge": {
        for (const slot of idxs) {
          const b = boxAtSlot[slot];
          if (b != null) {
            ops.push({ id: `as-${b}`, addClass: "s-merged" });
            prevActive.push(b);
          }
        }
        break;
      }
      case "compare":
      default: {
        for (const slot of idxs) {
          const b = boxAtSlot[slot];
          if (b != null) {
            ops.push({ id: `as-${b}`, addClass: "s-active pulse" });
            prevActive.push(b);
          }
        }
        break;
      }
    }
    frames.push(ops);
    captions.push(captionAt(content, s, step?.label));
  }

  if (frames.length === 0) {
    frames.push([]);
    captions.push(content?.subtitle || algoName);
  }
  return {
    canvasInner,
    frames,
    captions,
    durations: frames.map(() => 3),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PATTERN 2 — array_search
// ════════════════════════════════════════════════════════════════════════════

function renderArraySearch(
  data: ArraySearchData | undefined,
  content: ExtractedContent
): PatternRender {
  const values = Array.isArray(data?.values) ? data!.values : [];
  const steps = Array.isArray(data?.steps) ? data!.steps : [];
  const n = values.length;

  if (n === 0) {
    const nf = narrationFrames(content);
    return { canvasInner: headerHtml(content), ...nf };
  }

  const BOX = 64,
    GAP = 14;
  const totalW = n * BOX + (n - 1) * GAP;
  const startX = Math.max(8, (CANVAS_W - totalW) / 2);
  const slotX = (slot: number) => Math.round(startX + slot * (BOX + GAP));

  let boxes = "";
  for (let k = 0; k < n; k++) {
    boxes += `<div id="se-${k}" class="cell s-default" style="left:${slotX(k)}px;top:46%;width:${BOX}px;height:${BOX}px;font-size:20px">${esc(values[k])}</div>`;
  }
  const target = data?.target;
  const targetBadge =
    target != null ? `<div class="badge">Looking for: ${esc(target)}</div>` : "";
  const canvasInner = headerHtml(content) + targetBadge + boxes;

  const frames: Frame[] = [];
  const captions: string[] = [];
  let prev: number[] = [];

  for (let s = 0; s < steps.length; s++) {
    const step = steps[s];
    const ops: Op[] = [];
    for (const b of prev) {
      ops.push({ id: `se-${b}`, removeClass: "s-active s-highlight pulse" });
    }
    prev = [];
    const idxs = Array.isArray(step?.indices) ? step.indices : [];
    switch (step?.action) {
      case "eliminate":
        for (const i of idxs) ops.push({ id: `se-${i}`, addClass: "eliminated" });
        break;
      case "mid":
        for (const i of idxs) {
          ops.push({ id: `se-${i}`, addClass: "s-highlight" });
          prev.push(i);
        }
        break;
      case "found":
        for (const i of idxs)
          ops.push({ id: `se-${i}`, removeClass: "s-default s-active", addClass: "s-success pulse" });
        break;
      case "check":
      default:
        for (const i of idxs) {
          ops.push({ id: `se-${i}`, addClass: "s-active pulse" });
          prev.push(i);
        }
        break;
    }
    frames.push(ops);
    captions.push(captionAt(content, s, step?.label));
  }

  if (frames.length === 0) {
    frames.push([]);
    captions.push(content?.subtitle || "");
  }
  return { canvasInner, frames, captions, durations: frames.map(() => 3) };
}

// ════════════════════════════════════════════════════════════════════════════
// PATTERN 3 — graph_algorithm
// ════════════════════════════════════════════════════════════════════════════

function renderGraphAlgorithm(
  data: GraphAlgorithmData | undefined,
  content: ExtractedContent
): PatternRender {
  const nodes = Array.isArray(data?.nodes) ? data!.nodes : [];
  const edges = Array.isArray(data?.edges) ? data!.edges : [];
  const steps = Array.isArray(data?.steps) ? data!.steps : [];

  if (nodes.length === 0) {
    const nf = narrationFrames(content);
    return { canvasInner: headerHtml(content), ...nf };
  }

  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((nd, i) => {
    const x = typeof nd?.x === "number" ? nd.x : 20 + (i * 60) / Math.max(1, nodes.length);
    const y = typeof nd?.y === "number" ? nd.y : 45;
    if (nd?.id) pos.set(nd.id, { x, y });
  });

  const edgeId = (f: string, t: string) => `ge-${f}__${t}`;
  let edgeSvg = "";
  for (const e of edges) {
    const a = pos.get(e?.from ?? "");
    const b = pos.get(e?.to ?? "");
    if (!a || !b) continue;
    edgeSvg += `<line id="${esc(edgeId(e.from, e.to))}" x1="${a.x}%" y1="${a.y}%" x2="${b.x}%" y2="${b.y}%" />`;
    if (e?.weight != null) {
      edgeSvg += `<text class="edge-label" x="${(a.x + b.x) / 2}%" y="${(a.y + b.y) / 2}%">${esc(e.weight)}</text>`;
    }
  }
  let nodeHtml = "";
  for (const nd of nodes) {
    const p = nd?.id ? pos.get(nd.id) : undefined;
    if (!p) continue;
    nodeHtml += `<div id="gn-${esc(nd.id)}" class="node" style="left:${p.x}%;top:${p.y}%">${esc(nd.label ?? nd.id)}</div>`;
  }
  const canvasInner =
    headerHtml(content) +
    `<svg class="edges" viewBox="0 0 100 100" preserveAspectRatio="none">${edgeSvg}</svg>` +
    nodeHtml +
    `<div id="queue-zone"></div>`;

  const frames: Frame[] = [];
  const captions: string[] = [];
  let prevVisit: string | null = null;

  for (let s = 0; s < steps.length; s++) {
    const step = steps[s];
    const ops: Op[] = [];
    if (prevVisit) ops.push({ id: `gn-${prevVisit}`, removeClass: "s-visit", addClass: "s-success" });
    prevVisit = null;
    const nodeId = step?.node_id;
    switch (step?.action) {
      case "enqueue":
        if (nodeId) ops.push({ id: `gn-${nodeId}`, addClass: "s-active" });
        break;
      case "visit":
        if (nodeId) {
          ops.push({ id: `gn-${nodeId}`, removeClass: "s-active", addClass: "s-visit" });
          prevVisit = nodeId;
        }
        break;
      case "relax":
        if (step?.edge?.from && step?.edge?.to)
          ops.push({ id: edgeId(step.edge.from, step.edge.to), addClass: "active" });
        break;
      case "finalize":
        if (nodeId) ops.push({ id: `gn-${nodeId}`, removeClass: "s-active s-visit", addClass: "s-success" });
        break;
      case "path":
        if (step?.edge?.from && step?.edge?.to)
          ops.push({ id: edgeId(step.edge.from, step.edge.to), removeClass: "active", addClass: "path" });
        if (nodeId) ops.push({ id: `gn-${nodeId}`, addClass: "s-merged" });
        break;
      default:
        break;
    }
    const q = Array.isArray(step?.queue_state) ? step.queue_state : null;
    if (q) {
      const pills = q.map((v) => `<span class="pill">${esc(v)}</span>`).join("");
      ops.push({ id: "queue-zone", html: `Queue: ${pills || "—"}` });
    }
    frames.push(ops);
    captions.push(captionAt(content, s, step?.label));
  }

  if (frames.length === 0) {
    frames.push([]);
    captions.push(content?.subtitle || esc(data?.algorithm_name ?? ""));
  }
  return { canvasInner, frames, captions, durations: frames.map(() => 3.5) };
}

// ════════════════════════════════════════════════════════════════════════════
// PATTERN 4 — tree_traversal
// ════════════════════════════════════════════════════════════════════════════

function renderTreeTraversal(
  data: TreeTraversalData | undefined,
  content: ExtractedContent
): PatternRender {
  const nodes = Array.isArray(data?.nodes) ? data!.nodes : [];
  const steps = Array.isArray(data?.steps) ? data!.steps : [];
  if (nodes.length === 0) {
    const nf = narrationFrames(content);
    return { canvasInner: headerHtml(content), ...nf };
  }

  // Build child lists and depths from parent_id.
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  const children = new Map<string, string[]>();
  let rootId: string | undefined;
  for (const nd of nodes) {
    if (!nd?.parent_id || nd.position === "root") {
      if (!rootId) rootId = nd.id;
    } else {
      const arr = children.get(nd.parent_id) ?? [];
      arr.push(nd.id);
      children.set(nd.parent_id, arr);
    }
  }
  if (!rootId) rootId = nodes[0]?.id;

  // Assign x by in-order leaf counting, y by depth.
  const pos = new Map<string, { x: number; y: number }>();
  let leafCursor = 0;
  const leaves = Math.max(1, nodes.filter((nd) => (children.get(nd.id) ?? []).length === 0).length);
  function layout(id: string | undefined, depth: number): number {
    if (!id || !byId.has(id)) return leafCursor;
    const kids = children.get(id) ?? [];
    const y = 15 + depth * 18;
    if (kids.length === 0) {
      const x = ((leafCursor + 0.5) / leaves) * 80 + 10;
      pos.set(id, { x, y });
      leafCursor++;
      return x;
    }
    const xs = kids.map((k) => layout(k, depth + 1));
    const x = xs.reduce((a, b) => a + b, 0) / xs.length;
    pos.set(id, { x, y });
    return x;
  }
  layout(rootId, 0);

  let edgeSvg = "";
  for (const [pid, kids] of children) {
    const p = pos.get(pid);
    if (!p) continue;
    for (const k of kids) {
      const c = pos.get(k);
      if (c) edgeSvg += `<line x1="${p.x}%" y1="${p.y}%" x2="${c.x}%" y2="${c.y}%" />`;
    }
  }
  let nodeHtml = "";
  for (const nd of nodes) {
    const p = pos.get(nd.id);
    if (!p) continue;
    nodeHtml += `<div id="tn-${esc(nd.id)}" class="node" style="left:${p.x}%;top:${p.y}%;width:48px;height:48px">${esc(nd.value ?? "")}</div>`;
  }
  const tname = esc(data?.traversal_name || "Traversal");
  const canvasInner =
    headerHtml(content) +
    `<div class="zone-sub" style="top:14%">${tname}</div>` +
    `<svg class="edges" viewBox="0 0 100 100" preserveAspectRatio="none">${edgeSvg}</svg>` +
    nodeHtml +
    `<div id="out-zone"></div>`;

  const frames: Frame[] = [];
  const captions: string[] = [];
  let prev: string | null = null;
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s];
    const ops: Op[] = [];
    if (prev) ops.push({ id: `tn-${prev}`, removeClass: "s-active s-highlight" });
    prev = null;
    const nodeId = step?.node_id;
    if (step?.action === "output") {
      if (nodeId) ops.push({ id: `tn-${nodeId}`, addClass: "s-success pulse" });
      const out = Array.isArray(step?.output_so_far) ? step.output_so_far : [];
      ops.push({
        id: "out-zone",
        html: out.map((v) => `<span class="pill">${esc(v)}</span>`).join(""),
      });
    } else if (step?.action === "backtrack") {
      if (nodeId) {
        ops.push({ id: `tn-${nodeId}`, addClass: "s-highlight" });
        prev = nodeId;
      }
    } else {
      if (nodeId) {
        ops.push({ id: `tn-${nodeId}`, addClass: "s-active pulse" });
        prev = nodeId;
      }
    }
    frames.push(ops);
    captions.push(captionAt(content, s, step?.label));
  }

  if (frames.length === 0) {
    frames.push([]);
    captions.push(content?.subtitle || tname);
  }
  return { canvasInner, frames, captions, durations: frames.map(() => 3) };
}

// ════════════════════════════════════════════════════════════════════════════
// PATTERN 5 — stack_queue_ops
// ════════════════════════════════════════════════════════════════════════════

function renderStackQueue(
  data: StackQueueData | undefined,
  content: ExtractedContent
): PatternRender {
  const ops = Array.isArray(data?.operations) ? data!.operations : [];
  const isQueue = data?.structure === "queue" || data?.structure === "deque";
  const useCase = esc(data?.use_case || content?.subtitle || "");
  const canvasInner =
    headerHtml(content) +
    (useCase ? `<div class="zone-sub" style="top:14%">${useCase}</div>` : "") +
    `<div class="sqzone"><div id="sq" class="${isQueue ? "sqrow" : "sqcol"}"></div></div>`;

  const frames: Frame[] = [];
  const captions: string[] = [];
  for (let s = 0; s < ops.length; s++) {
    const op = ops[s];
    const state = Array.isArray(op?.state_after) ? op.state_after : [];
    const boxes = state.map((v) => `<div class="sqbox">${esc(v)}</div>`).join("");
    frames.push([{ id: "sq", html: boxes }]);
    captions.push(captionAt(content, s, op?.label || (op?.op ?? "")));
  }
  if (frames.length === 0) {
    frames.push([{ id: "sq", html: "" }]);
    captions.push(useCase);
  }
  return { canvasInner, frames, captions, durations: frames.map(() => 3) };
}

// ════════════════════════════════════════════════════════════════════════════
// PATTERN 6 — formula_derivation
// ════════════════════════════════════════════════════════════════════════════

function renderFormulaDerivation(
  data: FormulaDerivationData | undefined,
  content: ExtractedContent
): PatternRender {
  const steps = Array.isArray(data?.steps) ? data!.steps : [];
  const fname = esc(data?.formula_name || content?.title || "Derivation");
  const canvasInner =
    headerHtml(content) +
    `<div class="zone-sub" style="top:14%">${fname}</div>` +
    `<div class="fzone"><div id="fexpr" class="fexpr"></div><div id="fexpl" class="fexpl"></div><div id="fsub" class="fsub"></div></div>`;

  const frames: Frame[] = [];
  const captions: string[] = [];
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s];
    let expr = esc(step?.expression ?? "");
    const hot = step?.highlight_part ? esc(step.highlight_part) : "";
    if (hot && expr.includes(hot)) {
      expr = expr.replace(hot, `<span class="hot">${hot}</span>`);
    }
    frames.push([
      { id: "fexpr", html: `<span class="enter">${expr}</span>` },
      { id: "fexpl", text: step?.explanation ?? "" },
    ]);
    captions.push(captionAt(content, s, step?.explanation));
  }

  const sub = data?.substitution_example;
  if (sub) {
    const vars = Array.isArray(sub.variable_values) ? sub.variable_values : [];
    const varStr = vars.map((v) => `${esc(v?.variable)}=${esc(v?.value)}`).join(", ");
    frames.push([
      { id: "fsub", html: `<span class="enter">For ${esc(varStr)} → ${esc(sub.result ?? "")}</span>` },
    ]);
    captions.push(captionAt(content, steps.length, `Example: ${sub.result ?? ""}`));
  }

  if (frames.length === 0) {
    const final = esc(data?.final_formula ?? "");
    frames.push([{ id: "fexpr", html: final }]);
    captions.push(content?.subtitle || fname);
  }
  return { canvasInner, frames, captions, durations: frames.map(() => 4) };
}

// ════════════════════════════════════════════════════════════════════════════
// PATTERN 7 — concept_analogy (also the fallback for unimplemented patterns)
// ════════════════════════════════════════════════════════════════════════════

function renderConceptAnalogy(
  data: ConceptAnalogyData | undefined,
  content: ExtractedContent,
  notice?: string
): PatternRender {
  const elements = Array.isArray(data?.analogy?.elements) ? data!.analogy!.elements : [];

  // No analogy data → minimal narration reveal (used by unimplemented patterns).
  if (elements.length === 0) {
    const def = data?.formal_definition || content?.subtitle || "";
    const inner =
      headerHtml(content, notice) +
      `<div class="fzone"><div id="ca-def" class="fexpr" style="font-size:22px"></div>` +
      `<div id="ca-extra" class="fexpl"></div></div>`;
    const segs = content?.narrative_segments ?? [];
    const frames: Frame[] = [];
    const captions: string[] = [];
    const phases = segs.length > 0 ? segs : [{ caption: def, visual_phase: "" }];
    phases.forEach((seg, i) => {
      frames.push([
        { id: "ca-def", html: `<span class="enter">${esc(seg?.caption || def)}</span>` },
        { id: "ca-extra", text: i === phases.length - 1 ? esc(content?.exam_tip ?? "") : "" },
      ]);
      captions.push(seg?.caption || def);
    });
    return { canvasInner: inner, frames, captions, durations: frames.map(() => 4) };
  }

  const title = esc(data?.analogy?.title || "The Analogy");
  let leftRows = "";
  let rightRows = "";
  elements.forEach((el, i) => {
    leftRows += `<div id="ana-l-${i}" class="map-row hidden"><strong>${esc(el?.analogy_item)}</strong></div>`;
    rightRows += `<div id="ana-r-${i}" class="map-row hidden">→ <span>${esc(el?.maps_to)}</span></div>`;
  });
  const canvasInner =
    headerHtml(content, notice) +
    `<div class="panel left"><h4>${title}</h4>${leftRows}</div>` +
    `<div class="bridge">⇄</div>` +
    `<div class="panel right"><h4>${esc(data?.concept_name || "Concept")}</h4>${rightRows}` +
    `<div id="ana-def" class="map-row hidden" style="margin-top:10px;color:var(--text-muted)"></div></div>`;

  const frames: Frame[] = [];
  const captions: string[] = [];
  elements.forEach((el, i) => {
    frames.push([
      { id: `ana-l-${i}`, removeClass: "hidden", addClass: "enter" },
      { id: `ana-r-${i}`, removeClass: "hidden", addClass: "enter" },
    ]);
    captions.push(captionAt(content, i, el?.explanation));
  });
  // final: formal definition
  frames.push([
    { id: "ana-def", removeClass: "hidden", addClass: "enter", text: data?.formal_definition || content?.exam_tip || "" },
  ]);
  captions.push(captionAt(content, elements.length, data?.formal_definition));

  return { canvasInner, frames, captions, durations: frames.map(() => 4) };
}

// ════════════════════════════════════════════════════════════════════════════
// PATTERN 8 — comparison_table
// ════════════════════════════════════════════════════════════════════════════

function renderComparisonTable(
  data: ComparisonTableData | undefined,
  content: ExtractedContent
): PatternRender {
  const dims = Array.isArray(data?.dimensions) ? data!.dimensions : [];
  const a = esc(data?.item_a || "A");
  const b = esc(data?.item_b || "B");

  if (dims.length === 0) {
    const nf = narrationFrames(content);
    return { canvasInner: headerHtml(content), ...nf };
  }

  const headerRow = `<div class="row" style="top:20%;background:var(--dark)">
    <div class="lhs" style="font-weight:800;color:#fff">${a}</div>
    <div class="mid"></div>
    <div class="rhs" style="font-weight:800;color:#fff">${b}</div></div>`;

  const rowTop = (i: number) => 30 + i * 11;
  let rows = "";
  dims.forEach((d, i) => {
    const winA = d?.winner === "a" ? " win" : "";
    const winB = d?.winner === "b" ? " win" : "";
    rows += `<div id="cmp-${i}" class="row hidden" style="top:${rowTop(i)}%">
      <div class="lhs${winA}">${esc(d?.a_value)}</div>
      <div class="mid">${esc(d?.label)}</div>
      <div class="rhs${winB}">${esc(d?.b_value)}</div></div>`;
  });
  const useTop = rowTop(dims.length) + 2;
  const useCases =
    `<div id="cmp-use" class="row hidden" style="top:${Math.min(88, useTop)}%;background:var(--surface-2)">
      <div class="lhs">Use ${a}: ${esc(data?.use_case_a ?? "")}</div>
      <div class="mid"></div>
      <div class="rhs">Use ${b}: ${esc(data?.use_case_b ?? "")}</div></div>`;

  const canvasInner = headerHtml(content) + headerRow + rows + useCases;

  const frames: Frame[] = [];
  const captions: string[] = [];
  dims.forEach((d, i) => {
    frames.push([{ id: `cmp-${i}`, removeClass: "hidden", addClass: "enter" }]);
    captions.push(captionAt(content, i, d?.label));
  });
  frames.push([{ id: "cmp-use", removeClass: "hidden", addClass: "enter" }]);
  captions.push(captionAt(content, dims.length, data?.summary));

  return { canvasInner, frames, captions, durations: frames.map(() => 3) };
}

// ════════════════════════════════════════════════════════════════════════════
// PATTERN 9 — process_flow
// ════════════════════════════════════════════════════════════════════════════

function renderProcessFlow(
  data: ProcessFlowData | undefined,
  content: ExtractedContent
): PatternRender {
  const steps = Array.isArray(data?.steps) ? data!.steps : [];
  if (steps.length === 0) {
    const nf = narrationFrames(content);
    return { canvasInner: headerHtml(content), ...nf };
  }
  const top = (i: number) => 22 + i * (60 / Math.max(1, steps.length));
  let boxes = "";
  steps.forEach((st, i) => {
    const cls = st?.type === "decision" ? "flow-box decision" : "flow-box";
    const ex = st?.indian_example ? `<span class="ex">${esc(st.indian_example)}</span>` : "";
    boxes += `<div id="pf-${i}" class="${cls} hidden" style="top:${top(i)}%">${esc(st?.label)}${ex}</div>`;
  });
  const canvasInner = headerHtml(content) + boxes;

  const frames: Frame[] = [];
  const captions: string[] = [];
  steps.forEach((st, i) => {
    frames.push([{ id: `pf-${i}`, removeClass: "hidden", addClass: "enter" }]);
    captions.push(captionAt(content, i, st?.description || st?.label));
  });
  return { canvasInner, frames, captions, durations: frames.map(() => 3) };
}

// ════════════════════════════════════════════════════════════════════════════
// PATTERN 10 — cause_effect_chain
// ════════════════════════════════════════════════════════════════════════════

function renderCauseEffect(
  data: CauseEffectData | undefined,
  content: ExtractedContent
): PatternRender {
  const chain = Array.isArray(data?.chain) ? data!.chain : [];
  if (chain.length === 0) {
    const nf = narrationFrames(content);
    return { canvasInner: headerHtml(content), ...nf };
  }
  const icon = (t: string | undefined) =>
    t === "cause" ? "⚡" : t === "consequence" ? "❗" : "➜";
  const n = chain.length;
  const left = (i: number) => Math.round((i + 0.5) * (88 / n) + 6);
  let boxes = "";
  chain.forEach((c, i) => {
    const extra = c?.type === "cause" ? " root" : c?.type === "consequence" ? " final" : "";
    boxes += `<div id="ce-${i}" class="chain-box${extra} hidden" style="left:${left(i)}%;transform:translate(-50%,-50%)">
      <span class="chain-ico">${icon(c?.type)}</span>${esc(c?.label)}</div>`;
  });
  const canvasInner = headerHtml(content) + boxes;

  const frames: Frame[] = [];
  const captions: string[] = [];
  chain.forEach((c, i) => {
    frames.push([{ id: `ce-${i}`, removeClass: "hidden", addClass: "enter" }]);
    captions.push(captionAt(content, i, c?.description || c?.label));
  });
  return { canvasInner, frames, captions, durations: frames.map(() => 3) };
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

const COMING_SOON = "Pattern coming soon — showing key points";

/**
 * Render a complete, self-contained HTML explainer for the given content.
 * Dispatches on content.pattern; never throws (falls back to a narration reveal
 * on any unexpected error).
 */
export function renderExplainer(content: ExtractedContent): string {
  try {
    let pr: PatternRender;
    switch (content?.pattern) {
      case "array_sort":
        pr = renderArraySort(dataOf<ArraySortData>(content), content);
        break;
      case "array_search":
        pr = renderArraySearch(dataOf<ArraySearchData>(content), content);
        break;
      case "graph_algorithm":
        pr = renderGraphAlgorithm(dataOf<GraphAlgorithmData>(content), content);
        break;
      case "tree_traversal":
        pr = renderTreeTraversal(dataOf<TreeTraversalData>(content), content);
        break;
      case "stack_queue_ops":
        pr = renderStackQueue(dataOf<StackQueueData>(content), content);
        break;
      case "formula_derivation":
        pr = renderFormulaDerivation(dataOf<FormulaDerivationData>(content), content);
        break;
      case "comparison_table":
        pr = renderComparisonTable(dataOf<ComparisonTableData>(content), content);
        break;
      case "process_flow":
        pr = renderProcessFlow(dataOf<ProcessFlowData>(content), content);
        break;
      case "cause_effect_chain":
        pr = renderCauseEffect(dataOf<CauseEffectData>(content), content);
        break;
      case "concept_analogy":
      case "unknown":
        pr = renderConceptAnalogy(dataOf<ConceptAnalogyData>(content), content);
        break;
      // Not yet implemented → concept-analogy renderer with a notice.
      case "dp_table":
      case "hierarchy_structure":
      case "definition_with_example":
      case "state_machine":
      default:
        pr = renderConceptAnalogy(dataOf<ConceptAnalogyData>(content), content, COMING_SOON);
        break;
    }
    return assembleHtml(content, pr);
  } catch (err) {
    console.error("[renderExplainer] fell back to narration:", err);
    const nf = narrationFrames(content);
    return assembleHtml(content, { canvasInner: headerHtml(content), ...nf });
  }
}
