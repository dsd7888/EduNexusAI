# CP-Q4 — Faculty Analytics

The surface a Dean or HOD pays for: what the cohort actually knows, which
questions are broken, and whether the COs an accreditation body will ask about
are being attained. Everything here is **DB aggregation — this checkpoint makes
ZERO AI calls.**

Branch `dev`. Migrations `20260727120000_retro_subjects_school_created_by.sql`
and `20260728000000_faculty_analytics_snapshots.sql`, both applied to the live
pilot database before the code that reads them shipped.

---

## Part 0 — deferred CP-Q3 privacy check: PASS

Before any faculty read of student data was built, the shape of
`quiz_sessions.config.masterySnapshot` (CP-Q3 Part 5A) was audited for
material a student should not be able to read.

**Clean.** Every field is the student's own data, already selectable by them
directly under existing RLS:

| Field | Source | Student-readable independently? |
|---|---|---|
| `subjectId`, `moduleId` | `modules` (scoping ids) | Yes — already on their own `quiz_sessions` row |
| `moduleName` | `modules.name` | Yes — syllabus metadata, rendered across student surfaces |
| `attemptsBefore` | `student_topic_mastery.attempts_count` | Yes — `stm_select_own` |
| `correctBefore` | `student_topic_mastery.correct_count` | Yes — `stm_select_own` |
| `accuracyBefore` | derived ratio | Yes — from the two above |
| `difficultyBefore` | `student_topic_mastery.current_difficulty` | Yes — `stm_select_own` |

- **All own data.** `buildMasterySnapshot(adminClient, user.id, …)` is called
  with the authenticated user's id, and the mastery pull is
  `.eq("student_id", studentId)`. The containing row is gated by
  `quiz_sessions_select_own`.
- **No answer-key or grading material.** Keys live in `quiz_session_keys` (the
  CP-Q3 Part 1 split); `config.questions` is the `studentSafe(...)` projection.
  `accuracyBefore` is a ratio of the student's own counters, not a scoring rule.
- **No field from a source the student wouldn't normally read.**
  `current_difficulty` — the adaptive ladder position — was the one worth a
  second look. It is the student's own ladder position, directly selectable, and
  already rendered to them on the mastery hub.

The companion-table split contingency did not trigger. A one-line note was added
to `CP_Q3_STUDENT_UX.md` at the mastery-deltas paragraph.

---

## The access invariant

> A faculty user sees analytics ONLY for subjects in their `faculty_assignments`.
> Dean/HOD see analytics only for subjects within their `role_scope`.
> Superadmin sees everything. No exceptions.

Encoded once, in `src/lib/analytics/access.ts`:

```ts
assertAnalyticsAccess(adminClient, userId, role, subjectId) → SubjectRow
```

Throws `AnalyticsAccessError` (carrying an HTTP status) on denial; returns the
subject row on success so callers need no second round trip.

### Grep-verifiable enforcement

Every analytics route calls it **before its first read**:

```bash
grep -rn "assertAnalyticsAccess" src/app/api/faculty/analytics
```

must return a hit for every `route.ts` under that directory. This is asserted
mechanically, not by convention — `_cp_q4_verify/access_invariants.ts` §7 walks
the directory and fails if any route file lacks the call. A route that read
first and checked later would still pass a functional test; the enforcement is
positional.

### Why this deliberately diverges from §4's oversight fallthrough

Everywhere else in this codebase, ownership checks test `role === "faculty"`
literally and dean/hod fall through into the superadmin-like else branch. §4
says that is intentional — for **faculty content** (lesson plans, PPTs, the
Q-bank), an unscoped dean read means "all the teaching material in my school",
which is coarse-grained and fine.

**Analytics is not faculty content. It is per-student performance data
aggregated at cohort scale, and unscoped access would be a privacy hole rather
than a UX affordance** — one endpoint returning the mastery profile of every
student in the institution. So this surface scopes dean/hod through `role_scope`
and **fails closed**: a dean with no `role_scope` row reads nothing.

