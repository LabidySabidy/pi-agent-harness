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
  // The learning and passivity extensions moved to socrates-web, which ships and loads its own copies
  // (see the commit that removed them). Their tests went with them, and that repo's suite runs them:
  //   node --test session.test.ts   (isolation) and the shipped copies are asserted by preflight.
  { file: "agent/extensions/home-guard/home-guard.test.ts", min: 10 },
  { file: "agent/extensions/reasoning-level/level.test.ts", min: 23 },
  { file: "agent/extensions/reasoning-level/wiring.test.ts", min: 11 },
  { file: "run-extension-tests.test.ts", min: 3 },
  // The skill-frontmatter guard's own test, using the PI_HARNESS_SKILLS_DIR seam. Root-level, next
  // to run-extension-tests.test.ts, and NOT in agent/extensions/ — a direct *.ts there breaks every
  // pi session (GL-027), which the guard itself refuses.
  { file: "guard-skills.test.ts", min: 12 },
  // The Ollama warm-up's own test: request shape (keep_alive must be in the BODY) and the silence
  // policy (an absent Ollama must not warn or break a session).
  { file: "agent/extensions/ollama-warmup/warmup.test.ts", min: 10 },
];

// This runner's own tests invoke this runner. Without a stop it recurses forever, so every test that
// spawns the guard is dropped from the declaration while the guard is being driven by a self-test.
//
// ⚠ A SET, not a single name. This was `d.file !== SELF_TEST` and adding guard-skills.test.ts — which
// also spawns the guard, once per fixture — produced a fork bomb: 340 node processes before the run
// was killed. Contributing a second self-test meant contributing a second exclusion, and nothing
// enforced that. Adding a file here that launches the guard now requires adding it to SELF_TESTS.
const SELF_TESTS = new Set(["run-extension-tests.test.ts", "guard-skills.test.ts"]);
const declared =
  process.env.GUARD_SELFTEST === "1" ? DECLARED.filter((d) => !SELF_TESTS.has(d.file)) : DECLARED;

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

/**
 * Does this source export a DEFAULT that could be a factory?
 *
 * pi requires `export default <function>`. The previous check accepted any
 * `export` at all, so `export const helper = 1` passed while pi refused to start
 * — the guard was green on the exact file shape that broke the loader. Observed
 * live on 2026-09-18: a direct `__probeA.ts` containing only `export const y = 2`
 * ran the guard at exit 0 and made `pi -p` fail with
 * `Extension does not export a valid factory function`.
 */
function exportsDefault(source) {
  return /^\s*export\s+default\b/m.test(source);
}

// pi auto-discovers extension entry points and refuses to start on any that does not
// export a default factory — in every project, not just this one. Two shapes reach the
// loader: a direct `extensions/*.ts` file, and `extensions/<dir>/index.ts`. Both are
// checked, because a guard that covers only the shape that broke last time is the
// failure mode GL-027 already recorded.
for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".ts")) {
    const rel = `agent/extensions/${entry.name}`;
    const source = readFileSync(join(extensionsDir, entry.name), "utf8");
    if (entry.name.endsWith(".test.ts")) {
      problems.push(
        `FATAL PLACEMENT ${rel} — pi auto-discovers direct *.ts files here as global extensions, so ` +
          `this file breaks the startup of every pi session (GL-027). Move it to tests/.`,
      );
    } else if (!exportsDefault(source)) {
      problems.push(
        `FATAL PLACEMENT ${rel} — pi loads EVERY direct *.ts here as a global extension and ` +
          `requires \`export default\` to be a function. A file without one makes pi refuse to ` +
          `start in every project (GL-027). Found no \`export default\`.`,
      );
    }
    continue;
  }

  // Subdirectories are loaded only via their index entry point (see
  // dist/core/extensions/loader.js resolveEntryPoints). The same factory requirement
  // applies, so a factory-less index.ts here breaks startup exactly as a direct file does.
  if (!entry.isDirectory()) continue;
  for (const indexName of ["index.ts", "index.js"]) {
    const indexPath = join(extensionsDir, entry.name, indexName);
    if (!existsSync(indexPath)) continue;
    const rel = `agent/extensions/${entry.name}/${indexName}`;
    let source;
    try {
      source = readFileSync(indexPath, "utf8");
    } catch {
      continue;
    }
    // A .js index cannot declare a TS type, so the same default-export test applies.
    if (!exportsDefault(source)) {
      problems.push(
        `FATAL PLACEMENT ${rel} — pi loads this as an extension entry point and requires ` +
          `\`export default\` to be a function. Without one it refuses to start in every ` +
          `project (GL-027). Found no \`export default\`.`,
      );
    }
  }
}

