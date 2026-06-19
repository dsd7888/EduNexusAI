// Shared placement-prep track metadata.
// Used by the prep hub (/student/placement/prep) and the per-track page
// (/student/placement/prep/[track]). Keep this the single source of truth so the
// two views never drift.

export type Track = "aptitude" | "verbal" | "domain" | "communication";

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

export const TRACK_SECTIONS: Record<Track, { title: string; topics: string[] }[]> = {
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
