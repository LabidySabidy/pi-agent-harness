/**
 * wiring.test.ts — the hook wiring, not the policy.
 *
 * `level.test.ts` pins what SHOULD happen; this file pins that `index.ts` actually feeds the
 * pure function the right signals and calls pi correctly. It exists because the design lives or
 * dies on one discriminator: ONLY an event carrying `asserted: true` may arm an override. pi
 * emits `thinking_level_select` for model switches and level cycling too
 * (agent-session.js:1215/1254/1277/1321), and if those armed overrides the user would silently
 * get a pinned level they never asked for.
 *
 * Run: node run-extension-tests.mjs   (from ~/.pi)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import reasoningLevel from "./index.ts";

/** A fake ExtensionAPI recording what the extension actually did. */
function fakePi(start: string) {
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
  const applied: string[] = [];
  const entries: Array<{ type: string; data: Record<string, unknown> }> = [];
  let level = start;

  const api = {
    on(event: string, fn: (event: unknown, ctx: unknown) => void) {
      const list = handlers.get(event) ?? [];
      list.push(fn);
      handlers.set(event, list);
    },
    getThinkingLevel: () => level,
    setThinkingLevel: (next: string) => {
      level = next;
      applied.push(next);
    },
    appendEntry: (type: string, data: Record<string, unknown>) => {
      entries.push({ type, data });
    },
  };

  return {
    api: api as never,
    fire: (event: string, payload: unknown = {}) => {
      for (const fn of handlers.get(event) ?? []) fn(payload, {});
    },
    applied,
    entries,
    current: () => level,
  };
}

const inspect = { toolName: "bash", input: { command: "cat README.md" } };

test("a NON-asserted thinking_level_select is ignored — the authorship discriminator", () => {
  // This is the model-switch / level-cycling case. If it armed an override, the user would get
  // a pinned level they never chose, and a sweep would stop saving anything.
  const pi = fakePi("high");
  reasoningLevel(pi.api);
  pi.fire("session_start");
  pi.fire("thinking_level_select", { type: "thinking_level_select", level: "off", previousLevel: "high" });
  assert.deepEqual(pi.applied, [], "an unasserted emit must not move the level");
  assert.deepEqual(pi.entries, [], "and must not be logged as a policy decision");
});

test("an ASSERTED thinking_level_select arms the override and moves the level", () => {
  const pi = fakePi("high");
  reasoningLevel(pi.api);
  pi.fire("session_start");
  pi.fire("thinking_level_select", {
    type: "thinking_level_select",
    level: "max",
    previousLevel: "high",
    asserted: true,
  });
  assert.deepEqual(pi.applied, ["max"]);
  const decisions = pi.entries.filter((e) => e.type === "reasoning-level");
  assert.equal(decisions.length, 1);
  assert.match(String(decisions[0].data.reason), /assert/);
  assert.equal(decisions[0].data.overridden, true);
});

test("an asserted level SUSPENDS the sweep — inspections cannot take it away", () => {
  const pi = fakePi("high");
  reasoningLevel(pi.api);
  pi.fire("session_start");
  pi.fire("thinking_level_select", { level: "max", previousLevel: "high", asserted: true });
  pi.applied.length = 0; // ignore the assertion itself
  for (let i = 0; i < 5; i++) pi.fire("tool_result", inspect);
  assert.deepEqual(pi.applied, [], "five inspections must not move an asserted level");
  assert.equal(pi.current(), "max");
});

test("without an assertion a 3-inspection sweep still turns thinking off", () => {
  const pi = fakePi("high");
  reasoningLevel(pi.api);
  pi.fire("session_start");
  pi.fire("tool_result", inspect);
  pi.fire("tool_result", inspect);
  pi.fire("tool_result", inspect);
  assert.deepEqual(pi.applied, ["off"]);
});

test("agent_settled expires the override and restores the baseline", () => {
  const pi = fakePi("high");
  reasoningLevel(pi.api);
  pi.fire("session_start");
  pi.fire("thinking_level_select", { level: "max", previousLevel: "high", asserted: true });
  pi.applied.length = 0;
  pi.fire("agent_settled");
  assert.deepEqual(pi.applied, ["high"], "the assertion was for one message, not forever");
});

