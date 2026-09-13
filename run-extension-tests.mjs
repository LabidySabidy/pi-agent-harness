#!/usr/bin/env node
/**
 * run-extension-tests.mjs — run the harness extension tests, attributably.
 *
 * WHY THIS EXISTS, with the failure it prevents:
 *
 *   `node --test a.test.ts b.test.ts` where `b.test.ts` does NOT exist runs only `a` and **exits 0**.
 *   A missing file is silently ignored, so a green aggregate number can exclude the very tests you
 *   just wrote. That happened: a new extension's tests were reported as running while the file lived
 *   only on an unmerged branch. The aggregate said "35" and I read "41".
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
 * regression down to 42 passes while covering less than it did. That is the same silent-coverage hole
 * one level up, so a count ABOVE its floor prints a WARN naming both numbers. It is not a failure —
 * a guard that cries wolf gets ignored — but staleness stops being invisible.
 *
 * Run from the harness root:  node run-extension-tests.mjs
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * The declaration. `min` is the floor for that file: raise it when you add tests. It is deliberately
 * a floor rather than an equality so that ADDING a test does not fail the run — only losing one does.
 */
const DECLARED = [
  { file: "agent/extensions/learning/learning.test.ts", min: 23 },
  { file: "agent/extensions/learning/pipeline.test.ts", min: 12 },
  { file: "agent/extensions/passivity/passivity.test.ts", min: 6 },
];

const root = process.cwd();
const problems = [];

// --- 1. every declared file must exist --------------------------------------
const missing = DECLARED.filter((d) => !existsSync(join(root, d.file)));
for (const m of missing) {
  problems.push(
    `MISSING  ${m.file} — declared but not on disk. ` +
      `If you wrote it on a branch, the branch is not checked out (GL-026): the install path IS the working tree.`,
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

const extensionsDir = join(root, "agent", "extensions");
// `relative()` returns backslashes on Windows and the declaration uses forward slashes, so both
// sides are normalised before comparing — a separator difference must not read as a missing file.
const toPosix = (p) => p.split(sep).join("/");
const found = existsSync(extensionsDir) ? findTests(extensionsDir).map((f) => toPosix(relative(root, f))) : [];
const declaredNames = new Set(DECLARED.map((d) => toPosix(d.file)));
for (const file of found) {
  if (!declaredNames.has(toPosix(file))) {
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
console.log("Extension tests\n");
const results = [];
const stale = [];
let total = 0;
let failures = 0;

for (const { file, min } of DECLARED) {
  let output = "";
  let ok = true;
  try {
    output = execFileSync(process.execPath, ["--test", file], { encoding: "utf8", stdio: "pipe" });
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

const floor = DECLARED.reduce((sum, d) => sum + d.min, 0);
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
    `
  ${stale.length} floor(s) are stale — the file has grown past its declared minimum. ` +
      `Not a failure, but raise them so a regression cannot hide under the old number:`,
  );
  for (const s of stale) console.log(`    ${s.file}: ${s.count} tests, floor ${s.min}`);
}
console.log(`  every declared file ran, and every count is attributable above.`);
