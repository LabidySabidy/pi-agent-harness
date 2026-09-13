/**
 * signal.ts — pure detection of "this turn was a grill turn".
 *
 * Used by the `telemetry_missing` check: if a grill turn produced no telemetry,
 * that absence is recorded instead of silently ignored (DEF-001).
 */
export const GRILL_SKILLS = ["grill-misconception", "feynman-recite"] as const;

interface MaybeEntry {
  type?: string;
  message?: { role?: string; content?: unknown };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = b as { type?: string; text?: string } | null;
        return block?.type === "text" && typeof block.text === "string" ? block.text : "";
      })
      .join("\n");
  }
  return "";
}

/** The most recent user message's text, or null if there is none. */
export function lastUserMessageText(entries: unknown[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as MaybeEntry | null;
    if (e?.message?.role === "user") return contentText(e.message.content);
  }
  return null;
}

/**
 * True when the latest user message was a skill expansion for a grill skill —
 * i.e. the turn just answered was supposed to produce learning telemetry.
 */
export function detectGrillTurn(entries: unknown[]): { active: boolean; evidence?: string } {
  const text = lastUserMessageText(entries);
  if (!text) return { active: false };
  for (const skill of GRILL_SKILLS) {
    if (text.includes(`<skill name="${skill}"`)) return { active: true, evidence: skill };
  }
  return { active: false };
}
