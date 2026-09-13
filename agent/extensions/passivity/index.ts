/**
 * passivity interceptor — the emitter the feature never had.
 *
 * HISTORY, because it matters for how this is judged: the original client listened for this
 * notification (`06cee66^:public/app.js:248-250`) and rendered a banner, but **no emitter existed**.
 * `grep -rln "PASSIVITY" ~/.pi/agent/extensions/` returned nothing, so the banner could never appear.
 * The feature was dead in the original and dead in the recovery until this file existed.
 *
 * The client REACTS to this notification; it does not diagnose passivity. That division is the
 * original's design and is preserved: the tutor notices, the screen responds.
 *
 * HOOK CHOICE — `agent_end`, deliberately:
 *   - `message_end` on the user message fires before the assistant streams anything, and although the
 *     server buffers frames for a late subscriber, a notification tied to the END of the exchange is
 *     where the learner actually sees it: right after the reply that prompted the intercept.
 *   - `turn_end` fires once per AGENT turn, and one prompt can span several when tools run (GL-018),
 *     which would emit the same notification several times for one prompt.
 *   `agent_end` fires exactly once per prompt.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isPassivePrompt, lastUserMessageText, PASSIVITY_MESSAGE } from "./passivity.ts";

export default function passivityInterceptor(pi: ExtensionAPI) {
  pi.on("agent_end", async (_event: unknown, ctx: any) => {
    try {
      const text = lastUserMessageText(ctx.sessionManager.getEntries());
      if (!text) return;
      if (!isPassivePrompt(text)) return;
      // Transported in RPC mode as { type: "extension_ui_request", method: "notify", message },
      // which is the frame the client already matches on.
      ctx.ui.notify(PASSIVITY_MESSAGE, "warning");
    } catch {
      // A notification must never break a turn; a missed intercept is a lesser failure than a crash.
    }
  });
}
