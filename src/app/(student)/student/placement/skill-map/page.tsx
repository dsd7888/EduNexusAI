"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { MonoTag, type MonoTagVariant } from "@/components/ui/mono-tag";
import { ScoreMeter } from "@/components/ui/score-meter";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useSupabaseData";
import { getArchetype, computeSkillGap } from "@/lib/placement/archetypes";
import type { SkillGapProfile, SkillGapPillarResult, PillarStatus } from "@/lib/placement/archetypes";
import { TARGET_LABELS, type StudentPlacementProfile } from "@/types/placement";

// ─── Status → visual mapping (DESIGN.md: never red for performance) ────────

const STATUS_TAG_VARIANT: Record<PillarStatus, MonoTagVariant> = {
  met: "mastery-fill",
  partial: "amber-fill",
  gap: "default",
};

const STATUS_LABEL: Record<PillarStatus, string> = {
  met: "Met",
  partial: "Partial",
  gap: "Gap",
};

// Percent-based pillars (readiness_*, resume_completeness) render with
// ScoreMeter using the pillar's own target; count-based pillars (projects,
// tech stack, extracurriculars) render as a plain value/target row instead —
// a "62%" framing doesn't make sense for "1 deployed project".
function isPercentPillar(pillar: SkillGapPillarResult): boolean {
  // valueLabel ends in "/100" only for percent metrics (see formatValueLabel
  // in archetypes.ts) — a cheap, correct-by-construction check that doesn't
  // need to duplicate the metric→percent set from that module.
  return pillar.valueLabel.endsWith("/100");
}

function PillarRow({ pillar }: { pillar: SkillGapPillarResult }) {
  return (
    <div className="rounded-8 border border-ink-200 bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-plex-sans text-body font-semibold text-ink">{pillar.label}</p>
          <p className="mt-0.5 max-w-lg font-plex-sans text-label text-ink-600">{pillar.description}</p>
        </div>
        <MonoTag variant={STATUS_TAG_VARIANT[pillar.status]}>{STATUS_LABEL[pillar.status]}</MonoTag>
      </div>

      {isPercentPillar(pillar) ? (
        <ScoreMeter className="mt-3" score={pillar.value} target={pillar.target} />
      ) : (
        <p className="mt-3 font-plex-mono text-mono-tag text-ink-600">
          {pillar.valueLabel} <span className="text-ink-400">·</span> {pillar.targetLabel}
        </p>
      )}

      {pillar.status !== "met" && (
        <div className="mt-3">
          {pillar.remedy.kind === "phase2" ? (
            <MonoTag variant="default">{pillar.remedy.label}</MonoTag>
          ) : (
            <Link
              href={pillar.remedy.href}
              className="inline-flex h-11 items-center gap-1.5 rounded-8 border border-ink-200 px-3 font-plex-sans text-label font-medium text-ink transition-colors duration-180 ease-out hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
            >
              {pillar.remedy.label}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export default function SkillMapPage() {
  const router = useRouter();
  const { profile: userProfile, isLoading: userLoading } = useCurrentUser();
  const [placementProfile, setPlacementProfile] = useState<StudentPlacementProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    fetch("/api/placement/profile")
      .then((r) => r.json())
      .then((d) => {
        if (!d.profile) {
          router.replace("/student/placement/setup");
          return;
        }
        setPlacementProfile(d.profile as StudentPlacementProfile);
      })
      .catch(() => toast.error("Failed to load placement profile"))
      .finally(() => setLoadingProfile(false));
  }, [router]);

  const dataReady = !loadingProfile && !userLoading;

  const report = useMemo(() => {
    if (!dataReady || !placementProfile) return null;
    const branch = userProfile?.branch ?? "ANY";
    const archetype = getArchetype(branch, placementProfile.primary_target);
    const gapProfile: SkillGapProfile = {
      readiness_aptitude: placementProfile.readiness_aptitude,
      readiness_verbal: placementProfile.readiness_verbal,
      readiness_domain: placementProfile.readiness_domain,
      readiness_coding: placementProfile.readiness_coding,
      readiness_communication: placementProfile.readiness_communication,
      resume_completeness: placementProfile.resume_completeness,
      resume_data: placementProfile.resume_data as SkillGapProfile["resume_data"],
    };
    return computeSkillGap(gapProfile, archetype);
  }, [dataReady, placementProfile, userProfile?.branch]);

  if (!dataReady || !placementProfile || !report) {
    return (
      <div className="max-w-4xl space-y-6">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-8 w-full" />
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-8" />
          <Skeleton className="h-24 rounded-8" />
          <Skeleton className="h-24 rounded-8" />
        </div>
      </div>
    );
  }

  const { archetype, pillars, metCount, partialCount, gapCount } = report;
  const total = pillars.length;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
          Skill-gap map · {TARGET_LABELS[placementProfile.primary_target]}
        </p>
        <h1 className="mt-1 font-plex-serif text-display-lg font-bold text-ink">{archetype.label}</h1>
        <p className="mt-2 max-w-2xl font-plex-sans text-body text-ink-600">{archetype.summary}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <MonoTag variant="mastery-fill">{metCount}/{total} met</MonoTag>
        {partialCount > 0 && <MonoTag variant="amber-fill">{partialCount} partial</MonoTag>}
        {gapCount > 0 && <MonoTag variant="default">{gapCount} gap{gapCount === 1 ? "" : "s"}</MonoTag>}
      </div>

      <div className={cn("space-y-3")}>
        {pillars.map((pillar) => (
          <PillarRow key={pillar.id} pillar={pillar} />
        ))}
      </div>

      {gapCount === 0 && partialCount === 0 && (
        <p className="font-plex-sans text-body text-ink-600">
          Every pillar for this archetype is met. Check back after a drive or a target change —
          this map recomputes from your latest readiness and resume data.
        </p>
      )}
    </div>
  );
}
