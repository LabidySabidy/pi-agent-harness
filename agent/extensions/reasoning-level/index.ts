/**
 * index.ts — thinking off for read sweeps. The side-effecting half; `level.ts` is the policy.
 *
 * WHY THIS IS DETERMINISTIC AND NOT A TOOL THE AGENT CALLS:
 * A guideline the agent may follow is worth its adherence rate, and this harness has measured
 * that rate twice — pi's own "use read instead of cat" guideline lost 20:1, and `record_learning`
 * fired 7 times across 180 sessions. So the level is set here, from observed signals, and the
 * agent is never asked. That also keeps the cost at zero turns: a `tool_call` block would have
 * bought compliance with retries, and a turn costs ~200x a cached token.
 *
 * Hook choice, and why not the alternatives:
 *   - `session_start`      capture the baseline. Read once; a mid-session settings edit must not
 *                          silently move the agent's floor.
 *   - `before_agent_start` once per user PROMPT (verified at agent-session.js:887, emitted right
 *                          after the user message is pushed), so a new initiative never inherits
 *                          a sweep's `off`.
 *   - `tool_result`        the only signal source needed — isError and the tool/command identity.
 *   - NOT `context`        an injected message changes the context and invalidates the cached
 *                          prefix, so a "reminder" is not free.
 *   - NOT `tool_call`      blocking buys compliance with a wasted turn, at output prices.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  initialState,
  isInspection,
  nextLevel,
  type Level,
  type Signal,
  type State,
} from "./level.ts";

export default function reasoningLevel(pi: ExtensionAPI): void {
  // Baseline is captured, never hardcoded. `getThinkingLevel()` may return a level this
  // provider does not honour (DeepSeek clamps), and that is fine — it is only a label for
  // what we return to; setThinkingLevel clamps on the way in.
  let state: State = initialState("high");

  pi.on("session_start", () => {
    state = initialState(pi.getThinkingLevel() as Level);
  });

  pi.on("before_agent_start", () => {
    apply({ kind: "newPrompt" });
  });

  pi.on("tool_result", (event: any) => {
    try {
      if (event?.isError) return apply({ kind: "error" });
      const command = String((event?.input as { command?: unknown })?.command ?? "");
      apply(isInspection(String(event?.toolName ?? ""), command) ? { kind: "inspect" } : { kind: "other" });
    } catch {
      // A level decision must never break a turn. A missed optimization is the lesser failure.
    }
  });

  function apply(signal: Signal): void {
    const previous = state.level;
    const decision = nextLevel(state, signal);
    state = decision.state;
    // An unchanged level is a no-op: no cache churn, no log noise. This is what keeps the
    // extension free on the turns where it has nothing to say.
    if (decision.level === previous) return;
    pi.setThinkingLevel(decision.level);
    pi.appendEntry("reasoning-level", {
      from: previous,
      to: decision.level,
      reason: decision.reason,
    });
  }
}