That divergence is the entire reason CP-Q4 has its own `assertAnalyticsAccess`
rather than reusing `assertSubjectAccess` (which short-circuits on
`role !== "faculty"`). Keeping them separate means a future faculty feature
unrelated to analytics cannot pick up analytics-specific rules by importing the
same function, and equally cannot loosen them for everyone by "fixing" the
shared helper for its own case.

### Access-check masking — authorization outcomes only, never infrastructure

`analyticsAccessResponse(err, { maskAsNotFound })` collapses 4xx → 404 for the
per-student route. A faculty member probing student ids must not be able to
enumerate the roster by reading status codes, so "no access to this subject",
"subject doesn't exist", "student doesn't exist" and "student has no sessions
here" all return an identical `{"error":"Not found"}` with status 404.

**5xx is never masked.** An infrastructure failure reported as 404 sends
everyone debugging a routing problem that does not exist. The harness asserts
the two 404 bodies are byte-identical, so there is no oracle.

> Periodically grep the codebase for masking logic that silently promotes 5xx
> into 4xx. The bound is the whole safety property.

---

## Data model

### `faculty_analytics_snapshots` — one row per subject, forever

`subject_id` carries a **named** UNIQUE constraint
(`faculty_analytics_snapshots_subject_id_key`) rather than an inline one. Two
reasons, both load-bearing: the constraint name is the upsert target, and
`DROP CONSTRAINT IF EXISTS` → `ADD CONSTRAINT` is the idempotent shape a
re-runnable migration needs (an inline `UNIQUE (col)` gets an
implementation-chosen name a later migration cannot reliably drop). Logged to
§17.

**Per-subject, not per-faculty.** Analytics is a property of the cohort, not of
the viewer. Two faculty on the same subject must see the same numbers — if they
did not, a disagreement between colleagues about "what the data says" would be a
caching artefact. The UNIQUE constraint makes per-faculty snapshots
unrepresentable rather than merely discouraged.

### `aggregate_accuracy` is NULL at zero attempts, never 0 — a design choice

This is CP-Q3's "never show a student a failure they didn't earn" applied at
cohort scale. A fresh subject rendering **0% cohort accuracy** reads as a
catastrophic result and would trigger faculty intervention on data that does not
exist. Zero is a real, terrible score; "no data yet" is not a score at all.

Every consumer branches on null before formatting, and the same rule holds in
`aggregation.ts`, `computePerModule`, `computeCOAttainment` and
`pointBiserial`. **A future "fix the null handling" refactor has to argue with
this reasoning, not discover it.** Logged to §17.

### RLS

| Reader | Rule |
|---|---|
| superadmin | `fas_all_superadmin` — full access |
| faculty | `fas_select_faculty_assigned` — via `faculty_assignments` ONLY. Not school, not branch, not department (§4: faculty can be assigned across schools, so any hierarchy shortcut is both wrong and wider) |
| dean/hod | `fas_select_oversight_scoped` — via `role_scope` joined to `subjects`; `role_scope.department IS NULL` means entire school |
| student | **No policy at all.** A student SELECT returns `[]` with no error (§14) |

---

## Aggregate compute lib

`src/lib/analytics/aggregates.ts` — five pure functions plus one persistence
wrapper. The pure five take a data pull and constants and return a value: no
Supabase, no clock except an injectable `now`, no writes. That is what lets
`aggregate_correctness.ts` assert them against hand-calculated values to four
decimal places, and what keeps every persistence decision in `refreshSnapshot`
alone.

**Each function's docstring states what it computes AND what it does not.** This
document does not restate them — the source is the record. In summary:

