---
name: branch-hygiene
description: Feature-branch start, PR creation, branch cleanup — use when creating a branch, wrapping up, merging, creating a PR, shipping it, cleaning up branches, or closing out.
  - "finish this branch"
  - "clean up branches"
  - "new branch for"
---

# Skill: Branch Hygiene

Two phases + cleanup mode. Phase A fires before non-trivial implementation.
Phase B fires when work is complete. Cleanup mode removes stale merged branches.

## Branch tracking preference

Per project, stored in the project's AGENTS.md as a YAML frontmatter key:

```yaml
branch_tracking: true
```

If absent, ask once: "Treat this project as branch-tracked? (y/n) — I'll create feature
branches before work and PRs to merge." Store the answer. If `false`, skip this skill
entirely for that project.

> **Tension note:** Project AGENTS.md gaining YAML frontmatter is a new convention.
> Previously it was plain prose. The frontmatter block is machine-parseable while
> the prose remains human-readable. This is the smallest viable approach — no new
> config file, no schema. If more structured keys appear later, extract to
> `.agent/config`.

## Branch naming convention

- Features: `feat/<short-kebab-name>`
- Bugs: `fix/<short-kebab-name>`
- Short: 2-4 words, descriptive, no ticket numbers unless they exist

## Phase A — Branch Start

**When:**
- plan-then-implement step 3 (after PLAN.md approval, before execution)
- Explicit `/skill:branch` invocation
- AGENTS.md "Branch-before-code" rule triggers (first non-trivial Write/Edit on main)

### Step A1 — Check working directory

```bash
git status --porcelain
```

If dirty (uncommitted changes):

**If on main/master:** offer stash or abort only. Committing to main defeats branch tracking.
```
Working directory has uncommitted changes. Before branching:
1. Stash them (git stash)
2. Abort — I'll clean up myself and you retry

Which?
```
If "stash": `git stash push -m "pre-branch stash"`. If "abort": stop.

**If on a named branch:** also offer commit.
```
1. Stash them (git stash)
2. Commit them
3. Abort — I'll clean up myself and you retry

Which?
```
If "commit": proceed with warning about mixing concerns.

### Step A2 — Check current branch

```bash
git branch --show-current
```

### Step A3 — Determine base branch

```bash
# Try origin/HEAD first, fall back to main, then master
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|^refs/remotes/origin/||' || echo "main"
```

### Step A4 — Act on branch state

**If on `$BASE`:**

Propose a branch name. Derive from:
1. Active TASKS.md task description (if plan-then-implement loaded)
2. Trigger phrase used to invoke this skill
3. Ask the user

Present the name: "Branch name: `feat/<proposed>` — ok?"

User confirms or edits. Then:

```bash
git checkout -b <branch>
```

Report: "On `feat/<name>`. Ready to implement."
Branch is local only — no empty push. Remote learns about it on first real push.

**If already on a named branch:**

```bash
# Show state
LAST_COMMIT=$(git log -1 --oneline --format="%s")
AHEAD=$(git rev-list origin/<base>..HEAD --count 2>/dev/null || echo "?")
BEHIND=$(git rev-list HEAD..origin/<base> --count 2>/dev/null || echo "?")
```

Report:
```
Already on `feat/<existing>`. Last commit: "<last-commit>" (ahead: <N>, behind: <M>).
Continue here or start fresh from <base>? (continue / new <name>)
```

If "continue": proceed. If "new": `git checkout <base> && git checkout -b <new-name>`.

This prevents silently piling work onto stale branches.

---

## Phase B — Branch Finish

**When:** work is complete, tests pass, user signals completion.

### Step B0 — Prerequisites

```bash
# Check gh is installed and authenticated
gh auth status 2>&1
```

If exit code is non-zero (not installed, not authenticated, or token expired):
"`gh` unavailable. I'll print a manual PR URL when ready.
Run `gh auth login` to enable automatic PR creation."

### Step B1 — Verify tests pass

Run the project's full test suite. Per the verification-before-claim rule: show
the actual test output in the message — not a summary assertion.

```
<test command output with pass/fail counts>
```

Block on any failure. Do not offer options until tests pass.

### Step B2 — Detect state

```bash
BRANCH=$(git branch --show-current)
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|^refs/remotes/origin/||' || echo "main")
AHEAD=$(git rev-list origin/$BASE..HEAD --count 2>/dev/null || echo "?")
BEHIND=$(git rev-list HEAD..origin/$BASE --count 2>/dev/null || echo "?")

# Empty branch detection
COMMIT_COUNT=$(git rev-list origin/$BASE..HEAD --count 2>/dev/null || echo "0")
```

