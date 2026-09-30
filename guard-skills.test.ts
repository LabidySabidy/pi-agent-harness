/**
 * guard-skills.test.ts — the SKILL FRONTMATTER guard's own test.
 *
 * The guard refuses a run when a skill's frontmatter would make pi drop that skill silently. It was
 * written for a real defect: `skill-feynman-recite.md` carried an unquoted ": " in its description,
 * pi dropped the skill, and the loader reported `diagnostics: []` on two of three pi versions while
 * eleven skill files sat on disk — a missing feature reported as a clean run.
 *
 * The checking logic had no test of its own. Exercising it was awkward because the guard hardcoded
 * `agent/skills/`, so a test had to either mutate the REAL skill tree — a test that corrupts a
 * tracked file, the exact thing this cleanup exists to remove — or use an override seam. The seam is
 * `PI_HARNESS_SKILLS_DIR` (see SKILLS_DIR / SKILLS_LABEL in run-extension-tests.mjs).
 *
 * PLACEMENT, and why this file is at the harness root: it must NOT live directly in
 * `agent/extensions/`, because pi auto-discovers direct `*.ts` files there as global extensions and a
 * file with no `export default` factory makes EVERY pi session refuse to start (GL-027). The guard
 * itself refuses such a file (`FATAL PLACEMENT`), and it sits next to `run-extension-tests.test.ts`,
 * which is the same shape of test for the same script.
 *
 * What is pinned:
 *   1. a fixture carrying the ORIGINAL defect REFUSES — a guard is not a guard until it has been
 *      seen rejecting the thing it guards (GL-024)
 *   2. a clean fixture PASSES, so the guard is not merely refusing everything
 *   3. each other refusal condition fires: blank description, missing description, unterminated
 *      quote, unclosed frontmatter, absent frontmatter
 *   4. an unrecognised frontmatter shape WARNS and does not refuse
 *   5. the seam does not change the real run — the default is still agent/skills/
 *
 * Run: node --test guard-skills.test.ts   (or via the guard itself)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HARNESS, "run-extension-tests.mjs");

/**
 * Run the guard for real, capturing status and both streams.
 *
 * `skillsDir` is only set when given, so omitting it exercises the DEFAULT path. GUARD_SELFTEST=1
 * stops the guard recursing into its own test file; the skill check is independent of that filter
 * and still runs, which is what these tests assert on.
 */
