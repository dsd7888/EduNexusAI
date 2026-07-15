export type RequestedMode = "auto" | "standard" | "reasoning" | "research";
export type EffectiveMode = "standard" | "reasoning" | "research";

export interface Citation {
  title: string;
  uri: string;
}

export type MessageStatus = "thinking" | "streaming" | "done" | "error";

export interface UiMessage {
  /** Client-side React key. NOT the database id — see `dbId`. */
  id: string;
  /**
   * The chat_messages row id, when known. Distinct from `id`: `id` is minted
   * client-side (genId) so a message has a stable key from the instant it is
   * optimistically rendered, before the row exists.
   *
   * Required by anything that must reference this turn on the server —
   * currently /api/chat/visualize. Absent while a reply is still streaming,
   * and on the user's own turns.
   */
  dbId?: string;
  role: "user" | "assistant";
  content: string;
  status?: MessageStatus;
  cached?: boolean;
  effectiveMode?: EffectiveMode;
  /** requestedMode was "auto" and the backend elevated it to reasoning. */
  autoElevated?: boolean;
  citations?: Citation[];
  errorMessage?: string;
  retryable?: boolean;
  /** The user text this assistant turn was generated from — needed for
   * Regenerate/Simplify/Go-deeper without re-deriving it from array position. */
  respondingTo?: string;
  requestedMode?: RequestedMode;
  /** Trailing "Want a quick quiz?" / "Try a variation: ..." line, stripped
   * from `content` and rendered as a tappable chip instead. */
  trailingChip?: string;
}

export interface StruggleInfo {
  topic: string;
}

export interface SubjectRow {
  id: string;
  name: string;
  code: string;
  semester: number;
  branch: string;
}
