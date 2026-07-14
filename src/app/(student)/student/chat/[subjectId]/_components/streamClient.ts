import type { Citation, EffectiveMode, RequestedMode } from "./types";

export interface ChatJsonPayload {
  response: string;
  cached?: boolean;
  mode: EffectiveMode;
  recencySuggested?: boolean;
  citations?: Citation[];
  struggle?: { struggle_detected: true; topic: string } | null;
}

export interface ChatFatalPayload {
  status: number;
  error?: string;
  message?: string;
  retryable?: boolean;
  limitReached?: boolean;
}

export interface ChatStreamHandlers {
  onMeta?: (meta: { mode: EffectiveMode; recencySuggested?: boolean }) => void;
  onChunk?: (text: string) => void;
  onError?: (message: string) => void;
  onDone?: (payload: {
    messageId: string | null;
    struggle: { struggle_detected: true; topic: string } | null;
  }) => void;
  onJson?: (payload: ChatJsonPayload) => void;
  onFatal?: (payload: ChatFatalPayload) => void;
  onNetworkError?: () => void;
}

/**
 * POSTs to /api/chat and dispatches to the right handler depending on
 * response shape: SSE (standard/reasoning), plain JSON (cached hit or
 * research), or a fatal JSON error (429/404/500, possibly opened as a
 * normal Response even though the route "streams" on the happy path).
 */
export async function sendChatMessage(
  payload: {
    subjectId: string;
    message: string;
    sessionId: string;
    mode: RequestedMode;
  },
  handlers: ChatStreamHandlers
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    handlers.onNetworkError?.();
    return;
  }

  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    handlers.onFatal?.({
      status: res.status,
      error: typeof data?.error === "string" ? data.error : undefined,
      message: typeof data?.message === "string" ? data.message : undefined,
      retryable: data?.retryable === true,
      limitReached: data?.limitReached === true,
    });
    return;
  }

  if (contentType.includes("application/json")) {
    const data = await res.json().catch(() => null);
    if (!data) {
      handlers.onNetworkError?.();
      return;
    }
    handlers.onJson?.(data as ChatJsonPayload);
    return;
  }

  if (!res.body) {
    handlers.onNetworkError?.();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDoneOrError = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawFrame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        const eventMatch = rawFrame.match(/^event:\s*(.+)$/m);
        const dataMatch = rawFrame.match(/^data:\s*(.+)$/m);
        if (!eventMatch || !dataMatch) continue;

        const event = eventMatch[1].trim();
        let data: {
          mode?: EffectiveMode;
          recencySuggested?: boolean;
          text?: string;
          message?: string;
          messageId?: string | null;
          struggle?: { struggle_detected: true; topic: string } | null;
        };
        try {
          data = JSON.parse(dataMatch[1]);
        } catch {
          continue;
        }

        if (event === "meta") {
          if (data.mode) handlers.onMeta?.({ mode: data.mode, recencySuggested: data.recencySuggested });
        } else if (event === "chunk") {
          handlers.onChunk?.(String(data.text ?? ""));
        } else if (event === "error") {
          sawDoneOrError = true;
          handlers.onError?.(String(data.message ?? "The response was interrupted."));
        } else if (event === "done") {
          sawDoneOrError = true;
          handlers.onDone?.({
            messageId: data.messageId ?? null,
            struggle: data.struggle ?? null,
          });
        }
      }
    }
  } catch {
    if (!sawDoneOrError) handlers.onNetworkError?.();
    return;
  }

  if (!sawDoneOrError) {
    // Stream closed before a done/error frame arrived — interrupted mid-flight.
    handlers.onNetworkError?.();
  }
}
