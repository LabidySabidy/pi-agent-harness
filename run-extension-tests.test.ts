/**
 * run-extension-tests.test.ts — the guard's own test.
 *
 * The guard exists to refuse a run that would report coverage it does not have. Its first version
 * resolved the declared paths against `process.cwd()` instead of its own location, so running it from
 * another directory reported MISSING and blamed an unchecked-out branch — a confident diagnosis of
 * the wrong cause, which is precisely the failure mode the guard is for.
 *
 * These tests pin the resolution, so that cannot come back.
 *
 * Run: node --test run-extension-tests.test.ts   (or via the guard itself)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HARNESS, "run-extension-tests.mjs");

function runGuard(cwd: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [GUARD], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      // Tell the guard it is being driven by its own test, so it does not run this file again.
      env: { ...process.env, GUARD_SELFTEST: "1" },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

test("the guard passes when run from a directory outside the harness", () => {
  // The defect this pins: cwd used to decide which tree was tested, so an outside cwd produced
  // MISSING for every declared file and blamed a branch.
  const elsewhere = mkdtempSync(join(tmpdir(), "guard-cwd-"));
  try {
    const result = runGuard(elsewhere);
    assert.equal(result.status, 0, `expected a green run from ${elsewhere}:\n${result.stderr}`);
    assert.match(result.stdout, /every declared file ran/);
    assert.doesNotMatch(result.stderr, /MISSING/, "no file may be reported missing because of cwd");
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("the guard tests the harness tree no matter where it is run from", () => {
  const elsewhere = mkdtempSync(join(tmpdir(), "guard-tree-"));
  try {
    const fromInside = runGuard(HARNESS);
    const fromOutside = runGuard(elsewhere);
    assert.equal(fromInside.status, 0);
    assert.equal(fromOutside.status, 0);
    // Same suites, same counts: the tree is resolved from the script, not the caller.
    const files = (out: string) => out.split("\n").filter((l) => /^ {2}(PASS|FAIL)/.test(l)).map((l) => l.split("—")[0].trim());
    assert.deepEqual(files(fromOutside.stdout), files(fromInside.stdout));
    assert.ok(files(fromOutside.stdout).length >= 3, "it reported the declared suites");
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("the guard names its harness root, so a run is attributable", () => {
  const result = runGuard(HARNESS);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /harness root:/);
  assert.ok(result.stdout.includes(HARNESS.replace(/\\/g, "/")) || result.stdout.includes(HARNESS));
});
