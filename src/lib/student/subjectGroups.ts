export type GroupByOption = "semester" | "code" | "none";

export type ProcessedSubjectGroup<T extends { code: string; semester?: number | null }> =
  {
    label: string | null;
    items: T[];
    isCurrent: boolean;
  };

export function buildProcessedSubjectGroups<T extends { code: string; semester?: number | null }>(
  subjects: T[],
  groupBy: GroupByOption,
  sortOrder: "asc" | "desc",
  profileSemester: number
): ProcessedSubjectGroup<T>[] {
  const currentSem = profileSemester ?? 0;

  const sorted = [...subjects].sort((a, b) => {
    if (groupBy === "semester") {
      const as = a.semester ?? 0;
      const bs = b.semester ?? 0;
      if (as === currentSem && bs !== currentSem) return -1;
      if (bs === currentSem && as !== currentSem) return 1;
      return as - bs;
    }
    const cmp = a.code.localeCompare(b.code);
    return sortOrder === "asc" ? cmp : -cmp;
  });

  if (groupBy === "none") {
    return [{ label: null, items: sorted, isCurrent: false }];
  }

  if (groupBy === "semester") {
    const map = new Map<number, T[]>();
    sorted.forEach((s) => {
      const sem = s.semester ?? 0;
      if (!map.has(sem)) map.set(sem, []);
      map.get(sem)!.push(s);
    });
    return Array.from(map.entries()).map(([sem, items]) => ({
      label: `Semester ${sem}`,
      isCurrent: sem === currentSem,
      items: sortOrder === "desc" ? [...items].reverse() : items,
    }));
  }

  if (groupBy === "code") {
    const map = new Map<string, T[]>();
    sorted.forEach((s) => {
      const prefix = s.code.replace(/\d/g, "") || "Other";
      if (!map.has(prefix)) map.set(prefix, []);
      map.get(prefix)!.push(s);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) =>
        sortOrder === "asc" ? a.localeCompare(b) : b.localeCompare(a)
      )
      .map(([label, items]) => ({
        label,
        isCurrent: false,
        items,
      }));
  }

  return [{ label: null, items: sorted, isCurrent: false }];
}
