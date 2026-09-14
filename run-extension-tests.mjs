#!/usr/bin/env node
/**
 * run-extension-tests.mjs — run the harness extension tests, attributably.
 *
 * WHY THIS EXISTS, with the failure it prevents:
 *
 *   `node --test a.test.ts b.test.ts` where `b.test.ts` does NOT exist runs only `a` and **exits 0**.
 *   A missing file is silently ignored, so a green aggregate number can exclude the very tests you
 *   just wrote. That happened: a new extension's tests were reported as running while the file lived
 *   only on an unmerged branch. The aggregate said "35" and was read as "41".
 *
 * This runner refuses to be ambushed by that, in three mechanical ways:
 *
 *   1. Every test file is DECLARED here explicitly. A declared file that does not exist is a FAILURE,
 *      not a skip. A glob is deliberately not used — it matches only what happens to be there.
 *   2. Every `*.test.ts` found on disk must be declared. A new test file has to be added on purpose,
 *      so it cannot be written and forgotten.
 *   3. Each file is run SEPARATELY and its count is asserted against a floor, then printed. A suite
 *      that silently shrinks fails, and the number attached to each file is visible — which is what
 *      an aggregate hides.
 *
 * A floor is a MINIMUM, so it can go stale: add tests (41 -> 46), leave the floor at 41, and a later
 * regression down to 42 passes while covering less than it did. A count ABOVE its floor therefore
 * prints a WARN naming both numbers. Not a failure — a guard that cries wolf gets ignored — but
 * staleness stops being invisible.
 *
 * RESOLUTION: every path is resolved from THIS SCRIPT'S location, never from `process.cwd()`. Run
 * from anywhere and it tests the same tree. That is not a convenience: when paths were resolved
 * against the working directory, running from outside the harness reported MISSING and pointed at a
 * branch problem, which is a confident diagnosis of the wrong cause — the exact failure this file
 * exists to prevent.
 *
 * Run:  node ~/.pi/run-extension-tests.mjs      (from any directory)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/** The harness root: the script's own directory, so cwd never changes what is tested. */
const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The declaration. `min` is the floor for that file: raise it when you add tests. A floor rather than
 * an equality so that ADDING a test does not fail the run — only losing one does.
 */
const DECLARED = [
  { file: "agent/extensions/learning/learning.test.ts", min: 23 },
  { file: "agent/extensions/learning/pipeline.test.ts", min: 12 },
  { file: "agent/extensions/passivity/passivity.test.ts", min: 6 },
  { file: "agent/extensions/reasoning-level/level.test.ts", min: 10 },
  { file: "run-extension-tests.test.ts", min: 3 },
];

// This runner's own test invokes this runner. Without a stop it recurses forever, so the self-test
// is dropped from the declaration while it is being run from inside a self-test.
const SELF_TEST = "run-extension-tests.test.ts";
const declared = process.env.GUARD_SELFTEST === "1" ? DECLARED.filter((d) => d.file !== SELF_TEST) : DECLARED;

const toPosix = (p) => p.split(sep).join("/");

/**
 * The environment for child test runs.
 *
 * Node's test runner marks its children with NODE_TEST_CONTEXT. That marker is inherited by our own
 * `node --test` invocations, and a process carrying it does NOT behave as a test runner — it reports
 * **0 tests**. A guard driven from inside a test process (its own test, a CI wrapper) would fail every
 * file with "0 tests, BELOW FLOOR" and look like missing coverage rather than a sandboxed env.
 * GUARD_SELFTEST stops the guard's own test from recursing into the guard.
 */
function childEnv() {
  const env = { ...process.env, GUARD_SELFTEST: "1" };
  delete env.NODE_TEST_CONTEXT;
  return env;
}
const abs = (file) => join(ROOT, file);
const problems = [];

// --- 0. we are where we think we are -----------------------------------------
if (!existsSync(join(ROOT, "agent", "extensions"))) {
  console.error(`REFUSED: ${ROOT} does not look like the harness root (no agent/extensions).`);
  process.exit(1);
}

// --- 1. every declared file must exist --------------------------------------
for (const d of declared) {
  if (existsSync(abs(d.file))) continue;
  const elsewhere = existsSync(join(process.cwd(), d.file));
  problems.push(
    `MISSING  ${d.file} — declared but not present under ${ROOT}.` +
      (elsewhere
        ? " (It exists under the CURRENT directory, which is a different tree — this run always tests the harness.)"
        : " If you wrote it on a branch, the branch is not checked out (GL-026): the install path IS the working tree."),
  );
}

