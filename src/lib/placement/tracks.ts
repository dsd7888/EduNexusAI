// Shared placement-prep track metadata.
// Used by the prep hub (/student/placement/prep) and the per-track page
// (/student/placement/prep/[track]). Keep this the single source of truth so the
// two views never drift.

export type Track = "aptitude" | "verbal" | "domain" | "communication";

// A section with no `branches` is universal — shown to every branch (this is
// every existing section, and stays the default for new ones unless a section
// is genuinely branch-exclusive content, e.g. ML theory that a non-MLAI student
// has no reason to be quizzed on). Branch-restricted sections currently only
// exist under "domain" — the "shared core + per-branch overlay" model from the
// placement-prep content plan, so CSE and MLAI students draw from the same OS/
// DBMS/CN/OOP/DSA pool (one set of bank questions, one mastery row per topic)
// instead of two duplicated copies that'd drift out of sync.
export interface TrackSection {
  title: string;
  topics: string[];
  branches?: string[];
}

export const TRACKS: Track[] = ["aptitude", "verbal", "domain", "communication"];

export const VALID_TRACKS = new Set<string>(TRACKS);

export const TRACK_META: Record<Track, { title: string; description: string }> = {
  aptitude: {
    title: "Aptitude & Reasoning",
    description:
      "Quantitative ability, logical reasoning, and data interpretation — the core of every mass recruiter OA",
  },
  verbal: {
    title: "Verbal Ability",
    description:
      "Reading comprehension, grammar, vocabulary, and sentence correction",
  },
  domain: {
    title: "Core Domain",
    description:
      "OS, DBMS, Networks, OOP — technical fundamentals tested in IT company interviews",
  },
  communication: {
    title: "Communication & HR",
    description:
      "HR interview questions, situational answers, and written communication practice",
  },
};

export const TRACK_SECTIONS: Record<Track, TrackSection[]> = {
  aptitude: [
    {
      title: "Quantitative Ability",
      topics: [
        "Time & Work (Easy → Medium → Hard)",
        "Percentages & Profit/Loss",
        "Ratio, Proportion & Mixtures",
        "Time, Speed & Distance",
        "Probability & Permutations",
      ],
    },
    {
      title: "Logical Reasoning",
      topics: [
        "Seating Arrangement",
        "Blood Relations & Family Tree",
        "Syllogisms",
        "Coding-Decoding",
        "Series & Patterns",
      ],
    },
    {
      title: "Data Interpretation",
      topics: ["Bar Charts & Pie Charts", "Tables & Caselets", "Mixed DI Sets"],
    },
  ],
  verbal: [
    {
      title: "Reading Comprehension",
      topics: ["RC Passages (Short)", "RC Passages (Long)", "Inference & Tone questions"],
    },
    {
      title: "Grammar & Usage",
      topics: ["Error Identification", "Sentence Correction", "Fill in the Blanks"],
    },
    {
      title: "Vocabulary",
      topics: ["Synonyms & Antonyms", "Idioms & Phrases", "Word Usage in Context"],
    },
    {
      title: "Para Skills",
      topics: ["Para Jumbles", "Para Completion", "Summary Writing"],
    },
  ],
  domain: [
    {
      title: "Operating Systems",
      topics: [
        "Process Management & Scheduling",
        "Memory Management & Paging",
        "Deadlocks & Synchronization",
        "File Systems",
      ],
    },
    {
      title: "DBMS",
      topics: [
        "SQL Queries & Joins",
        "Normalization (1NF–3NF)",
        "Transactions & ACID",
        "Indexing & Query Optimization",
      ],
    },
    {
      title: "Computer Networks",
      topics: [
        "OSI & TCP/IP Model",
        "IP Addressing & Subnetting",
        "DNS, HTTP, FTP Protocols",
        "Routing Algorithms",
      ],
    },
    {
      title: "OOP Concepts",
      topics: [
        "Classes, Objects, Inheritance",
        "Polymorphism & Abstraction",
        "Design Patterns (basic)",
      ],
    },
    // Universal — the single biggest gap against product-company interviews,
    // which gate almost entirely on this before CS-fundamentals depth even
    // comes up. No `branches`: CSE and MLAI share one bank/mastery pool here.
    {
      title: "Data Structures & Algorithms",
      topics: [
        "Arrays & Two-Pointer Techniques",
        "Linked Lists — Reversal & Cycle Detection",
        "Stacks, Queues & Their Applications",
        "Trees — BST, Traversals & Balancing",
        "Graphs — BFS, DFS & Shortest Path",
        "Recursion & Backtracking",
        "Dynamic Programming — Core Patterns",
        "Sorting & Searching Algorithms",
        "Hashing & Hash Tables",
        "Time & Space Complexity (Big-O)",
      ],
    },
    // Universal — fresher-pitched, not SDE-2 depth. Every product-company
    // technical round now asks at least one "design X" question even for
    // interns/freshers.
    {
      title: "System Design Fundamentals",
      topics: [
        "Client-Server Architecture & REST APIs",
        "Caching Strategies & CDNs",
        "Load Balancing & Horizontal Scaling",
        "Database Choices — SQL vs NoSQL Trade-offs",
        "Designing a URL Shortener (fresher HLD)",
        "Designing a Rate Limiter (fresher HLD)",
      ],
    },
    // MLAI-only overlay below — CSE students never see these, no code change
    // needed elsewhere: isSectionVisibleForBranch()/getVisibleSections() below
    // are what every consumer (UI pages + the generate API) filters through.
    {
      title: "Mathematics for Machine Learning",
      topics: [
        "Linear Algebra — Vectors, Matrices & Eigenvalues",
        "Probability — Distributions & Bayes' Theorem",
        "Statistics — Hypothesis Testing & p-values",
        "Calculus for ML — Gradients & Chain Rule",
      ],
      branches: ["MLAI"],
    },
    {
      title: "Core Machine Learning",
      topics: [
        "Supervised Learning — Regression & Classification",
        "Unsupervised Learning — Clustering & Dimensionality Reduction",
        "Ensemble Methods — Bagging, Boosting & Random Forests",
        "Bias-Variance Tradeoff & Regularization (L1/L2)",
        "Model Evaluation — Precision, Recall, F1 & ROC-AUC",
        "Feature Engineering & Selection",
      ],
      branches: ["MLAI"],
    },
    {
      title: "Deep Learning",
      topics: [
        "Neural Network Fundamentals & Backpropagation",
        "CNNs for Computer Vision",
        "RNNs, LSTMs & Sequence Modeling",
        "Transformers & Attention Mechanism",
      ],
      branches: ["MLAI"],
    },
    {
      title: "GenAI & LLM Fundamentals",
      topics: [
        "How LLMs Work — Tokens, Embeddings & Context Windows",
        "Prompt Engineering Fundamentals",
        "RAG & Vector Databases",
        "LLM Limitations — Hallucination, Bias & Evaluation",
      ],
      branches: ["MLAI"],
    },
  ],
  communication: [
    {
      title: "HR Questions",
      topics: [
        "Tell me about yourself",
        "Strengths & Weaknesses",
        "Why this company?",
        "Where do you see yourself in 5 years?",
        "Situational & Behavioral questions",
      ],
    },
    {
      title: "Technical Communication",
      topics: [
        "Explaining your projects",
        "Describing technical concepts simply",
        "Handling technical interview pressure",
      ],
    },
    {
      title: "Written Communication",
      topics: ["Email writing", "Report structure", "Formal vs informal tone"],
    },
  ],
};

