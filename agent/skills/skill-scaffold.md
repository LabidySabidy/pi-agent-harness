---
name: scaffold
description: Bootstrap a new project — discovery flow, VISION/PLAN/TASKS files, GitHub repo, and live Vercel deploy
triggers:
  - "scaffold"
  - "bootstrap"
  - "new project"
  - "init project"
  - "starting a new app"
  - "begin a new project"
  - "build a new app"
  - "new app idea"
  - "got an idea for an app"
  - "create a new web app"
  - "spin up a new app"
  - "put together an app"
---

# Skill: Scaffold (New Project Bootstrap + Auto-Deploy)

## When to load
- I say "scaffold," "bootstrap," "new project," or similar
- I describe wanting to start a new app and there are no project files yet
- I say "I want to build a new app," "I've got an idea for an app," "spin up a new app," etc.

## What this skill does
First triage whether this is a small/throwaway tool or a real maintained product — then run the appropriate discovery flow, produce the right files, create a GitHub repo, and deploy to Vercel for an instant live URL. Templates live at `~/.pi/agent/templates/`.

## Hard rules
1. **No code or directory structure until VISION + PLAN are agreed.** Discovery first, scaffolding second.
2. **Use templates from `~/.pi/agent/templates/`.** Read them, populate, don't reinvent the structure.
3. **Show proposed content before writing each file.** Wait for approval per file.
4. **Apply Simplicity First.** No speculative features in v1.
5. **GitHub repo + Vercel deploy are automatic for real-product path.** Don't ask — just do it. The user invoked scaffold because they want a live app.
6. **Verify every file write.** After writing ANY file, read it back immediately. If the file is missing, empty, or content doesn't match, the write silently failed (common on cross-drive Windows paths like F:/). Fall back to `bash` heredocs for that file. Never proceed past a write without verification.
7. **Web apps get Playwright E2E.** When solution shape is "web" and the path is real-product, install Playwright with a smoke test before the first deployment. Throwaway tools and non-web projects skip this.

## Triage (ask this first, before anything else)

> "Is this a small/throwaway tool (scripts, CLIs, one-off automations under ~300 lines), or a real product you'll maintain and grow over time?"

