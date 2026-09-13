/**
 * bash-quiet.test.ts — the pattern/hint lists, pinned.
 *
 * These two lists decide what collapses and what never does. The session audit that
 * prompted this file found bash-quiet missing `node --test` (120 uncollapsed runs) and
 * blocking passing test output because the summary line "fail 0" tripped the failure
 * hint. Both are regressions this file catches.
 *
 * Run: node run-extension-tests.mjs   (from ~/.pi)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { VERIFY_PATTERNS, VERIFY_FAILURE_HINTS } from "../agent/extensions/bash-quiet.ts";

const isVerify = (cmd: string) => VERIFY_PATTERNS.some((re) => re.test(cmd));
const blocks = (text: string) => VERIFY_FAILURE_HINTS.some((re) => re.test(text));

test("node --test is a verification command", () => {
  for (const cmd of [
    "node --test agent/extensions/learning/foo.test.ts",
    "cd /f/dev && node --test src/tests/",
    "node --experimental-strip-types --test app/",
    "node --import tsx --test",
  ]) {
    assert.equal(isVerify(cmd), true, `should match: ${cmd}`);
  }
});

test("plain node is not a verification command", () => {
  assert.equal(isVerify("node agent/script.js"), false);
  assert.equal(isVerify("node -e \"console.log(1)\""), false);
});

test("the original verification commands still match", () => {
  for (const cmd of ["npm run build", "npm test", "./gradlew build", "mvn test", "tsc --noEmit"]) {
    assert.equal(isVerify(cmd), true, `should match: ${cmd}`);
  }
});

test("passing test summaries do not trip the failure hints", () => {
  // Node's test runner prints these on a green run.
  for (const text of [
    "ℹ tests 9\nℹ pass 9\nℹ fail 0",
    "0 errors",
    "0 failures",
    "errors: 0",
    "failures: 0",
  ]) {
    assert.equal(blocks(text), false, `should NOT block: ${JSON.stringify(text)}`);
  }
});

test("real failures still block", () => {
  for (const text of [
    "2 failed",
    "Build failed",
    "error TS2365: Operator '+' cannot be applied",
    "3 errors",
    "2 failures",
    "FAIL",
    "EXIT: 2",
    "Command aborted",
    "Command timed out after 5 seconds",
  ]) {
    assert.equal(blocks(text), true, `should block: ${JSON.stringify(text)}`);
  }
});

test("success does not block", () => {
  assert.equal(blocks("EXIT: 0"), false);
  assert.equal(blocks("vite built in 1.2s"), false);
});
