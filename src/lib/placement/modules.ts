import type { PracticeModule } from "@/lib/db/types";

export const PRACTICE_MODULES: PracticeModule[] = [
  // ── UNIVERSAL ──────────────────────────────────────────
  {
    id: "profit_loss",
    label: "Profit & Loss",
    category: "quantitative",
    branches: [],
    icon: "TrendingUp",
    description: "Markup, discount, successive profit/loss problems",
  },
  {
    id: "time_speed_distance",
    label: "Time, Speed & Distance",
    category: "quantitative",
    branches: [],
    icon: "Gauge",
    description: "Trains, boats, relative motion, average speed",
  },
  {
    id: "time_work",
    label: "Time & Work",
    category: "quantitative",
    branches: [],
    icon: "Clock",
    description: "Pipes & cisterns, combined work, efficiency",
  },
  {
    id: "si_ci",
    label: "Interest (SI & CI)",
    category: "quantitative",
    branches: [],
    icon: "Percent",
    description: "Simple and compound interest calculations",
  },
  {
    id: "number_series",
    label: "Number Series",
    category: "quantitative",
    branches: [],
    icon: "Hash",
    description: "Arithmetic, geometric, mixed patterns",
  },
  {
    id: "percentages",
    label: "Percentages",
    category: "quantitative",
    branches: [],
    icon: "Percent",
    description: "Percentage change, population, dilution",
  },
  {
    id: "data_interpretation",
    label: "Data Interpretation",
    category: "quantitative",
    branches: [],
    icon: "BarChart2",
    description: "Tables, bar charts, pie charts",
  },
  {
    id: "syllogisms",
    label: "Syllogisms",
    category: "logical",
    branches: [],
    icon: "GitMerge",
    description: "All/Some/No statements, Venn diagram logic",
  },
  {
    id: "coding_decoding",
    label: "Coding-Decoding",
    category: "logical",
    branches: [],
    icon: "Code2",
    description: "Letter shifts, number codes, symbol substitution",
  },
  {
    id: "blood_relations",
    label: "Blood Relations",
    category: "logical",
    branches: [],
    icon: "Users",
    description: "Family tree, relationship identification",
  },
  {
    id: "seating_arrangement",
    label: "Seating Arrangement",
    category: "logical",
    branches: [],
    icon: "LayoutGrid",
    description: "Linear and circular arrangement puzzles",
  },
  {
    id: "direction_sense",
    label: "Direction & Distance",
    category: "logical",
    branches: [],
    icon: "Compass",
    description: "Compass directions, distance calculation",
  },
  {
    id: "synonyms_antonyms",
    label: "Vocabulary",
    category: "verbal",
    branches: [],
    icon: "BookOpen",
    description: "GRE-level synonyms, antonyms, contextual meaning",
  },
  {
    id: "reading_comprehension",
    label: "Reading Comprehension",
    category: "verbal",
    branches: [],
    icon: "FileText",
    description: "Inference, main idea, vocabulary in context",
  },
  {
    id: "error_identification",
    label: "Grammar & Error",
    category: "verbal",
    branches: [],
    icon: "AlertCircle",
    description: "Subject-verb agreement, tense, prepositions",
  },

  // ── COMPUTER SCIENCE / IT ──────────────────────────────
  {
    id: "data_structures",
    label: "Data Structures",
    category: "technical",
    branches: ["Computer Science", "Information Technology"],
    icon: "Layers",
    description: "Arrays, linked lists, trees, graphs, heaps",
  },
  {
    id: "algorithms_complexity",
    label: "Algorithms & Complexity",
    category: "technical",
    branches: ["Computer Science", "Information Technology"],
    icon: "Zap",
    description: "Sorting, searching, Big-O analysis",
  },
  {
    id: "dbms",
    label: "DBMS & SQL",
    category: "technical",
    branches: ["Computer Science", "Information Technology"],
    icon: "Database",
    description: "Normalization, queries, joins, transactions",
  },
  {
    id: "operating_systems",
    label: "Operating Systems",
    category: "technical",
    branches: ["Computer Science", "Information Technology"],
    icon: "Monitor",
    description: "Scheduling, memory management, deadlocks",
  },
  {
    id: "computer_networks",
    label: "Computer Networks",
    category: "technical",
    branches: ["Computer Science", "Information Technology"],
    icon: "Network",
    description: "OSI model, TCP/IP, subnetting, protocols",
  },
  {
    id: "oops",
    label: "OOP Concepts",
    category: "technical",
    branches: ["Computer Science", "Information Technology"],
    icon: "Box",
    description: "Inheritance, polymorphism, encapsulation, abstraction",
  },

  // ── MECHANICAL ─────────────────────────────────────────
  {
    id: "thermodynamics",
    label: "Thermodynamics",
    category: "technical",
    branches: ["Mechanical"],
    icon: "Flame",
    description: "Laws of thermodynamics, cycles, heat engines",
  },
  {
    id: "fluid_mechanics",
    label: "Fluid Mechanics",
    category: "technical",
    branches: ["Mechanical", "Chemical", "Civil"],
    icon: "Droplets",
    description: "Bernoulli, continuity, flow regimes",
  },
  {
    id: "strength_of_materials",
    label: "Strength of Materials",
    category: "technical",
    branches: ["Mechanical", "Civil"],
    icon: "Wrench",
    description: "Stress, strain, bending moment, shear force",
  },
  {
    id: "manufacturing_processes",
    label: "Manufacturing",
    category: "technical",
    branches: ["Mechanical"],
    icon: "Settings",
    description: "Casting, machining, welding, tolerances",
  },

  // ── CHEMICAL ───────────────────────────────────────────
  {
    id: "reaction_engineering",
    label: "Reaction Engineering",
    category: "technical",
    branches: ["Chemical"],
    icon: "FlaskConical",
    description: "Reactor design, conversion, rate equations",
  },
  {
    id: "mass_transfer",
    label: "Mass Transfer",
    category: "technical",
    branches: ["Chemical"],
    icon: "ArrowLeftRight",
    description: "Diffusion, distillation, absorption",
  },
  {
    id: "process_control",
    label: "Process Control",
    category: "technical",
    branches: ["Chemical"],
    icon: "Sliders",
    description: "PID controllers, control loops, stability",
  },

  // ── ELECTRICAL ─────────────────────────────────────────
  {
    id: "circuit_analysis",
    label: "Circuit Analysis",
    category: "technical",
    branches: ["Electrical", "Electronics"],
    icon: "Cpu",
    description: "KVL, KCL, Thevenin, Norton, AC circuits",
  },
  {
    id: "electrical_machines",
    label: "Electrical Machines",
    category: "technical",
    branches: ["Electrical"],
    icon: "Cog",
    description: "Transformers, motors, generators",
  },
  {
    id: "digital_logic",
    label: "Digital Logic",
    category: "technical",
    branches: ["Electronics", "Electrical"],
    icon: "Binary",
    description: "Boolean algebra, gates, flip-flops, counters",
  },
];

// Get modules available for a student's branch
export function getModulesForBranch(branch: string): PracticeModule[] {
  return PRACTICE_MODULES.filter(
    (m) => m.branches.length === 0 || m.branches.includes(branch)
  );
}

// Group modules by category
export function groupModulesByCategory(
  modules: PracticeModule[]
): Record<string, PracticeModule[]> {
  return modules.reduce((acc, m) => {
    if (!acc[m.category]) acc[m.category] = [];
    acc[m.category].push(m);
    return acc;
  }, {} as Record<string, PracticeModule[]>);
}