function runGuard(skillsDir?: string): { status: number; stdout: string; stderr: string } {
  const env = { ...process.env, GUARD_SELFTEST: "1" };
  if (skillsDir !== undefined) env.PI_HARNESS_SKILLS_DIR = skillsDir;
  else delete env.PI_HARNESS_SKILLS_DIR;
  try {
    const stdout = execFileSync(process.execPath, [GUARD], {
      cwd: HARNESS,
      encoding: "utf8",
      stdio: "pipe",
      env,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** Build a throwaway skills dir from a filename → content map, then hand it to `fn`. */
function withSkillsDir(files: Record<string, string>, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "guard-skills-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, "utf8");
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GOOD = "---\nname: fine\ndescription: A skill with a plain, legal description.\n---\n\nBody.\n";

test("the guard REFUSES the original defect: an unquoted colon-space in a description", () => {
  // The real bug, reduced. `description: Do X: then Y` is invalid YAML inside a compact mapping, so
  // pi drops the whole skill and says nothing.
  const defective =
    "---\nname: broken\ndescription: Recite a concept: then check understanding.\n---\n\nBody.\n";
  withSkillsDir({ "skill-broken.md": defective }, (dir) => {
    const result = runGuard(dir);
    assert.equal(result.status, 1, `the guard must refuse this, got ${result.status}:\n${result.stdout}`);
    assert.match(result.stderr, /REFUSED/);
    assert.match(result.stderr, /nested mapping/, "it must name the mechanism, not merely refuse");
    assert.match(result.stderr, /skill-broken\.md/);
  });
});

test("the guard PASSES a clean fixture, so it is not refusing everything", () => {
  withSkillsDir({ "skill-fine.md": GOOD }, (dir) => {
    const result = runGuard(dir);
    assert.equal(result.status, 0, `a clean skill must pass:\n${result.stderr}`);
    assert.match(result.stdout, /Skills checked: 1 file\(s\)/);
  });
});

test("a QUOTED description carrying a colon is accepted — the fix, not a blanket ban", () => {
  // The actual repair for feynman-recite: keep the colon, quote the scalar. If the guard refused
  // every description containing ': ', the fix would have been impossible.
  const quoted =
    '---\nname: ok\ndescription: "Recite a concept: then check understanding."\n---\n\nBody.\n';
  withSkillsDir({ "skill-quoted.md": quoted }, (dir) => {
    const result = runGuard(dir);
    assert.equal(result.status, 0, `a quoted colon is legal YAML and must pass:\n${result.stderr}`);
  });
});

test("a blank description refuses, because pi drops the skill silently", () => {
  withSkillsDir({ "skill-blank.md": "---\nname: blank\ndescription:\n---\n\nBody.\n" }, (dir) => {
    const result = runGuard(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /blank/i);
  });
});

test("a missing description refuses", () => {
  withSkillsDir({ "skill-nodesc.md": "---\nname: nodesc\n---\n\nBody.\n" }, (dir) => {
    const result = runGuard(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no .description/i);
  });
});

test("an unterminated quote refuses", () => {
  withSkillsDir(
    { "skill-quote.md": '---\nname: q\ndescription: "never closed\n---\n\nBody.\n' },
    (dir) => {
      const result = runGuard(dir);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unterminated quote/i);
    },
  );
});

test("an unclosed frontmatter block refuses", () => {
  withSkillsDir({ "skill-open.md": "---\nname: open\ndescription: No closing fence.\n\nBody.\n" }, (dir) => {
    const result = runGuard(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /never closed/i);
  });
});

test("a file with no frontmatter at all refuses", () => {
  withSkillsDir({ "skill-none.md": "Just a body, no frontmatter.\n" }, (dir) => {
    const result = runGuard(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no frontmatter/i);
  });
});

test("an unrecognised frontmatter shape WARNS rather than refusing (GL-024)", () => {
  // A line that is neither `key: value` nor an indented continuation. Refusing would be over-strict
  // for a shape merely not parsed; accepting it in silence is the bug GL-024 names. So it must say
  // something AND let the run proceed.
  const odd = "---\nname: odd\ndescription: Legal description.\nthis line has no colon\n---\n\nBody.\n";
  withSkillsDir({ "skill-odd.md": odd }, (dir) => {
    const result = runGuard(dir);
    assert.equal(result.status, 0, `an unparsed shape must warn, not refuse:\n${result.stderr}`);
    assert.match(
      result.stdout + result.stderr,
      /not parsed/,
      "the warning must be visible somewhere, not swallowed",
    );
  });
});

test("the override does not move the default: an unset variable still scans agent/skills/", () => {
  const result = runGuard();
  assert.equal(result.status, 0, `the real run must stay green:\n${result.stderr}`);
  // The label names the directory actually scanned. Asserting the DEFAULT label is what pins the
  // seam as opt-in; asserting a skill COUNT would break every time a skill is added or moved.
  assert.match(result.stdout, /Skills checked: \d+ file\(s\) in agent\/skills\//);
  assert.ok(
    Number(/Skills checked: (\d+) file\(s\)/.exec(result.stdout)?.[1]) > 5,
    `the real skills tree should have several files, got: ${result.stdout}`,
  );
  assert.doesNotMatch(result.stderr, /REFUSED/, "the real skill tree must still pass its own guard");
});

test("a MISCONFIGURED override refuses rather than silently skipping the skill check", () => {
  // The hole the seam opens: point it at a directory that does not exist and `existsSync` skips the
  // entire skill check, leaving a green run that verified nothing. A typo must not be able to switch
  // a guard off.
  const ghost = join(tmpdir(), "guard-skills-does-not-exist-" + Date.now());
  const result = runGuard(ghost);
  assert.equal(result.status, 1, `a nonexistent override must refuse:\n${result.stdout}`);
  assert.match(result.stderr, /does not exist/);
  assert.match(result.stderr, /skipped/i, "the message must say what would have been skipped");
});

test("an empty-string override still falls back to the real tree", () => {
  // `"" || default` is the fallback, so a blank variable must behave exactly like an unset one.
  // Worth pinning because the alternative — scanning the process cwd or a path named "" — would be
  // an odd failure to diagnose.
  const result = runGuard("");
  assert.equal(result.status, 0, `a blank override must not refuse:\n${result.stderr}`);
  assert.match(result.stdout, /Skills checked: \d+ file\(s\) in agent\/skills\//);
});
