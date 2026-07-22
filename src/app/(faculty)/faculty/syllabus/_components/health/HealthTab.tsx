"use client";

/**
 * Syllabus Health tab.
 *
 * Two layers, surfaced differently on purpose:
 *
 *  - The deterministic audit (GET /api/syllabus/audit) loads on tab open and
 *    after every syllabus edit. It is free and instant, so it NEVER sits behind
 *    a button — findings and the health ring are just there.
 *  - The AI suggestions (POST /api/syllabus/audit/suggest) cost money and a few
 *    seconds, so they are explicitly requested. A cache hit returns instantly.
 *
 * Proposals are a review buffer. Nothing here writes to the syllabus except
 * Accept, which calls /apply and then re-renders from the audit the server
 * returned — so what the faculty sees after accepting is server truth, not an
 * optimistic guess about what the write did.
 */

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ALL_DIMENSIONS,
  DIMENSION_LABELS,
  type AuditWarning,
  type Dimension,
  type DimensionScore,
  type Finding,
  type Proposal,
} from "@/lib/syllabus-audit/types";
import { ProposalCard } from "./ProposalCard";
import {
  DIMENSION_BLURBS,
  DIMENSION_ICONS,
  SEVERITY_CHIP,
  SEVERITY_ICONS,
  SEVERITY_LABELS,
  healthTone,
  healthVerdict,
} from "./shared";

interface AuditPayload {
  findings: Finding[];
  scores: Record<Dimension, DimensionScore>;
  overallHealth: number;
}

interface HealthTabProps {
  subjectId: string;
  /**
   * The deterministic audit, owned and fetched by the PAGE, not by this tab.
   *
   * It lives up there because the tab-strip badge ("Health · 3") has to track
   * findings while the faculty member is on the editor tab — §6e asks them to
   * see improvement WITHOUT switching. Radix unmounts inactive TabsContent, so
   * a fetch owned here would only ever run while the tab is already open, and
   * the badge would sit stale exactly when it is meant to be informative.
   * Owning it once above also means no duplicate request when the tab IS open.
   */
  audit: AuditPayload | null;
  loading: boolean;
  /** Re-run the deterministic audit (the "Re-check" button). */
  onRefresh: () => void;
  /** Replace the audit with a server-recomputed one after suggest/apply. */
  onAuditReplace: (audit: AuditPayload) => void;
}

// ─── Health ring ─────────────────────────────────────────────────────────────