// --- 2b. every skill's frontmatter must be loadable --------------------------
//
// WHY THIS EXISTS, with the failure it prevents:
//
//   `feynman-recite` was silently invisible for weeks. Its description was an UNQUOTED YAML
//   scalar containing ": " — `description: Active-recall check: the user explains …` — which YAML
//   reads as a nested mapping inside a compact mapping and rejects. pi DROPS such a skill, and for
//   a loose `*.md` (as opposed to a declared `SKILL.md`) it drops it with **no diagnostic at all**:
//   on 0.84.3 and 0.85.1 the loader reported 10 skills and `diagnostics: []` while 11 files sat on
//   disk. Only 0.80.3 said anything. So the skill's own README entry and its `total` were both
//   lies, and nothing failed.
//
// This is GL-024's shape (a parser that silently drops turns a formatting variation into a missing
// feature). A skill that cannot load is a missing feature, so the run refuses.
//
// SCOPE, stated honestly: this is a TARGETED detector, not a YAML parser. The harness has no
// `package.json` and no importable YAML library (verified: `require.resolve('yaml')` and
// `require.resolve('js-yaml')` both fail from the harness root, and the pi SDK does not resolve
// either), so a real parser would mean adding a dependency to a repo that deliberately has none.
// It therefore refuses on the two conditions pi itself drops a loose `*.md` for — a frontmatter
// PARSE failure and a missing/blank `description` — and, per GL-024, it WARNS on any frontmatter
// shape it does not recognise rather than quietly accepting it.
const SKILLS_DIR = process.env.PI_HARNESS_SKILLS_DIR || join(ROOT, "agent", "skills");
// What gets PRINTED, and what appears in problem lines. It must name the directory actually scanned:
// a test override that still printed "agent/skills/" would attribute a fixture failure to the real
// tree. That is GL-024's shape — a label that lies about what was checked — and it is the same class
// of defect this guard exists to catch, so the seam is not allowed to introduce it.
const SKILLS_LABEL = process.env.PI_HARNESS_SKILLS_DIR ? SKILLS_DIR : "agent/skills";
const skillWarnings = [];

