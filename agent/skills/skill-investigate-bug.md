---
name: investigate-bug
description: Structured 8-step defect investigation — gather, reproduce, root-cause with evidence, TDD fix plan. Use when something is broken, failing, regressed, stopped working, was working before, or has a failing test.
triggers:
  - "stopped working"
  - "was working before"
---

# Skill: Investigate Bug

## When to load
- I describe something broken, failing, or behaving unexpectedly
- I say "investigate," "debug," "trace," "root cause," "why is this failing"
- The model self-selects this skill from its description when something is described as broken or failing

## What this skill does
Walk through a structured 8-step defect investigation, ending with a TDD fix plan saved to disk before any fix is implemented.

## Hard rules
1. **Never code before I approve the root cause.** Investigation → approval → fix.
2. **When I say "was working before," investigate the diff first.** Find the introducing commit before exploring the symptom.
3. **Always ask for screenshots, error messages, or reproduction steps** if I haven't given them.
4. **Root cause must have evidence.** "I think it's X" is not enough — find the line, the log, the failing test that proves it.

## The 8 steps

### 1. Gather details
Ask me for what you're missing:
- Observed behavior?
- Expected behavior?
- Reproduction steps?
- Environment (browser, OS, prod/dev/local)?
- Error messages, stack traces, logs?
- Screenshots if it's a UI issue?

If a Jira ticket or similar exists, ask for the link.

### 2. Summarize and confirm
Restate the defect cleanly:

```
Observed: <what's happening>
Expected: <what should happen>
Reproduction: <steps>
Environment: <where>
Severity: <my read>
```

Wait for me to confirm or correct before investigating.

### 3. Identify scope
Which subsystem? Which files? Which recent changes might have introduced this? Run `git log --oneline -20` and check for recent merges that touch the area.

### 4. Investigate code
- Search for the UI element, error message, or function name involved
- Trace data flow: input → validation → processing → output
- Check whether the code path is even being hit (logs, breakpoints, tests)
- Read related tests to see what behavior is verified

### 5. Root cause
Present findings:

```
Root cause: <one sentence>
Evidence: <specific file:line, log entry, failing assertion>
How it broke: <causal chain>
Why tests didn't catch it: <gap analysis>
```

Wait for me to approve before fixing.

### 6. TDD fix plan
For each broken behavior, define a RED-GREEN cycle:
- **RED**: a failing test that asserts the correct behavior
- **GREEN**: minimum code change that makes the test pass

Plan vertical slices, not "all tests then all code." Each slice should leave the system in a working state.

### 7. Save fix plan
For non-trivial defects, write the plan to `.agent/plans/<defect-id>-fix.md`:

```markdown
# Fix Plan — <defect-id>

## Problem
<from step 2>

## Root cause
<from step 5>

## TDD plan
1. RED: <test description>
   GREEN: <code change>
2. ...

## Acceptance criteria
- [ ] <verifiable condition>
```

### 8. Implement
Execute each RED-GREEN cycle in order. Run tests after each. After all cycles pass, run the full STANDARDS.md gate suite. Update PROGRESS.md.

## Common patterns

- **"It was working before"** → start with `git log` and find the commit since last known good
- **"Test is flaky"** → look for timing assumptions, shared mutable state, order-dependent fixtures
- **"Works locally, fails in CI"** → environment differences (env vars, paths, file casing on Linux vs Windows)
- **"Works in dev, fails in prod"** → load, real data shapes, race conditions that don't surface at low concurrency

## Anti-patterns

- **Don't shotgun-fix.** Multiple speculative changes at once make it impossible to know which one helped.
- **Don't fix the symptom and skip the root cause.** Patching the visible failure often leaves the underlying bug to resurface elsewhere.
- **Don't trust "obvious" causes without evidence.** First hypothesis is often wrong. Verify before fixing.
