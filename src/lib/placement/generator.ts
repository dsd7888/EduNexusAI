export function buildPlacementTestPrompt(options: {
  companyName: string;
  branch: string;
  aptitudePattern: {
    quantitative: number;
    logical: number;
    verbal: number;
    technical: number;
  };
  syllabusContent: string;
  difficulty: string;
  totalQuestions?: number;
}): string {
  const { companyName, branch, aptitudePattern, syllabusContent, difficulty, totalQuestions = 30 } =
    options;

  const counts = {
    quantitative: Math.round((aptitudePattern.quantitative / 100) * totalQuestions),
    logical: Math.round((aptitudePattern.logical / 100) * totalQuestions),
    verbal: Math.round((aptitudePattern.verbal / 100) * totalQuestions),
    technical: Math.round((aptitudePattern.technical / 100) * totalQuestions),
  };
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  counts.quantitative += totalQuestions - sum;

  // Company-specific test profile for prompt grounding
  const companyProfiles: Record<string, string> = {
    TCS: `TCS National Qualifier Test (NQT) pattern:
- Numerical Ability: number series (e.g. 2,6,12,20,30,?), percentages, profit/loss, time-speed-distance, data sufficiency
- Verbal: reading comprehension passages (200-250 words), fill-in-the-blanks (grammar), sentence correction, synonyms/antonyms from GRE wordlist
- Reasoning: series completion, coding-decoding (A=1,B=2 type), blood relations, directional sense, input-output machine problems
- Known difficulty: Easy-Medium. Cut-off typically 60-65%.
- Real TCS NQT questions shared on GeeksforGeeks, IndiaBix, PrepInsta confirm these exact patterns.`,

    Infosys: `Infosys Recruitment Test (InfyTQ / HackWithInfy pattern):
- Quantitative: time & work (pipes, cisterns), percentages, averages, data interpretation (bar graphs, pie charts), mensuration
- Logical: Syllogisms (All A are B type), logical puzzles, seating arrangements (circular and linear), Venn diagrams
- Verbal: Error correction, jumbled sentences, reading comprehension, vocabulary in context
- Known difficulty: Easy-Medium. Infosys emphasizes verbal more than most companies.
- Patterns sourced from: IndiaBix Infosys papers, PrepInsta, r/placements on Reddit.`,

    Wipro: `Wipro NLTH (National Level Test for Hiring) pattern:
- Quant: Number systems, HCF/LCM, ratio/proportion, time-speed-distance, simple/compound interest
- Logical: Odd one out, matrix reasoning, number analogies, alphabetical series, mirror/water images
- Verbal: Synonyms, antonyms, one-word substitution, para-jumbles
- Technical: Basic programming logic (flowcharts), fundamental CS/branch concepts
- Known difficulty: Easy-Medium. Wipro tests are known to be straightforward.`,

    "L&T": `L&T Campus Recruitment pattern for core engineering:
- Quant: Aptitude heavier on engineering math — vectors, matrices basics, probability, statistics
- Logical: Analytical reasoning, pattern recognition, spatial reasoning (important for engineers)
- Technical: HEAVY on core branch subjects. Mechanical: Thermodynamics laws + cycles, SOM, FM basics. Civil: Structural analysis, soil mechanics. Electrical: Circuit laws, machines. Chemical: Material balance, thermodynamics.
- Verbal: Lighter section compared to IT companies — focus on technical communication
- Known difficulty: Medium-Hard. L&T values technical depth over aptitude.
- Patterns from L&T campus drive reports on GFG, engineering forums.`,

    Bosch: `Bosch Campus Recruitment (technical-heavy for core branches):
- Aptitude: Standard quantitative and logical, moderate difficulty
- Technical round is the differentiator: Deep core engineering questions.
  Mechanical: Thermodynamics (Carnot efficiency, heat transfer modes), Fluid Mechanics (Reynolds number, Bernoulli), Manufacturing (tolerance, fits, GD&T basics)
  Electrical: Motors, transformers, power factor, circuit analysis
  Electronics: Op-amps, digital logic, microcontroller basics
- Known from Bosch placement drives reported on LinkedIn, GFG campus experiences.
- Difficulty: Medium. Technical section filters candidates significantly.`,

    Capgemini: `Capgemini Recruitment Assessment (Exceller/Perform track):
- Quant: Percentages, profit/loss, time-speed-distance, number series — standard CAT-lite level
- Logical: Logical deduction, blood relations, directions, coding-decoding
- Verbal: Reading comprehension, grammar, vocabulary
- Personality/Behavioral: sometimes included but not in aptitude
- Known difficulty: Easy-Medium. Capgemini is considered accessible.
- Pattern from: PrepInsta Capgemini papers, IndiaBix, r/cscareerquestions India posts.`,

    Mahindra: `Mahindra Campus Recruitment (core engineering focus):
- Quant: Engineering mathematics orientation — logarithms, permutation/combination, probability
- Technical: Core subjects with practical application angle.
  Mechanical: IC engines, automotive systems, manufacturing processes
  Chemical: Process plant design basics, safety concepts
  Civil: Construction management, materials
- Logical: Standard reasoning
- Known difficulty: Medium. Mahindra values practical engineering knowledge.`,

    Cognizant: `Cognizant GenC / GenC Elevate pattern:
- Quant: Time and work, percentages, averages, data interpretation
- Reasoning: Logical puzzles, syllogisms, input-output
- Verbal: Comprehensive verbal — grammar, vocabulary, comprehension
- Coding: Basic programming (for tech roles) — but aptitude section mirrors TCS/Infosys
- Known difficulty: Easy. One of the more accessible large IT recruiters.
- Patterns from CognizantGenc papers on PrepInsta, GFG campus section.`,
  };

  const companyContext =
    companyProfiles[companyName] ??
    `${companyName} campus placement aptitude test following standard Indian engineering campus recruitment patterns used by major companies.`;

  return `You are an expert psychometrician and campus recruitment 
specialist at a top Indian engineering university. You have 
10+ years of experience designing aptitude tests for Tier-1 
companies and have analysed thousands of real placement papers.

Your task: design one complete, authentic, high-quality 
campus placement test for ${companyName}.

═══════════════════════════════════════════════
COMPANY INTELLIGENCE — ${companyName}
═══════════════════════════════════════════════
${companyContext}

═══════════════════════════════════════════════
STUDENT PROFILE
═══════════════════════════════════════════════
Branch: ${branch} Engineering
Difficulty: ${difficulty}
Academic Syllabus (for technical section):
${syllabusContent}

═══════════════════════════════════════════════
TEST SPECIFICATION — ${totalQuestions} QUESTIONS TOTAL
═══════════════════════════════════════════════
Section 1 — Quantitative Aptitude: ${counts.quantitative} questions
Section 2 — Logical Reasoning:     ${counts.logical} questions
Section 3 — Verbal Ability:         ${counts.verbal} questions
Section 4 — Technical (${branch}): ${counts.technical} questions

═══════════════════════════════════════════════
QUESTION DESIGN STANDARDS
═══════════════════════════════════════════════

QUANTITATIVE (${counts.quantitative} questions):
Topics to cover (distribute evenly, no topic repeated consecutively):
  • Number series: arithmetic/geometric/mixed patterns
  • Percentages & profit/loss: multi-step problems with realistic numbers
  • Time-speed-distance: trains, boats, relative motion
  • Time & work: pipes, cisterns, combined work
  • Simple & compound interest: annual/half-yearly calculations
  • Ratio, proportion & averages: weighted averages, mixtures
  • Data interpretation: one small table or two numbers to compare

Authenticity rules:
  • NEVER use round numbers (not 100, 200, 1000)
  • Use realistic values (144, 375, 2880, 13.6%, 37.5 kmph)
  • Include one "trap" answer that catches the common mistake
  • Solvable in 45-90 seconds with pen and paper
  • Show complete working in explanation (formula → substitution → answer)

LOGICAL REASONING (${counts.logical} questions):
Topics to cover:
  • Syllogisms: 2 premises (All/Some/No format) → 2 conclusions → which follow?
  • Coding-decoding: letter shift, number substitution, or symbol code
  • Blood relations: 3-4 people maximum, solvable in 60s
  • Number/letter series: identify the pattern, find the missing term
  • Directional sense: compass directions + distances
  • Seating arrangement: 4-5 people, one circular or linear
  • Input-output: number/word rearrangement machine (2 steps shown)

Authenticity rules:
  • Syllogism conclusions must be logically valid — no ambiguous cases
  • Coding examples: PAINT=74128 style, not trivial A=1 B=2 only
  • Each reasoning type appears maximum twice

VERBAL ABILITY (${counts.verbal} questions):
Structure:
  • 1 reading comprehension passage (150-180 words, academic/general topic)
    → 2 questions based on it (inference + vocabulary-in-context)
  • Fill-in-the-blanks: grammar focus (tense, preposition, article)
  • Sentence error identification: one underlined error in 4 options
  • Synonym/Antonym: GRE-level vocabulary 
    (ebullient, laconic, obfuscate, perennial, vociferous)
  • Para-jumble: 4 sentences to arrange in logical order

Authenticity rules:
  • Reading passage must be original, NOT a well-known text
  • Grammar questions test subject-verb agreement, tense consistency
  • Vocabulary at university graduate level, not school level

TECHNICAL — ${branch} Engineering (${counts.technical} questions):
  • Draw ONLY from the academic syllabus provided above
  • Application-level: give values, ask for calculation OR
    give scenario, ask which law/principle applies
  • Include the correct formula in the explanation
  • At least one numerical calculation question
  • Style: "A gas expands at constant pressure of 200 kPa from 
    0.5 m3 to 1.2 m3. Work done by the system is: A. 100 kJ B. 120 kJ C. 140 kJ D. 160 kJ"
  • NEVER ask "define X" or "who discovered Y"

═══════════════════════════════════════════════  
QUALITY CHECKLIST — verify each question before including:
═══════════════════════════════════════════════
  ✓ Exactly one unambiguously correct answer
  ✓ Three plausible wrong answers (not obviously silly)
  ✓ One distractor answer that catches a common mistake
  ✓ Solvable in 90 seconds or less
  ✓ Explanation shows complete step-by-step solution
  ✓ No two consecutive questions from same subcategory
  ✓ Question is self-contained (no "from the above passage" 
    except for RC questions)

═══════════════════════════════════════════════
OUTPUT FORMAT — STRICT
═══════════════════════════════════════════════
Return ONLY a valid JSON array. Nothing before [. Nothing after ].
No markdown. No backticks. No explanation text.

Each object:
{
  "id": "q1",
  "category": "quantitative",
  "subcategory": "profit_loss",
  "question": "Full question text with all given values",
  "options": ["A. option1", "B. option2", "C. option3", "D. option4"],
  "answer": "A",
  "explanation": "Step 1: formula. Step 2: substitution. Step 3: result. Therefore answer is A.",
  "difficulty": "${difficulty}"
}

Categories must be exactly one of:
  "quantitative" | "logical" | "verbal" | "technical"

Subcategory must be a specific slug:
  quantitative: profit_loss | time_speed_distance | time_work | 
    simple_compound_interest | ratio_proportion | number_series | 
    data_interpretation | percentages | averages | mensuration
  logical: syllogisms | coding_decoding | blood_relations | 
    number_series | direction_sense | seating_arrangement | input_output
  verbal: reading_comprehension | fill_blanks | error_identification | 
    synonyms_antonyms | para_jumble | sentence_completion
  technical: (use specific topic slug e.g. thermodynamics_laws, 
    fluid_mechanics, heat_transfer, organic_chemistry, 
    process_control, strength_of_materials)

═══════════════════════════════════════════════
FINAL INSTRUCTION
═══════════════════════════════════════════════
Generate all ${totalQuestions} questions now. 
Complete every single object fully.
The array must contain exactly ${totalQuestions} elements.
Do not stop at 10 or 15. Do not summarize.
Begin with [ and end with ]. Nothing else.`;
}

