"use client";

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
  const [text, setText] = useState(String(value));
  // Focus is STATE, not a ref: the re-sync below runs during render and reading
  // `ref.current` there is exactly what react-hooks/refs forbids. Focus changes
  // twice per interaction, so the extra render costs nothing.
  const [focused, setFocused] = useState(false);

  // Re-sync the visible text when the controlled `value` changes underneath us
  // (a preset button, a template load, a draft restore), but never while the
  // field has focus — overwriting someone mid-keystroke is the bug this guard
  // exists to prevent.
  //
  // Done during render via a prev-value comparison, which is React's documented
  // "adjusting state when a prop changes" pattern and the same one FacultyShell
  // uses for prevPathname. The previous implementation did this in an effect,
  // which re-rendered a second time for every external change and tripped
  // react-hooks/set-state-in-effect.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (!focused) setText(String(value));
  }

  const commit = () => {
    const n = parseInt(text, 10);
    const clamped = isNaN(n) ? fb : Math.max(min, Math.min(max, n));
    setText(String(clamped));
    onChange(clamped);
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={text}
      disabled={disabled}
      className={className}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onChange={(e) => {
        setText(e.target.value.replace(/[^0-9]/g, ""));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
    />
  );
}
