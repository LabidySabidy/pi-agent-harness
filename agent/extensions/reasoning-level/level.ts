/**
 * level.ts — the sweep-detection decision function, plus the run-scoped override.
 *
 * Pure: no pi runtime, so the whole policy is unit-testable. `index.ts` owns every side
 * effect (capturing the baseline, calling pi.setThinkingLevel, logging the transition).
 *
 * Two things this decides, and why:
 *
 * 1. READ SWEEPS. The thinking level applies to TURNS, not to tools. A read is IO — no
 *    thinking happens during it. The thinking is in the turn that decides what to read and,
 *    more, in the turn that interprets what came back. So a SINGLE read must keep thinking
 *    on; only a RUN of inspections has trivial reasoning between them. THRESHOLD = 3 is the
 *    current guess; the decision log is the instrument that will correct it.
 *
 * 2. A RUN-SCOPED OVERRIDE. pi-web's sidebar declares "the user asserted level X"
 *    explicitly (an `asserted` field on the thinking_level_select event), so authorship is
 *    never inferred from level values — three separate reviews found that inference is
 *    unreliable: a model switch calls setThinkingLevel with no user action at all
 *    (agent-session.js:1215/1254/1277/1321). An assertion SUSPENDS the policy for the rest
 *    of the run and expires at `settled`. It is deliberately not the baseline: "for this
 *    message" must not become "forever".
 */

export type Level = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface State {
  /** The level currently in force. */
  level: Level;
  /** The level to return to — captured once per session, never hardcoded. */
  baseline: Level;
  /** Consecutive inspections seen since the last non-inspection or error. */
  run: number;
  /** The user's assertion for the current run, or null. Suspends the policy while set. */
  override: Level | null;
}

export type Signal =
  | { kind: "newPrompt" }
  | { kind: "error" }
  | { kind: "inspect" }
  | { kind: "other" }
  | { kind: "write" }
  | { kind: "assert"; level: Level }
  | { kind: "settled" };

/** Consecutive inspections before thinking goes off. */
export const THRESHOLD = 3;

/**
 * Bash verbs that mean "look at something", not "compute something".
 * Each requires a trailing space so a bare `echo cat` does not match.
 */
export const INSPECT_PATTERNS: RegExp[] = [
  /(^|[\s;&|])(cat|head|tail|ls|rg|grep|find|wc)\s/,
  /(^|[\s;&|])sed\s+-n\s/,
  /(^|[\s;&|])git\s+(status|log|diff|show)\b/,
];

/** Built-in tools that are inspections by definition. */
export const INSPECT_TOOLS = new Set(["read", "grep", "ls", "find"]);

/** Levels pi may report. Used to reject a malformed assertion rather than trust it. */
export const LEVELS = new Set<string>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function isInspection(toolName: string, command: string): boolean {
  if (INSPECT_TOOLS.has(toolName)) return true;
  if (toolName !== "bash") return false;
  return INSPECT_PATTERNS.some((re) => re.test(command));
}

export function initialState(baseline: Level): State {
  return { level: baseline, baseline, run: 0, override: null };
}

export interface Decision {
  state: State;
  /** The level that should be in force after this signal. */
  level: Level;
  /** Human-readable trigger, for the decision log. */
  reason: string;
}

export function nextLevel(state: State, signal: Signal): Decision {
  switch (signal.kind) {
    // The user's explicit assertion. Suspends the policy and resets the sweep counter so
    // an assertion made mid-sweep cannot inherit a half-counted run.
    case "assert":
      return {
        state: { ...state, override: signal.level, level: signal.level, run: 0 },
        level: signal.level,
        reason: `user asserted ${signal.level} — policy suspended for this run`,
      };

    // End of the run: the assertion was for "this message" and expires with it.
    case "settled":
      return {
        state: { ...state, override: null, level: state.baseline, run: 0 },
        level: state.baseline,
        reason:
          state.override === null
            ? "run settled — baseline"
            : `override ${state.override} expired — back to baseline`,
      };

    // A fresh user prompt, which also covers a steering message (it never fires
    // before_agent_start, so index.ts drives this from a user message_start).
    case "newPrompt":
      return {
        state: { ...state, run: 0, level: state.override ?? state.baseline },
        level: state.override ?? state.baseline,
        reason:
          state.override === null
            ? "new user prompt — reset to baseline"
            : `new prompt — override ${state.override} still in force`,
      };

    // A WRITE is never mechanical. It changes state on disk, so it is held to a higher bar
    // than an inspection: it breaks the sweep count AND restores the baseline, even if the
    // sweep had already fired earlier in the same turn. PRECAUTION, not a fix — 40 writes
    // once ran at `off` across two sessions, and whether any of them suffered is unmeasured.
    // An explicit user assertion still outranks it: the user asked for that level.
    case "write":
      if (state.override !== null) {
        return {
          state: { ...state, run: 0, level: state.override },
          level: state.override,
          reason: `write — override ${state.override} in force`,
        };
      }
      return {
        state: { ...state, run: 0, level: state.baseline },
        level: state.baseline,
        reason: "write in flight — reasoning on, sweep count cleared",
      };

    case "error":
    case "other": {
      if (state.override !== null) {
        return {
          state: { ...state, run: 0, level: state.override },
          level: state.override,
          reason: `override ${state.override} in force — policy suspended`,
        };
      }
      return {
        state: { ...state, run: 0, level: state.baseline },
        level: state.baseline,
        reason:
          signal.kind === "error" ? "tool error — diagnosis ahead" : "non-inspection work — baseline",
      };
    }

    case "inspect": {
      // Suspended: the user asked for this level, so a sweep must not take it away.
      if (state.override !== null) {
        return { state, level: state.override, reason: `override ${state.override} in force — sweep suspended` };
      }
      const run = state.run + 1;
      if (run < THRESHOLD) {
        return {
          state: { ...state, run, level: state.baseline },
          level: state.baseline,
          reason: `inspection ${run}/${THRESHOLD}`,
        };
      }
      return {
        state: { ...state, run, level: "off" },
        level: "off",
        reason: `read sweep (${run} consecutive inspections) — thinking off`,
      };
    }
  }
}
