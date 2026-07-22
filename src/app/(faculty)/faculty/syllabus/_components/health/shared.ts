/**
 * Syllabus Health tab — presentation constants.
 *
 * ── On the use of red ────────────────────────────────────────────────────────
 * This file deliberately does NOT use `@/lib/ui/score`, and the reason is worth
 * stating so nobody "fixes" it later. That module encodes the STUDENT score
 * policy — slate/amber/emerald, red reserved for destructive actions — because
 * showing a learner red for being early in their journey is a retention killer.
 *
 * A syllabus audit is not a learner's journey. It is a compliance report read
 * by the faculty member who owns the document, and a CO that cannot be assessed
 * in any exam is a genuine defect that an NBA panel will treat as one. Softening
 * it to amber would misrepresent severity to the one person who can fix it. So
 * the audit has its own three-colour policy — and a red diff for "what exists
 * today" is the universally understood convention for a removal/change.
 *
 * The rules are different because the audiences and the stakes are different;
 * neither is a mistake to be reconciled with the other.
 */

import {
  AlertTriangle,
  BookOpenCheck,
  Clock,
  GitCompareArrows,
  Info,
  Layers,
  ListChecks,
  Sparkles,
  Target,
  Timer,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { Dimension, Severity } from "@/lib/syllabus-audit/types";

export const DIMENSION_ICONS: Record<Dimension, LucideIcon> = {
  co_coverage: Target,
  btl_profile: Layers,
  hours_balance: Clock,
  topic_density: ListChecks,
  practical_alignment: GitCompareArrows,
  co_po_mapping: BookOpenCheck,
  co_verb_quality: BookOpenCheck,
  modern_relevance: Sparkles,
  missing_topics: Timer,
  assessment_coverage: ListChecks,
};

/** One-line explanation of what each dimension actually measures. */
export const DIMENSION_BLURBS: Record<Dimension, string> = {
  co_coverage: "Every course outcome reaches at least one module, and vice versa.",
  btl_profile: "Bloom's levels rise through the course and reach higher-order thinking.",
  hours_balance: "Teaching time is proportionate to exam weightage.",
  topic_density: "No module is packed with more topics than its hours allow.",
  practical_alignment: "Each practical maps to theory, and each module has lab support.",
  co_po_mapping: "Programme outcomes are addressed by at least one course outcome.",
  co_verb_quality: "Course outcomes use measurable, Bloom-appropriate verbs.",
  modern_relevance: "Topics reflect current industry practice.",
  missing_topics: "Standard topics for this subject are not conspicuously absent.",
  assessment_coverage: "Every outcome can actually be examined under the exam scheme.",
};

export const SEVERITY_ICONS: Record<Severity, LucideIcon> = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Info,
};

export const SEVERITY_CHIP: Record<Severity, string> = {
  critical: "border-rose-400/40 bg-rose-500/10 text-rose-300",
  warning: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  info: "border-sky-400/40 bg-sky-500/10 text-sky-300",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "For info",
};

export interface HealthTone {
  text: string;
  ring: string;
  pill: string;
}

/**
 * Score → colour. Thresholds match the scoring policy in checks.ts: a clean
 * dimension is 100, info-only 90, warnings 60, any critical 30.
 */
export function healthTone(score: number): HealthTone {
  if (score >= 90) {
    return {
      text: "text-emerald-400",
      ring: "stroke-emerald-500",
      pill: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300",
    };
  }
  if (score >= 60) {
    return {
      text: "text-amber-400",
      ring: "stroke-amber-500",
      pill: "border-amber-400/40 bg-amber-500/10 text-amber-300",
    };
  }
  return {
    text: "text-rose-400",
    ring: "stroke-rose-500",
    pill: "border-rose-400/40 bg-rose-500/10 text-rose-300",
  };
}

/** Plain-language verdict under the ring. Never scolding, never falsely upbeat. */
export function healthVerdict(score: number, assessedCount: number): string {
  if (assessedCount === 0) return "Not enough syllabus data to audit yet.";
  if (score >= 90) return "This syllabus is in good shape.";
  if (score >= 75) return "Broadly sound, with a few things worth tightening.";
  if (score >= 55) return "Several issues an accreditation review would raise.";
  return "Significant gaps — start with the critical findings.";
}

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  module_co_mapping: "CO ↔ Module mapping",
  btl_levels: "Bloom's levels",
  co_description: "Course outcome wording",
  module_weightage: "Module weightage",
  practical_mapping: "Practical mapping",
  co_po_mapping: "CO ↔ PO mapping",
};
