"use client";

/**
 * SubjectSearchPicker — the one subject-selection control on the student side.
 *
 * WHY THIS EXISTS AS A SHARED COMPONENT (CP-Q3 Part 2)
 * Three student surfaces each grew their own subject list: /student/subjects,
 * /student/chat, and the quiz setup. All three re-implemented the same
 * offerings query, the same sort, and none of them had search — so a pilot
 * student on a 7-semester branch scrolls 52 cards to find one subject. This
 * component is the single search-enabled selector, wired into all three in the
 * same checkpoint. A shared component that lives in one consumer for a
 * checkpoint and gets wired to the others "later" is exactly how three subtly
 * different local implementations accumulate.
 *
 * NO NEW DEPS. There is no shadcn `command` primitive in src/components/ui/
 * (checked — accordion…textarea, no cmdk), so this is a plain input over a
 * filtered list with its own keyboard handling rather than a cmdk wrapper.
 *
 * OWNERSHIP: this component owns search, keyboard nav and (in multi mode) the
 * selection set. It does NOT own what selection means — consumers get
 * onSelect/onChange and decide whether that navigates, filters a grid, or
 * feeds a quiz request.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useStudentSubjects, type SubjectRow } from "@/hooks/useSupabaseData";
import { cn } from "@/lib/utils";

/**
 * Multi-select ceiling. This is a SEND-COST guard, not a UI opinion: quiz
 * generation batches carry each selected subject's full syllabus (CP-Q1 §3 —
 * "full syllabus, never truncated"), so every extra subject is real tokens on
 * every batch. Five is the point past which a combined-syllabus quiz stops
 * being a coherent assessment anyway.
 */
export const MAX_MULTI_SUBJECTS = 5;

/** Above this many chips, collapse to a count so the control stops growing. */
const CHIP_SUMMARY_THRESHOLD = 3;

const DEBOUNCE_MS = 50;

export interface SubjectSearchPickerProps {
  /** Fired on every commit (click / Enter). In multi mode, fired per toggle. */
  onSelect: (subject: SubjectRow) => void;
  multi?: boolean;
  /**
   * true (default): only the student's own semester — the narrow, common case.
   * false: every subject their branch offers, all semesters. The pilot cohort
   * has students taking cross-semester electives, and hiding those makes the
   * picker look broken to exactly the students with the least common timetable.
   */
  filterByBranch?: boolean;
  placeholder?: string;
  /** Subject ids selected on mount (multi mode). Uncontrolled thereafter. */
  initialSelected?: string[];
  /** Multi mode only: the full selection after each toggle. */
  onChange?: (subjects: SubjectRow[]) => void;
  /** Rendered when the (filtered) subject list is empty. */
  emptyLabel?: string;
  className?: string;
  /** Keep the result list open at all times (inline pickers) vs. on focus. */
  alwaysOpen?: boolean;
}

/**
 * Subsequence match with a positional score — "fuzzy" in the useful sense
 * (typing `dbms` finds "Database Management Systems") without pulling in a
 * fuzzy-search dependency.
 *
 * Returns null for no match. Lower score = better. The scoring rewards early
 * and contiguous matches, so an exact code prefix always outranks a scattered
 * subsequence hit inside a long name.
 */
export function fuzzyScore(haystack: string, needle: string): number | null {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();

  const direct = h.indexOf(n);
  if (direct !== -1) {
    // Substring hit — always beats any subsequence hit (which start at 1000).
    return direct;
  }

  let score = 1000;
  let hi = 0;
  let lastHit = -1;
  for (let ni = 0; ni < n.length; ni += 1) {
    const ch = n[ni];
    let found = -1;
    while (hi < h.length) {
      if (h[hi] === ch) {
        found = hi;
        hi += 1;
        break;
      }
      hi += 1;
    }
    if (found === -1) return null;
    // Gap penalty: contiguous runs score better than scattered letters.
    score += lastHit === -1 ? found : found - lastHit - 1;
    lastHit = found;
  }
  return score;
}

/** Best score across name / code / branch — the three fields worth searching. */
function matchSubject(subject: SubjectRow, query: string): number | null {
  if (!query.trim()) return 0;
  const q = query.trim();
  const candidates = [subject.code, subject.name, subject.branch ?? ""];
  let best: number | null = null;
  for (const c of candidates) {
    const s = fuzzyScore(c, q);
    if (s !== null && (best === null || s < best)) best = s;
  }
  return best;
}

