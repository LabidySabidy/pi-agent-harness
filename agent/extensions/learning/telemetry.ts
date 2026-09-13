/**
 * telemetry.ts — pure payload handling for the learning extension.
 *
 * No pi imports, no I/O, no clock: every function here is a function of its
 * arguments, so it is unit-testable outside the extension runtime with
 * `node --test`. This mirrors the convention set by `telemetry/buckets.ts`.
 */
export const BADGES = ["🟥", "🟨", "🟩", "🟦"] as const;
export type Badge = (typeof BADGES)[number];

export const BADGE_LABEL: Record<Badge, string> = {
  "🟥": "Weak",
  "🟨": "Fair",
  "🟩": "Good",
  "🟦": "Mastered",
};

/** Emoji are multi-code-unit — alternation, never a `[]` character class. */
export const BADGE_ALT = "(?:🟥|🟨|🟩|🟦|⬜)";

/**
 * Misconception severity — the three ACTIVE ratings a tutor may emit.
 * Not to be confused with the mastery scale: this describes how a misconception is
 * wrong, not how well a concept is known.
 *
 * `resolved` and `unrated` are display states derived from status + emptiness, so
 * they are deliberately not storable values:
 *   display = status === "resolved" ? "resolved" : (severity || "unrated")
 *
 * Store one of `root` / `partial` / `edge`, or nothing. Never infer severity from the
 * misconception prose — unrated must stay honest.
 */
export const SEVERITIES = ["root", "partial", "edge"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Display state: the three active ratings plus the two derived terminals. */
export type SeverityState = Severity | "resolved" | "unrated";

export const SEVERITY_LABEL: Record<SeverityState, string> = {
  root: "Root",
  partial: "Partial",
  edge: "Edge",
  resolved: "Resolved",
  unrated: "Unrated",
};

/** Colour is applied as a stroke (dot + label), never a fill — per the design system. */
export const SEVERITY_COLOR: Record<SeverityState, string | null> = {
  root: "#c83f3f",
  partial: "#d97706",
  edge: "#d4a72c",
  resolved: "#c9c6bd",
  unrated: null,
};

export function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

/** Collapse the stored pair into the five-state display value. */
export function severityState(
  status: "open" | "resolved",
  severity: Severity | "" | undefined,
): SeverityState {
  if (status === "resolved") return "resolved";
  return severity && isSeverity(severity) ? severity : "unrated";
}

export interface Sm2 {
  interval: number;
  ease_factor: number;
  repetitions: number;
}

export interface MisconceptionPayload {
  id: string;
  description: string;
  status: "open" | "resolved";
  /** The user's own words for the corrected model. Optional on open events. */
  corrected?: string;
  /** Tutor-emitted. Absent means unrated — never inferred from the prose. */
  severity?: Severity;
}

export interface Telemetry {
  concept: string;
  status: Badge;
  sm2: Sm2;
  misconception?: MisconceptionPayload;
  note?: string;
  decision?: string;
}

export const TELEMETRY_RE = /<learning-telemetry>([\s\S]*?)<\/learning-telemetry>/g;

/** Strip code fences and trailing commas so near-miss JSON still parses. */
export function normalizeJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json|JSON)?\s*$/gm, "");
  s = s.replace(/^```\s*$/gm, "");
  s = s.replace(/,\s*([}\]])/g, "$1");
  return s.trim();
}

export function isBadge(v: unknown): v is Badge {
  return typeof v === "string" && (BADGES as readonly string[]).includes(v);
}

function toNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function toText(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/**
 * Validate an already-parsed payload. Returns null when the payload cannot be
 * trusted; SM-2 fields self-heal to defaults rather than failing the whole event.
 */
export function validateTelemetry(data: unknown): Telemetry | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  const concept = toText(d.concept);
  if (!concept) return null;
  if (!isBadge(d.status)) return null;

  const sm2Raw =
    typeof d.sm2 === "object" && d.sm2 !== null ? (d.sm2 as Record<string, unknown>) : {};

  const sm2: Sm2 = {
    interval: toNumber(sm2Raw.interval) ?? 1,
    ease_factor: toNumber(sm2Raw.ease_factor) ?? 2.5,
    repetitions: toNumber(sm2Raw.repetitions) ?? 1,
  };

  const t: Telemetry = { concept, status: d.status, sm2 };

  if (typeof d.misconception === "object" && d.misconception !== null) {
    const m = d.misconception as Record<string, unknown>;
    const id = toText(m.id);
    const description = toText(m.description);
    if (id && description) {
      t.misconception = {
        id,
        description,
        status: m.status === "resolved" ? "resolved" : "open",
        corrected: toText(m.corrected),
      };
      // Absent severity stays absent: a payload that omits it must not clear a
      // rating recorded earlier.
      if (isSeverity(m.severity)) t.misconception.severity = m.severity;
    }
  }

  const note = toText(d.note);
  if (note) t.note = note;
  const decision = toText(d.decision);
  if (decision) t.decision = decision;

  return t;
}

/** Pull telemetry blocks out of assistant text and return the visible remainder. */
export function extractTelemetry(text: string): { blocks: string[]; cleaned: string } {
  const blocks: string[] = [];
  TELEMETRY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TELEMETRY_RE.exec(text)) !== null) blocks.push(m[1]);
  return { blocks, cleaned: text.replace(TELEMETRY_RE, "") };
}

/** Same, for a message content value that may be a string or a block array. */
export function extractAndClean(content: unknown): {
  telemetryBlocks: string[];
  cleanedContent: unknown;
} {
  if (typeof content === "string") {
    const { blocks, cleaned } = extractTelemetry(content);
    return { telemetryBlocks: blocks, cleanedContent: cleaned };
  }
  if (Array.isArray(content)) {
    const telemetryBlocks: string[] = [];
    const cleanedContent = content.map((block: unknown) => {
      const b = block as { type?: string; text?: string } | null;
      if (b && b.type === "text" && typeof b.text === "string") {
        const { blocks, cleaned } = extractTelemetry(b.text);
        if (blocks.length === 0) return block;
        telemetryBlocks.push(...blocks);
        return { ...b, text: cleaned };
      }
      return block;
    });
    return { telemetryBlocks, cleanedContent };
  }
  return { telemetryBlocks: [], cleanedContent: content };
}
