"use client";

// Clamped numeric input. While focused it shows a local editing buffer; when
// blurred it shows the controlled `value` prop directly (no effect, no ref sync,
// no cascading render). Commits on blur/Enter, clamping to [min, max].

import { useState } from "react";
import { Input } from "@/components/ui/input";

interface NumericFieldProps {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  fallback?: number;
  className?: string;
  disabled?: boolean;
}

export function NumericField({
  value,
  onChange,
  min,
  max,
  fallback,
  className,
  disabled,
}: NumericFieldProps) {
  const fb = fallback ?? min;
  // null = not editing → display the controlled value; string = editing buffer.
  const [editing, setEditing] = useState<string | null>(null);
  const display = editing ?? String(value);

  const commit = () => {
    const n = parseInt(editing ?? String(value), 10);
    const clamped = isNaN(n) ? fb : Math.max(min, Math.min(max, n));
    setEditing(null);
    onChange(clamped);
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={display}
      disabled={disabled}
      className={className}
      onFocus={() => setEditing(String(value))}
      onBlur={commit}
      onChange={(e) => setEditing(e.target.value.replace(/[^0-9]/g, ""))}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
