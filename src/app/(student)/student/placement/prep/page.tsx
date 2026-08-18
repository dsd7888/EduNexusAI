"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Search, X } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { MonoTag, type MonoTagVariant } from "@/components/ui/mono-tag";
import { cn } from "@/lib/utils";
import { DEFAULT_TARGET, scoreState } from "@/lib/ui/score";
import {
  TRACKS,
  TRACK_META,
  TRACK_SECTIONS,
  VALID_TRACKS,
  type Track,
} from "@/lib/placement/tracks";
import type { PlacementTopicMastery } from "@/types/placement";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TrackSummary {
  topicsPracticed: number;
  avgAccuracy: number;
  hasData: boolean;
}

function summarize(rows: PlacementTopicMastery[]): TrackSummary {
  if (rows.length === 0) {
    return { topicsPracticed: 0, avgAccuracy: 0, hasData: false };
  }
  const avg = rows.reduce((s, m) => s + m.recent_accuracy, 0) / rows.length;
  return { topicsPracticed: rows.length, avgAccuracy: avg, hasData: true };
}

function masteryTag(m: PlacementTopicMastery | undefined): {
  label: string;
  variant: MonoTagVariant;
} {
  if (!m) return { label: "New", variant: "default" };
  const state = scoreState(m.recent_accuracy, { target: DEFAULT_TARGET });
  return {
    label: `Mastery ${Math.round(m.recent_accuracy)}`,
    variant: state === "good" ? "mastery-fill" : state === "progress" ? "amber-fill" : "default",
  };
}

function sectionKey(track: Track, sectionTitle: string): string {
  return `${track}::${sectionTitle}`;
}

function topicId(track: Track, topic: string): string {
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  return `topic-${track}-${slug}`;
}

type Highlight = { track: Track; topic: string } | null;

// ─── Presentational pieces ──────────────────────────────────────────────────

