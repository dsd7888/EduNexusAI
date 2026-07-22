"use client";

/**
 * The proposal diff card — the core review surface of the Health tab.
 *
 * The whole feature's safety rests on this card being honest. A faculty member
 * accepts a change to their own syllabus based on what they read here, so:
 *
 *  - OLD is server-rendered from the database (suggestions.ts never lets the
 *    model author it). What's in the red block is what is actually stored today.
 *  - The rationale is always visible, never behind a disclosure. "Why" is the
 *    thing being judged; hiding it turns review into rubber-stamping.
 *  - Accept is the only path that writes, and it is disabled while in flight so
 *    a double-click can't fire two writes at one finding.
 */

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Finding, Proposal } from "@/lib/syllabus-audit/types";
import { DIMENSION_LABELS } from "@/lib/syllabus-audit/types";
import { ENTITY_TYPE_LABELS } from "./shared";

interface ProposalCardProps {
  proposal: Proposal;
  /** The finding this fixes — its diagnosis is the "problem" line. */
  finding: Finding | null;
  onAccept: (proposal: Proposal) => Promise<void>;
  onDismiss: (proposalId: string) => void;
}

export function ProposalCard({
  proposal,
  finding,
  onAccept,
  onDismiss,
}: ProposalCardProps) {
  const [busy, setBusy] = useState(false);

  const handleAccept = async () => {
    setBusy(true);
    try {
      await onAccept(proposal);
    } finally {
      // The card usually unmounts on success; guard for the failure path where
      // it stays and must become clickable again.
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-[11px] font-normal">
              {DIMENSION_LABELS[proposal.dimension]}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {ENTITY_TYPE_LABELS[proposal.entityType] ?? proposal.entityType}
            </span>
          </div>
          {finding && (
            <p className="text-sm text-muted-foreground">{finding.diagnosis}</p>
          )}
        </div>
      </div>

      {/* The diff. Stacked rather than side-by-side: the values are prose-like
          (a CO description runs to a couple of lines) and two narrow columns
          force mid-word wrapping that makes a small wording change hard to
          spot — which is the one thing this view exists to make easy. */}
      <div className="space-y-1.5">
        <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-rose-300/80">
            Now
          </div>
          <div className="text-sm text-rose-200 break-words">{proposal.oldValue}</div>
        </div>
        <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-emerald-300/80">
            Proposed
          </div>
          <div className="text-sm text-emerald-200 break-words">
            {proposal.newValue}
          </div>
        </div>
      </div>

      <div className="rounded-md bg-muted/50 px-3 py-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Why
        </div>
        <p className="text-sm text-muted-foreground">{proposal.rationale}</p>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleAccept} disabled={busy} className="gap-1">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDismiss(proposal.id)}
          disabled={busy}
          className="gap-1"
        >
          <X className="size-4" />
          Dismiss
        </Button>
      </div>
    </div>
  );
}