function HealthRing({ score, assessedCount }: { score: number; assessedCount: number }) {
  const tone = healthTone(score);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);

  return (
    <div className="flex items-center gap-4">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 120 120" className="size-32 -rotate-90">
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            strokeWidth="10"
            className="stroke-muted"
          />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`${tone.ring} transition-[stroke-dashoffset] duration-500`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-3xl font-bold ${tone.text}`}>{score}</span>
          <span className="text-[10px] text-muted-foreground">out of 100</span>
        </div>
      </div>
      <div className="min-w-0 space-y-1">
        <h3 className="font-semibold">Syllabus health</h3>
        <p className="text-sm text-muted-foreground">
          {healthVerdict(score, assessedCount)}
        </p>
        <p className="text-xs text-muted-foreground">
          Averaged over the {assessedCount} dimension{assessedCount === 1 ? "" : "s"} that
          could be assessed from this syllabus.
        </p>
      </div>
    </div>
  );
}

// ─── Dimension card ──────────────────────────────────────────────────────────

function DimensionCard({
  dimension,
  score,
  expanded,
  onToggle,
  findings,
}: {
  dimension: Dimension;
  score: DimensionScore;
  expanded: boolean;
  onToggle: () => void;
  findings: Finding[];
}) {
  const Icon = DIMENSION_ICONS[dimension];
  const tone = healthTone(score.score);
  const clickable = score.assessed && score.total > 0;

  return (
    <div
      className={
        "rounded-lg border bg-card p-3 space-y-2 transition-colors " +
        (clickable ? "hover:bg-muted/40" : "")
      }
    >
      <button
        type="button"
        onClick={clickable ? onToggle : undefined}
        disabled={!clickable}
        className="w-full text-left space-y-2 disabled:cursor-default"
        aria-expanded={clickable ? expanded : undefined}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium truncate">
              {DIMENSION_LABELS[dimension]}
            </span>
          </div>
          {score.assessed ? (
            <Badge className={`shrink-0 ${tone.pill}`}>{score.score}</Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 text-muted-foreground">
              —
            </Badge>
          )}
        </div>

        {score.assessed ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {score.total === 0
                ? "No issues found"
                : `${score.total} finding${score.total === 1 ? "" : "s"}`}
            </span>
            {clickable && (
              <ChevronDown
                className={
                  "size-3.5 text-muted-foreground transition-transform " +
                  (expanded ? "rotate-180" : "")
                }
              />
            )}
          </div>
        ) : (
          // An unassessed dimension says WHY rather than showing a misleading
          // 100 — see DimensionScore.assessed in types.ts.
          <p className="text-xs text-muted-foreground">{score.note}</p>
        )}
      </button>

      {expanded && findings.length > 0 && (
        <ul className="space-y-1.5 border-t pt-2">
          {findings.map((f) => (
            <li key={f.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{f.entity}</span> —{" "}
              {f.diagnosis}
            </li>
          ))}
        </ul>
      )}

      {!expanded && score.assessed && score.total === 0 && (
        <p className="text-[11px] text-muted-foreground/70">
          {DIMENSION_BLURBS[dimension]}
        </p>
      )}
    </div>
  );
}

// ─── Findings list ───────────────────────────────────────────────────────────

function FindingRow({
  finding,
  proposal,
  onView,
}: {
  finding: Finding;
  proposal: Proposal | undefined;
  onView: () => void;
}) {
  const Icon = SEVERITY_ICONS[finding.severity];
  return (
    <div className="flex items-start gap-3 rounded-md border bg-card px-3 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-[10px] ${SEVERITY_CHIP[finding.severity]}`}>
            {SEVERITY_LABELS[finding.severity]}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-normal">
            {finding.entity}
          </Badge>
        </div>
        <p className="text-sm">{finding.diagnosis}</p>
        {finding.suggestion && (
          <p className="text-xs text-muted-foreground">{finding.suggestion}</p>
        )}
      </div>
      {proposal && (
        <Button size="sm" variant="outline" onClick={onView} className="shrink-0">
          View proposal
        </Button>
      )}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function HealthTab({
  subjectId,
  audit,
  loading,
  onRefresh,
  onAuditReplace,
}: HealthTabProps) {
  const [suggesting, setSuggesting] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [warnings, setWarnings] = useState<AuditWarning[]>([]);
  const [aiRan, setAiRan] = useState(false);
  /**
   * AI-discovered findings (co_verb_quality / modern_relevance /
   * missing_topics), held separately from the deterministic audit.
   *
   * They HAVE to live here because /apply recomputes only the deterministic
   * audit — it cannot re-derive AI findings without another Flash call, and it
   * has just deleted the cache they came from. Without this, accepting one
   * proposal dropped every AI finding from the list, and because a proposal is
   * only rendered when its finding resolves, every co_verb_quality proposal
   * silently vanished with it. Caught only by clicking Accept in a browser:
   * 5 proposals became 1 instead of 4 (§17 — live-drive the real UI).
   */
  const [aiFindings, setAiFindings] = useState<Finding[]>([]);
  const [expanded, setExpanded] = useState<Dimension | null>(null);
  const [showProposals, setShowProposals] = useState(false);

  // Proposals are deliberately NOT persisted across a subject switch or a
  // syllabus save. The page remounts this component (key={subjectId}:{reloadKey})
  // so that state resets by construction rather than via a reset effect —
  // proposals computed against an older syllabus would offer fixes for problems
  // that may no longer exist.
  const data = audit;

  const proposalByFinding = useMemo(() => {
    const map = new Map<string, Proposal>();
    for (const p of proposals) if (!map.has(p.findingId)) map.set(p.findingId, p);
    return map;
  }, [proposals]);

  // The deterministic audit is server truth; AI findings are layered on top.
  // Deduped by id because the /suggest response already returns them merged,
  // while /apply returns deterministic-only.
  const allFindings = useMemo(() => {
    const map = new Map<string, Finding>();
    for (const f of data?.findings ?? []) map.set(f.id, f);
    for (const f of aiFindings) if (!map.has(f.id)) map.set(f.id, f);
    return Array.from(map.values());
  }, [data, aiFindings]);

  const findingById = useMemo(() => {
    const map = new Map<string, Finding>();
    for (const f of allFindings) map.set(f.id, f);
    return map;
  }, [allFindings]);

  const assessedCount = useMemo(
    () => ALL_DIMENSIONS.filter((d) => data?.scores[d]?.assessed).length,
    [data],
  );

  const handleSuggest = useCallback(async () => {
    if (!subjectId) return;
    setSuggesting(true);
    try {
      const res = await fetch("/api/syllabus/audit/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't generate suggestions");
        return;
      }
      setProposals((json.proposals ?? []) as Proposal[]);
      setAiFindings((json.aiFindings ?? []) as Finding[]);
      setWarnings((json.warnings ?? []) as AuditWarning[]);
      setAiRan(true);
      setShowProposals(true);
      // The suggest route returns the audit re-scored with the AI findings
      // folded in, so the three AI dimension cards stop reading "not assessed".
      if (json.findings && json.scores) {
        onAuditReplace({
          findings: json.findings as Finding[],
          scores: json.scores as Record<Dimension, DimensionScore>,
          overallHealth: json.overallHealth as number,
        });
      }
      const count = (json.proposals ?? []).length;
      toast.success(
        count === 0
          ? "No changes proposed — nothing the AI is confident enough to suggest."
          : `${count} proposed change${count === 1 ? "" : "s"} ready for review.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't generate suggestions");
    } finally {
      setSuggesting(false);
    }
  }, [subjectId, onAuditReplace]);

  const handleAccept = useCallback(
    async (proposal: Proposal) => {
      const res = await fetch("/api/syllabus/audit/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId,
          proposalId: proposal.id,
          entityType: proposal.entityType,
          patch: proposal.patch,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't apply this change");
        return;
      }

      // Render from what the server actually wrote, not an optimistic local edit.
      onAuditReplace({
        findings: json.findings as Finding[],
        scores: json.scores as Record<Dimension, DimensionScore>,
        overallHealth: json.overallHealth as number,
      });
      setProposals((prev) => prev.filter((p) => p.id !== proposal.id));
      // The change was written, so this finding is resolved. Deterministic ones
      // disappear via the server's recomputed audit; an AI one has to be
      // retired here, since nothing re-derives it.
      setAiFindings((prev) => prev.filter((f) => f.id !== proposal.findingId));

      const inv = json.invalidated as
        | { lessonPlanCache: number; labManualCache: number }
        | undefined;
      const cleared = (inv?.lessonPlanCache ?? 0) + (inv?.labManualCache ?? 0);
      toast.success(json.summary ?? "Change applied", {
        description:
          cleared > 0
            ? "Lesson plan and lab manual caches refreshed — they'll regenerate from the updated syllabus."
            : undefined,
      });
    },
    [subjectId, onAuditReplace],
  );

  const handleDismiss = useCallback((proposalId: string) => {
    // Not persisted, by design (spec §6c): re-running suggestions brings it back.
    setProposals((prev) => prev.filter((p) => p.id !== proposalId));
  }, []);

  if (!subjectId) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a subject to audit its syllabus.
      </p>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Auditing syllabus…
      </div>
    );
  }

  if (!data) return null;

  const grouped = ALL_DIMENSIONS.map((d) => ({
    dimension: d,
    findings: allFindings.filter((f) => f.dimension === d),
  })).filter((g) => g.findings.length > 0);

  const visibleProposals = proposals.filter((p) => findingById.has(p.findingId));

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm text-muted-foreground">
        This tool audits your syllabus against AICTE/NBA standards and suggests
        improvements. Findings update live as you edit. Proposed changes are reviewed
        here before applying — nothing changes until you approve it.
      </div>

      {/* ── Dashboard ───────────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <HealthRing score={data.overallHealth} assessedCount={assessedCount} />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
              className="gap-1"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Re-check
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSuggest()}
              disabled={suggesting}
              className="gap-1"
            >
              {suggesting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {aiRan ? "Regenerate suggestions" : "Get AI Suggestions"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_DIMENSIONS.map((d) => (
            <DimensionCard
              key={d}
              dimension={d}
              score={
                data.scores[d] ?? {
                  score: 100,
                  total: 0,
                  severity: "info",
                  assessed: false,
                }
              }
              expanded={expanded === d}
              onToggle={() => setExpanded((prev) => (prev === d ? null : d))}
              findings={allFindings.filter((f) => f.dimension === d)}
            />
          ))}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
            <AlertTriangle className="size-4" />
            Some suggestions were not used
          </div>
          <ul className="list-disc pl-5 text-xs text-amber-200/80 space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* The syllabus changed under the AI analysis (an accepted proposal
          invalidates the suggestion cache). Say so rather than letting the
          dimension cards quietly contradict the proposals still on screen. */}
      {visibleProposals.length > 0 && aiFindings.length > 0 &&
        !data.scores.co_verb_quality?.assessed && (
          <p className="text-xs text-muted-foreground">
            The syllabus changed since these suggestions were generated. They are
            still safe to apply — each one is re-validated against the current
            syllabus on Accept — but re-run suggestions for a fresh AI review.
          </p>
        )}

      {/* ── Proposals ───────────────────────────────────────────────────── */}
      {visibleProposals.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">
              Proposed changes ({visibleProposals.length})
            </h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowProposals((v) => !v)}
            >
              {showProposals ? "Hide" : "Review all proposals"}
            </Button>
          </div>
          {showProposals && (
            <div className="space-y-3">
              {visibleProposals.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  finding={findingById.get(p.findingId) ?? null}
                  onAccept={handleAccept}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Findings ────────────────────────────────────────────────────── */}
      {grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No findings — this syllabus passes every check that could be run against it.
        </p>
      ) : (
        <div className="space-y-4">
          <h3 className="font-semibold">Findings ({allFindings.length})</h3>
          {grouped.map((g) => (
            <div key={g.dimension} className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                {DIMENSION_LABELS[g.dimension]}
              </h4>
              <div className="space-y-2">
                {g.findings.map((f) => (
                  <FindingRow
                    key={f.id}
                    finding={f}
                    proposal={proposalByFinding.get(f.id)}
                    onView={() => setShowProposals(true)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
