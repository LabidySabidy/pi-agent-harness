/**
 * level.test.ts — the sweep-detection decision function, pinned.
 *
 * Pure: no pi runtime, so the whole policy is testable. The threshold and the reset
 * rules are what matter — a wrong `off` costs a re-derivation, a missed `off` costs
 * only the status quo. So the tests below care most about the reset paths.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, nextLevel, isInspection, THRESHOLD } from "./level.ts";

test("threshold is 3 — a single interpretive read keeps thinking on", () => {
  assert.equal(THRESHOLD, 3);
});

test("isInspection: bash read verbs count", () => {
  for (const cmd of [
    "cat PUZZLE.md",
    "head -20 x.txt",
    "tail -5 log",
    "sed -n '1,20p' f.ts",
    "ls -la",
    "rg TODO src",
    "grep -rn x .",
    "find . -name '*.ts'",
    "wc -l a b",
    "cd /x && cat a.md",
    "git status",
    "git diff HEAD",
  ]) {
    assert.equal(isInspection("bash", cmd), true, cmd);
  }
});

test("isInspection: non-read bash does not count", () => {
  for (const cmd of [
    "npm test",
    "node --test x.ts",
    "echo cat",
    "git commit -m 'cat'",
    "rm -rf build",
    "npm run build",
  ]) {
    assert.equal(isInspection("bash", cmd), false, cmd);
  }
});

test("isInspection: inspection tools count, writers and bash alone do not", () => {
  for (const t of ["read", "grep", "ls", "find"]) assert.equal(isInspection(t, ""), true, t);
  for (const t of ["edit", "write", "bash", "powershell"]) assert.equal(isInspection(t, ""), false, t);
});

test("two inspections stay at baseline; the third turns thinking off", () => {
  let s = initialState("high");
  for (let i = 1; i <= 2; i++) {
    const r = nextLevel(s, { kind: "inspect" });
    assert.equal(r.level, "high", `inspection ${i} must stay at baseline`);
    s = r.state;
  }
  const r3 = nextLevel(s, { kind: "inspect" });
  assert.equal(r3.level, "off");
  assert.match(r3.reason, /sweep/);
});

test("a non-inspection resets the run and restores the baseline", () => {
  let s = initialState("high");
  s = nextLevel(s, { kind: "inspect" }).state;
  s = nextLevel(s, { kind: "inspect" }).state;
  const r = nextLevel(s, { kind: "other" });
  assert.equal(r.level, "high");
  assert.equal(r.state.run, 0);
});

test("one inspection after a reset does not turn thinking off", () => {
  let s = initialState("high");
  s = nextLevel(s, { kind: "inspect" }).state;
  s = nextLevel(s, { kind: "other" }).state;
  assert.equal(nextLevel(s, { kind: "inspect" }).level, "high");
});

test("an error during a sweep returns to baseline immediately", () => {
  let s = initialState("high");
  for (let i = 0; i < 3; i++) s = nextLevel(s, { kind: "inspect" }).state;
  assert.equal(s.level, "off");
  const r = nextLevel(s, { kind: "error" });
  assert.equal(r.level, "high");
  assert.equal(r.state.run, 0);
});

test("a new user prompt never leaves the session stranded at off", () => {
  let s = initialState("high");
  for (let i = 0; i < 5; i++) s = nextLevel(s, { kind: "inspect" }).state;
  assert.equal(s.level, "off");
  const r = nextLevel(s, { kind: "newPrompt" });
  assert.equal(r.level, "high");
  assert.equal(r.state.run, 0);
});

test("the baseline is whatever was captured, not a hardcoded high", () => {
  const r = nextLevel(initialState("max"), { kind: "other" });
  assert.equal(r.level, "max");
  assert.equal(r.state.baseline, "max");
});

// --- run-scoped override (pi-web's declared assertion) ----------------------

test("an assertion sets the override, the level, and clears the sweep counter", () => {
  let s = initialState("high");
  s = nextLevel(s, { kind: "inspect" }).state;
  s = nextLevel(s, { kind: "inspect" }).state; // run = 2, one short of the threshold
  const r = nextLevel(s, { kind: "assert", level: "max" });
  assert.equal(r.level, "max");
  assert.equal(r.state.override, "max");
  assert.equal(r.state.run, 0);
  assert.match(r.reason, /assert/);
});

test("an override SUSPENDS the sweep — inspections cannot turn thinking off", () => {
  let s = nextLevel(initialState("high"), { kind: "assert", level: "max" }).state;
  for (let i = 0; i < 6; i++) {
    const r = nextLevel(s, { kind: "inspect" });
    assert.equal(r.level, "max", `inspection ${i + 1} must not override the assertion`);
    s = r.state;
  }
});

test("an override suspends the error reset too — the user's level holds", () => {
  const s = nextLevel(initialState("high"), { kind: "assert", level: "low" }).state;
  const r = nextLevel(s, { kind: "error" });
  assert.equal(r.level, "low");
});

test("an override suspends non-inspection work too", () => {
  const s = nextLevel(initialState("high"), { kind: "assert", level: "max" }).state;
  assert.equal(nextLevel(s, { kind: "other" }).level, "max");
});

test("a new prompt re-applies the override, not the baseline", () => {
  const s = nextLevel(initialState("high"), { kind: "assert", level: "max" }).state;
  const r = nextLevel(s, { kind: "newPrompt" });
  assert.equal(r.level, "max");
  assert.equal(r.state.override, "max");
  assert.equal(r.state.run, 0);
});

test("settled clears the override and restores the baseline", () => {
  const s = nextLevel(initialState("high"), { kind: "assert", level: "max" }).state;
  const r = nextLevel(s, { kind: "settled" });
  assert.equal(r.level, "high");
  assert.equal(r.state.override, null);
  assert.equal(r.state.run, 0);
  assert.match(r.reason, /expire|settle/i);
});

test("after settled, a new prompt starts at the baseline again", () => {
  let s = nextLevel(initialState("high"), { kind: "assert", level: "max" }).state;
  s = nextLevel(s, { kind: "settled" }).state;
  assert.equal(nextLevel(s, { kind: "newPrompt" }).level, "high");
});

test("an override expires at the end of its run, not the next one", () => {
  // two runs back to back: the assertion must cover run 1 only
  let s = initialState("high");
  s = nextLevel(s, { kind: "newPrompt" }).state;
  s = nextLevel(s, { kind: "assert", level: "max" }).state;
  assert.equal(nextLevel(s, { kind: "inspect" }).level, "max"); // run 1, overridden
  s = nextLevel(s, { kind: "settled" }).state;
  assert.equal(nextLevel(s, { kind: "newPrompt" }).level, "high"); // run 2, baseline
});