function TrackTabs({
  active,
  onSelect,
  focusTrack,
  loading,
}: {
  active: Track;
  onSelect: (track: Track) => void;
  focusTrack: Track | null;
  loading: boolean;
}) {
  return (
    <div role="tablist" aria-label="Prep tracks" className="flex gap-1 overflow-x-auto border-b border-ink-100">
      {TRACKS.map((track) => {
        const isActive = track === active;
        const isFocus = !loading && focusTrack === track;
        return (
          <button
            key={track}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(track)}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 font-plex-sans text-body-sm font-medium transition-colors duration-180 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900",
              isActive ? "border-ink-900 text-ink-900" : "border-transparent text-ink-500 hover:text-ink-800"
            )}
          >
            {TRACK_META[track].title}
            {isFocus && (
              <MonoTag variant="amber-fill" className="ml-0.5">
                Focus
              </MonoTag>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TopicRow({
  track,
  topic,
  mastery,
  loading,
  href,
  highlighted,
}: {
  track: Track;
  topic: string;
  mastery: PlacementTopicMastery | undefined;
  loading: boolean;
  href: string;
  highlighted: boolean;
}) {
  const tag = masteryTag(mastery);
  return (
    <Link
      id={topicId(track, topic)}
      href={href}
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 rounded-8 border border-ink-200 bg-paper px-4 py-2.5 transition-colors duration-180 ease-out hover:border-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900",
        highlighted && "border-ink-400 bg-ink-50"
      )}
    >
      <span className="min-w-0 truncate font-plex-sans text-body-sm text-ink-700">{topic}</span>
      {loading ? (
        <div className="h-4 w-16 shrink-0 animate-pulse rounded bg-ink-100" />
      ) : (
        <MonoTag variant={tag.variant} className="shrink-0">
          {tag.label}
        </MonoTag>
      )}
    </Link>
  );
}

function SectionAccordion({
  section,
  topicMap,
  loading,
  open,
  onToggle,
  practiceHrefFor,
  track,
  highlight,
}: {
  section: { title: string; topics: string[] };
  topicMap: Record<string, PlacementTopicMastery>;
  loading: boolean;
  open: boolean;
  onToggle: () => void;
  practiceHrefFor: (topic: string) => string;
  track: Track;
  highlight: Highlight;
}) {
  const practicedCount = section.topics.filter((t) => topicMap[t]).length;
  return (
    <div className="rounded-8 border border-ink-200 bg-paper">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-plex-sans text-body font-medium text-ink-900">{section.title}</span>
          {!loading && (
            <span className="font-plex-sans text-body-sm text-ink-500">
              {practicedCount}/{section.topics.length} practiced
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-ink-400 transition-transform duration-180 ease-out motion-reduce:transition-none",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-180 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-2 border-t border-ink-100 p-3">
            {section.topics.map((topic) => (
              <TopicRow
                key={topic}
                track={track}
                topic={topic}
                mastery={topicMap[topic]}
                loading={loading}
                href={practiceHrefFor(topic)}
                highlighted={highlight?.track === track && highlight?.topic === topic}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptySearchState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="rounded-12 border border-dashed border-ink-200 bg-paper p-6 text-center">
      <p className="font-plex-sans text-body text-ink-600">
        No topics match &ldquo;{query.trim()}&rdquo;. Try a different search.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-3 inline-flex h-11 items-center font-plex-sans text-body-sm font-medium text-ink underline-offset-2 hover:underline"
      >
        Clear search
      </button>
    </div>
  );
}

// ─── Inner (uses useSearchParams) ──────────────────────────────────────────────

function PrepHubInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const companySlug = searchParams.get("company");
  const trackParam = searchParams.get("track");
  const topicParam = searchParams.get("topic");

  const [mastery, setMastery] = useState<PlacementTopicMastery[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTrack, setActiveTrack] = useState<Track>(
    trackParam && VALID_TRACKS.has(trackParam) ? (trackParam as Track) : "aptitude"
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [highlight, setHighlight] = useState<Highlight>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/placement/prep/mastery")
      .then((r) => (r.ok ? r.json() : { mastery: [] }))
      .then((d) => {
        if (!cancelled) setMastery((d.mastery ?? []) as PlacementTopicMastery[]);
      })
      .catch(() => {
        if (!cancelled) setMastery([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep-link: ?topic= pre-opens the section that contains it (runs once, on mount).
  useEffect(() => {
    if (!topicParam) return;
    for (const track of TRACKS) {
      for (const sec of TRACK_SECTIONS[track]) {
        const match = sec.topics.find((t) => t.toLowerCase() === topicParam.toLowerCase());
        if (match) {
          setActiveTrack(track);
          setExpanded((prev) => new Set(prev).add(sectionKey(track, sec.title)));
          setHighlight({ track, topic: match });
          return;
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(topicId(highlight.track, highlight.topic));
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = setTimeout(() => setHighlight(null), 2000);
    return () => clearTimeout(t);
  }, [highlight]);

  const byTrack = useMemo(() => {
    const map: Record<Track, Record<string, PlacementTopicMastery>> = {
      aptitude: {},
      verbal: {},
      domain: {},
      communication: {},
    };
    mastery.forEach((m) => {
      if (m.track in map) map[m.track as Track][m.topic] = m;
    });
    return map;
  }, [mastery]);

  const summaries = useMemo(() => {
    const out = {} as Record<Track, TrackSummary>;
    TRACKS.forEach((t) => {
      out[t] = summarize(Object.values(byTrack[t]));
    });
    return out;
  }, [byTrack]);

  const focusTrack = useMemo<Track | null>(() => {
    if (loading) return null;
    let pick: Track | null = null;
    let lowest = Infinity;
    TRACKS.forEach((t) => {
      const s = summaries[t];
      const score = s.hasData ? s.avgAccuracy : 0;
      if (score < lowest) {
        lowest = score;
        pick = t;
      }
    });
    return pick;
  }, [summaries, loading]);

  function trackHref(track: Track): string {
    return companySlug
      ? `/student/placement/prep/${track}?company=${encodeURIComponent(companySlug)}`
      : `/student/placement/prep/${track}`;
  }

  function practiceHref(track: Track, topic: string): string {
    const qs = new URLSearchParams({ topic });
    if (companySlug) qs.set("company", companySlug);
    return `/student/placement/prep/${track}/practice?${qs.toString()}`;
  }

  const toggleSection = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  function selectTrack(track: Track) {
    setActiveTrack(track);
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("track", track);
    params.delete("topic");
    router.replace(`/student/placement/prep?${params.toString()}`, { scroll: false });
  }

  const query = search.trim().toLowerCase();
  const isSearching = query.length > 0;

  const searchGroups = useMemo(() => {
    if (!isSearching) return [];
    const groups: Array<{ track: Track; sectionTitle: string; topics: string[] }> = [];
    TRACKS.forEach((track) => {
      TRACK_SECTIONS[track].forEach((sec) => {
        const matches = sec.topics.filter((t) => t.toLowerCase().includes(query));
        if (matches.length > 0) groups.push({ track, sectionTitle: sec.title, topics: matches });
      });
    });
    return groups;
  }, [isSearching, query]);

  const totalMatches = useMemo(
    () => searchGroups.reduce((n, g) => n + g.topics.length, 0),
    [searchGroups]
  );

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-plex-serif text-display-lg font-bold text-ink">Placement Prep</h1>
        <p className="mt-1 font-plex-sans text-body text-ink-600">
          Adaptive practice across aptitude, verbal, core domain, and communication.
        </p>
      </div>

      {/* Search — sticky, filters topics across every track as you type */}
      <div className="sticky top-11 z-[5] bg-paper py-2">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a topic across every track…"
            aria-label="Search a topic across every track"
            className="min-h-11 w-full rounded-4 border border-ink-200 bg-paper pl-9 pr-9 font-plex-sans text-body text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink-900 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center text-ink-500 transition-colors duration-180 ease-out hover:text-ink-900"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      {isSearching ? (
        totalMatches === 0 ? (
          <EmptySearchState query={search} onClear={() => setSearch("")} />
        ) : (
          <div className="space-y-5">
            <p className="font-plex-sans text-body-sm text-ink-500">
              {totalMatches} topic{totalMatches === 1 ? "" : "s"} match &ldquo;{search.trim()}&rdquo;
            </p>
            {searchGroups.map((g) => (
              <div key={`${g.track}::${g.sectionTitle}`}>
                <p className="mb-2 font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
                  {TRACK_META[g.track].title} <span className="text-ink-300">/</span> {g.sectionTitle}
                </p>
                <div className="space-y-2">
                  {g.topics.map((topic) => (
                    <TopicRow
                      key={`${g.track}-${topic}`}
                      track={g.track}
                      topic={topic}
                      mastery={byTrack[g.track][topic]}
                      loading={loading}
                      href={practiceHref(g.track, topic)}
                      highlighted={highlight?.track === g.track && highlight?.topic === topic}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div>
          <TrackTabs
            active={activeTrack}
            onSelect={selectTrack}
            focusTrack={focusTrack}
            loading={loading}
          />

          <div className="mt-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-plex-serif text-display-sm font-semibold text-ink">
                {TRACK_META[activeTrack].title}
              </h2>
              <p className="mt-0.5 max-w-prose font-plex-sans text-body-sm text-ink-500">
                {TRACK_META[activeTrack].description}
              </p>
            </div>
            <Link
              href={trackHref(activeTrack)}
              className="shrink-0 font-plex-sans text-body-sm font-medium text-ink underline-offset-2 hover:underline"
            >
              Open track →
            </Link>
          </div>

          <div className="mt-4 space-y-2">
            {TRACK_SECTIONS[activeTrack].map((sec) => (
              <SectionAccordion
                key={sec.title}
                track={activeTrack}
                section={sec}
                topicMap={byTrack[activeTrack]}
                loading={loading}
                open={expanded.has(sectionKey(activeTrack, sec.title))}
                onToggle={() => toggleSection(sectionKey(activeTrack, sec.title))}
                practiceHrefFor={(topic) => practiceHref(activeTrack, topic)}
                highlight={highlight}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page (Suspense for useSearchParams) ──────────────────────────────────────

export default function PrepHubPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-5xl space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-11 w-full max-w-md rounded-4" />
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-8" />
          ))}
        </div>
      }
    >
      <PrepHubInner />
    </Suspense>
  );
}
