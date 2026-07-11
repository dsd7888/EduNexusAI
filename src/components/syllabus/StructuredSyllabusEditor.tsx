"use client";

import { useMemo } from "react";
import { Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import type {
  ExtractedSyllabus,
  ExtractedModule,
  ExtractedCourseOutcome,
  ExtractedPractical,
} from "@/lib/syllabus/types";

const BTL_OPTIONS = [
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
];

const ALL_SECTIONS = [
  "course",
  "exam",
  "modules",
  "outcomes",
  "co-po",
  "practicals",
  "references",
];

export function emptyExtracted(): ExtractedSyllabus {
  return {
    course: {
      code: "",
      name: "",
      prerequisites: [],
      credits: 0,
      theory_hours_per_week: 0,
      practical_hours_per_week: 0,
    },
    exam_scheme: {
      theory_ce: null,
      theory_ese: null,
      practical_ce: null,
      practical_ese: null,
      tutorial_marks: null,
      total_marks: null,
    },
    modules: [],
    course_outcomes: [],
    co_po_mapping: [],
    co_pso_mapping: [],
    practicals: [],
    textbooks: [],
    reference_books: [],
  };
}

interface SectionProps {
  extracted: ExtractedSyllabus;
  update: (mutator: (draft: ExtractedSyllabus) => void) => void;
}

interface StructuredSyllabusEditorProps extends SectionProps {
  defaultOpenSections?: string[];
}

/**
 * Structured, section-by-section syllabus editor (course info, exam scheme,
 * modules, course outcomes, CO-PO matrix, practicals, reference books).
 * Shared by the superadmin "manage syllabus" page and the faculty edit view
 * so both roles see and edit the exact same structure.
 */
export function StructuredSyllabusEditor({
  extracted,
  update,
  defaultOpenSections = ALL_SECTIONS,
}: StructuredSyllabusEditorProps) {
  return (
    <Accordion
      type="multiple"
      defaultValue={defaultOpenSections}
      className="border rounded-md divide-y"
    >
      <AccordionItem value="course" className="px-4">
        <AccordionTrigger>1. Course Info</AccordionTrigger>
        <AccordionContent>
          <CourseInfoSection extracted={extracted} update={update} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="exam" className="px-4">
        <AccordionTrigger>2. Exam Scheme</AccordionTrigger>
        <AccordionContent>
          <ExamSchemeSection extracted={extracted} update={update} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="modules" className="px-4">
        <AccordionTrigger>
          3. Modules ({extracted.modules.length})
        </AccordionTrigger>
        <AccordionContent>
          <ModulesSection extracted={extracted} update={update} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="outcomes" className="px-4">
        <AccordionTrigger>
          4. Course Outcomes ({extracted.course_outcomes.length})
        </AccordionTrigger>
        <AccordionContent>
          <CourseOutcomesSection extracted={extracted} update={update} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="co-po" className="px-4">
        <AccordionTrigger>5. CO-PO Mapping</AccordionTrigger>
        <AccordionContent>
          <CoPoMatrixSection extracted={extracted} update={update} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="practicals" className="px-4">
        <AccordionTrigger>
          6. Practicals ({extracted.practicals.length})
        </AccordionTrigger>
        <AccordionContent>
          <PracticalsSection extracted={extracted} update={update} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="references" className="px-4">
        <AccordionTrigger>
          7. Reference Books ({extracted.reference_books.length})
        </AccordionTrigger>
        <AccordionContent>
          <ReferenceBooksSection extracted={extracted} update={update} />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

// ─── Section components ────────────────────────────────────────────────────

function CourseInfoSection({ extracted, update }: SectionProps) {
  const c = extracted.course;
  return (
    <div className="grid gap-4 sm:grid-cols-2 pb-2">
      <div className="space-y-2">
        <Label>Code</Label>
        <Input
          value={c.code}
          onChange={(e) =>
            update((d) => {
              d.course.code = e.target.value;
            })
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Name</Label>
        <Input
          value={c.name}
          onChange={(e) =>
            update((d) => {
              d.course.name = e.target.value;
            })
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Credits</Label>
        <Input
          type="number"
          value={c.credits || ""}
          onChange={(e) =>
            update((d) => {
              d.course.credits = Number(e.target.value) || 0;
            })
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Theory hours / week</Label>
        <Input
          type="number"
          value={c.theory_hours_per_week || ""}
          onChange={(e) =>
            update((d) => {
              d.course.theory_hours_per_week = Number(e.target.value) || 0;
            })
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Practical hours / week</Label>
        <Input
          type="number"
          value={c.practical_hours_per_week || ""}
          onChange={(e) =>
            update((d) => {
              d.course.practical_hours_per_week = Number(e.target.value) || 0;
            })
          }
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label>Prerequisites (comma-separated)</Label>
        <Input
          value={c.prerequisites.join(", ")}
          onChange={(e) =>
            update((d) => {
              d.course.prerequisites = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            })
          }
        />
      </div>
    </div>
  );
}

function ExamSchemeSection({ extracted, update }: SectionProps) {
  const e = extracted.exam_scheme;
  const num = (v: number | null) => (v == null ? "" : String(v));
  const set = (key: keyof typeof e, value: string) =>
    update((d) => {
      const v = value.trim();
      d.exam_scheme[key] = v === "" ? null : Number(v);
    });
  return (
    <div className="grid gap-4 sm:grid-cols-3 pb-2">
      <div className="space-y-2">
        <Label>Theory CE</Label>
        <Input
          type="number"
          value={num(e.theory_ce)}
          onChange={(ev) => set("theory_ce", ev.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Theory ESE</Label>
        <Input
          type="number"
          value={num(e.theory_ese)}
          onChange={(ev) => set("theory_ese", ev.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Total marks</Label>
        <Input
          type="number"
          value={num(e.total_marks)}
          onChange={(ev) => set("total_marks", ev.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Practical CE</Label>
        <Input
          type="number"
          value={num(e.practical_ce)}
          onChange={(ev) => set("practical_ce", ev.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Practical ESE</Label>
        <Input
          type="number"
          value={num(e.practical_ese)}
          onChange={(ev) => set("practical_ese", ev.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Tutorial marks</Label>
        <Input
          type="number"
          value={num(e.tutorial_marks)}
          onChange={(ev) => set("tutorial_marks", ev.target.value)}
        />
      </div>
    </div>
  );
}

function ModulesSection({ extracted, update }: SectionProps) {
  const sections = useMemo(() => {
    const map = new Map<number, ExtractedModule[]>();
    for (const m of extracted.modules) {
      const arr = map.get(m.section_number) ?? [];
      arr.push(m);
      map.set(m.section_number, arr);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([section, mods]) => ({
        section,
        modules: mods.sort((a, b) => a.module_number - b.module_number),
      }));
  }, [extracted.modules]);

  const addModule = (sectionNumber: number) => {
    update((d) => {
      const maxNumber = d.modules.reduce(
        (acc, m) => Math.max(acc, m.module_number),
        0
      );
      d.modules.push({
        module_number: maxNumber + 1,
        name: "",
        content: "",
        hours: 0,
        weightage_percent: 0,
        section_number: sectionNumber,
        btl_levels: [],
      });
    });
  };

  const removeModule = (moduleNumber: number) =>
    update((d) => {
      d.modules = d.modules.filter((m) => m.module_number !== moduleNumber);
    });

  const updateModule = (
    moduleNumber: number,
    patch: Partial<ExtractedModule>
  ) =>
    update((d) => {
      const idx = d.modules.findIndex((m) => m.module_number === moduleNumber);
      if (idx >= 0) d.modules[idx] = { ...d.modules[idx], ...patch };
    });

  const toggleBtl = (moduleNumber: number, level: string) =>
    update((d) => {
      const idx = d.modules.findIndex((m) => m.module_number === moduleNumber);
      if (idx < 0) return;
      const cur = d.modules[idx].btl_levels;
      d.modules[idx].btl_levels = cur.includes(level)
        ? cur.filter((b) => b !== level)
        : [...cur, level];
    });

  const sectionList = sections.length > 0 ? sections : [{ section: 1, modules: [] }];

  return (
    <div className="space-y-6 pb-2">
      {sectionList.map(({ section, modules }) => (
        <div key={section} className="space-y-3">
          <h3 className="text-sm font-semibold">Section {toRoman(section)}</h3>
          {modules.length === 0 && (
            <p className="text-sm text-muted-foreground">No modules.</p>
          )}
          {modules.map((m) => (
            <div
              key={m.module_number}
              className="border rounded-md p-3 space-y-3 bg-muted/30"
            >
              <div className="flex items-start gap-3 flex-wrap">
                <div className="space-y-1 w-20">
                  <Label className="text-xs">Module #</Label>
                  <Input
                    type="number"
                    value={m.module_number}
                    onChange={(e) =>
                      updateModule(m.module_number, {
                        module_number: Number(e.target.value) || m.module_number,
                      })
                    }
                  />
                </div>
                <div className="space-y-1 flex-1 min-w-[200px]">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={m.name}
                    onChange={(e) =>
                      updateModule(m.module_number, { name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1 w-24">
                  <Label className="text-xs">Hours</Label>
                  <Input
                    type="number"
                    value={m.hours || ""}
                    onChange={(e) =>
                      updateModule(m.module_number, {
                        hours: Number(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className="space-y-1 w-24">
                  <Label className="text-xs">Weight %</Label>
                  <Input
                    type="number"
                    value={m.weightage_percent || ""}
                    onChange={(e) =>
                      updateModule(m.module_number, {
                        weightage_percent: Number(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className="space-y-1 w-24">
                  <Label className="text-xs">Section</Label>
                  <Input
                    type="number"
                    value={m.section_number}
                    onChange={(e) =>
                      updateModule(m.module_number, {
                        section_number: Number(e.target.value) || 1,
                      })
                    }
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive mt-5"
                  onClick={() => removeModule(m.module_number)}
                  aria-label="Remove module"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Content</Label>
                <Textarea
                  value={m.content}
                  onChange={(e) =>
                    updateModule(m.module_number, { content: e.target.value })
                  }
                  rows={3}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">BTL Levels</Label>
                <div className="flex gap-2 flex-wrap">
                  {BTL_OPTIONS.map((level) => {
                    const active = m.btl_levels.includes(level);
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() => toggleBtl(m.module_number, level)}
                        className={
                          "text-xs rounded-full px-3 py-1 border transition-colors " +
                          (active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-muted")
                        }
                      >
                        {level}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => addModule(section)}
            className="gap-1"
          >
            <Plus className="size-3" /> Add module to Section {toRoman(section)}
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          addModule(
            (extracted.modules.reduce(
              (acc, m) => Math.max(acc, m.section_number),
              0
            ) || 0) + 1
          )
        }
        className="gap-1"
      >
        <Plus className="size-3" /> Add new section
      </Button>
    </div>
  );
}

function CourseOutcomesSection({ extracted, update }: SectionProps) {
  const add = () =>
    update((d) => {
      const next = d.course_outcomes.length + 1;
      d.course_outcomes.push({
        co_code: `CO${next}`,
        description: "",
      });
    });
  const remove = (idx: number) =>
    update((d) => {
      d.course_outcomes.splice(idx, 1);
    });
  const updateRow = (idx: number, patch: Partial<ExtractedCourseOutcome>) =>
    update((d) => {
      d.course_outcomes[idx] = { ...d.course_outcomes[idx], ...patch };
    });

  return (
    <div className="space-y-2 pb-2">
      {extracted.course_outcomes.length === 0 && (
        <p className="text-sm text-muted-foreground">No course outcomes.</p>
      )}
      {extracted.course_outcomes.map((co, idx) => (
        <div key={idx} className="flex items-start gap-2">
          <Input
            value={co.co_code}
            onChange={(e) => updateRow(idx, { co_code: e.target.value })}
            className="w-24"
          />
          <Input
            value={co.description}
            onChange={(e) => updateRow(idx, { description: e.target.value })}
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive"
            onClick={() => remove(idx)}
            aria-label="Remove outcome"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="gap-1">
        <Plus className="size-3" /> Add outcome
      </Button>
    </div>
  );
}

function CoPoMatrixSection({ extracted, update }: SectionProps) {
  const coCodes = useMemo(
    () => extracted.course_outcomes.map((c) => c.co_code).filter(Boolean),
    [extracted.course_outcomes]
  );

  const poCodes = useMemo(() => {
    const set = new Set<string>();
    for (const m of extracted.co_po_mapping) {
      if (m.po_code) set.add(m.po_code);
    }
    if (set.size === 0) {
      for (let i = 1; i <= 12; i++) set.add(`PO${i}`);
    }
    return [...set].sort((a, b) => {
      const an = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const bn = parseInt(b.replace(/\D/g, ""), 10) || 0;
      return an - bn;
    });
  }, [extracted.co_po_mapping]);

  const matrix = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of extracted.co_po_mapping) {
      m.set(`${row.co_code}::${row.po_code}`, row.strength);
    }
    return m;
  }, [extracted.co_po_mapping]);

  const setCell = (coCode: string, poCode: string, strength: number | null) =>
    update((d) => {
      d.co_po_mapping = d.co_po_mapping.filter(
        (r) => !(r.co_code === coCode && r.po_code === poCode)
      );
      if (strength != null) {
        d.co_po_mapping.push({ co_code: coCode, po_code: poCode, strength });
      }
    });

  if (coCodes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground pb-2">
        Add Course Outcomes first to define a CO-PO mapping.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto pb-2">
      <table className="text-sm border-collapse">
        <thead>
          <tr>
            <th className="border px-3 py-1 bg-muted/40 text-left">CO</th>
            {poCodes.map((po) => (
              <th key={po} className="border px-2 py-1 bg-muted/40 text-center">
                {po}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {coCodes.map((co) => (
            <tr key={co}>
              <td className="border px-3 py-1 font-medium">{co}</td>
              {poCodes.map((po) => {
                const value = matrix.get(`${co}::${po}`);
                const bg =
                  value === 3
                    ? "bg-emerald-500/70"
                    : value === 2
                      ? "bg-emerald-400/40"
                      : value === 1
                        ? "bg-emerald-300/30"
                        : "";
                return (
                  <td key={po} className={`border p-0 text-center ${bg}`}>
                    <select
                      className="w-14 bg-transparent text-center outline-none py-1"
                      value={value ?? ""}
                      onChange={(e) =>
                        setCell(
                          co,
                          po,
                          e.target.value === "" ? null : Number(e.target.value)
                        )
                      }
                    >
                      <option value="">—</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                    </select>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PracticalsSection({ extracted, update }: SectionProps) {
  const add = () =>
    update((d) => {
      const srNo =
        d.practicals.reduce((acc, p) => Math.max(acc, p.sr_no), 0) + 1;
      d.practicals.push({ sr_no: srNo, name: "", hours: 0 });
    });
  const remove = (idx: number) =>
    update((d) => {
      d.practicals.splice(idx, 1);
    });
  const updateRow = (idx: number, patch: Partial<ExtractedPractical>) =>
    update((d) => {
      d.practicals[idx] = { ...d.practicals[idx], ...patch };
    });

  return (
    <div className="space-y-2 pb-2">
      {extracted.practicals.length === 0 && (
        <p className="text-sm text-muted-foreground">No practicals.</p>
      )}
      {extracted.practicals.map((p, idx) => (
        <div key={idx} className="flex items-start gap-2">
          <Input
            type="number"
            value={p.sr_no}
            onChange={(e) =>
              updateRow(idx, { sr_no: Number(e.target.value) || p.sr_no })
            }
            className="w-20"
          />
          <Input
            value={p.name}
            onChange={(e) => updateRow(idx, { name: e.target.value })}
            className="flex-1"
            placeholder="Experiment name"
          />
          <Input
            type="number"
            value={p.hours || ""}
            onChange={(e) =>
              updateRow(idx, { hours: Number(e.target.value) || 0 })
            }
            className="w-24"
            placeholder="Hours"
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive"
            onClick={() => remove(idx)}
            aria-label="Remove practical"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="gap-1">
        <Plus className="size-3" /> Add practical
      </Button>
    </div>
  );
}

function ReferenceBooksSection({ extracted, update }: SectionProps) {
  const add = () =>
    update((d) => {
      d.reference_books.push("");
    });
  const remove = (idx: number) =>
    update((d) => {
      d.reference_books.splice(idx, 1);
    });
  const updateRow = (idx: number, value: string) =>
    update((d) => {
      d.reference_books[idx] = value;
    });

  return (
    <div className="space-y-2 pb-2">
      {extracted.reference_books.length === 0 && (
        <p className="text-sm text-muted-foreground">No reference books.</p>
      )}
      {extracted.reference_books.map((book, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Input
            value={book}
            onChange={(e) => updateRow(idx, e.target.value)}
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive"
            onClick={() => remove(idx)}
            aria-label="Remove reference"
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="gap-1">
        <Plus className="size-3" /> Add reference book
      </Button>
    </div>
  );
}

function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1) return String(n);
  const pairs: [number, string][] = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  let rem = n;
  for (const [v, sym] of pairs) {
    while (rem >= v) {
      out += sym;
      rem -= v;
    }
  }
  return out;
}
