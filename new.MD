🎯 REVISED PILOT ARCHITECTURE
Student Flow (Guided & Simple)
1. Login → Student Dashboard
2. Select Branch (Mechanical / Chemistry)
3. Select Semester (1-8)
4. Select Subject (Shows only subjects for that branch+semester)
5. Chat Interface Opens with:
   - Subject context locked (can't chat about other subjects)
   - Suggested prompts in cards (like ChatGPT home)
   - Simple chat with citations

Data Model (Simplified)
No more PDFs! Just structured text:
sql-- New table: subject_content
CREATE TABLE subject_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  content_type TEXT CHECK (content_type IN ('syllabus', 'key_concepts', 'textbook_refs')),
  content TEXT NOT NULL,  -- The actual syllabus/notes as plain text
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Example data:
-- subject_id: Thermodynamics
-- content_type: 'syllabus'
-- content: "Unit 1: Laws of Thermodynamics
--           First Law: Energy conservation...
--           Reference Textbooks: 
--           - Engineering Thermodynamics by P.K. Nag
--           - Heat Transfer by J.P. Holman"
```

---

## Suggested Prompts (Smart & Subject-Specific)

For **Thermodynamics**, show:
- "Explain the First Law of Thermodynamics in simple terms"
- "What's the difference between heat and work?"
- "Give me a real-world example of the Second Law"
- "Solve: A system absorbs 500J of heat..."

For **Organic Chemistry**, show:
- "Explain benzene's aromaticity"
- "What are functional groups?"
- "Difference between SN1 and SN2 reactions"

**These are generated dynamically** by analyzing the syllabus!

---

## The Prompt Engineering Strategy

**Core Principle:** One master prompt template that adapts to ANY subject.

**System Prompt Template:**
```
You are an expert university tutor for {SUBJECT_NAME} ({SUBJECT_CODE}).
You ONLY answer questions strictly related to the syllabus provided below.

SYLLABUS:
{SUBJECT_SYLLABUS_TEXT}

RULES:
1. Answer ONLY using information from the syllabus above
2. If question is outside syllabus, say: "This topic isn't covered in your {SUBJECT_NAME} syllabus"
3. Use simple language suitable for {SEMESTER} semester students
4. Give concrete examples when explaining concepts
5. For numerical problems, show step-by-step solutions
6. Always mention which unit/section your answer refers to
7. If you reference a textbook from the syllabus, cite it

Your goal: Help students understand the syllabus content deeply.
```

**This works for ANY department because:**
- ✅ Subject name is dynamic
- ✅ Syllabus text is dynamic
- ✅ Semester level adjusts tone
- ✅ Rules are universal

---

## Implementation Plan (Revised Day 4)

### Part 1: Subject Content Management (30 min)

**Cursor Prompt:**
```
Add a new tab to /src/app/(superadmin)/superadmin/subjects/page.tsx called "Subject Content"

This tab shows:
- Subject selector dropdown
- Textarea to paste syllabus text (large, 10+ rows)
- "Save Syllabus" button
- Display current syllabus text if exists

API:
- POST /api/subjects/content with { subjectId, contentType: 'syllabus', content }
- GET /api/subjects/content?subjectId=xxx to fetch

Creates/updates subject_content table record.
Simple CRUD, no complexity.
```

---

### Part 2: Student Subject Selector (30 min)

**Cursor Prompt:**
```
Create /src/app/(student)/student/subjects/page.tsx

Flow:
1. Show student's branch and semester at top (from their profile)
2. Show grid of subject cards (fetch subjects WHERE branch = student.branch AND semester = student.semester)
3. Each card shows:
   - Subject code and name
   - Department
   - "Start Chat" button → /student/chat/{subjectId}

Use shadcn Card components.
Clean, simple grid layout.
```

---

### Part 3: Chat UI with Suggested Prompts (45 min)

**Cursor Prompt:**
```
Create /src/app/(student)/student/chat/[subjectId]/page.tsx

Layout:
1. Top bar: Subject name + code (fetch from subjects table)
2. If no messages yet:
   - Show 4 suggested prompt cards (like ChatGPT home)
   - Cards show: "Explain...", "What is...", "Difference between...", "Example of..."
   - Clicking a card sends that as the first message
3. Once chat starts:
   - Message list (user messages on right, AI on left)
   - Input box at bottom
   - Send button
   - Loading indicator while AI responds

Suggested prompts generation:
- Fetch subject_content for this subject
- Use Gemini to generate 4 context-specific prompts:
  "Based on this syllabus: {content}, generate 4 example questions 
   a student might ask. Return as JSON array."
- Cache these prompts in the component state

Use shadcn: Card, ScrollArea, Input, Button
Clean, modern chat UI.
```

---

### Part 4: Chat API (RAG with Full Context) (45 min)

**Cursor Prompt:**
```
Create /src/app/api/chat/route.ts

POST endpoint:
1. Auth check (student only)
2. Parse body: { subjectId, message, sessionId? }
3. Get or create chat session for this student + subject
4. Check semantic cache:
   - Generate embedding for message
   - Search semantic_cache WHERE module_id IS NULL AND subject_id = subjectId
   - If similarity > 0.90, return cached response
5. If not cached:
   - Fetch subject_content for this subject
   - Build system prompt using template (see above)
   - Call Gemini with FULL syllabus in context (no chunking needed)
   - Store response in semantic_cache with embedding
6. Save message to chat_messages
7. Return response with citations

Use Gemini Flash for cost efficiency.
Track tokens and cost in usage_analytics.
```

---

### Part 5: Hide Upload Notes Feature (5 min)

**Cursor Prompt:**
```
In /src/app/(superadmin)/superadmin/upload/page.tsx:

Replace the "Notes" tab content with:
<div className="text-center py-12">
  <FileX className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
  <h3 className="text-lg font-semibold mb-2">Notes Upload Coming Soon</h3>
  <p className="text-muted-foreground">
    For the pilot phase, please use the Subject Content management 
    to add syllabus text directly. Full PDF processing will be 
    available post-pilot.
  </p>
</div>

Keep Syllabus and PYQ tabs working.
Import FileX from lucide-react.

Testing the New Flow

Setup (Superadmin):

Go to Subjects → Subject Content tab
Select Thermodynamics
Paste syllabus text (even just a paragraph for testing)
Save


Student Experience:

Login as student
Dashboard shows "Select Subject"
Click Thermodynamics
See 4 suggested prompts
Click one or type own question
Get answer with citation


Verify:

Ask same question again → should be instant (cached)
Ask question outside syllabus → should refuse politely




This Approach Is Better Because:
✅ Ships today - no PDF debugging
✅ Works for any department - prompt template is universal
✅ Guided UX - students can't get lost
✅ Suggested prompts - solves "what should I ask?" problem
✅ Semantic cache - repeated questions are free
✅ Syllabus-locked - main goal achieved
✅ Scalable - add subjects by pasting text, takes 5 min

Want me to generate all 5 prompts now? We can have this working in 2-3 hours total. 🚀Okay guide me again for day-4, properly, and also make AI give knowledge which is practical and easy for student to remember too, like uk if u use too many complex jargons, obv they can get confused, our work is to ease it and also ensure that AI uses its knowledge and give that too,, there can be conditions where textbooks might have limited knowledge..
And lets start day-410:35Perfect! Let's build Day 4 properly with a student-friendly AI tutor.

🚀 DAY 4: Smart AI Tutor (Simplified Architecture)
The Philosophy
Our AI should be like the BEST human tutor:

Explains complex topics in simple terms
Uses real-world examples students can relate to
Builds on textbook knowledge with practical insights
Adapts tone to semester level (3rd sem vs 7th sem)
Remembers what works (semantic cache)


Part 1: Database Setup (5 min)
Go to Supabase → SQL Editor and run:
sql-- Add subject_content table for storing syllabus text
CREATE TABLE subject_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  reference_books TEXT,  -- comma-separated list
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(subject_id)
);

