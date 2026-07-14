import { ExternalLink } from "lucide-react";
import { domainFromUri } from "./helpers";
import type { Citation } from "./types";

export function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
      {citations.map((c, idx) => (
        <a
          key={`${c.uri}-${idx}`}
          href={c.uri}
          target="_blank"
          rel="noopener noreferrer"
          className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
            {idx + 1}
          </span>
          <span className="truncate">
            {domainFromUri(c.uri)}
            {c.title ? <span className="text-muted-foreground/70"> · {c.title}</span> : null}
          </span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      ))}
    </div>
  );
}
