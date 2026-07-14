"use client";

import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

interface Props {
  onGetAnswer: () => void;
}

/** Shown under a resumed session's last message when it's a user turn that
 * never got a reply (the stream died before completion on a prior visit). */
export function OrphanResumeCard({ onGetAnswer }: Props) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>This question didn&apos;t get a response.</span>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onGetAnswer} className="h-7 shrink-0 text-xs">
        Get answer
      </Button>
    </div>
  );
}