// --- 2. no undeclared test file may exist -----------------------------------
function findTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTests(full));
    else if (entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const extensionsDir = join(ROOT, "agent", "extensions");

// pi auto-discovers `~/.pi/agent/extensions/*.ts` as GLOBAL extensions and refuses to start on any
// file that exports no factory — in every project, not just this one. A test file is only the most
// likely way to hit it, so the check is on the MECHANISM: any direct *.ts here that exports nothing.
// Asked at the desk because the symptom appears in the consumer, layers away from the cause;
// observed live on 2026-09-13 and recorded as GL-027.
for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
  const rel = `agent/extensions/${entry.name}`;
  const source = readFileSync(join(extensionsDir, entry.name), "utf8");
  // `export` anywhere includes `export default`, `export const`, and `export { … }`.
  const exportsSomething = /^\s*export\b/m.test(source);
  if (entry.name.endsWith(".test.ts")) {
    problems.push(
      `FATAL PLACEMENT ${rel} — pi auto-discovers direct *.ts files here as global extensions, so ` +
        `this file breaks the startup of every pi session (GL-027). Move it to tests/.`,
    );
  } else if (!exportsSomething) {
    problems.push(
      `FATAL PLACEMENT ${rel} — it exports nothing, and pi loads EVERY direct *.ts here as a global ` +
        `extension. A file with no factory makes pi refuse to start in every project (GL-027). ` +
        `Move it under a subdirectory with an index.ts entry point, or delete it.`,
    );
  }
}

const found = existsSync(extensionsDir) ? findTests(extensionsDir).map((f) => toPosix(relative(ROOT, f))) : [];
const declaredNames = new Set(declared.map((d) => toPosix(d.file)));
for (const file of found) {
  if (!declaredNames.has(file)) {
    problems.push(`UNLISTED ${file} — on disk but not declared, so it would never run. Add it to DECLARED.`);
  }
}

if (problems.length > 0) {
  console.error("Extension test run REFUSED:\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nNothing was run. Fix the declaration or the working tree, then try again.");
  process.exit(1);
}

// --- 3. run each file separately, attribute the count ------------------------
console.log(`Extension tests (harness root: ${ROOT})\n`);
const results = [];
const stale = [];
let total = 0;
let failures = 0;

for (const { file, min } of declared) {
  let output = "";
  let ok = true;
  try {
    output = execFileSync(process.execPath, ["--test", abs(file)], {
      encoding: "utf8",
      stdio: "pipe",
      cwd: ROOT,
      env: childEnv(),
    });
  } catch (err) {
    ok = false;
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }

  const declaredCount = /^ℹ tests (\d+)$/m.exec(output)?.[1];
  const count = declaredCount === undefined ? 0 : Number(declaredCount);
  const failCount = Number(/^ℹ fail (\d+)$/m.exec(output)?.[1] ?? 0);

  const belowFloor = count < min;
  const passed = ok && failCount === 0 && !belowFloor;
  if (!passed) failures++;
  total += count;

  const note = belowFloor
    ? `BELOW FLOOR (expected at least ${min})`
    : failCount > 0
      ? `${failCount} FAILED`
      : ok
        ? "ok"
        : "run errored";
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${file}  — ${count} tests, ${note}`);
  if (passed && count > min) {
    stale.push({ file, count, min });
    console.log(`        WARN  ${count} > floor ${min} — raise it, or this file can shrink back to ${min} unnoticed`);
  }
  results.push({ file, count, min, passed });
}

const floor = declared.reduce((sum, d) => sum + d.min, 0);
console.log(`\n  total ${total} tests across ${results.length} files (floor ${floor})`);

if (failures > 0) {
  console.error(`\n${failures} file(s) did not meet the floor or reported failures.`);
  process.exit(1);
}
if (total < floor) {
  console.error(`\nTotal ${total} is below the declared floor of ${floor}.`);
  process.exit(1);
}

if (stale.length > 0) {
  console.log(
    `\n  ${stale.length} floor(s) are stale — the file has grown past its declared minimum. ` +
      `Not a failure, but raise them so a regression cannot hide under the old number:`,
  );
  for (const s of stale) console.log(`    ${s.file}: ${s.count} tests, floor ${s.min}`);
}
console.log(`  every declared file ran, and every count is attributable above.`);