test("a tool error returns to baseline only when nothing was asserted", () => {
  const pi = fakePi("high");
  reasoningLevel(pi.api);
  pi.fire("session_start");
  pi.fire("thinking_level_select", { level: "max", previousLevel: "high", asserted: true });
  pi.applied.length = 0;
  pi.fire("tool_result", { toolName: "bash", isError: true, input: { command: "npm test" } });
  assert.deepEqual(pi.applied, [], "an asserted level must survive a tool error");
});

test("a malformed asserted level is rejected rather than trusted", () => {
  const pi = fakePi("high");
  reasoningLevel(pi.api);
  pi.fire("session_start");
  pi.fire("thinking_level_select", { level: "bogus", previousLevel: "high", asserted: true });
  assert.deepEqual(pi.applied, [], "an unknown level must not reach setThinkingLevel");
});

test("an ASSERTED event that arrives AFTER the level already moved is still recorded", () => {
  // THE REAL pi-web ORDER, and the case the earlier tests could not catch: pi-web calls
  // setThinkingLevel FIRST (so the clamp applies and previousLevel is accurate), THEN emits
  // asserted. By the time this handler runs, the asserted level is already in force — so the
  // idempotence guard sees next === live and would return without writing anything, leaving a
  // working override indistinguishable from a dropped event.
  const pi = fakePi("high");
  reasoningLevel(pi.api);
  pi.fire("session_start");

  // simulate pi-web: the level moves out-of-band before the assertion is delivered
  (pi.api as { setThinkingLevel: (l: string) => void }).setThinkingLevel("max");

  pi.fire("thinking_level_select", {
    type: "thinking_level_select",
    level: "max",
    previousLevel: "high",
    asserted: true,
  });

  const decisions = pi.entries.filter((e) => e.type === "reasoning-level");
  assert.equal(decisions.length, 1, "the assertion must be recorded even though the level was set first");
  assert.match(String(decisions[0].data.reason), /assert/);
  assert.equal(decisions[0].data.overridden, true);
});

test("a policy no-op on the sweep path stays SILENT — only asserts force a record", () => {
  // The counterpart to the test above: forcing a log on every no-op would flood the transcript
  // with entries for inspections that changed nothing.
  const pi = fakePi("high");
  reasoningLevel(pi.api);
  pi.fire("session_start");
  pi.fire("tool_result", { toolName: "bash", input: { command: "cat PUZZLE.md" } });
  pi.fire("tool_result", { toolName: "bash", input: { command: "cat PUZZLE.md" } });
  assert.deepEqual(pi.entries, [], "two inspections are a no-op at the baseline and must not log");
});

test("a tool_call for write/edit restores thinking, even mid-sweep", () => {
  const pi = fakePi("high");
  reasoningLevel(pi.api);
  pi.fire("session_start");
  // drive the sweep to `off`
  pi.fire("tool_result", inspect);
  pi.fire("tool_result", inspect);
  pi.fire("tool_result", inspect);
  assert.equal(pi.current(), "off", "the sweep fired");
  pi.applied.length = 0;

  // now a write is announced BEFORE it runs
  pi.fire("tool_call", { toolName: "write", input: { path: "a.ts" } });
  assert.deepEqual(pi.applied, ["high"], "a write must bring reasoning back");
  assert.match(String(pi.entries.at(-1).data.reason), /write/i);
});

test("a tool_call for a read/bashing tool does NOT restore thinking", () => {
  // Only writes get the higher bar; an inspection must not defeat the sweep.
  const pi = fakePi("high");
  reasoningLevel(pi.api);
  pi.fire("session_start");
  pi.fire("tool_result", inspect);
  pi.fire("tool_result", inspect);
  pi.fire("tool_result", inspect);
  assert.equal(pi.current(), "off");
  pi.applied.length = 0;
  pi.fire("tool_call", { toolName: "read", input: { path: "a.ts" } });
  pi.fire("tool_call", { toolName: "bash", input: { command: "cat a.ts" } });
  assert.deepEqual(pi.applied, [], "non-writes must leave the level alone");
  assert.equal(pi.current(), "off");
});