If `COMMIT_COUNT` is `0` (empty branch — no commits beyond base):
```
Branch `feat/<name>` has no commits beyond <base>. Nothing to merge or PR.
1. Continue (add work to this branch)
2. Discard this branch

Which?
```
If "discard": `git checkout <base> && git branch -D <branch>`. If "continue": return to implementation.

### Step B3 — Present options (exactly 3)

If branch has commits:
```
Branch `feat/<name>` ready (ahead: <N>, behind: <M>). What next?

1. Push and create a Pull Request  ← default
2. Merge to <base-branch> locally  ← explicit override (trivial/doc/config only)
3. Discard this branch

Which?
```

- Default to option 1. Option 2 only accepted with explicit confirmation: "This is trivial doc/config work? (y/n)"
- No "keep as-is" option — closure, not deferral.

### Step B4 — Execute

**Option 1: Push + PR**

```bash
git push -u origin <branch>
```

Construct PR body from project context:

- **Title:** derived from (in priority order):
  1. Active TASKS.md task description
  2. PLAN.md goal sentence
  3. Branch name (translated to sentence case)
- **"## What" section:** from the most recent 1-2 PROGRESS.md entries. If PROGRESS.md is empty or unavailable, fall back to PLAN.md goal sentence. Do NOT use raw commit messages — they lack context.
- **"## Test plan" section:** pull acceptance criteria checkboxes from PLAN.md (if exists). Link to PROGRESS.md for session context.

```bash
gh pr create --title "<title>" --body "<constructed-body>"
```

If `gh` unavailable: print the manual PR URL and body for pasting.

Branch is NOT deleted — stays alive for PR iteration.

**After PR creation:** Archive PLAN.md and TASKS.md when the PR is merged — run `/skill:branch cleanup` which will prompt for archival alongside branch cleanup.

**Option 2: Merge locally**

```bash
git checkout <base>
git pull
git merge <branch>
# Run test suite on merged result — show output per verification-before-claim
```

**If tests pass on merge result:**
```bash
git branch -d <branch>
git push
```

**After merge success:** Archive PLAN.md and TASKS.md if they exist:
```bash
mkdir -p .agent/archive
DATE=$(date +%Y-%m-%d)
BRANCH=$(git branch --show-current | sed 's|/|-|g')
for f in PLAN.md TASKS.md; do
  [ -f "$f" ] && cp "$f" ".agent/archive/${DATE}-$(echo $f | sed 's|\.md$||')-${BRANCH}.md"
done
# Leave originals in place — overwrite them when the next feature is planned
```
The copies in `.agent/archive/` are immutable records. Root `PLAN.md` and `TASKS.md` stay as templates for the next feature.

**If tests fail on merge result:**
- Do NOT delete branch.
- "Tests failed on merge: `<N>` failures. Reverting merge."
- `git reset --merge ORIG_HEAD`
- Branch preserved. Surface failures. Offer: investigate here, or switch to option 1 (push PR).

**Option 3: Discard**

```
This will permanently delete branch `<name>` and all its commits.
Type the full branch name to confirm:
```

Must match exactly — enter alone is not enough. On match:

```bash
git checkout <base>
git branch -D <branch>
```

---

## Cleanup Mode (`/skill:branch cleanup`)

List local branches whose tips are reachable from base (already merged):

Run `git branch --merged <base>`. Parse output in the agent:
- Drop lines starting with `*` (current branch marker)
- Drop the base branch name (e.g., `main` or `master`)
- Remaining lines are stale merged branches

For each, show last commit date via `git log -1 --format="%ci" <name>`.
Offer: delete all merged, select individually, or skip.

On confirmation: `git branch -d <name>` (safe — only merged branches, no `-D`).

**After cleanup:** If PLAN.md or TASKS.md exist and differ from any archive in `.agent/archive/`, offer: "Archive current PLAN.md and TASKS.md? The last feature is merged — these likely reflect completed work." If yes, copy both to `.agent/archive/YYYY-MM-DD-{plan,tasks}-<branch>.md`. Do NOT delete the root files — they stay as templates.

---

## Quick reference

| | Tests gate | Branch deleted | PR created |
|---|---|---|---|
| Push + PR | CI | No | Yes |
| Merge locally | Local (on merge result) | Yes (on pass) | No |
| Discard | None | Yes (force) | No |
| Cleanup | None (already merged) | Yes (safe) | N/A |