// ─── Branch visibility ─────────────────────────────────────────────────────────
// `profiles.branch` (and `subjects.branch`) is free-text, not a DB enum — no
// casing/whitespace guarantee. Normalize before any comparison so "MLAI",
// " mlai", "Mlai" all match the same way a section was authored above.
function normalizeBranch(branch: string | null | undefined): string {
  return (branch ?? "").trim().toUpperCase();
}

/**
 * A section with no `branches` (or an empty array — almost certainly a data-
 * entry slip, not "hide from everyone") is universal. An unknown/missing
 * student branch fails OPEN: this gates placement-prep *content*, not access
 * to anything sensitive, so a student whose branch hasn't loaded yet (or was
 * never set) should see too much rather than see nothing while a real bug
 * elsewhere goes unnoticed.
 */
export function isSectionVisibleForBranch(
  section: TrackSection,
  branch: string | null | undefined
): boolean {
  if (!section.branches || section.branches.length === 0) return true;
  const b = normalizeBranch(branch);
  if (!b) return true;
  return section.branches.some((allowed) => normalizeBranch(allowed) === b);
}

export function getVisibleSections(
  track: Track,
  branch: string | null | undefined
): TrackSection[] {
  return TRACK_SECTIONS[track].filter((s) => isSectionVisibleForBranch(s, branch));
}

/**
 * Reverse lookup for the generate API: is this exact topic string allowed for
 * this branch? A topic that doesn't match ANY section (stale bank data, a
 * topic since renamed/removed) returns true — "not found" is a different
 * failure mode than "wrong branch" and isn't this function's job to flag; the
 * caller's own topic-membership check is what should reject that case.
 */
export function isTopicAllowedForBranch(
  track: Track,
  topic: string,
  branch: string | null | undefined
): boolean {
  const section = TRACK_SECTIONS[track].find((s) => s.topics.includes(topic));
  if (!section) return true;
  return isSectionVisibleForBranch(section, branch);
}
