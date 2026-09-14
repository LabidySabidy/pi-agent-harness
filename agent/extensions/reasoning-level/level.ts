/**
 * level.ts — the sweep-detection decision function.
 *
 * Pure: no pi runtime, so the whole policy is unit-testable. `index.ts` owns every side
 * effect (capturing the baseline, calling pi.setThinkingLevel, logging the transition).
 *
 * What this decides, and why the threshold is 3: the thinking level applies to TURNS,
 * not to tools. A read is IO — no thinking happens during it. The thinking is in the turn
 * that decides what to read and, more, in the turn that interprets what came back. So a
 * SINGLE read must keep thinking on. Only a RUN of inspections has trivial reasoning
 * between them. `THRESHOLD = 3` is the current guess; the decision log from a real
 * session is the instrument that will correct it.
 */

export type Level = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface State {
  /** The level currently in force. */
  level: Level;
  /** The level to return to — captured once per session, never hardcoded. */
  baseline: Level;
  /** Consecutive inspections seen since the last non-inspection or error. */
  run: number;
}

export type Signal =
  | { kind: "newPrompt" }
  | { kind: "error" }
  | { kind: "inspect" }
  | { kind: "other" };

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

export function isInspection(toolName: string, command: string): boolean {
  if (INSPECT_TOOLS.has(toolName)) return true;
  if (toolName !== "bash") return false;
  return INSPECT_PATTERNS.some((re) => re.test(command));
}

export function initialState(baseline: Level): State {
  return { level: baseline, baseline, run: 0 };
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
    case "newPrompt":
      return {
        state: { ...state, run: 0, level: state.baseline },
        level: state.baseline,
        reason: "new user prompt — reset to baseline",
      };
    case "error":
      return {
        state: { ...state, run: 0, level: state.baseline },
        level: state.baseline,
        reason: "tool error — diagnosis ahead",
      };
    case "other":
      return {
        state: { ...state, run: 0, level: state.baseline },
        level: state.baseline,
        reason: "non-inspection work — baseline",
      };
    case "inspect": {
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
