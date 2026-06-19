// ─── Input ───────────────────────────────────────────
export interface ExplainerRequest {
  topic: string;
  subject_id?: string;
  module_id?: string;
  context_hint?: string;
  audience_semester?: number;
}

export interface SubjectContext {
  subject_name: string;
  module_name: string;
  module_description: string;
  course_outcomes: { co_code: string; description: string }[];
  branch: string;
  semester: number;
}

// ─── Pattern types ───────────────────────────────────
export type ExplainerPattern =
  | "array_sort"
  | "array_search"
  | "graph_algorithm"
  | "tree_traversal"
  | "stack_queue_ops"
  | "dp_table"
  | "formula_derivation"
  | "concept_analogy"
  | "comparison_table"
  | "process_flow"
  | "cause_effect_chain"
  | "definition_with_example"
  | "hierarchy_structure"
  | "state_machine"
  | "unknown"; // fallback to concept_analogy renderer

export type ColorScheme = "blue" | "green" | "purple" | "amber";
export type Complexity = "foundational" | "intermediate" | "advanced";

// ─── Pattern-specific data types ─────────────────────

export interface ArraySortData {
  values: number[];
  steps: {
    action: "compare" | "swap" | "sorted" | "pivot" | "merge";
    indices: number[]; // which indices are involved
    values_after: number[]; // full array state after this step
    label: string; // "Comparing 38 and 27"
  }[];
  algorithm_name: string; // "Merge Sort", "Quick Sort" etc
}

export interface ArraySearchData {
  values: number[];
  target: number;
  steps: {
    action: "check" | "eliminate" | "found" | "mid";
    indices: number[];
    label: string;
  }[];
  algorithm_name: string;
}

export interface GraphAlgorithmData {
  nodes: { id: string; label: string; x: number; y: number }[];
  edges: { from: string; to: string; weight?: number }[];
  steps: {
    action: "visit" | "enqueue" | "relax" | "finalize" | "path";
    node_id?: string;
    edge?: { from: string; to: string };
    label: string;
    queue_state?: string[];
  }[];
  algorithm_name: string;
  start_node: string;
}

export interface TreeTraversalData {
  nodes: {
    id: string;
    value: string;
    parent_id?: string;
    position: "left" | "right" | "root";
  }[];
  traversal_order: string[]; // node ids in visit order
  traversal_name: string; // "Inorder", "Preorder" etc
  steps: {
    node_id: string;
    action: "visit" | "backtrack" | "output";
    output_so_far: string[];
    label: string;
  }[];
}

export interface StackQueueData {
  structure: "stack" | "queue" | "deque";
  operations: {
    op: "push" | "pop" | "enqueue" | "dequeue" | "peek";
    value?: string | number;
    state_after: (string | number)[];
    label: string;
  }[];
  use_case: string; // "Function call stack", "BFS queue" etc
}

export interface DpTableData {
  problem_name: string; // "0/1 Knapsack", "LCS" etc
  table_headers: { rows: string[]; cols: string[] };
  fill_order: {
    row: number;
    col: number;
    value: number;
    formula_used: string; // "dp[i-1][j] = 3, dp[i-1][j-w] + v = 5 → 5"
    label: string;
  }[];
  final_answer: string;
}

export interface FormulaDerivationData {
  formula_name: string; // "Time Complexity of Merge Sort"
  final_formula: string; // "O(n log n)"
  steps: {
    expression: string; // the formula/expression at this step
    explanation: string; // why this step
    highlight_part?: string; // which term to emphasize
  }[];
  substitution_example?: {
    variable_values: { variable: string; value: string }[];
    result: string;
  };
}

export interface ConceptAnalogyData {
  concept_name: string;
  analogy: {
    title: string; // "Like a Library Book System"
    elements: {
      analogy_item: string; // "Book shelf"
      maps_to: string; // "Memory address"
      explanation: string;
    }[];
    scenario: string; // Short story using the analogy
  };
  formal_definition: string;
  key_properties: string[];
  exam_context: string; // What they'll be asked about this
}

export interface ComparisonTableData {
  item_a: string; // "TCP"
  item_b: string; // "UDP"
  dimensions: {
    label: string; // "Reliability"
    a_value: string; // "Guaranteed delivery"
    b_value: string; // "Best effort"
    winner?: "a" | "b" | "neither" | "depends";
  }[];
  use_case_a: string;
  use_case_b: string;
  summary: string;
}

export interface ProcessFlowData {
  process_name: string;
  steps: {
    id: string;
    label: string;
    description: string;
    type: "start" | "process" | "decision" | "end";
    next_id?: string;
    yes_id?: string; // for decision nodes
    no_id?: string;
    indian_example?: string;
  }[];
}