-- Add index
CREATE INDEX idx_subject_content_subject ON subject_content(subject_id);

-- Add updated_at trigger
CREATE TRIGGER subject_content_updated_at 
BEFORE UPDATE ON subject_content
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Part 2: Superadmin Content Management (20 min)

**Cursor Prompt (Cmd+I):**
```
Update /src/app/(superadmin)/superadmin/subjects/page.tsx to add a third tab: "Syllabus Content"

This new tab allows superadmin to add/edit syllabus text for subjects.

Tab layout:
1. Subject selector dropdown (fetch all subjects)
2. When subject selected:
   - Large textarea for syllabus content (20+ rows)
   - Text input for reference books (comma-separated)
   - "Save" button with loading state
3. Display current content if exists (fetch from subject_content table)
4. Success/error toasts

API calls:
- On subject select: GET /api/subjects/content?subjectId={id}
- On save: POST /api/subjects/content with { subjectId, content, referenceBooks }

Use createBrowserClient from @/lib/db/supabase-browser
Use shadcn: Tabs, Select, Textarea, Input, Button, Label, toast

Keep the existing "Subjects" and "Modules" tabs unchanged.
Simple, functional UI focused on getting content in quickly.
```

---

**Cursor Prompt (Cmd+I) #2:**
```
Create /src/app/api/subjects/content/route.ts

GET endpoint:
- Auth check (superadmin only)
- Query param: subjectId
- Fetch subject_content WHERE subject_id = subjectId
- Return { content, referenceBooks } or null if doesn't exist

POST endpoint:
- Auth check (superadmin only)
- Parse body: { subjectId, content, referenceBooks }
- Validate: content is not empty, subjectId exists
- UPSERT into subject_content:
  * If exists: UPDATE
  * If not: INSERT with created_by = user.id
- Return success

Use createAdminClient for all DB operations.
Proper error handling and logging.
```

