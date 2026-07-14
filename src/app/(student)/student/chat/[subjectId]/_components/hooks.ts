import { useEffect, useState } from "react";

/**
 * While `active`, re-renders `value` at most once per `delayMs` so KaTeX/
 * markdown re-parsing during token-by-token streaming doesn't flicker.
 * Flushes immediately once `active` goes false (stream finished).
 */
export function useDebouncedStreamText(
  value: string,
  active: boolean,
  delayMs = 80
): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, active, delayMs]);

  // Once streaming ends, bypass the debounce buffer entirely so the final
  // text lands immediately instead of waiting out delayMs.
  return active ? debounced : value;
}
