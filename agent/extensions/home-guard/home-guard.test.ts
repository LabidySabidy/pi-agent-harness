/**
 * home-guard.test.ts — the guard that keeps Pi from writing memory files into the home directory.
 *
 * The failure this pins: with Pi started at `C:\Users\<me>`, `session-summary`, `extract-patterns`
 * and `telemetry` all treated the home directory as a project, leaving a `PROGRESS.md`, a
 * `VALIDATION-SWEEP-*.md` and a whole `.agent/` directory in the home root. Seven such sessions were
 * recorded. A stray file that nobody thinks to look for is the whole problem.
 *
 * Pure module, no pi runtime, so this runs with plain `node --test` (the `telemetry/buckets.ts`
 * precedent).
 *
 * Run: node --test agent/extensions/home-guard/home-guard.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { isHomeDirectory, skipProjectMemory } from "./home-guard.ts";

test("the home directory is detected", () => {
  assert.equal(isHomeDirectory(homedir()), true);
});

test("the home directory is detected through a trailing separator", () => {
  // Windows shells hand back `C:\Users\me\` as readily as `C:\Users\me`, and GL-001 records that
  // every layer eats a different amount of path encoding. A guard that silently stops matching is
  // worse than no guard, so the comparison normalises both sides.
  assert.equal(isHomeDirectory(homedir() + sep), true);
});

test("the home directory is detected through the opposite slash style", () => {
  const flipped = homedir().replace(/\\/g, "/");
  assert.equal(isHomeDirectory(flipped), true, "forward slashes must compare equal on Windows");
});

test("a real project under home is NOT the home directory", () => {
  // The guard must only catch Pi started AT home. `~/projects/thing` is a real project and must
  // still get its PROGRESS.md and .agent/.
  assert.equal(isHomeDirectory(join(homedir(), "projects", "thing")), false);
});

test("the harness directory itself is not the home directory", () => {
  assert.equal(isHomeDirectory(join(homedir(), ".pi")), false);
});

test("an unrelated directory is not the home directory", () => {
  assert.equal(isHomeDirectory("F:" + sep + "Development"), false);
});

test("empty, undefined and null are not the home directory", () => {
  // A guard that throws on a missing cwd would take down a session. Fail open.
  assert.equal(isHomeDirectory(""), false);
  assert.equal(isHomeDirectory(undefined), false);
  assert.equal(isHomeDirectory(null), false);
});

test("skipProjectMemory follows isHomeDirectory", () => {
  assert.equal(skipProjectMemory(homedir()), true);
  assert.equal(skipProjectMemory(join(homedir(), "projects", "thing")), false);
});

test("PI_ALLOW_HOME_MEMORY=1 is the documented escape hatch", () => {
  // Deliberate override, for anyone who actually wants a PROGRESS.md in their home directory.
  const original = process.env.PI_ALLOW_HOME_MEMORY;
  try {
    process.env.PI_ALLOW_HOME_MEMORY = "1";
    assert.equal(skipProjectMemory(homedir()), false, "the escape hatch must disable the guard");
  } finally {
    if (original === undefined) delete process.env.PI_ALLOW_HOME_MEMORY;
    else process.env.PI_ALLOW_HOME_MEMORY = original;
  }
});

test("the escape hatch does not leak once unset", () => {
  const original = process.env.PI_ALLOW_HOME_MEMORY;
  try {
    delete process.env.PI_ALLOW_HOME_MEMORY;
    assert.equal(skipProjectMemory(homedir()), true);
  } finally {
    if (original !== undefined) process.env.PI_ALLOW_HOME_MEMORY = original;
  }
});