---

## Part 3: Hide Notes Upload Tab (5 min)

**Cursor Prompt (Cmd+I):**
```
Update /src/app/(superadmin)/superadmin/upload/page.tsx

Replace the entire "Notes" tab content with a placeholder:

<div className="flex flex-col items-center justify-center py-16 text-center">
  <FileX className="w-16 h-16 text-muted-foreground mb-4" />
  <h3 className="text-xl font-semibold mb-2">Notes Upload Coming Soon</h3>
  <p className="text-muted-foreground max-w-md mb-4">
    For the pilot phase, please use the "Subjects → Syllabus Content" tab 
    to add course content directly as text. Full PDF processing will be 
    available after the pilot.
  </p>
  <p className="text-sm text-muted-foreground">
    Tip: Copy-paste syllabus text from your existing PDFs
  </p>
</div>

Import FileX from lucide-react.
Keep Syllabus and PYQ tabs working unchanged.
```

---

## Part 4: Student Subject Selector (25 min)

**Cursor Prompt (Cmd+I):**
```
Create /src/app/(student)/student/subjects/page.tsx

This page helps students select a subject to chat with.

Layout (client component):
1. Page title: "Select Subject"
2. Show student info at top:
   - "Your Branch: {branch}"
   - "Current Semester: {semester}"
   (Fetch from their profile using createBrowserClient)

3. Subject grid:
   - Fetch subjects WHERE branch = student.branch AND semester = student.semester
   - Display as cards grid (3 columns on desktop, 1 on mobile)
   - Each card shows:
     * Subject code (large, bold)
     * Subject name
     * Department badge
     * "Start Learning" button → navigate to /student/chat/{subjectId}

4. Empty state if no subjects:
   - "No subjects found for your branch and semester"
   - "Please contact your admin"

Use shadcn: Card, Badge, Button
Use next/link for navigation
Clean grid layout with hover effects
Loading skeleton while fetching subjects
```

