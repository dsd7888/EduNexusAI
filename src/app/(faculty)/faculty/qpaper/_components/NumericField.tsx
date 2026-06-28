"use client";

import { useState, useEffect, useRef } from "react";
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
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setText(String(value));
    }
  }, [value]);

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
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
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
