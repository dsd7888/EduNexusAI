"use client";

import { Button } from "@/components/ui/button";
import { Loader2, Send, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ModeControl } from "./ModeControl";
import type { RequestedMode } from "./types";

const MAX_ROWS = 6;
const LINE_HEIGHT_PX = 24;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  mode: RequestedMode;
  onModeChange: (mode: RequestedMode) => void;
  disabled: boolean;
  isSending: boolean;
  placeholder: string;
}

export function Composer({
  value,
  onChange,
  onSend,
  mode,
  onModeChange,
  disabled,
  isSending,
  placeholder,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = LINE_HEIGHT_PX * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value]);

  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const isDisabled = disabled || isOffline;

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isDisabled) onSend();
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-background shadow-sm transition-shadow focus-within:border-primary/50 focus-within:shadow-md">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isDisabled}
        rows={1}
        className="max-h-[144px] w-full resize-none bg-transparent px-4 pt-3 text-[15px] leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <ModeControl value={mode} onChange={onModeChange} disabled={isDisabled} />
        <div className="flex items-center gap-2">
          {isOffline && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <WifiOff className="h-3 w-3" />
              You&apos;re offline
            </span>
          )}
          <Button
            onClick={onSend}
            disabled={isDisabled || !value.trim()}
            size="sm"
            className="h-8 gap-1.5 rounded-full px-4"
          >
            {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Send</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