---

## Part 5: The Smart Prompt Engineering System (15 min)

**Cursor Prompt (Cmd+I):**
```
Create /src/lib/ai/prompts.ts

This file contains the master prompt template for the AI tutor.

Export this function:

export function buildTutorSystemPrompt(options: {
  subjectName: string;
  subjectCode: string;
  semester: number;
  branch: string;
  syllabusContent: string;
  referenceBooks?: string;
}): string {
  const { subjectName, subjectCode, semester, branch, syllabusContent, referenceBooks } = options;
  
  // Adjust complexity based on semester
  const complexityLevel = semester <= 2 ? 'beginner' : semester <= 4 ? 'intermediate' : 'advanced';
  const explanation_style = {
    beginner: 'Use very simple language, avoid jargon, explain every term',
    intermediate: 'Use clear language with some technical terms, provide examples',
    advanced: 'Use technical language, assume foundational knowledge, focus on depth'
  };

  return \`You are an expert university tutor specializing in ${subjectName} (${subjectCode}) for ${complexityLevel} level students (Semester ${semester}, ${branch} branch).

SYLLABUS CONTENT:
${syllabusContent}

${referenceBooks ? \`REFERENCE TEXTBOOKS:\n${referenceBooks}\n\` : ''}

YOUR TEACHING PHILOSOPHY:
1. **Simplify Complex Concepts**: ${explanation_style[complexityLevel]}
2. **Use Real-World Examples**: Connect theory to practical applications students can relate to
3. **Build on Textbook Knowledge**: The syllabus is your foundation, but you can add:
   - Modern industry applications
   - Recent developments in the field
   - Practical problem-solving techniques
   - Study tips and exam strategies
4. **Be Student-Friendly**: Use analogies, visual descriptions, step-by-step breakdowns
5. **Encourage Understanding**: Don't just give answers, help students think

RESPONSE RULES:
- **Stay in Scope**: Only answer questions related to ${subjectName} or general study advice
- **If Outside Scope**: Say "That's not covered in your ${subjectName} syllabus, but I'm here to help with [list 2-3 actual topics]"
- **Cite Sources**: When referencing syllabus, say "According to Unit X..." or "As per the syllabus section on..."
- **For Numerical Problems**: Show complete step-by-step solutions with explanations
- **Use Formatting**: 
  - Bold key terms
  - Use bullet points for lists
  - Show formulas clearly
  - Break complex explanations into numbered steps

EXAMPLE GOOD RESPONSES:
- "Let's break down the First Law of Thermodynamics in simple terms. Think of it like your bank account..."
- "Here's a real-world example: When you use a pressure cooker at home, that's the Second Law in action..."
- "I'll solve this step-by-step: Step 1: Identify what we're given..."

Your goal: Help students not just pass exams, but truly understand and remember ${subjectName}.\`;
}

This prompt adapts to:
- Subject (dynamic)
- Semester level (adjusts complexity)
- Branch (context)
- Syllabus content (grounding)
- Reference books (additional context)
```

---

## Test Setup Before Building Chat (10 min)

**Manual test setup:**

1. **Login as superadmin**
2. Go to **Subjects → Syllabus Content tab**
3. Select **Thermodynamics**
4. Paste this test syllabus:
```
UNIT 1: LAWS OF THERMODYNAMICS
- First Law: Energy Conservation Principle
- Second Law: Entropy and Heat Transfer Direction
- Applications: Heat Engines, Refrigerators

UNIT 2: THERMODYNAMIC CYCLES
- Carnot Cycle
- Rankine Cycle
- Brayton Cycle

Reference Books:
- Engineering Thermodynamics by P.K. Nag
- Thermodynamics: An Engineering Approach by Cengel & Boles

Save
Verify in Supabase → Table Editor → subject_content → should see the row