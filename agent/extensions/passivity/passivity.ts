/**
 * passivity.ts — the pure half of the passivity interceptor.
 *
 * The regex is VERBATIM from `06cee66^:public/app.js:22-23`. It is the original's definition of a
 * passive reply and is reproduced exactly rather than "improved": widening it would start accusing
 * learners of passivity for messages the original accepted.
 *
 * No pi imports here, so the predicate is testable without the extension runtime.
 */

/** Verbatim from `06cee66^:public/app.js:22-23`. */
export const PASSIVE_RE =
  /^(?:ok|okay|k+|cool|got ?it|makes? ?sense|next|proceed|continue|go ?on|y|yes|yeah|sure|fine|right|nice|great|\.+)$/i;

/**
 * The notification text. The client matches on the substring `PASSIVITY`, exactly as the original
 * client did (`06cee66^:public/app.js:249`), so the marker must survive any rewording of the rest.
 */
export const PASSIVITY_MESSAGE =
  "⚠️ [PASSIVITY INTERCEPT] Simply nodding along triggers the Illusion of Understanding. " +
  "Actively explain the concept using a plain-English analogy.";

/** True when a learner's whole message is a nod rather than a reply. */
export function isPassivePrompt(text: string): boolean {
  return PASSIVE_RE.test(text.trim());
}

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

/**
 * The most recent thing the LEARNER said.
 *
 * Skill invocations arrive as user messages too, so a `/skill:…` prompt is checked like any other —
 * it will simply never match PASSIVE_RE.
 */
export function lastUserMessageText(entries: unknown[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as MaybeEntry | null;
    if (e?.message?.role === "user") return contentText(e.message.content);
  }
  return null;
}
