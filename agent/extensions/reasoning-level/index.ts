/**
 * index.ts — thinking off for read sweeps, plus a run-scoped override the user asserts.
 * `level.ts` holds the policy; this file owns every side effect.
 *
 * WHY DETERMINISTIC AND NOT A TOOL THE AGENT CALLS:
 * a guideline the agent may follow is worth its adherence rate, and this harness measured that
 * rate twice — pi's own "use read instead of cat" guideline lost 20:1, and `record_learning`
 * fired 7 times across 180 sessions. So the level is set here, from observed signals, and the
 * agent is never asked. That also keeps the cost at zero turns: a `tool_call` block would have
 * bought compliance with retries, and a turn costs ~200x a cached token.
 *
 * WHY AUTHORSHIP IS DECLARED, NEVER INFERRED:
 * pi emits `thinking_level_select` on any change, from any source. Inferring "the user did this"
 * by comparing values is unreliable — `setThinkingLevel` is called by model switches and level
 * cycling with no user action at all (agent-session.js:1215/1254/1277/1321), and on a genuine
 * change pi's event and pi-web's would be byte-identical. So pi-web's sidebar sends an explicit
 * `asserted: true`, and only that arms an override. Every non-asserted event is ignored.
 *
 * HOOK CHOICES:
 *   session_start      capture the baseline once; a mid-session settings edit must not move it
 *   message_start      a USER message — covers a fresh prompt AND a steering message, which
 *                      never fires before_agent_start (agent-loop.js injects queued messages
 *                      inside the inner loop). before_agent_start is kept as a belt-and-braces
 *                      prompt signal; the handler is idempotent.
 *   tool_result        isError / inspection identity, and a divergence check for levels moved
 *                      outside this extension
 *   thinking_level_select  the declared assertion from pi-web
 *   agent_settled      NOT agent_end: that fires once per low-level run and pi re-enters the
 *                      loop for retries, auto-compaction, and queued continuations, so one
 *                      prompt can fire it repeatedly (agent-session.js:748-757). agent_settled
 *                      fires once, in that loop's finally.
 *   NOT context        an injected message invalidates the cached prefix, so a "reminder" is
 *                      not free
 *   NOT tool_call      blocking buys compliance with a wasted turn, at output prices
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  initialState,
  isInspection,
  LEVELS,
  nextLevel,
  type Level,
  type Signal,
  type State,
} from "./level.ts";

export default function reasoningLevel(pi: ExtensionAPI): void {
  let state: State = initialState("high");

  pi.on("session_start", () => {
    state = initialState(pi.getThinkingLevel() as Level);
  });

  // Clear the override at a session boundary. `level` is not touched — the next
  // session_start re-captures it.
  pi.on("session_shutdown", () => {
    state = { ...state, override: null };
  });

  pi.on("before_agent_start", () => applySignal({ kind: "newPrompt" }));

  pi.on("message_start", (event: any) => {
    try {
      if (event?.message?.role === "user") applySignal({ kind: "newPrompt" });
    } catch {
      /* a level decision must never break a turn */
    }
  });

  // pi-web's sidebar declaration. `asserted` is the whole discriminator: pi's own emit
  // never carries it, so the extension cannot misread a model switch as user intent.
  pi.on("thinking_level_select", (event: any) => {
    try {
      if (event?.asserted !== true) return;
      const level = String(event.level) as Level;
      if (!LEVELS.has(level)) return;
      applySignal({ kind: "assert", level });
    } catch {
      /* fail-open */
    }
  });

  pi.on("agent_settled", () => applySignal({ kind: "settled" }));

  pi.on("tool_result", (event: any) => {
    try {
      // A level moved outside this extension (TUI, /model, a clamp we did not make).
      // apply() reads the level back after every write, so our own writes cannot land here.
      const live = pi.getThinkingLevel() as Level;
      if (state.override === null && live !== state.level) {
        return applySignal({ kind: "assert", level: live });
      }

      if (event?.isError) return applySignal({ kind: "error" });
      const command = String((event?.input as { command?: unknown })?.command ?? "");
      applySignal(
        isInspection(String(event?.toolName ?? ""), command) ? { kind: "inspect" } : { kind: "other" },
      );
    } catch {
      // A level decision must never break a turn. A missed optimization is the lesser failure.
    }
  });

  function applySignal(signal: Signal): void {
    const before = state.level;
    const decision = nextLevel(state, signal);
    state = decision.state;
    apply(decision.level, decision.reason, before);
  }

  function apply(next: Level, reason: string, before: Level): void {
    // Compare against the level ACTUALLY in force, not our bookkeeping — the two can
    // diverge, and an unchanged level costs nothing (no cache churn, no log noise).
    const live = pi.getThinkingLevel() as Level;
    if (next === live) {
      state = { ...state, level: live };
      return;
    }
    pi.setThinkingLevel(next);
    // Read back: pi clamps, so record what is actually in force rather than what we asked
    // for. Without this, a clamped write would look like a foreign change to the divergence
    // check above and freeze the level for the rest of the run.
    const now = pi.getThinkingLevel() as Level;
    state = { ...state, level: now };
    pi.appendEntry("reasoning-level", {
      from: before,
      to: now,
      reason,
      overridden: state.override !== null,
    });
  }
}
