/**
 * passivity-interceptor.ts
 *
 * Shatters "spectator mode": intercepts low-effort passive inputs on the `input`
 * hook (before the agent/skill sees them) and reroutes the turn into active
 * recall via /skill:feynman-recite.
 *
 * Stateless — no files, no persistent memory. The only side effect is the
 * terminal warning + the transformed input.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Whole-string anchored alternation — a substantive sentence alongside any of
// these words ("makes sense, but why...") will NOT match, so it passes through.
const PASSIVE_WORD_RE =
  /^(?:ok|okay|k+|kk+|cool|got ?it|makes? ?sense|next|proceed|continue|go ?on|y|yes|yeah|yea|yep|sure|fine|right|nice|great|👍|👌|🙂|👏)$/i;

const WARNING =
  "⚠️ PASSIVITY INTERCEPT — nodding along triggers the Illusion of Understanding. " +
  "You are relying on visual recognition, not active recollection. " +
  "To earn your next proficiency badge, retrieve this concept from memory.";

function isPassive(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const raw = text.trim();
  if (raw === "") return false;

  const t = raw.toLowerCase();

  // pure punctuation ("." / "..." / "!") is a lazy nod
  if (/^[.!?]+$/.test(t)) return true;

  // strip trailing punctuation, then match the whole word/phrase
  const word = t.replace(/[.!?,\s]+$/g, "");
  if (word === "") return false;
  return PASSIVE_WORD_RE.test(word);
}

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event: any, ctx: any) => {
    try {
      if (!isPassive(event?.text)) {
        return { action: "continue" };
      }

      // terminal warning — the cognitive science of the intercept
      if (ctx?.hasUI) {
        ctx.ui.notify(WARNING, "warning");
      }

      // reroute into active recall (skill expansion happens downstream)
      return { action: "transform", text: "/skill:feynman-recite" };
    } catch {
      return { action: "continue" };
    }
  });
}