| Function | Computes | Explicitly does not |
|---|---|---|
| `computeAggregateAccuracy` | one attempt-weighted cohort number | weight students equally, drop outliers, or separate by mode |
| `computePerModule` | accuracy / attempts / distinct students per module, ordered by `module_number` | infer a module for attempts whose `module_id` is null (exam_sim items may legitimately span modules) |
| `computePerQuestion` | times served, correct, accuracy, mean time, point-biserial — **bank questions only** | cover `ai_fresh` questions (no persistent identity — pooling them averages different questions together); compute discrimination below the 5-attempt floor; judge, rank, hide or auto-flag any question |
| `computeCOAttainment` | confidence-weighted per-CO accuracy from actual performance | check question-paper coverage; apply an attainment threshold or level; map CO→PO |
| `computeEngagement` | weekly active students (oldest-first), streak distribution, median practice frequency | count abandoned or in-progress sessions as practice; relax streak semantics at cohort scale |
| `refreshSnapshot` | all five + upsert | check access (caller must have passed `assertAnalyticsAccess`) |

### The shared `aggregation.ts` extraction

`computeAggregateAccuracy` does not implement the arithmetic. It delegates to
`src/lib/assessment/aggregation.ts`, which is **also** consumed by
`/api/assessment/landing` (the student's own mastery aggregate, CP-Q3 Part 3),
the per-student analytics route, and the roster route.

Both call sites were rewired **in the same diff that created the module**. The
discipline matters: shared math that lives in one consumer and is "extracted
later" was never extracted, it was duplicated. Two implementations drift — not
because anyone rewrites the formula, but because one acquires a rounding change
or a null guard the other doesn't, and then the product quietly tells a student
and their teacher different things about the same work, with no way to notice
from either side.

The rule it encodes: **attempt-weighted, never a mean of per-bucket
percentages.** For buckets of (40 attempts, 20 correct) and (3 attempts, 3
correct):

```
mean-of-percentages → (50% + 100%) / 2 = 75%   ← wrong, and flattering
attempt-weighted     → 23 / 43           = 53%   ← what actually happened
```

### Streak semantics are not relaxed at cohort scale

`computeEngagement` imports CP-Q3's `computeStreak` unmodified. It would be easy
to argue that faculty want the "true" current state and should see a student's
streak as broken the moment Monday starts. **That argument is rejected.** A
streak means one thing in this product — the current week is *pending, not
failing* — and a faculty member acting on a number that reads differently from
the one the student sees would be intervening on an artefact of whose screen it
was rendered on.

### Point-biserial discrimination

```
r_pb = ((M1 − M0) / σ) · √(p · q)
```

M1/M0 are the mean overall session scores of students who got the item
right/wrong, σ the population SD of those scores, p/q the proportions. The value
for faculty: **r_pb < 0 means the students who did well overall got this item
wrong more often than the students who did badly** — almost always a miskeyed
answer or an ambiguous stem, not a hard question.

Returns `null` (never 0) below `MIN_ATTEMPTS_FOR_DISCRIMINATION = 5`, when every
attempt is correct or every attempt is wrong, or when σ = 0. Null and 0 stay
distinct: 0 is a real finding ("this item tells you nothing"), null means "not
measurable yet". Collapsing them would sort never-answered questions to the top
of the broken-question review queue.

---

## Snapshot freshness model

```
read → missing, or computed_at older than 2h  → recompute inline, refreshedInline: true
read → within the window                      → serve stored, refreshedInline: false
cron → 0 3 * * * , every subject with attempts in the last 24h
```

**No recompute on every route hit.** The aggregates are a full scan of a
subject's attempt history with a point-biserial per bank question; at pilot
cohort size one refresh serves many faculty views of the same subject.
Recomputing per request would make the dashboard's cost scale with how often
faculty look at it, which is backwards.

The 2-hour window is a judgement about what this surface is *for*. It is not a
live scoreboard — nobody makes a teaching decision on the last twenty minutes of
quiz activity. Two hours is short enough that a faculty member who runs a class
exercise and checks afterwards sees it, long enough that a page refresh does not
trigger a recompute.

**Manual refresh is floored at 15 minutes and enforced server-side, per
subject** (not per faculty, as the spec phrased it). The snapshot *is*
per-subject, so two faculty pressing refresh would otherwise trigger two full
recomputes producing the same row. A client-side countdown alone is a
suggestion.

The **cohort privacy floor is applied at the response layer**, never at compute
or storage time — so the stored snapshot stays truthful for cron and debugging,
a cohort that grows past the floor becomes visible without a recompute, and the
suppression reads as what it is (a disclosure decision) rather than as a filter
someone later "optimises" away.

---

## CO attainment lineage — CP-Q1.5 through to the NAAC-facing metric

```
syllabus modules
   └─ dual-pass Flash classifier (CP-Q1.5, §17)
        └─ module_co_mapping { co_code, confidence: high|medium|low,
                               source: ai_inferred | superadmin_verified }
             └─ mappingWeight()            ← src/lib/analytics/coWeighting.ts
                  └─ computeCOAttainment(attempts, mappings)
                       └─ faculty_analytics_snapshots.co_attainment
                            └─ the CO panel + the Dean's NAAC callout
```

Every attempt inherits the COs of its module. An attempt whose module maps to
three COs contributes to all three, each at that mapping's own weight — a module
genuinely teaches toward several outcomes, and splitting the attempt between
them would understate every one.

```
weighted_accuracy = Σ(wᵢ · correctᵢ) / Σ(wᵢ)
```

`attempts` in the result is the **raw** count, not the weighted sum: faculty
reading "CO 3: 61% over 240 attempts" need the real exposure figure; a weighted
187.2 would look like a bug.

### Confidence bands map to numeric weights per `CONFIDENCE_WEIGHTS`

Calibrated to **dual-pass semantics**, not to a generic notion of confidence:

| Band | Weight | Why |
|---|---|---|
| `high` | 1.0 | §17: agreement between two independent passes keeps the result and takes the *lower* of the two confidences — so a surviving `high` means both calls independently arrived at this CO with high confidence |
| `medium` | 0.7 | agreement at a weaker confidence, or a single-pass result with no disagreement to resolve — real signal, discounted |
| `low` | 0.4 | §17: disagreement forces `low` and takes the **union** of both passes. `low` does not mean "a weak guess" — it means "the classifier could not decide, and this is one of several mappings kept for safety" |

Weights are non-zero at every band on purpose. A CO whose only mappings are
low-confidence would otherwise vanish from the attainment table, and an absent
CO reads as "not assessed" rather than "assessed on shaky mappings" — the more
misleading of the two on an accreditation surface.

**Recalibrate in `coWeighting.ts` when live confidence distributions become
reviewable — never per consumer**, or the number in the dashboard and the number
in a report drift.

A **verified** mapping weighs a flat 1.0 regardless of the AI's original
confidence. Someone has looked at it and confirmed it, superseding the
classifier; continuing to discount that by a stale `low` would mean verification
never fully counted. `co_attainment.ts` asserts this against an explicit
counterfactual: CO 2 computes to 0.6588, and **not** the 0.6364 it would be if
the verified low-confidence mapping had been weighted by its band.

### What this metric is NOT

**CO attainment from actual student performance — not question-paper CO
coverage.** Coverage (what the Q-paper generator already reports, and what most
accreditation tooling means by "CO mapping") answers *"did we ASK about this
outcome?"*. This answers *"did students DEMONSTRATE it?"*. A subject can have
flawless coverage and 40% attainment, and that gap is the entire reason the
panel exists.

---

## The Dean-facing pitch shape — which panel closes which concern

| Panel | The concern it closes |
|---|---|
| **3. CO attainment** | *"Show me we meet NAAC criterion 2 targets."* The callout — "3 COs below 60% attainment — this cohort would fail NAAC criterion 2 targets on current performance" — is computed from what students actually scored, traceable back through `module_co_mapping` to the syllabus. **This is the panel that closes the sale.** |
| **2. Module heatmap** | *"Which parts of the syllabus aren't landing?"* Sorted by `weightage_percent` DESC by default, so the highest-weightage-and-lowest-accuracy modules surface first — the ones that will cost the most in the exam. |
| **4. Question quality** | *"Is our assessment instrument sound?"* Negative discrimination is a defensible, standard psychometric flag for a miskeyed or ambiguous question — an answer to the accreditation question "how do you assure assessment quality?" that is not an opinion. |
| **1. Cohort mastery** | *"How is this cohort doing overall?"* One number, attempt-weighted, with an 8-week trend. |
| **5. Engagement** | *"Are students actually using it?"* The adoption question every pilot review asks, answered without a vanity metric — weekly active students, streak distribution, median practice frequency. |
| **6. Students table** | *"Who needs help, specifically?"* The intervention surface. The only panel that names students. |

---

## Explicit rejections

Each is a stated principle, so a future revision has to argue against it rather
than fill a silence.

1. **No cross-feature aggregation.** Analytics reads assessment data only — no
   chat, no placement, no faculty-generated content. A student talking to the AI
   tutor is thinking out loud; they ask the things they would not ask in front
   of a class, and that is most of the value of having it. If faculty can read
   that transcript, students learn to perform for it and the tutor becomes a
   worse tutor for the students who need it most. A quiz is already a thing you
   submit to be marked — faculty seeing it changes nothing about how it is used.
   Enforced by `cross_feature_scoping.ts` with canary strings, not by
   convention.
2. **No per-faculty snapshots.** Analytics is a property of the cohort, not the
   viewer. Enforced by the UNIQUE constraint.
3. **No live recompute on route hit.** See the freshness model.
4. **No student names in any aggregate visualization.** Not in the heatmap, not
   in the CO table, not in the engagement chart, not in a tooltip. Names appear
   *only* in the students table, which is a roster shown to a faculty member
   already entitled to teach those students — a different thing from an
   aggregate, and blurring the two produces a leaderboard.
5. **No aggregate below a 5-student cohort** (`MIN_COHORT_FOR_AGGREGATE`). Five,
   not the student-facing ten, because faculty legitimately need to see thin
   cohorts — an elective with eight students is a real class — and they already
   know who is in the room. Below five, an aggregate is one or two students'
   work wearing the authority of a statistic.
6. **No item statistic below 5 attempts** (`MIN_ATTEMPTS_FOR_DISCRIMINATION`).

---

## Deviations from the CP-Q4 spec, and why

1. **Five routes, not four.** `GET /api/faculty/analytics/subject/[subjectId]/students`
   was added for the students table. The roster is deliberately **not** in the
   snapshot: `faculty_analytics_snapshots` is a cached aggregate refreshed by a
   cron and read by every faculty member on the subject, and an aggregate table
   containing identities is no longer an aggregate table. It is also the correct
   freshness behaviour — the snapshot may legitimately be two hours old, but
   "who is in my class and when were they last active" should not be.
2. **The cron route is `GET` (with a `POST` alias).** The spec said POST; Vercel
   cron issues **GET**, and all three pre-existing cron routes are GET for that
   reason. A POST-only route would be scheduled in `vercel.json`, appear wired
   up, and never fire.
3. **The cron route fails closed in production when `CRON_SECRET` is unset.**
   The three existing cron routes treat an unset secret as "allow anyone", which
   is survivable for a bounded UPDATE. This route recomputes a full aggregate
   per active subject — left open it is a one-request amplification any
   logged-in student could fire in a loop. Found by the harness (below).
4. **Manual refresh is limited per subject, not per faculty.** See the freshness
   model.

---

## Verification — `_cp_q4_verify/`

All six run against the live database; the three HTTP harnesses need
`npm run dev`. Output is redirected to a file, never piped (a SIGPIPE from
`head` does not run a `finally`).

| Harness | Result | What it proves |
|---|---|---|
| `discrimination_stat.ts` | **12 / 12** | Point-biserial against hand-computed values (perfect 1.00, inverted −1.00, an asymmetric 0.7759), the 5-attempt floor from both sides, and that degenerate inputs return null rather than NaN |
| `aggregate_correctness.ts` | **57 / 57** | The full `refreshSnapshot` path against the scripted scenario — counts, aggregate, per-module, per-question, two hand-computed discriminations, the jsonb/numeric round trip, and that a second refresh still leaves exactly one row |
| `co_attainment.ts` | **22 / 22** | Weighting by confidence band; a verified low-confidence mapping weighing 1.0 against an explicit counterfactual; that flattening the weights changes the answer; multi-CO contribution |
| `access_invariants.ts` | **29 / 29** | Faculty A 200 on X / 403 on Y; Faculty B's identical 404s (no oracle); dean school-wide, HOD department-scoped, both 403 outside; an unscoped dean failing closed; students 403 everywhere; and the grep-verifiable invariant checked mechanically |
| `snapshot_freshness.ts` | **22 / 22** | Missing → inline; fresh → served with `computed_at` **unchanged** (proving no recompute, rather than trusting the flag); aged 3h → inline; the manual-refresh floor from both sides |
| `cross_feature_scoping.ts` | **35 / 35** | Canary strings seeded into chat, placement and generated content appear nowhere in any analytics payload — with a positive control that the response *does* carry assessment data, and a control that the canaries were genuinely reachable |

**Total: 177 assertions, 0 failures.**

**Cleanup verified, not assumed.** After the full suite:
`faculty_analytics_snapshots` 0, `role_scope` 0, `quiz_sessions` 0,
`student_question_attempts` 0, `student_topic_mastery` 0, leftover CPQ4 subjects
0, leftover harness profiles 0, `subjects` back to its pre-CP-Q4 count of 17.

### Four defects the harnesses found

Recorded because the point of a harness is the things it catches, not the green
number at the end.

1. **The cron route was open to any authenticated user** when `CRON_SECRET` is
   unset. Fixed by failing closed in production (deviation 3 above).
2. **`computed_at` serialised two different ways** — Postgres returns
   `…+00:00`, JS `toISOString()` returns `…Z`. The same field therefore changed
   representation depending on whether the request hit the cache or recomputed,
   so any client comparing it as a string would see a phantom change on every
   cache transition. Normalised in `snapshotStore.envelope`.
3. **The per-student module breakdown depended on `student_topic_mastery`**, a
   *derived* cache written by the `/submit` write-back — so it vanished for any
   student whose attempts exist but whose mastery rows do not (a half-failed
   submit, an `/answer` row in an unsubmitted session, imported data). Faculty
   would have seen "no modules practised" beside a non-zero attempt count.
   Rewritten to derive from attempts (the ground truth the cohort panel already
   uses, so the two now agree by construction), consulting mastery only for the
   ladder position and last-practised timestamp.
4. **Two cleanup leaks in the harnesses themselves**, caught by the
   verify-the-cleanup rule rather than by any assertion: `seedScenario` leaked
   everything it had created when seeding threw partway (the cleanup closure was
   only reachable through a successful return — now wrapped in try/catch that
   rolls back and re-throws), and `access_invariants` enumerated its extra
   subjects by hand and silently leaked Subject Y on every run (now a tracked
   list).

---

## Schema-drift findings

Three, all real, all logged to `Future_plans.MD` as audit items.

1. **`role_scope` exists live but is EMPTY, and CP-Q4 is its first consumer.**
   The table has `(id, user_id, school, department, created_at)` matching §4, but
   appears in no migration and in no line of `src/` before now. There are also no
   dean/hod profiles yet. So the oversight branch has never executed against
   real data, and `access_invariants.ts` is the only place it is exercised before
   pilot — which is why that harness seeds **both** scoping shapes (department
   NULL and department set) plus an out-of-scope subject, rather than a single
   positive case. *A positive case alone cannot distinguish "the policy works"
   from "the policy allows everything."*
   **When the first real dean or HOD is created they MUST get a `role_scope` row,
   or analytics will correctly show them nothing.**
2. **`subjects.school` and `subjects.created_by` are live but were in no
   migration** — added through the SQL editor, the drift §14 warns about seen
   from the column side rather than the policy side. The dean/hod RLS policy now
   depends on `school`, so this was a load-bearing dependency on a column with no
   recorded origin. Captured retroactively in
   `20260727120000_retro_subjects_school_created_by.sql`, which is a strict no-op
   against the live DB and exists so a fresh environment matches. Deliberately its
   own migration, not folded into the CP-Q4 one: that file *creates* structure and
   this one *records* existing structure.
3. **`module_co_mapping.source` values documented in §5 cannot exist.** §5 says
   `'ai_classified' | 'faculty_verified'`; the migration that created the table
   constrains it to `CHECK (source IN ('ai_inferred','superadmin_verified'))`,
   and all 135 live rows are `ai_inferred`. `confidence` is likewise a TEXT band
   (`high|medium|low`), not a numeric score. Note this is not a naming quibble:
   the table's RLS grants write only to superadmin/dept_admin, so **verification
   is a superadmin action in this system, not a faculty one — a faculty member
   cannot currently verify a CO mapping at all.** `coWeighting.ts` handles the
   real values and keeps the documented names as aliases so a future schema
   alignment does not silently demote every verified mapping on migration day.

---

## Files

**Migrations**
- `supabase/migrations/20260727120000_retro_subjects_school_created_by.sql`
- `supabase/migrations/20260728000000_faculty_analytics_snapshots.sql`

**Lib**
- `src/lib/assessment/aggregation.ts` — shared attempt-weighted math (new)
- `src/lib/analytics/access.ts` — the access invariant
- `src/lib/analytics/aggregates.ts` — the six compute functions
- `src/lib/analytics/coWeighting.ts` — CO trust weights
- `src/lib/analytics/privacy.ts` — cohort + item floors, discrimination copy
- `src/lib/analytics/snapshotStore.ts` — read-through cache + floor application

**Routes**
- `GET /api/faculty/analytics/subject/[subjectId]` (+ `?force=1`)
- `GET /api/faculty/analytics/subject/[subjectId]/students`
- `GET /api/faculty/analytics/question/[questionId]`
- `GET /api/faculty/analytics/student/[studentId]?subjectId=`
- `GET|POST /api/cron/refresh-analytics-snapshots` — `0 3 * * *`

**UI** — `src/app/(faculty)/faculty/analytics/`
- `_components/FacultyAnalyticsShell.tsx` — breadcrumbs + `humanizeAge`
- `subject/[subjectId]/page.tsx` — the six-panel dashboard
- `question/[questionId]/page.tsx` — item deep dive
- `student/[studentId]/page.tsx` — per-student view

**Modified** — `/api/assessment/landing` (rewired to shared aggregation),
`src/lib/testing/httpHarness.ts` (role-aware sign-in),
faculty dashboard subject card (one "Analytics" link), `vercel.json`,
`CLAUDE_CONTEXT.md` §17, `CP_Q3_STUDENT_UX.md`, `Future_plans.MD`.

The pre-existing `/faculty/analytics` page (platform usage analytics) is
untouched; the new pages nest beneath it.

---

## Not verified

Per CLAUDE.md's verification protocol, stated explicitly rather than implied:

**The three new pages have not been browser-driven, and no interrupted or
concurrent flow was exercised on them.** They type-check, lint clean and build,
and every route they consume is verified over real HTTP by the harnesses — but
the UI itself has had no manual pass.

Both concurrency guards the protocol calls for are in place *by construction*:
the roster effect carries a `cancelled` flag, and the snapshot load carries a
`loadToken` ref checked after every `await` (a subject switch mid-flight, a
manual refresh landing after the initial load, and a double-clicked refresh all
overlap on this page). Spinner state is only cleared by the request that still
owns the page. **But written-correctly is not verified-correctly** — this is
exactly the class of bug that passed tsc, lint, build and a full happy-path
drive during the Syllabus Health Audit. A browser pass exercising an interrupted
load (switch subject mid-request) and a concurrent one (refresh while the
roster is still loading) is still owed.
