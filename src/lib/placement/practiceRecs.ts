// Static, hand-authored external-practice pointers, keyed by track + exact
// TRACK_SECTIONS topic label (src/lib/placement/tracks.ts). Zero AI cost,
// zero external API calls — curated links only, refreshed by hand.
//
// Deliberately NOT keyed by PRACTICE_MODULES (src/lib/placement/modules.ts) —
// that catalog backs a different route (/student/placement/practice/[moduleId])
// and uses different id/label strings than the topics students actually click
// through /student/placement/prep/[track]/practice.

export interface PracticeResource {
  label: string;
  url: string;
}

export const PRACTICE_RECS: Record<string, Record<string, PracticeResource[]>> = {
  aptitude: {
    "Time & Work (Easy → Medium → Hard)": [
      { label: "IndiaBIX — Time and Work", url: "https://www.indiabix.com/aptitude/time-and-work/" },
      { label: "PrepInsta — Time & Work formulas", url: "https://prepinsta.com/quantitative-aptitude/time-and-work/" },
    ],
    "Percentages & Profit/Loss": [
      { label: "IndiaBIX — Profit and Loss", url: "https://www.indiabix.com/aptitude/profit-and-loss/" },
      { label: "PrepInsta — Percentages", url: "https://prepinsta.com/quantitative-aptitude/percentage/" },
    ],
    "Ratio, Proportion & Mixtures": [
      { label: "IndiaBIX — Ratio and Proportion", url: "https://www.indiabix.com/aptitude/ratio-and-proportion/" },
      { label: "PrepInsta — Mixtures & Alligations", url: "https://prepinsta.com/quantitative-aptitude/mixture-and-alligation/" },
    ],
    "Time, Speed & Distance": [
      { label: "IndiaBIX — Time and Distance", url: "https://www.indiabix.com/aptitude/time-and-distance/" },
      { label: "PrepInsta — Speed, Time & Distance", url: "https://prepinsta.com/quantitative-aptitude/speed-time-and-distance/" },
    ],
    "Probability & Permutations": [
      { label: "IndiaBIX — Probability", url: "https://www.indiabix.com/aptitude/probability/" },
      { label: "IndiaBIX — Permutation and Combination", url: "https://www.indiabix.com/aptitude/permutation-and-combination/" },
    ],
    "Seating Arrangement": [
      { label: "IndiaBIX — Seating Arrangement", url: "https://www.indiabix.com/logical-reasoning/seating-arrangement/" },
      { label: "PrepInsta — Seating Arrangement", url: "https://prepinsta.com/logical-reasoning/seating-arrangement/" },
    ],
    "Blood Relations & Family Tree": [
      { label: "IndiaBIX — Blood Relation Test", url: "https://www.indiabix.com/logical-reasoning/blood-relation-test/" },
    ],
    "Syllogisms": [
      { label: "IndiaBIX — Logical Deduction (Syllogism)", url: "https://www.indiabix.com/logical-reasoning/logical-deduction/" },
    ],
    "Coding-Decoding": [
      { label: "IndiaBIX — Coding Decoding", url: "https://www.indiabix.com/logical-reasoning/coding-decoding/" },
    ],
    "Series & Patterns": [
      { label: "IndiaBIX — Number Series", url: "https://www.indiabix.com/aptitude/number-series/" },
      { label: "PrepInsta — Number Series", url: "https://prepinsta.com/logical-reasoning/number-series/" },
    ],
    "Bar Charts & Pie Charts": [
      { label: "IndiaBIX — Data Interpretation", url: "https://www.indiabix.com/data-interpretation/pie-charts/" },
    ],
    "Tables & Caselets": [
      { label: "IndiaBIX — Tabulation", url: "https://www.indiabix.com/data-interpretation/tabulation/" },
    ],
    "Mixed DI Sets": [
      { label: "GeeksforGeeks — Data Interpretation", url: "https://www.geeksforgeeks.org/aptitude-for-placements/" },
    ],
  },

  verbal: {
    "RC Passages (Short)": [
      { label: "IndiaBIX — Reading Comprehension", url: "https://www.indiabix.com/verbal-ability/reading-comprehension/" },
    ],
    "RC Passages (Long)": [
      { label: "IndiaBIX — Reading Comprehension", url: "https://www.indiabix.com/verbal-ability/reading-comprehension/" },
    ],
    "Inference & Tone questions": [
      { label: "PrepInsta — Reading Comprehension", url: "https://prepinsta.com/verbal-ability/reading-comprehension/" },
    ],
    "Error Identification": [
      { label: "IndiaBIX — Spotting Errors", url: "https://www.indiabix.com/verbal-ability/spotting-errors/" },
    ],
    "Sentence Correction": [
      { label: "IndiaBIX — Sentence Correction", url: "https://www.indiabix.com/verbal-ability/sentence-correction/" },
    ],
    "Fill in the Blanks": [
      { label: "IndiaBIX — Spotting Errors & Fill Ups", url: "https://www.indiabix.com/verbal-ability/fill-in-the-blanks/" },
    ],
    "Synonyms & Antonyms": [
      { label: "IndiaBIX — Synonyms", url: "https://www.indiabix.com/verbal-ability/synonyms/" },
      { label: "Magoosh — GRE Vocabulary", url: "https://magoosh.com/gre/gre-vocabulary/" },
    ],
    "Idioms & Phrases": [
      { label: "IndiaBIX — Idioms and Phrases", url: "https://www.indiabix.com/verbal-ability/idioms-and-phrases/" },
    ],
    "Word Usage in Context": [
      { label: "Magoosh — GRE Vocabulary", url: "https://magoosh.com/gre/gre-vocabulary/" },
    ],
    "Para Jumbles": [
      { label: "PrepInsta — Para Jumbles", url: "https://prepinsta.com/verbal-ability/para-jumbles/" },
    ],
    "Para Completion": [
      { label: "IndiaBIX — Sentence Sequence", url: "https://www.indiabix.com/verbal-ability/sequence-of-sentence/" },
    ],
    "Summary Writing": [
      { label: "PrepInsta — Verbal Ability", url: "https://prepinsta.com/verbal-ability/" },
    ],
  },

  domain: {
    "Process Management & Scheduling": [
      { label: "GeeksforGeeks — CPU Scheduling", url: "https://www.geeksforgeeks.org/cpu-scheduling-in-operating-systems/" },
      { label: "JavaTpoint — Process Scheduling", url: "https://www.javatpoint.com/os-cpu-scheduling" },
    ],
    "Memory Management & Paging": [
      { label: "GeeksforGeeks — Memory Management", url: "https://www.geeksforgeeks.org/memory-management-in-operating-system/" },
      { label: "JavaTpoint — Memory Management", url: "https://www.javatpoint.com/os-memory-management" },
    ],
    "Deadlocks & Synchronization": [
      { label: "GeeksforGeeks — Deadlocks", url: "https://www.geeksforgeeks.org/deadlock-in-operating-system/" },
      { label: "JavaTpoint — Deadlock", url: "https://www.javatpoint.com/os-deadlock-introduction" },
    ],
    "File Systems": [
      { label: "GeeksforGeeks — File Systems", url: "https://www.geeksforgeeks.org/file-systems-in-operating-system/" },
    ],
    "SQL Queries & Joins": [
      { label: "W3Schools — SQL Joins", url: "https://www.w3schools.com/sql/sql_join.asp" },
      { label: "LeetCode — Top SQL 50", url: "https://leetcode.com/studyplan/top-sql-50/" },
      { label: "HackerRank — SQL", url: "https://www.hackerrank.com/domains/sql" },
    ],
    "Normalization (1NF–3NF)": [
      { label: "GeeksforGeeks — Normal Forms in DBMS", url: "https://www.geeksforgeeks.org/normal-forms-in-dbms/" },
      { label: "JavaTpoint — Normalization", url: "https://www.javatpoint.com/dbms-normalization" },
    ],
    "Transactions & ACID": [
      { label: "GeeksforGeeks — ACID Properties", url: "https://www.geeksforgeeks.org/acid-properties-in-dbms/" },
      { label: "JavaTpoint — Transaction Management", url: "https://www.javatpoint.com/dbms-transaction" },
    ],
    "Indexing & Query Optimization": [
      { label: "GeeksforGeeks — Indexing in DBMS", url: "https://www.geeksforgeeks.org/indexing-in-databases-set-1/" },
      { label: "Use The Index, Luke", url: "https://use-the-index-luke.com/" },
    ],
    "OSI & TCP/IP Model": [
      { label: "GeeksforGeeks — OSI Model Layers", url: "https://www.geeksforgeeks.org/layers-of-osi-model/" },
      { label: "JavaTpoint — TCP/IP Model", url: "https://www.javatpoint.com/tcp-ip-model" },
    ],
    "IP Addressing & Subnetting": [
      { label: "GeeksforGeeks — Subnetting", url: "https://www.geeksforgeeks.org/subnetting-in-computer-network/" },
      { label: "GeeksforGeeks — Classful IP Addressing", url: "https://www.geeksforgeeks.org/introduction-of-classful-ip-addressing/" },
    ],
    "DNS, HTTP, FTP Protocols": [
      { label: "GeeksforGeeks — DNS in Application Layer", url: "https://www.geeksforgeeks.org/domain-name-system-dns-in-application-layer/" },
      { label: "JavaTpoint — Computer Network DNS", url: "https://www.javatpoint.com/computer-network-dns" },
    ],
    "Routing Algorithms": [
      { label: "GeeksforGeeks — Routing Algorithms", url: "https://www.geeksforgeeks.org/routing-algorithms/" },
      { label: "JavaTpoint — Routing Algorithm", url: "https://www.javatpoint.com/routing-algorithm" },
    ],
    "Classes, Objects, Inheritance": [
      { label: "GeeksforGeeks — Inheritance in Java", url: "https://www.geeksforgeeks.org/inheritance-in-java/" },
      { label: "W3Schools — Java Inheritance", url: "https://www.w3schools.com/java/java_inheritance.asp" },
    ],
    "Polymorphism & Abstraction": [
      { label: "GeeksforGeeks — Polymorphism in Java", url: "https://www.geeksforgeeks.org/polymorphism-in-java/" },
      { label: "W3Schools — Java Polymorphism", url: "https://www.w3schools.com/java/java_polymorphism.asp" },
    ],
    "Design Patterns (basic)": [
      { label: "GeeksforGeeks — Software Design Patterns", url: "https://www.geeksforgeeks.org/software-design-patterns/" },
      { label: "Refactoring.Guru — Design Patterns", url: "https://refactoring.guru/design-patterns" },
    ],
  },

  communication: {
    "Tell me about yourself": [
      { label: "IndiaBIX — HR Interview Questions", url: "https://www.indiabix.com/hr-interview/questions-and-answers/" },
    ],
    "Strengths & Weaknesses": [
      { label: "IndiaBIX — HR Interview Questions", url: "https://www.indiabix.com/hr-interview/questions-and-answers/" },
    ],
    "Why this company?": [
      { label: "IndiaBIX — HR Interview Questions", url: "https://www.indiabix.com/hr-interview/questions-and-answers/" },
    ],
    "Where do you see yourself in 5 years?": [
      { label: "IndiaBIX — HR Interview Questions", url: "https://www.indiabix.com/hr-interview/questions-and-answers/" },
    ],
    "Situational & Behavioral questions": [
      { label: "IndiaBIX — HR Interview Questions", url: "https://www.indiabix.com/hr-interview/questions-and-answers/" },
    ],
    "Explaining your projects": [
      { label: "GeeksforGeeks — Technical Interview Tips", url: "https://www.geeksforgeeks.org/tips-to-crack-technical-interview/" },
    ],
    "Describing technical concepts simply": [
      { label: "GeeksforGeeks — Technical Interview Tips", url: "https://www.geeksforgeeks.org/tips-to-crack-technical-interview/" },
    ],
    "Handling technical interview pressure": [
      { label: "GeeksforGeeks — Technical Interview Tips", url: "https://www.geeksforgeeks.org/tips-to-crack-technical-interview/" },
    ],
    "Email writing": [
      { label: "Coursera — Speak English Professionally", url: "https://www.coursera.org/learn/speakenglish" },
    ],
    "Report structure": [
      { label: "Coursera — Speak English Professionally", url: "https://www.coursera.org/learn/speakenglish" },
    ],
    "Formal vs informal tone": [
      { label: "Coursera — Speak English Professionally", url: "https://www.coursera.org/learn/speakenglish" },
    ],
  },
};

/** Curated external-practice pointers for one topic. Empty array if none authored yet. */
export function getPracticeRecs(track: string, topic: string): PracticeResource[] {
  return PRACTICE_RECS[track]?.[topic] ?? [];
}
