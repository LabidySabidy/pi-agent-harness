---
name: plan-then-implement
description: Formalize the read-code → write-PLAN.md → execute pattern with TDD and acceptance gates
triggers:
  - "plan and implement"
  - "build this feature"
  - "add this feature"
  - "implement this"
  - "let's build"
---

# Skill: Plan Then Implement

## When to load
- I describe a feature I want built and the change spans more than one file or involves real logic
- I explicitly invoke `/skill:plan-then-implement`
- The classifier-router routes a substantive build request here

## What this skill does
Codify the workflow that worked for the CSV export task: read codebase → write PLAN.md → get approval → execute phases with TDD → run STANDARDS.md gates → update PROGRESS.md.

## Hard rules
1. **Read before planning.** Walk the relevant files. Don't generate plans from imagination.
2. **PLAN.md gets written before any code.** Show proposed plan, wait for approval, then implement.
3. **TDD for non-trivial work.** Tests first when the change involves real logic. Tests can be skipped only for purely additive trivial changes (a route mirroring an existing one, a constant added, etc.).
4. **Acceptance gates from STANDARDS.md fire between phases.** Failure output is input to the next attempt — don't re-run the same change unchanged.
5. **Update PROGRESS.md at session end.**

## Workflow

### Step 1 — Read the codebase
- Identify which files are likely to change
- Read those files plus their tests
- Read VISION.md, LANGUAGE.md, LESSONS.md if they exist
- Check `git log --oneline -20` for recent context

### Step 2 — Write PLAN.md
Use the template at `~/.pi/agent/templates/PLAN.md`. Populate:
- **Goal**: one sentence
- **Approach**: 2-4 sentences with rationale
- **Phases**: each with what it produces
- **Files that will change**: table with file + change type + phase
- **Acceptance criteria**: verifiable checkboxes
- **Not in scope**: explicit exclusions
- **Open questions**: anything blocking

Show me the plan. Before asking for approval, I check for grill triggers (see below).

### Grill trigger (before approval)

After you've seen the plan, I check: does this plan hit any of these complexity triggers?
- **Spans more than 3 files**
- **Introduces a new external dependency** (library, API, service)
- **Touches authentication, payments, or data integrity**
- **Has unresolved Open questions** in PLAN.md

**If any trigger is hit:** I invoke `/skill:grill` automatically to walk through design assumptions and scope before locking in the plan. This catches hidden assumptions and scope drift early.

**If plan is trivial** (single-file, mechanical, scoped): I skip grill and proceed directly to asking for your approval.

After grill (if triggered), we return to ask for your approval on the possibly-refined plan.

### Step 3 — Add tasks to TASKS.md
Each phase becomes one or more T-NNN tasks. Use monotonically increasing IDs that don't collide with existing tasks. For every task, populate `Done when:` with a testable criterion (a command that passes, an endpoint that returns a specific response, a visible UI state). `Estimate:` is optional — only include it when the effort is genuinely uncertain.

### Step 4 — Execute phase by phase
For each phase:

1. If non-trivial logic: write the test first (RED).
2. Implement the smallest change that makes the test pass (GREEN).
3. Refactor only if it improves clarity (REFACTOR).
4. Run the relevant gates from STANDARDS.md.
5. If gates fail, fix using the failure output as input.
6. When the phase is green, update TASKS.md (move task to Done) and move to next phase.

### Step 5 — Final verification
After all phases:
- Run the full STANDARDS.md gate suite
- Verify each acceptance criterion checkbox from PLAN.md
- If anything fails, return to the relevant phase

### Step 6 — Update PROGRESS.md
Append a 2-3 sentence summary: what was done, what was verified, what's next.

## Anti-patterns

- **Don't write tests after the fact** when the work was non-trivial. The test-first cycle catches design issues that "I'll add tests later" doesn't.
- **Don't skip PLAN.md** for "small" features that turn out big. If you're already 3 files in with no plan, stop and write one.
- **Don't run gates only at the end.** Catch failures early — cost compounds with how much code is on top.
- **Don't refactor adjacent code while implementing.** Stay surgical. Adjacent improvements go in their own task.

## Output at the end

Use the structured recap format from AGENTS.md (`**Changed:**` / `**Verified:**` / `**Next:**`). In addition, include:

```
## Open
- <any open questions, deferred items, or follow-ups>
```
