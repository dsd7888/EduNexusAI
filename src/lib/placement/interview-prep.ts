export type InterviewRound = 'hr' | 'technical' | 'aptitude_discussion'

export type InterviewQuestionCategory =
  | 'introduction'
  | 'motivation'
  | 'behavioral'
  | 'situational'
  | 'technical_cs'
  | 'project_deep_dive'
  | 'stress'

export interface InterviewQuestion {
  id: string
  round: InterviewRound
  category: InterviewQuestionCategory
  question: string
  why_asked: string
  answer_framework: string
  dos: string[]
  donts: string[]
  company_types: string[]
  difficulty: 'easy' | 'medium' | 'hard'
}

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'intro-001',
    round: 'hr',
    category: 'introduction',
    question: 'Tell me about yourself.',
    why_asked:
      'Tests communication clarity and self-awareness. Interviewer wants a structured 90-second pitch, not your life story.',
    answer_framework:
      'PRESENT → PAST → FUTURE: Start with who you are now (branch, semester, college), then 1-2 academic/project highlights, then why you are interested in this company/role specifically.',
    dos: [
      'Keep it under 90 seconds',
      'End with why you want THIS company',
      'Mention one specific project or achievement'
    ],
    donts: [
      'Start with "My name is..." — they know your name',
      'List every subject you studied',
      'Say "I am a hardworking and passionate person"'
    ],
    company_types: ['all'],
    difficulty: 'easy'
  },
  {
    id: 'intro-002',
    round: 'hr',
    category: 'introduction',
    question: 'Walk me through your resume.',
    why_asked:
      'Tests whether you can articulate your own experience. Many students cannot explain their own projects clearly.',
    answer_framework:
      'Education (10 seconds) → Key projects in reverse order, each in 20 seconds: what problem it solved, what you built, what you learned → Skills relevant to this role → Why you are here',
    dos: [
      'Prepare a 2-minute version and a 4-minute version',
      'For each project: one sentence on what it does, one on your specific contribution',
      'Connect your experience to the role'
    ],
    donts: [
      'Read from the resume — they can do that',
      'Spend more than 30 seconds on education',
      'Say "as you can see on my resume"'
    ],
    company_types: ['all'],
    difficulty: 'easy'
  },
  {
    id: 'motiv-001',
    round: 'hr',
    category: 'motivation',
    question: 'Why do you want to join TCS/Infosys/this company?',
    why_asked:
      'Tests preparation and genuine interest. Also filters out candidates who applied everywhere without thinking.',
    answer_framework:
      'Company-specific reason (something you actually researched) + Role alignment (connects to your skills/projects) + Growth (what you want to learn here specifically)',
    dos: [
      'Mention one specific thing about the company: a product, a program, a recent initiative',
      'Connect it to your actual skills or projects',
      'Be honest if it is your first choice or a strong choice'
    ],
    donts: [
      'Say "good salary and work culture" — every company claims this',
      'Mention you applied to 20 other companies',
      'Give generic answers like "it is a reputed company"'
    ],
    company_types: ['service_it'],
    difficulty: 'easy'
  },
  {
    id: 'behav-001',
    round: 'hr',
    category: 'behavioral',
    question: 'Tell me about a time you worked in a team and faced a conflict.',
    why_asked:
      'Tests conflict resolution, maturity, and communication. They want proof you can work with difficult people without drama.',
    answer_framework:
      'STAR: Situation (set the scene briefly) → Task (what was your role) → Action (what YOU specifically did to resolve it — not "we") → Result (outcome + what you learned)',
    dos: [
      'Use a real example from college project or internship',
      'Focus on what YOU did, not blaming others',
      'Include a positive outcome or lesson'
    ],
    donts: [
      'Say you have never had a conflict — not credible',
      'Blame the other person',
      'Choose a trivial example like disagreeing on pizza topping'
    ],
    company_types: ['all'],
    difficulty: 'medium'
  },
  {
    id: 'behav-002',
    round: 'hr',
    category: 'behavioral',
    question: 'Describe a situation where you failed or made a mistake.',
    why_asked:
      'Tests self-awareness, honesty, and whether you learn from mistakes. Overconfident candidates claim they never fail.',
    answer_framework:
      'Name the failure clearly (do not minimize it) → What happened as a result → What you did to fix or learn from it → What you do differently now',
    dos: [
      'Choose something real but not catastrophic',
      'Show what you learned concretely',
      'Keep it professional — academic or project context works well'
    ],
    donts: [
      'Say your weakness is "working too hard" or "being a perfectionist"',
      'Choose a failure that shows poor judgment or ethics',
      'Spend more time on the failure than the lesson'
    ],
    company_types: ['all'],
    difficulty: 'medium'
  },
  {
    id: 'situ-001',
    round: 'hr',
    category: 'situational',
    question: 'If you are given a task you do not know how to do, what would you do?',
    why_asked:
      'Tests learning agility and professionalism. They want to know you will not freeze or hide when stuck.',
    answer_framework:
      'Step 1: Spend X time trying yourself (documentation, examples) → Step 2: Ask a specific question (not "how do I do this?" but "I tried X and got Y, is my approach right?") → Step 3: Communicate status proactively',
    dos: [
      'Show that you try independently first',
      'Demonstrate you ask good questions, not vague ones',
      'Mention that you communicate proactively about blockers'
    ],
    donts: [
      'Say you would just figure it out alone without asking anyone',
      'Say you would immediately ask your manager everything',
      'Give a vague answer without concrete steps'
    ],
    company_types: ['all'],
    difficulty: 'easy'
  },
  {
    id: 'tech-001',
    round: 'technical',
    category: 'technical_cs',
    question: 'What is the difference between a process and a thread?',
    why_asked:
      'OS fundamentals — commonly asked in IT service companies to check basic CS knowledge.',
    answer_framework:
      'Define process (independent program in execution, own memory space) → Define thread (unit of execution within a process, shares memory) → Key difference: isolation vs shared memory → When to use each',
    dos: [
      'Use a concrete analogy: process = a restaurant, thread = a waiter in that restaurant',
      'Mention that threads are lighter weight and faster to create',
      'Know the term "context switching"'
    ],
    donts: [
      'Confuse process with program (program is static, process is running)',
      'Give only a textbook definition with no example',
      'Say they are the same thing'
    ],
    company_types: ['service_it', 'product'],
    difficulty: 'medium'
  },
  {
    id: 'tech-002',
    round: 'technical',
    category: 'technical_cs',
    question: 'Explain the difference between primary key and foreign key.',
    why_asked:
      'DBMS basics — extremely common in IT company technical rounds. Tests whether you have practical SQL understanding.',
    answer_framework:
      'Primary key: uniquely identifies each row in a table, cannot be null, one per table → Foreign key: references primary key in another table, creates a relationship → Example: student_id in Students table (PK), student_id in Grades table (FK)',
    dos: [
      'Give a concrete example with two related tables',
      'Mention referential integrity',
      'Know what happens when you try to delete a referenced row'
    ],
    donts: [
      'Just give definitions without an example',
      'Confuse with unique key (unique allows null, PK does not)',
      'Say foreign key must reference the primary key of a different table only — it can reference any unique key'
    ],
    company_types: ['service_it', 'product'],
    difficulty: 'easy'
  },
  {
    id: 'tech-003',
    round: 'technical',
    category: 'technical_cs',
    question: 'What is the difference between GET and POST HTTP methods?',
    why_asked:
      'Networks/Web fundamentals — asked to check whether a CS student understands basic web communication.',
    answer_framework:
      'GET: retrieves data, parameters in URL, idempotent, cached → POST: sends data, parameters in body, not idempotent, not cached → When to use: GET for reading, POST for creating or submitting',
    dos: [
      'Mention idempotent (GET same request = same result, POST can create duplicates)',
      'Note that GET params are visible in URL (security implication)',
      'Know that POST body can send large/sensitive data'
    ],
    donts: [
      'Say POST is "more secure" without qualification',
      'Confuse with PUT (update) and DELETE',
      'Give only one difference'
    ],
    company_types: ['service_it', 'product'],
    difficulty: 'easy'
  },
  {
    id: 'proj-001',
    round: 'technical',
    category: 'project_deep_dive',
    question:
      'Explain your best project. What problem does it solve and what was your specific contribution?',
    why_asked:
      'Tests depth of understanding. Many students copy projects from GitHub and cannot explain them. This filters them out.',
    answer_framework:
      'Problem (what real problem does this solve — one sentence) → Solution overview (what you built — one sentence) → Tech choices (why React not Angular? Why MySQL not MongoDB?) → Your specific contribution → Challenges faced and how you solved them → What you would do differently',
    dos: [
      'Know every line of code — if you copied something, understand it',
      'Prepare for follow-up: "why did you use X library?"',
      'Have one specific technical challenge ready: "I struggled with X and solved it by doing Y"'
    ],
    donts: [
      'Say "we built" — say "I built" and "I was responsible for"',
      'Choose a project you cannot explain technically',
      'Say "it is a basic project" — own it'
    ],
    company_types: ['all'],
    difficulty: 'hard'
  },
  {
    id: 'stress-001',
    round: 'hr',
    category: 'stress',
    question: 'Are you open to relocation and working in any city?',
    why_asked:
      'Practical eligibility filter. For mass recruiters especially, they deploy freshers anywhere in India.',
    answer_framework:
      'If yes: be direct and positive → If you have constraints: be honest but show flexibility → Never give a conditional answer that sounds like you are negotiating',
    dos: [
      'Be honest — a commitment you cannot keep will cause problems later',
      'If yes, say yes clearly without caveats',
      'If you have constraints, mention them professionally once'
    ],
    donts: [
      'Say yes in the interview and back out after offer',
      'Make it sound like a negotiation',
      'Bring up salary in this context'
    ],
    company_types: ['service_it'],
    difficulty: 'easy'
  }
]

export function getQuestionsByRound(
  round: InterviewRound
): InterviewQuestion[] {
  return INTERVIEW_QUESTIONS.filter(q => q.round === round)
}

export function getQuestionsByCategory(
  category: InterviewQuestionCategory
): InterviewQuestion[] {
  return INTERVIEW_QUESTIONS.filter(q => q.category === category)
}

export function getQuestionsForCompanyType(
  companyType: string
): InterviewQuestion[] {
  return INTERVIEW_QUESTIONS.filter(
    q =>
      q.company_types.includes('all') || q.company_types.includes(companyType)
  )
}

export function getCategoryLabel(
  category: InterviewQuestionCategory
): string {
  const labels: Record<InterviewQuestionCategory, string> = {
    introduction: 'Introduction',
    motivation: 'Motivation',
    behavioral: 'Behavioral',
    situational: 'Situational',
    technical_cs: 'Technical CS',
    project_deep_dive: 'Project Deep Dive',
    stress: 'Stress'
  }
  return labels[category]
}

export function getRoundLabel(round: InterviewRound): string {
  const labels: Record<InterviewRound, string> = {
    hr: 'HR',
    technical: 'Technical',
    aptitude_discussion: 'Aptitude Discussion'
  }
  return labels[round]
}