export function scorePlacementAttempt(
  questions: any[],
  answers: Record<string, string>
): {
  score: number;
  correctAnswers: number;
  categoryScores: Record<string, number>;
} {
  const categoryCorrect: Record<string, number> = {};
  const categoryTotal: Record<string, number> = {};
  let correct = 0;

  for (const q of questions) {
    const cat = q.category ?? "quantitative";
    categoryTotal[cat] = (categoryTotal[cat] ?? 0) + 1;

    const studentAns = String(answers[q.id] ?? "").trim().toUpperCase();
    const correctAns = String(q.answer ?? "").trim().toUpperCase();

    if (studentAns === correctAns) {
      correct++;
      categoryCorrect[cat] = (categoryCorrect[cat] ?? 0) + 1;
    }
  }

  const categoryScores: Record<string, number> = {};
  for (const cat of Object.keys(categoryTotal)) {
    categoryScores[cat] = Math.round(
      ((categoryCorrect[cat] ?? 0) / categoryTotal[cat]) * 100
    );
  }

  return {
    score: Math.round((correct / questions.length) * 100),
    correctAnswers: correct,
    categoryScores,
  };
}

export function cleanQuestionExplanations(questions: any[]): any[] {
  const thinkingPatterns = [
    /Let me re[-\s]?(check|read|verify|evaluate|calculate|try|examine)[^.]*\./gi,
    /Let'?s (re-?|try|assume|check|adjust|fix|use|stick|go back|create|generate|make)[^.]*\./gi,
    /I will (replace|change|adjust|fix|use|create)[^.]*\./gi,
    /This is (getting|also|a good)[^.]*\./gi,
    /There (must be|is) a (mistake|typo|error|definite issue)[^.]*\./gi,
    /The (numbers|options|answer|calculation) (in the question|is|are|seems)[^.]*incorrect[^.]*\./gi,
    /Why did I[^.]*\./gi,
    /\(Note:[^)]*\)/gi,
    /Let me re-write[^.]*\./gi,
    /New Q:[^.]*\./gi,
    /New Question:[^.]*\./gi,
    /I'll use (these|this)[^.]*\./gi,
    /Explanation re-written[^.]*\./gi,
  ];

  return questions.map((q) => {
    if (!q?.explanation) return q;

    let cleaned = String(q.explanation);
    for (const pattern of thinkingPatterns) {
      cleaned = cleaned.replace(pattern, "");
    }

    cleaned = cleaned
      .replace(/\s{2,}/g, " ")
      .replace(/\.\s*\./g, ".")
      .trim();

    if (cleaned.length < 50) return q;

    return { ...q, explanation: cleaned };
  });
}

export function cleanQuestions(questions: any[]): any[] {
  const cleaned = cleanQuestionExplanations(questions);

  // Remove placeholder questions Pro sometimes generates
  // for reading comprehension passage setup
  return cleaned.filter((q) => {
    const text = String(q?.question ?? "").toLowerCase();
    const options = Array.isArray(q?.options) ? q.options : [];

    const isPlaceholder =
      text.includes("passage is part of") ||
      text.includes("first question related to") ||
      text.includes("please select an answer for") ||
      text.includes("question will be provided") ||
      options.some((o: any) =>
        String(o).toLowerCase().includes("first question related")
      );

    return !isPlaceholder;
  });
}

