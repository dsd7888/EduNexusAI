import type { PlacementTarget } from '@/types/placement'

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
    company_types: ['all'],
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
    company_types: ['all'],
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
    company_types: ['all'],
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
  },
  {
    id: 'intro-003',
    round: 'hr',
    category: 'introduction',
    question: 'What are your strengths and weaknesses?',
    why_asked:
      'Tests self-awareness and honesty. A rehearsed, generic answer is instantly obvious to an experienced interviewer.',
    answer_framework:
      'Strength: pick one that is actually relevant to the role, backed by a one-line proof (not just the label) → Weakness: name a real, moderate one + the specific thing you are doing about it — not a disguised humble-brag',
    dos: [
      'Back the strength with a specific example, not just the word',
      'Choose a weakness that is real but not role-critical',
      'Show the concrete action you are taking on the weakness'
    ],
    donts: [
      'Say "perfectionist" or "work too hard" as a weakness — every interviewer has heard it a hundred times',
      'List more than one weakness unless asked',
      'Claim you have no weaknesses'
    ],
    company_types: ['all'],
    difficulty: 'easy'
  },
  {
    id: 'motiv-002',
    round: 'hr',
    category: 'motivation',
    question: 'Why should we hire you over other candidates?',
    why_asked:
      'Tests whether you can articulate your specific value, not just repeat "I am hardworking and a fast learner."',
    answer_framework:
      'Pick 2 concrete things that differentiate you (a specific skill, project, or way you work) → Tie each directly to what this role needs → Close with genuine enthusiasm, not desperation',
    dos: [
      'Be specific: name a skill or project, not a trait',
      'Connect your answer to the actual role, not a generic pitch',
      'Keep it under 60 seconds'
    ],
    donts: [
      'List generic adjectives with no evidence',
      'Put down other candidates you have never met',
      'Sound rehearsed word-for-word'
    ],
    company_types: ['all'],
    difficulty: 'medium'
  },
  {
    id: 'motiv-003',
    round: 'hr',
    category: 'motivation',
    question: 'What do you know about our products and the market we compete in?',
    why_asked:
      'Product and startup interviewers filter hard for candidates who did zero research versus those who actually used or studied the product.',
    answer_framework:
      'Name the specific product/feature you explored → One honest observation (what you liked, or a gap you noticed) → Connect it to why that makes you want to build here',
    dos: [
      'Actually use the product before the interview if possible',
      'Have one specific, non-generic observation ready',
      'Show curiosity, not just praise'
    ],
    donts: [
      'Recite the "About Us" page verbatim',
      'Say "I have not used it yet" with nothing else to offer',
      'Over-praise without a single specific detail'
    ],
    company_types: ['product', 'startup'],
    difficulty: 'medium'
  },
  {
    id: 'motiv-004',
    round: 'hr',
    category: 'motivation',
    question: 'Why do you want to work in core manufacturing/engineering roles instead of IT?',
    why_asked:
      'Core companies specifically filter out candidates who are treating the role as a backup while they wait for an IT offer.',
    answer_framework:
      'A genuine reason tied to your branch/coursework or a project you built → What specifically excites you about hands-on/core work → Commitment signal — this is not a fallback choice',
    dos: [
      'Reference a specific core-engineering project, internship, or course',
      'Be honest and specific about what draws you to core work',
      'Show you understand what the day-to-day role actually involves'
    ],
    donts: [
      'Imply this is your backup while you wait for a software offer',
      'Give an answer that would work identically for any company',
      'Undersell your branch knowledge'
    ],
    company_types: ['core_engineering'],
    difficulty: 'medium'
  },
  {
    id: 'motiv-005',
    round: 'hr',
    category: 'motivation',
    question: 'Why a startup instead of a stable, established company?',
    why_asked:
      'Startups need to know you understand the tradeoff — more ownership and ambiguity, less structure and job security — and are choosing it deliberately.',
    answer_framework:
      'Acknowledge the tradeoff explicitly (you know it is less stable) → What you actually want from it (ownership, speed, breadth) → One concrete signal you already seek this (a self-driven project, a leadership role in college)',
    dos: [
      'Show you understand the real tradeoff, not just "startups are exciting"',
      'Give a concrete example of you already working this way',
      'Be honest about wanting ownership, not just referencing "fast-paced culture" as a buzzword'
    ],
    donts: [
      'Pretend you have not considered the risk',
      'Use "fast-paced" or "dynamic" with nothing concrete behind it',
      'Imply you would leave the moment a bigger company calls'
    ],
    company_types: ['startup'],
    difficulty: 'medium'
  },
  {
    id: 'behav-003',
    round: 'hr',
    category: 'behavioral',
    question: 'Tell me about a time you took initiative without being asked.',
    why_asked:
      'Tests whether you act proactively or only execute what you are told — a strong signal for how much supervision you will need.',
    answer_framework:
      'STAR: the gap or opportunity you noticed that nobody had assigned to anyone → what made you decide to act → what you actually did → the outcome, including what changed because you acted',
    dos: [
      'Choose an example where you genuinely acted before being told',
      'Be specific about what you actually did, step by step',
      'Mention the outcome, even if modest'
    ],
    donts: [
      'Describe something you were explicitly assigned',
      'Exaggerate the scale to sound more impressive',
      'Skip the "why did you decide to act" part'
    ],
    company_types: ['all'],
    difficulty: 'medium'
  },
  {
    id: 'behav-004',
    round: 'hr',
    category: 'behavioral',
    question: 'Describe a time you had to learn something completely new very quickly.',
    why_asked:
      'Tests learning agility — the single most transferable skill for a fresher, since the specific tech stack you learn in college rarely matches day-one job requirements.',
    answer_framework:
      'The specific new thing (a language, tool, or domain) and the deadline pressure → your actual learning approach — what resources, what order → how you validated you had actually learned it, not just skimmed it',
    dos: [
      'Name the specific thing you learned, not a vague "new technology"',
      'Explain your learning process, not just the outcome',
      'Mention how you confirmed you understood it, not just that you finished'
    ],
    donts: [
      'Claim you learned something "in a day" with no real process behind it',
      'Pick an example that is not actually difficult',
      'Make it sound effortless — interviewers want to see the struggle and the method'
    ],
    company_types: ['all'],
    difficulty: 'medium'
  },
  {
    id: 'situ-002',
    round: 'hr',
    category: 'situational',
    question: 'How would you prioritize when you are given multiple deadlines at once?',
    why_asked:
      'Tests whether you have an actual method, versus just "I would work harder."',
    answer_framework:
      'A concrete method: assess urgency + impact of each task → communicate proactively if something genuinely cannot be met on time → give a real example if you have one',
    dos: [
      'Name a concrete prioritization method (urgency vs impact, or similar)',
      'Mention communicating early if a deadline is at risk, not staying silent',
      'Use a real example from academics or a project if you have one'
    ],
    donts: [
      'Say "I would just manage my time better" with no method',
      'Claim you would never miss a deadline no matter what',
      'Give a purely theoretical answer with zero personal grounding'
    ],
    company_types: ['all'],
    difficulty: 'medium'
  },
  {
    id: 'situ-003',
    round: 'hr',
    category: 'situational',
    question: 'What would you do if you strongly disagreed with a technical decision your manager made?',
    why_asked:
      'Tests whether you can disagree professionally without either staying silent or being insubordinate — both failure modes recruiters watch for.',
    answer_framework:
      'State your case once, clearly, with reasoning/data — not repeatedly → listen to their reasoning; they may know context you do not → if they still decide to go their way, commit to executing it professionally, and raise it again later only if the outcome proves you right',
    dos: [
      'Show you would voice disagreement respectfully, not stay silent',
      'Acknowledge the manager may have context you lack',
      'Show you would commit to the decision once made, not sabotage it'
    ],
    donts: [
      'Say you would just follow orders without ever raising a concern',
      'Say you would go over their head immediately',
      'Sound like you would keep re-litigating the decision after it is made'
    ],
    company_types: ['all'],
    difficulty: 'hard'
  },
  {
    id: 'situ-004',
    round: 'hr',
    category: 'situational',
    question: 'How would you explain a technical or financial risk to a client who has no technical background?',
    why_asked:
      'BFSI and client-facing roles specifically need people who can translate complexity without dumbing it down or losing accuracy.',
    answer_framework:
      'Start with the real-world consequence, not the mechanism → use one concrete analogy the client would recognize → check understanding before moving on, and invite questions',
    dos: [
      'Lead with impact/consequence, not jargon',
      'Use one specific, relatable analogy',
      'Confirm the client actually understood before continuing'
    ],
    donts: [
      'Use technical terms without translating them',
      'Oversimplify to the point of being inaccurate',
      'Talk at the client instead of checking in'
    ],
    company_types: ['bfsi'],
    difficulty: 'hard'
  },
  {
    id: 'situ-005',
    round: 'hr',
    category: 'situational',
    question: 'A client pushes back hard on your recommendation in a meeting. How do you handle it?',
    why_asked:
      'Consulting interviewers specifically test composure and structured pushback-handling under live pressure, since this happens constantly on real engagements.',
    answer_framework:
      'Stay calm, ask what specifically they disagree with — do not get defensive → restate their concern back to confirm you understood it → respond with the reasoning/data behind the recommendation, and be willing to adjust if their pushback is valid',
    dos: [
      'Ask a clarifying question before defending your position',
      'Show you would genuinely consider valid pushback, not just repeat yourself louder',
      'Stay calm and structured, not defensive'
    ],
    donts: [
      'Immediately concede just to avoid conflict',
      'Get visibly defensive or dismissive of the client',
      'Give a vague "I would handle it professionally" non-answer'
    ],
    company_types: ['consulting'],
    difficulty: 'hard'
  },
  {
    id: 'tech-004',
    round: 'technical',
    category: 'technical_cs',
    question: 'What is the difference between SQL and NoSQL databases?',
    why_asked:
      'Tests whether you understand the actual tradeoffs behind a common buzzword pair, not just that "SQL is old and NoSQL is new."',
    answer_framework:
      'SQL: structured schema, relations, ACID guarantees, good for consistent transactional data → NoSQL: flexible/schema-less, horizontally scalable, good for high-volume or unstructured data → give one example of when you would pick each',
    dos: [
      'Name at least one real example database for each (MySQL/PostgreSQL vs MongoDB)',
      'Mention ACID vs eventual consistency if you know it',
      'Give a concrete scenario for choosing one over the other'
    ],
    donts: [
      'Say one is simply "better" than the other',
      'Confuse NoSQL with "no schema at all, ever"',
      'Give only definitions with no tradeoff discussion'
    ],
    company_types: ['all'],
    difficulty: 'medium'
  },
  {
    id: 'tech-005',
    round: 'technical',
    category: 'technical_cs',
    question: 'What is Big O notation and why does it matter?',
    why_asked:
      'Core DSA fundamental — product companies specifically probe whether you can reason about efficiency, not just get code to run.',
    answer_framework:
      'Define it as a way to describe how runtime/memory grows as input size grows, not exact time → walk through O(1), O(log n), O(n), O(n log n), O(n²) with a one-line example each → explain why it matters: correctness alone is not enough at scale',
    dos: [
      'Give a concrete example for at least 2-3 complexity classes',
      'Explain it is about growth rate, not exact seconds',
      'Mention that a working solution can still be a bad solution if too slow'
    ],
    donts: [
      'Just recite the definition with no example',
      'Confuse best-case and worst-case complexity',
      'Say Big O measures actual clock time'
    ],
    company_types: ['product'],
    difficulty: 'medium'
  },
  {
    id: 'tech-006',
    round: 'technical',
    category: 'technical_cs',
    question: 'What is OOP? Explain the four pillars.',
    why_asked:
      'Extremely common IT-services and product technical-round staple — checks whether you actually understand OOP or just memorized the acronym.',
    answer_framework:
      'Define OOP: organizing code around objects that bundle data + behavior → Encapsulation (bundling + hiding internal state) → Inheritance (reusing/extending behavior) → Polymorphism (same interface, different behavior) → Abstraction (hiding complexity behind a simple interface) — one concrete example for each',
    dos: [
      'Have one short concrete example ready per pillar',
      'Be able to say which language/project you actually used OOP in',
      'Distinguish encapsulation from abstraction clearly — they are often confused'
    ],
    donts: [
      'Recite definitions with zero examples',
      'Confuse method overloading (polymorphism) with overriding, or explain neither',
      'Say "class" and "object" are the same thing'
    ],
    company_types: ['all'],
    difficulty: 'medium'
  },
  {
    id: 'tech-007',
    round: 'technical',
    category: 'technical_cs',
    question: 'What happens when you type a URL into a browser and press Enter?',
    why_asked:
      'A classic product-company systems question — tests breadth across networking, DNS, and web fundamentals in one answer.',
    answer_framework:
      'DNS lookup resolves the domain to an IP → browser opens a TCP connection (TLS handshake if HTTPS) → browser sends an HTTP request → server processes and sends back a response → browser parses HTML/CSS/JS and renders the page',
    dos: [
      'Mention DNS resolution explicitly, not just "it finds the server"',
      'Mention TCP/TLS handshake if you know it, even briefly',
      'Walk through the steps in the correct order'
    ],
    donts: [
      'Skip straight to "the server sends back the webpage"',
      'Confuse HTTP and HTTPS as unrelated things rather than variants',
      'Give a one-line non-answer'
    ],
    company_types: ['product'],
    difficulty: 'hard'
  },
  {
    id: 'tech-008',
    round: 'technical',
    category: 'technical_cs',
    question: 'What is normalization in databases and why is it needed?',
    why_asked:
      'DBMS fundamental — tests whether you understand *why* schemas are designed the way they are, not just table syntax.',
    answer_framework:
      'Define it: organizing tables to reduce data redundancy and avoid update/insert/delete anomalies → briefly name 1NF/2NF/3NF and what each removes → give one concrete example of redundancy normalization fixes',
    dos: [
      'Give a concrete before/after example of removing redundancy',
      'Mention at least 1NF and one anomaly it prevents',
      'Know when denormalization is intentionally used (read-heavy systems)'
    ],
    donts: [
      'List the normal forms with no explanation of what each actually fixes',
      'Say normalization is "just organizing tables" with no specifics',
      'Claim normalization has no tradeoffs at all'
    ],
    company_types: ['all'],
    difficulty: 'medium'
  },
  {
    id: 'tech-009',
    round: 'technical',
    category: 'technical_cs',
    question: 'What is the difference between stack and heap memory?',
    why_asked:
      'Tests whether you understand memory management fundamentals underneath the language you use day to day.',
    answer_framework:
      'Stack: fixed-size, LIFO, stores local variables/function calls, automatically freed → Heap: dynamically allocated, larger, manually or garbage-collector managed, used for objects with longer/uncertain lifetime → mention what happens on stack overflow vs memory leak',
    dos: [
      'Mention automatic vs manual/GC-managed cleanup',
      'Give an example of what typically lives on each',
      'Know what a stack overflow actually is (not just the website)'
    ],
    donts: [
      'Say heap memory is "unlimited"',
      'Confuse stack overflow with a memory leak',
      'Give only one sentence with no contrast'
    ],
    company_types: ['product'],
    difficulty: 'medium'
  },
  {
    id: 'tech-010',
    round: 'technical',
    category: 'technical_cs',
    question: 'What is a hash table and why is lookup close to O(1)?',
    why_asked:
      'Core DSA — one of the most commonly used data structures in real code, and a frequent whiteboard follow-up.',
    answer_framework:
      'Define it: key-value store using a hash function to map keys to array indices → explain average-case O(1) lookup because the hash function jumps straight to the bucket → mention collisions and one resolution strategy (chaining or open addressing) and why worst case can degrade to O(n)',
    dos: [
      'Mention collisions and at least one resolution method',
      'Be clear that O(1) is average-case, not guaranteed worst-case',
      'Give a real use case (e.g., a dictionary/map in your project)'
    ],
    donts: [
      'Claim hash table lookup is always exactly O(1) with no caveat',
      'Confuse a hash table with a hash function',
      'Skip mentioning collisions entirely'
    ],
    company_types: ['all'],
    difficulty: 'hard'
  },
  {
    id: 'tech-011',
    round: 'technical',
    category: 'technical_cs',
    question: 'What is the difference between TCP and UDP?',
    why_asked:
      'Networking fundamental — commonly asked to check whether you understand tradeoffs behind protocol choice, not just definitions.',
    answer_framework:
      'TCP: connection-oriented, reliable, ordered delivery, higher overhead → UDP: connectionless, no delivery guarantee, lower overhead, faster → give one real use case for each (TCP: file transfer/web; UDP: video calls/gaming)',
    dos: [
      'Give a real use case for each protocol',
      'Mention the reliability vs speed tradeoff explicitly',
      'Know that UDP does not guarantee order or delivery'
    ],
    donts: [
      'Say UDP is "just a worse version of TCP"',
      'Give only acronym definitions with no tradeoff',
      'Confuse this with HTTP vs HTTPS'
    ],
    company_types: ['product'],
    difficulty: 'medium'
  },
  {
    id: 'proj-002',
    round: 'technical',
    category: 'project_deep_dive',
    question:
      'What was the most challenging technical problem in your project, and how did you solve it?',
    why_asked:
      'Filters for candidates who actually debugged real problems versus those who followed a tutorial start to finish without hitting anything unexpected.',
    answer_framework:
      'State the problem precisely (not "it was hard") → what you tried that did not work → what actually fixed it and why → what you would do differently if you saw a similar problem again',
    dos: [
      'Be precise about the actual technical problem, with specifics',
      'Mention at least one approach that failed before the one that worked',
      'Explain WHY the fix worked, not just that it did'
    ],
    donts: [
      'Say "everything was challenging" with no specific problem named',
      'Skip straight to the solution with no failed attempts mentioned',
      'Claim it was solved instantly with no real struggle'
    ],
    company_types: ['all'],
    difficulty: 'hard'
  },
  {
    id: 'proj-003',
    round: 'technical',
    category: 'project_deep_dive',
    question: 'If you had two more months to work on this project, what would you add or change?',
    why_asked:
      'Tests genuine ownership and critical self-assessment — students who copied a project usually cannot answer this meaningfully.',
    answer_framework:
      'Name 1-2 specific, realistic improvements (not "add AI to everything") → explain the concrete gap each one addresses → show you understand your project\'s current limitations honestly',
    dos: [
      'Give specific, technically grounded improvements',
      'Explain what gap or limitation each improvement addresses',
      'Show honest awareness of current shortcomings'
    ],
    donts: [
      'Say the project is already "complete" with nothing to improve',
      'Suggest vague, unrealistic additions with no grounding',
      'List a feature you do not actually understand how to build'
    ],
    company_types: ['all'],
    difficulty: 'medium'
  },
  {
    id: 'proj-004',
    round: 'technical',
    category: 'project_deep_dive',
    question: 'How did you decide on the architecture or tech stack for this project?',
    why_asked:
      'Tests decision-making, not just execution — anyone can follow a tutorial\'s tech choices, but explaining the "why" behind them is much harder to fake.',
    answer_framework:
      'What alternatives you considered (even briefly) → the specific reason you picked what you picked (familiarity, performance, ecosystem, project requirement) → one thing you would reconsider today with more experience',
    dos: [
      'Name at least one alternative you considered, even if simple',
      'Give a real reason, not "it is popular"',
      'Show you would make a more informed choice today'
    ],
    donts: [
      'Say "my professor/tutorial told me to use it" as the entire reason',
      'Pretend the choice was a deep architectural decision if it was not',
      'Refuse to admit any tech choice could have been better'
    ],
    company_types: ['all'],
    difficulty: 'hard'
  },
  {
    id: 'stress-002',
    round: 'hr',
    category: 'stress',
    question: 'Why do you have gaps or low marks in some semesters?',
    why_asked:
      'A direct, uncomfortable filter question — recruiters want to see composure and honesty, not panic or excuse-making.',
    answer_framework:
      'State the fact plainly, no over-explaining or excessive apology → give the real, brief reason if there is one → pivot immediately to what changed/improved since then, with evidence (recovered CGPA, a project, an initiative)',
    dos: [
      'Answer directly and briefly — do not spiral into over-justifying',
      'Show concrete evidence of improvement since then',
      'Stay calm and matter-of-fact, not defensive'
    ],
    donts: [
      'Blame professors, the college, or circumstances entirely',
      'Get visibly flustered or over-apologize',
      'Dodge the question without answering it at all'
    ],
    company_types: ['all'],
    difficulty: 'hard'
  },
  {
    id: 'stress-003',
    round: 'hr',
    category: 'stress',
    question: 'We have many candidates on paper who look stronger than you. Why should we pick you?',
    why_asked:
      'A deliberately confrontational question to see if you stay composed and confident, or get defensive/rattled.',
    answer_framework:
      'Do not get defensive or compete on their terms → calmly restate your specific, genuine strengths and what you would bring → confidence without arrogance — you cannot control others\' profiles, only your own case',
    dos: [
      'Stay calm — this is deliberately designed to rattle you',
      'Restate your genuine strengths without attacking other candidates',
      'Show quiet confidence, not defensiveness'
    ],
    donts: [
      'Get visibly upset or argue with the premise',
      'Put down unnamed "other candidates"',
      'Cave and agree you are probably not good enough'
    ],
    company_types: ['all'],
    difficulty: 'hard'
  },
  {
    id: 'stress-004',
    round: 'hr',
    category: 'stress',
    question: 'This role requires long hours during peak/appraisal season. Are you fine with that?',
    why_asked:
      'A practical filter for roles with known crunch periods — dishonest yes-answers cause real attrition problems later.',
    answer_framework:
      'Be honest, not performatively enthusiastic → if genuinely fine, say so plainly with a reason → if you have real constraints, mention them professionally once, without turning it into a negotiation',
    dos: [
      'Give an honest answer you can actually keep',
      'If yes, say it plainly without over-promising ("I will work 20 hours a day")',
      'If you have a genuine constraint, state it once, professionally'
    ],
    donts: [
      'Say yes just to sound agreeable, then complain about it later',
      'Turn the answer into a negotiation about compensation',
      'Give a vague non-answer that dodges the actual question'
    ],
    company_types: ['all'],
    difficulty: 'medium'
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

// ─── Structured mock round (SPEC §8) ───────────────────────────────────────
// A "round" is a fixed-length, ordered pull from the static bank above —
// zero generation cost, same question data every rebuild. Deliberately
// deterministic (same target + round always yields the same sequence) rather
// than randomized: predictable rounds are easier to reason about for a pilot
// cohort and stay unit-testable without a random seed. Revisit only if
// repeat-practice variety becomes a real, observed student complaint.

export type MockRound = 'hr' | 'technical'

const HR_ROUND_SEQUENCE: InterviewQuestionCategory[] = [
  'introduction',
  'motivation',
  'behavioral',
  'behavioral',
  'situational',
  'stress'
]

// Ends on project_deep_dive on purpose — the mock page's reactive follow-up
// layer (CP-F1) fires after the round's project question, so it always lands
// as the final beat of the technical round rather than mid-sequence.
const TECHNICAL_ROUND_SEQUENCE: InterviewQuestionCategory[] = [
  'technical_cs',
  'technical_cs',
  'technical_cs',
  'project_deep_dive'
]

const DIFFICULTY_ORDER: Record<InterviewQuestion['difficulty'], number> = {
  easy: 0,
  medium: 1,
  hard: 2
}

function pickForCategory(
  category: InterviewQuestionCategory,
  target: PlacementTarget,
  used: Set<string>
): InterviewQuestion | null {
  const candidates = INTERVIEW_QUESTIONS.filter(
    q =>
      q.category === category &&
      !used.has(q.id) &&
      (q.company_types.includes(target) || q.company_types.includes('all'))
  )
  if (candidates.length === 0) return null

  // Prefer a question tagged specifically for this target over a generic
  // 'all' one, so e.g. a bfsi student sees the bfsi-tagged situational
  // question rather than always falling back to the generic pool.
  const targeted = candidates.filter(q => q.company_types.includes(target))
  const pool = targeted.length > 0 ? targeted : candidates

  const sorted = [...pool].sort(
    (a, b) =>
      DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty] ||
      a.id.localeCompare(b.id)
  )
  return sorted[0]
}

/**
 * Pure, deterministic round builder — same (target, round) always returns
 * the same ordered question list. No AI, no I/O, no randomness.
 */
export function buildMockRound(
  target: PlacementTarget,
  round: MockRound
): InterviewQuestion[] {
  const sequence = round === 'hr' ? HR_ROUND_SEQUENCE : TECHNICAL_ROUND_SEQUENCE
  const used = new Set<string>()
  const questions: InterviewQuestion[] = []
  for (const category of sequence) {
    const q = pickForCategory(category, target, used)
    if (q) {
      questions.push(q)
      used.add(q.id)
    }
  }
  return questions
}

export function getMockRoundLabel(round: MockRound): string {
  return round === 'hr' ? 'HR Round' : 'Technical Round'
}
