"use client";

/**
 * "Concept Explainers" section shown on the PPT result page. Lists the concept /
 * diagram slides from the generated outline; each can be turned into a shareable
 * animated explainer on demand. Results live in local state only — they are not
 * persisted to the PPT.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Copy, Loader2, PlayCircle } from "lucide-react";
import {
  copyExplainerLink,
  formatDuration,
} from "@/app/(faculty)/faculty/explainer/_components/shared";

export interface ConceptSlide {
  index: number;
  title: string;
  contentHint: string;
}

interface RowState {
  status: "idle" | "loading" | "done" | "error";
  short_code?: string;
  duration_seconds?: number | null;
}

interface Props {
  slides: ConceptSlide[];
  subjectId: string;
  moduleId?: string;
}

export function ConceptExplainers({ slides, subjectId, moduleId }: Props) {
  const [rows, setRows] = useState<Record<number, RowState>>({});

  if (slides.length === 0) return null;

  const generate = async (slide: ConceptSlide) => {
    setRows((p) => ({ ...p, [slide.index]: { status: "loading" } }));
    try {
      const res = await fetch("/api/explainer/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: slide.title,
          subject_id: subjectId,
          module_id: moduleId,
          context_hint: slide.contentHint?.slice(0, 200) || undefined,
        }),
      });
      if (!res.ok) throw new Error("generation failed");
      const data = (await res.json()) as {
        short_code: string;
        script?: { duration_seconds?: number };
      };
      setRows((p) => ({
        ...p,
        [slide.index]: {
          status: "done",
          short_code: data.short_code,
          duration_seconds: data.script?.duration_seconds ?? null,
        },
      }));
    } catch {
      setRows((p) => ({ ...p, [slide.index]: { status: "error" } }));
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Concept Explainers</CardTitle>
        <CardDescription>
          Generate a short animated explainer for any concept slide. Share the
          link with students before your lecture.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {slides.map((slide) => {
          const st: RowState = rows[slide.index] ?? { status: "idle" };
          return (
            <div
              key={slide.index}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <Badge variant="outline" className="shrink-0">
                {slide.index + 1}
              </Badge>
              <span
                className="min-w-0 flex-1 truncate text-sm"
                title={slide.title}
              >
                {slide.title}
              </span>

              <div className="flex shrink-0 items-center gap-1">
                {st.status === "done" && st.short_code ? (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      title="Play"
                      onClick={() =>
                        window.open(`/e/${st.short_code}`, "_blank")
                      }
                    >
                      <PlayCircle className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      title="Copy link"
                      onClick={() => copyExplainerLink(st.short_code!)}
                    >
                      <Copy className="size-4" />
                    </Button>
                    <Badge variant="secondary">
                      {formatDuration(st.duration_seconds)}
                    </Badge>
                  </>
                ) : st.status === "error" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => generate(slide)}
                  >
                    Retry
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={st.status === "loading"}
                    onClick={() => generate(slide)}
                  >
                    {st.status === "loading" ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      "Generate Explainer"
                    )}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