export interface CauseEffectData {
  title: string;
  chain: {
    id: string;
    label: string;
    type: "cause" | "effect" | "consequence";
    description: string;
  }[];
  root_cause: string;
  final_consequence: string;
  indian_context_example: string;
}

export interface HierarchyData {
  root: HierarchyNode;
  title: string;
  description: string;
}
export interface HierarchyNode {
  id: string;
  label: string;
  sublabel?: string;
  children?: HierarchyNode[];
  highlight?: boolean;
}

export interface DefinitionWithExampleData {
  term: string;
  formal_definition: string;
  simple_definition: string; // plain English
  examples: {
    label: string;
    description: string;
    is_counter_example?: boolean;
  }[];
  memory_hook: string; // one-line mnemonic
  exam_tip: string;
}

export interface StateMachineData {
  title: string;
  states: { id: string; label: string; is_initial?: boolean; is_final?: boolean }[];
  transitions: { from: string; to: string; label: string }[];
  example_trace: { state_id: string; input: string; description: string }[];
}

// Union of all pattern data
export type PatternData =
  | { pattern: "array_sort"; data: ArraySortData }
  | { pattern: "array_search"; data: ArraySearchData }
  | { pattern: "graph_algorithm"; data: GraphAlgorithmData }
  | { pattern: "tree_traversal"; data: TreeTraversalData }
  | { pattern: "stack_queue_ops"; data: StackQueueData }
  | { pattern: "dp_table"; data: DpTableData }
  | { pattern: "formula_derivation"; data: FormulaDerivationData }
  | { pattern: "concept_analogy"; data: ConceptAnalogyData }
  | { pattern: "comparison_table"; data: ComparisonTableData }
  | { pattern: "process_flow"; data: ProcessFlowData }
  | { pattern: "cause_effect_chain"; data: CauseEffectData }
  | { pattern: "definition_with_example"; data: DefinitionWithExampleData }
  | { pattern: "hierarchy_structure"; data: HierarchyData }
  | { pattern: "state_machine"; data: StateMachineData }
  | { pattern: "unknown"; data: ConceptAnalogyData };

// ─── Extracted content (output of Call 2) ────────────
export interface ExtractedContent {
  pattern: ExplainerPattern;
  title: string;
  subtitle: string;
  color_scheme: ColorScheme;
  complexity: Complexity;
  pedagogical_narrative: string; // the full Call 1 output, stored for reference
  pattern_data: PatternData;
  narrative_segments: {
    caption: string; // max 25 words, what to say
    visual_phase: string; // internal hint for renderer timing
  }[];
  exam_tip: string;
  subject_name: string;
  module_name?: string;
}

// ─── Output ───────────────────────────────────────────
export interface GeneratedExplainer {
  id: string;
  short_code: string;
  topic: string;
  subject_name: string;
  html_player: string;
  storage_url: string;
  has_audio: boolean;
  duration_seconds: number;
  created_at: string;
  /**
   * LEGACY: the old flat ExplainerScript, still returned by the current
   * generate route / read by the faculty page until the Prompt-2 renderer
   * rewrite switches them to ExtractedContent. Optional so new producers can
   * omit it.
   */
  script?: ExplainerScript;
}

// ════════════════════════════════════════════════════════════════════════════
// LEGACY — flat ExplainerScript schema.
//
// Still consumed UNCHANGED by renderer.ts and tts.ts (and read by the faculty
// page) until Prompt 2 rewrites the renderer to consume ExtractedContent +
// PatternData. Do not build on these for new work; they will be removed once the
// pattern-based renderer lands.
// ════════════════════════════════════════════════════════════════════════════

export interface VisualElement {
  id: string;
  type: "text" | "rect" | "circle" | "arrow" | "image" | "code";
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  color?: string;
  bg_color?: string;
  font_size?: number;
  font_weight?: "normal" | "bold";
  border_radius?: number;
  opacity?: number;
  points?: string;
}

export interface AnimationCue {
  element: string;
  time: number;
  state:
    | "show"
    | "hide"
    | "highlight"
    | "set_text"
    | "set_color"
    | "move"
    | "pulse"
    | "shake";
  text?: string;
  color?: string;
  x?: number;
  y?: number;
  duration?: number;
}

export interface NarrativeSegment {
  segment_id: string;
  duration: number;
  narration: string;
  cues: AnimationCue[];
}

export interface ExplainerScript {
  topic: string;
  subject_name: string;
  duration_seconds: number;
  content_classification: string;
  canvas: {
    layout: "single" | "split_horizontal" | "split_vertical";
    background: string;
    primary_color: string;
    accent_color: string;
    font_family: string;
  };
  elements: VisualElement[];
  segments: NarrativeSegment[];
  metadata?: {
    module_name?: string;
    branch_context?: string;
    generated_for_co?: string;
  };
}