export default function SubjectSearchPicker({
  onSelect,
  multi = false,
  filterByBranch = true,
  placeholder = "Search subjects by name, code or branch…",
  initialSelected,
  onChange,
  emptyLabel = "No subjects match that search.",
  className,
  alwaysOpen = false,
}: SubjectSearchPickerProps) {
  const [branch, setBranch] = useState<string | null>(null);
  const [semester, setSemester] = useState<number | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const { subjects, isLoading: subjectsLoading } = useStudentSubjects(
    branch,
    semester
  );

  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(alwaysOpen);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    () => initialSelected ?? []
  );
  const [limitHit, setLimitHit] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── profile ───────────────────────────────────────────────────────────────
  // The hook needs branch AND semester before it queries (semester is a
  // readiness gate there, not a filter — see useStudentSubjects). Guarded
  // against a late resolve after unmount.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const { createBrowserClient } = await import("@/lib/db/supabase-browser");
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("branch, semester")
          .eq("id", user.id)
          .single();
        if (cancelled) return;
        setBranch((profile?.branch as string | null) ?? null);
        setSemester((profile?.semester as number | null) ?? null);
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── debounce ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // ── the candidate set ─────────────────────────────────────────────────────
  // useStudentSubjects already scopes to the student's branch (every semester
  // of it). filterByBranch narrows that to their OWN semester; false keeps the
  // whole branch, which is what a cross-semester elective needs.
  const scoped = useMemo(() => {
    if (!filterByBranch || semester == null) return subjects;
    return subjects.filter((s) => (s.semester ?? 0) === semester);
  }, [subjects, filterByBranch, semester]);

  const results = useMemo(() => {
    const scored: Array<{ subject: SubjectRow; score: number }> = [];
    for (const s of scoped) {
      const score = matchSubject(s, query);
      if (score !== null) scored.push({ subject: s, score });
    }
    scored.sort(
      (a, b) =>
        a.score - b.score ||
        (a.subject.semester ?? 0) - (b.subject.semester ?? 0) ||
        a.subject.code.localeCompare(b.subject.code)
    );
    return scored.map((r) => r.subject);
  }, [scoped, query]);

  // Clamp the highlight whenever the result set shrinks under it, or the
  // keyboard would be pointing at nothing.
  useEffect(() => {
    setActiveIndex((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results.length]);

  const selectedSubjects = useMemo(
    () => selectedIds.map((id) => subjects.find((s) => s.id === id)).filter(Boolean) as SubjectRow[],
    [selectedIds, subjects]
  );

  // ── onChange notification ─────────────────────────────────────────────────
  // ⚠ DO NOT "SIMPLIFY" THIS BACK INTO per-mutation onChange() CALLS INSIDE
  // commit()/removeSelected(). That is the obvious shape and it ships a bug:
  //
  //   `initialSelected` arrives from a `?subjectId=` deep link, which is in the
  //   URL on the FIRST render — before useStudentSubjects has resolved. A
  //   caller notified only on explicit toggles never hears about that
  //   preselection, so the chip renders (child state) while the parent still
  //   believes nothing is selected, and its Start button stays disabled
  //   forever. It reads as "the quiz page sometimes doesn't work."
  //
  // One effect covers the preselect and the toggles through the same path, and
  // additionally: it waits for ids to RESOLVE before notifying (so the caller
  // never receives a truncated list mid-load), and prunes ids that never
  // resolve once loading is done (a stale bookmark, or a subject the student is
  // no longer offered).
  //
  // onChange is held in a ref because every caller passes an inline arrow; a
  // fresh identity each render would turn this effect into a render loop.
  // See §17: "Parent-notified state via effect, not per-mutation callback."
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const lastNotified = useRef<string | null>(null);
  useEffect(() => {
    if (!multi) return;
    // Ids that resolve to nothing once the list HAS loaded are dead — a stale
    // bookmark, or a subject the student is no longer offered. Drop them
    // rather than leaving the selection permanently unresolvable.
    if (!subjectsLoading && subjects.length > 0) {
      const known = new Set(subjects.map((s) => s.id));
      const pruned = selectedIds.filter((id) => known.has(id));
      if (pruned.length !== selectedIds.length) {
        setSelectedIds(pruned);
        return;
      }
    } else if (selectedIds.length > 0) {
      // Still loading and something is selected — wait, so the caller gets
      // resolved rows rather than a truncated list.
      return;
    }

    const signature = selectedIds.join(",");
    if (signature === lastNotified.current) return;
    lastNotified.current = signature;
    onChangeRef.current?.(selectedSubjects);
  }, [multi, selectedIds, selectedSubjects, subjects, subjectsLoading]);

  const commit = useCallback(
    (subject: SubjectRow) => {
      if (!multi) {
        onSelect(subject);
        setOpen(alwaysOpen);
        return;
      }
      setLimitHit(false);
      setSelectedIds((prev) => {
        const already = prev.includes(subject.id);
        if (!already && prev.length >= MAX_MULTI_SUBJECTS) {
          setLimitHit(true);
          return prev;
        }
        return already
          ? prev.filter((id) => id !== subject.id)
          : [...prev, subject.id];
      });
      onSelect(subject);
    },
    [multi, onSelect, alwaysOpen]
  );

  const removeSelected = useCallback((id: string) => {
    setLimitHit(false);
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) =>
        results.length === 0 ? 0 : (i - 1 + results.length) % results.length
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const subject = results[activeIndex];
      if (subject) commit(subject);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // First Esc clears a query; a second closes. Clearing is the more common
      // intent and losing the list on the first press is annoying.
      if (rawQuery) {
        setRawQuery("");
        setQuery("");
      } else if (!alwaysOpen) {
        setOpen(false);
        (e.target as HTMLInputElement).blur();
      }
    }
  };

  // Keep the highlighted row in view under arrow-key nav.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results.length]);

  // Close on outside click (only when the list is float-open).
  useEffect(() => {
    if (alwaysOpen || !open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, alwaysOpen]);

  const loading = profileLoading || subjectsLoading;
  const showList = alwaysOpen || open;

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {/* ── selected chips (multi) ─────────────────────────────────────── */}
      {multi && selectedSubjects.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {selectedSubjects.length > CHIP_SUMMARY_THRESHOLD ? (
            <>
              <span className="text-xs font-medium text-muted-foreground">
                {selectedSubjects.length} selected
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedIds([]);
                  setLimitHit(false);
                }}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear all
              </button>
            </>
          ) : null}
          {selectedSubjects.map((s) => (
            <Badge
              key={s.id}
              variant="secondary"
              className="gap-1 py-1 pl-2 pr-1 font-normal"
            >
              <span className="font-mono text-[11px]">{s.code}</span>
              <button
                type="button"
                aria-label={`Remove ${s.code}`}
                onClick={() => removeSelected(s.id)}
                className="rounded-sm p-0.5 hover:bg-background/60"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      {/* ── search input ───────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={rawQuery}
          onChange={(e) => {
            setRawQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="pl-9"
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {multi && limitHit ? (
        // Amber, never red — §16. Hitting a cap is a constraint, not an error.
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-500">
          {MAX_MULTI_SUBJECTS} subjects is the maximum for one quiz — remove one
          to add another.
        </p>
      ) : null}

      {/* ── results ────────────────────────────────────────────────────── */}
      {showList ? (
        <div
          ref={listRef}
          role="listbox"
          className={cn(
            "z-30 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover shadow-md",
            !alwaysOpen && "absolute left-0 right-0"
          )}
        >
          {loading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Loading your subjects…
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {scoped.length === 0
                ? "No subjects found for your branch. Contact your admin."
                : emptyLabel}
            </p>
          ) : (
            results.map((s, i) => {
              const isSelected = selectedIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => commit(s)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                    i === activeIndex && "bg-muted"
                  )}
                >
                  <Badge
                    variant="outline"
                    className="shrink-0 font-mono text-[11px]"
                  >
                    {s.code}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Sem {s.semester ?? "—"}
                  </span>
                  {multi ? (
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        isSelected ? "text-primary" : "text-transparent"
                      )}
                    />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

export type { SubjectRow };
