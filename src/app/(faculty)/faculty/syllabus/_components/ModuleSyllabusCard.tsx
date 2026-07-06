"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CONFIDENCE_CLASSES,
  SOURCE_LABELS,
  formatCo,
  normaliseBtlLevels,
  patchModuleCoMapping,
  type CourseOutcomeRef,
  type MappingRow,
  type ModuleRow,
} from "./shared";
import { toast } from "sonner";

export function ModuleSyllabusCard({
  module: mod,
  mappings,
  courseOutcomes,
  onMappingsChange,
}: {
  module: ModuleRow;
  mappings: MappingRow[];
  courseOutcomes: CourseOutcomeRef[];
  onMappingsChange: (moduleId: string, next: MappingRow[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const btlNumbers = normaliseBtlLevels(mod.btl_levels);
  const mappedCodes = new Set(mappings.map((m) => m.co_code));
  const available = courseOutcomes.filter((c) => !mappedCodes.has(c.co_code));

  const handleAdd = async (coCode: string) => {
    if (!coCode || busy) return;
    setBusy(true);
    const prev = mappings;
    const optimistic: MappingRow = {
      id: `pending-${coCode}`,
      module_id: mod.id,
      co_code: coCode,
      confidence: "high",
      source: "faculty_verified",
    };
    onMappingsChange(mod.id, [...prev, optimistic]);
    try {
      await patchModuleCoMapping(mod.id, coCode, "add");
    } catch {
      onMappingsChange(mod.id, prev);
      toast.error(`Failed to add ${formatCo(coCode)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (coCode: string) => {
    if (busy) return;
    setBusy(true);
    const prev = mappings;
    onMappingsChange(
      mod.id,
      prev.filter((m) => m.co_code !== coCode)
    );
    try {
      await patchModuleCoMapping(mod.id, coCode, "remove");
    } catch {
      onMappingsChange(mod.id, prev);
      toast.error(`Failed to remove ${formatCo(coCode)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">
            M{mod.module_number} · {mod.name}
          </h3>
          {mod.weightage_percent != null && (
            <Badge variant="outline">{mod.weightage_percent}%</Badge>
          )}
          <div className="flex gap-1 ml-auto">
            {btlNumbers.map((lvl) => (
              <Badge key={lvl} variant="secondary" className="text-[10px]">
                BTL {lvl}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {mod.description || "No content recorded for this module."}
        </p>

        <div className="space-y-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {mappings.length === 0 && (
              <span className="text-xs text-muted-foreground">
                No CO mapped — add one below
              </span>
            )}
            {mappings.map((m) => (
              <Badge
                key={m.co_code}
                variant="outline"
                title={SOURCE_LABELS[m.source]}
                className={`gap-1 ${CONFIDENCE_CLASSES[m.confidence]}`}
              >
                {formatCo(m.co_code)}
                <button
                  type="button"
                  aria-label={`Remove ${formatCo(m.co_code)}`}
                  onClick={() => handleRemove(m.co_code)}
                  disabled={busy}
                  className="ml-0.5 hover:opacity-70"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>

          {available.length > 0 && (
            <Select value="" onValueChange={handleAdd} disabled={busy}>
              <SelectTrigger size="sm" className="h-7 w-fit text-xs">
                <SelectValue placeholder="+ Add CO" />
              </SelectTrigger>
              <SelectContent>
                {available.map((c) => (
                  <SelectItem key={c.co_code} value={c.co_code}>
                    {formatCo(c.co_code)} — {c.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