/** Strip a trailing ` # comment` from an unquoted scalar, then trim. */
function plainValue(raw) {
  const cut = raw.search(/\s+#/);
  return (cut >= 0 ? raw.slice(0, cut) : raw).trim();
}

/**
 * Return the problem this scalar would cause YAML, or null when it is fine.
 *
 * `plain` is the value with a trailing comment already removed. A quoted scalar, a block scalar
 * (`|`, `>`), or a flow collection (`[`, `{`) is exempt: those are legal carriers of a colon.
 *
 * An EMPTY value is deliberately not judged here: `key:` with nothing after it is legal YAML when
 * an indented block follows (that is how `triggers:` carries its list in skill-browser.md), so
 * emptiness is decided by the caller, which can look ahead.
 */
function scalarProblem(plain) {
  if (plain === "") return null;
  const first = plain[0];
  if (first === '"' || first === "'") {
    if (plain.length < 2 || plain[plain.length - 1] !== first) {
      return "unterminated quote — the closing " + first + " is missing";
    }
    return null;
  }
  if (first === "|" || first === ">" || first === "[" || first === "{" || first === "&" || first === "*") {
    return null;
  }
  // The bug that started this. In a plain scalar, ": " opens a nested mapping, which YAML forbids
  // inside a compact mapping — and a trailing ":" is the same error at end of line.
  if (plain.includes(": ") || plain.endsWith(":")) {
    return (
      "an unquoted ': ' makes YAML read this as a nested mapping (a colon-space is illegal in a " +
      "plain scalar). Wrap the whole value in double quotes"
    );
  }
  return null;
}

/**
 * Validate one skill file. Returns {file, problems, warnings} — problems refuse the run.
 *
 * Deliberately permissive about SHAPE (a value may be quoted, plain, a flow list, or a block
 * scalar) and strict about the two things that silently lose the skill.
 */
function checkSkill(file) {
  const rel = `${SKILLS_LABEL}/${file}`;
  const problems = [];
  let source;
  try {
    source = readFileSync(join(SKILLS_DIR, file), "utf8");
  } catch (err) {
    return { rel, problems: [`unreadable: ${err.message}`] };
  }

  // Frontmatter must open on line 1 and close on a line that is exactly `---`.
  const normalized = source.replace(/\r\n/g, "\n");
  if (!/^---\n/.test(normalized)) {
    return { rel, problems: ["no frontmatter block — pi needs `---` on line 1 and a closing `---`"] };
  }
  const end = normalized.indexOf("\n---", 3);
  if (end < 0) {
    return { rel, problems: ["frontmatter block is never closed — pi needs a closing `---` line"] };
  }
  const block = normalized.slice(4, end);
  const lines = block.split("\n");

  const values = new Map();
  let lastKeyWasBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 2; // +1 for the opening `---`, +1 for 1-indexing
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    // A continuation line of a block scalar (`  text`) — legal, and the established shape for long
    // descriptions, so it is recognised rather than warned about.
    if (/^[ \t]+\S/.test(line)) {
      if (!lastKeyWasBlock) {
        skillWarnings.push(`${rel}:${lineNo} indented line inside a non-block value — not parsed`);
      }
      continue;
    }

    const m = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!m) {
      // Not `key: value`, not indented, not a comment. Refusing would be over-strict
      // (GL-024: warn on unrecognised, never silently accept).
      skillWarnings.push(`${rel}:${lineNo} unrecognised frontmatter line (not \`key: value\`) — not parsed`);
      lastKeyWasBlock = false;
      continue;
    }

    const [, key, rawRest] = m;
    const plain = plainValue(rawRest);

    // `key:` with nothing after it is legal when an indented block follows — that is how
    // `triggers:` carries its list. Only a value-less key with NO indented block under it is a
    // problem, so look ahead before judging.
    if (plain === "") {
      const nextContent = lines.slice(i + 1).find((l) => l.trim() !== "" && !l.trimStart().startsWith("#"));
      if (nextContent === undefined || !/^[ \t]+\S/.test(nextContent)) {
        problems.push(`${rel}:${lineNo} \`${key}\` — has no value and no indented block under it`);
      }
      lastKeyWasBlock = true; // an indented continuation is expected, not a warning
      values.set(key, "");
      continue;
    }

    lastKeyWasBlock = plain.startsWith("|") || plain.startsWith(">");

    const problem = scalarProblem(plain);
    if (problem) problems.push(`${rel}:${lineNo} \`${key}\` — ${problem}`);
    values.set(key, plain);
  }

  if (!values.has("description")) {
    problems.push(`${rel} — no \`description:\` key. pi DROPS a skill without one, silently (GL-024).`);
  } else if (!values.get("description")) {
    problems.push(`${rel} — \`description:\` is blank. pi DROPS a skill with a blank description, silently.`);
  }

  return { rel, problems };
}

// A seam that can silently DISABLE the guard is worse than no seam. `existsSync` below skips the
// whole skill check when the directory is missing, so a typo in PI_HARNESS_SKILLS_DIR would turn the
// guard off and still report a green run — GL-030's shape, an absent observable that cannot
// distinguish "nothing to check" from "never checked". A misconfigured override is therefore a
// refusal, not a warning.
if (process.env.PI_HARNESS_SKILLS_DIR && !existsSync(SKILLS_DIR)) {
  problems.push(
    `PI_HARNESS_SKILLS_DIR points at ${SKILLS_DIR}, which does not exist. The skill check would be ` +
      `skipped and the run would still look green. Unset it, or point it at a real directory.`,
  );
}

if (existsSync(SKILLS_DIR)) {
  const skillFiles = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
  let skillCount = 0;
  for (const file of skillFiles) {
    skillCount++;
    for (const p of checkSkill(file).problems) problems.push(p);
  }
  console.log(`Skills checked: ${skillCount} file(s) in ${SKILLS_LABEL}/\n`);
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
if (skillWarnings.length > 0) {
  console.log(`\n  ${skillWarnings.length} frontmatter shape(s) were not recognised by the skill guard. ` +
    `Not a failure, but the guard did not validate them — check them by hand:`);
  for (const w of skillWarnings) console.log(`    WARN  ${w}`);
}
console.log(`  every declared file ran, and every count is attributable above.`);
