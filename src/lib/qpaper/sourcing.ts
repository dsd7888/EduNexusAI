/**
 * Per-slot source allocation for the Q-paper generator.
 *
 * A faculty configures a *sourcing mix* — e.g. "70% fresh, 20% PYQ-style,
 * 10% bank" — and we deterministically decide which atomic slot draws from
 * which source. Determinism matters: configuring "30% bank" should reliably
 * land near 30% on every run, not drift run-to-run the way random sampling
 * would. We use largest-remainder (Hamilton) apportionment, the same method
 * moduleAssignment.ts uses to spread modules across slots.
 */

export type SourceCategory = "fresh" | "pyq_style" | "bank"; // extensible — Part 4 adds "reference_material"

export interface SourcingMix {
  category: SourceCategory;
  percent: number; // must sum to 100 across the array
}

export interface SlotSourceAssignment {
  slotIndex: number;
  source: SourceCategory;
}

/**
 * Deterministic proportional allocation via largest-remainder apportionment —
 * NOT random sampling.
 *
 * Algorithm:
 *   1. exact   = totalSlots * percent/100 per category
 *   2. base    = floor(exact) per category
 *   3. remainder = totalSlots - sum(base); hand it out one slot at a time to
 *      whichever category has the largest fractional remainder (ties → larger
 *      percent, then earlier position) until none is left
 *   4. emit slot indices in mix order: the first `count[0]` indices get
 *      category[0], the next `count[1]` get category[1], and so on
 *
 * Worked example — allocateSlotSources(10, [fresh:70, pyq_style:20, bank:10]):
 *   exact      = [7.0, 2.0, 1.0]
 *   base       = [7,   2,   1  ]  (sum 10)
 *   remainder  = 0                 → nothing to distribute
 *   result     → 7 fresh / 2 pyq_style / 1 bank
 *
 * Worked example — allocateSlotSources(7, [fresh:50, bank:50]):
 *   exact      = [3.5, 3.5]
 *   base       = [3,   3  ]        (sum 6)
 *   remainder  = 1
 *   fractions  = [0.5, 0.5]        → tie; broken by equal percent, then by
 *                                    position, so the first category (fresh) wins
 *   result     → 4 fresh / 3 bank
 *
 * @throws if `mix` percents do not sum to 100.
 */
export function allocateSlotSources(
  totalSlots: number,
  mix: SourcingMix[]
): SlotSourceAssignment[] {
  if (totalSlots <= 0 || mix.length === 0) return [];

  const sum = mix.reduce((s, m) => s + m.percent, 0);
  if (Math.abs(sum - 100) > 1e-6) {
    throw new Error(
      `SourcingMix percents must sum to 100, got ${sum} (${mix
        .map((m) => `${m.category}:${m.percent}`)
        .join(", ")})`
    );
  }

  // 1 + 2: exact share, floored base, and the leftover fraction.
  const rows = mix.map((m) => {
    const exact = (totalSlots * m.percent) / 100;
    const base = Math.floor(exact);
    return { category: m.category, percent: m.percent, base, frac: exact - base };
  });

  // 3: distribute the remainder to the largest fractional remainders.
  let remainder = totalSlots - rows.reduce((s, r) => s + r.base, 0);
  const order = rows
    .map((r, i) => ({ i, frac: r.frac, percent: r.percent }))
    .sort((a, b) => b.frac - a.frac || b.percent - a.percent || a.i - b.i);
  // remainder is always < rows.length (it's the sum of fractional parts), so a
  // single pass over `order` covers it; `% length` is belt-and-braces.
  for (let k = 0; remainder > 0; k++, remainder--) {
    rows[order[k % order.length].i].base += 1;
  }

  // 4: emit slot indices in mix order.
  const out: SlotSourceAssignment[] = [];
  let slotIndex = 0;
  for (const row of rows) {
    for (let n = 0; n < row.base; n++) {
      out.push({ slotIndex: slotIndex++, source: row.category });
    }
  }
  return out;
}