**Small/throwaway path:**
- Skip VISION.md entirely.
- Produce only: a brief PLAN.md (3–5 bullet points, no phases) and a TASKS.md (still use `Done when:` per task — it's one sentence, even for throwaway work).
- Skip GitHub + Vercel. Throwaway tools don't get deployed.
- End with: "Want to validate the riskiest bit first? `/skill:spike`"

**Real-product path:**
- Run the full 5-question discovery flow below, then produce all four files.
- After file approval: create GitHub repo, push, deploy to Vercel (see "GitHub + Vercel auto-deploy" below).

If I've already described the project in enough detail to make the answer obvious, don't ask — infer it and state your inference ("treating this as a small tool — let me know if it's bigger").

## Discovery flow

If I haven't given you a brief, ask these in order. Take answers conversationally — don't make me fill out a form.

1. **Customer**: Who is this for? Specific personas, not "users."
2. **Problem**: What problem does it solve, in their voice?
3. **Solution shape**: Most comfortable way for them to fix the problem? (Web, CLI, mobile, email-driven?)
4. **Core functionality**: What must v1 *minimally* do? Anything more is post-v1.
5. **Constraints**: Tech stack preferences, deploy target, budget, time horizon, external dependencies.

If I've given you a one-paragraph brief, skip to step 5 and confirm constraints.

## After discovery, produce in order

1. **VISION.md** — populated from discovery answers, including a Domain glossary section seeded with terms that emerged in discovery. Show first, get approval, then write.
2. **PLAN.md** — phases for v1 only. Don't plan v2/v3 here. Phases small and end-to-end useful.
3. **TASKS.md** — concrete tasks for Phase 1 of v1 only. Don't fill in future phases. Every task must have a `Done when:` criterion. `Estimate:` is optional.
4. **PROGRESS.md** — empty template, ready for first session-end summary.

For each file: show proposed content → wait for approval → write to project root → **verify the write landed** (read it back, confirm content matches). If the read returns empty/wrong content, the write tool failed silently (cross-drive issue). Retry with:
```bash
cat > path/to/file.md << 'ENDOFFILE'
<exact content>
ENDOFFILE
```
Never skip verification. Every file must be confirmed on disk before moving to the next.

## Tech stack defaults

When I don't specify, default to my primary stacks (from global AGENTS.md):
- **Backend (substantial)**: Java + Spring Boot
- **Frontend**: React (or Angular if I prefer)
- **Lightweight backend**: Python + Flask
- **DB**: SQLite for local-first apps, Postgres for multi-user
- **Deploy**: Vercel (auto-deployed via this skill)

If I request something outside these, push back gently once ("you usually use X — sticking with it, or different reason?") then defer to my answer.

## Playwright E2E setup (web apps, real-product path only)

When the solution shape from discovery question 3 is "web" AND the project is on the real-product path, set up Playwright before deploying. This gives every web project a smoke test from day one and establishes the pattern that all future changes get Playwright tests.

### Step A: Install Playwright
```bash
npm init playwright@latest -- --yes --quiet --install-deps
```
Or, for more control:
```bash
npm install -D @playwright/test
npx playwright install --with-deps chromium
```
Accept defaults: `tests/` directory, GitHub Actions workflow = yes, Chromium only.

### Step B: Write a smoke test
Create `tests/smoke.spec.ts` (or `.js` for non-TS projects):
```ts
import { test, expect } from '@playwright/test';

test('app loads and is interactive', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/./);  // page has a title
  // Add one domain-specific assertion from TASKS.md Phase 1
});
```
The test must exercise the minimal v1 interaction described in TASKS.md. For a calculator: verify number buttons render and clicking one produces output. For a todo app: verify you can type and add an item. One meaningful assertion, not a ritual.

### Step C: Add Playwright gate to TASKS.md
Append to TASKS.md under Phase 1:
```
- [ ] Playwright smoke test passes (`npx playwright test`)
  Done when: `npx playwright test` exits 0 and the smoke test exercises v1 core interaction
```

### Step D: Add Playwright to package.json scripts
Ensure `package.json` has:
```json
"scripts": {
  ...
  "test:e2e": "npx playwright test"
}
```

### Step E: Git commit Playwright setup
Before the initial scaffold commit, include Playwright files:
```bash
git add tests/ playwright.config.* package.json package-lock.json
git commit -m "Add Playwright E2E smoke test"
```

### Note for non-web projects
CLI tools, APIs, mobile apps, and throwaway tools skip Playwright entirely. Only web projects get this.

## GitHub + Vercel auto-deploy (real-product path only)

After all four files are written and approved, run this sequence automatically. Don't ask for confirmation — the user invoked scaffold to get a live app.

### Prerequisites check
Before starting, silently verify:
- `gh auth status` returns success
- `vercel whoami` returns a username
- If either fails, report which one and stop — don't proceed with a broken deploy.

### Step 1: Git init + initial commit
```bash
git init
git add -A
git commit -m "Initial scaffold: VISION, PLAN, TASKS, PROGRESS"
```
If the repo was already initialized, add a commit if there are unstaged changes. If already committed, skip.

### Step 2: Create GitHub repo
Ask for the repo name once (default: current directory name, lowercased with hyphens). Then ask: public or private? (default: public).

```bash
gh repo create <name> --<public|private> --push --source .
```
This creates the repo and pushes in one command. The `--push` flag handles the remote setup.

### Step 3: Deploy to Vercel
```bash
vercel --prod
```
Vercel auto-detects the framework. On first run it may prompt for:
- **Scope**: pick the account (likely `labidysabidy`)
- **Link to existing project?**: No (it's new)
- **Project name**: accept default or use the repo name
- **Root directory**: accept default (`.`) unless the project has a nested frontend

Handle these prompts by accepting defaults where possible. If Vercel asks a blocking question, surface it to me.

### Step 4: Report
Output the final summary:
- Repo URL: `https://github.com/LabidySabidy/<name>`
- Live URL: whatever Vercel printed
- Next: suggest `/skill:plan-then-implement` to start building

### Troubleshooting
- **`gh auth status` fails**: "GitHub CLI not authenticated. Run `gh auth login` and retry."
- **`vercel whoami` fails**: "Vercel CLI not authenticated. Run `vercel login` and retry."
- **`gh repo create` fails (name taken)**: prompt for a different name.
- **Vercel deploy fails**: surface the error. Common fixes: wrong framework detection (set with `vercel --build-env`), missing build script in package.json.

## After scaffolding

End with a summary of what was created:
- Files written
- GitHub repo URL
- Live Vercel URL
- Recommended first concrete task

Suggest invoking `/skill:plan-then-implement` for the first task, or `/skill:grill` if the v1 design feels uncertain.

## Anti-patterns

- **Don't run the full discovery flow for a 300-line script.** The triage exists for this reason — use it.
- **Don't scaffold without discovery.** Even a one-paragraph brief needs the constraints question.
- **Don't write all four files in one shot.** File-by-file approval catches drift early.
- **Don't create empty project AGENTS.md or STANDARDS.md.** Create these only when the project has a genuine override of a global default — never during initial scaffold.
- **Don't pad VISION with future-state aspirations.** Capture v1 reality. v2 lives in TASKS or a separate doc.
- **Don't ask "do you want a GitHub repo?" or "should I deploy?"** — the real-product path means yes to both. Just do it.
- **Don't deploy throwaway tools.** Small/throwaway path skips GitHub + Vercel entirely.
- **Don't skip write verification.** Cross-drive paths (C: → F:) cause silent write failures. Always read back after writing. If missing, retry with bash heredocs.
- **Don't skip Playwright for web apps on real-product path.** Every web project gets a smoke test. No exceptions.
