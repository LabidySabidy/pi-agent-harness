---
name: scaffold
description: Bootstrap a new project — discovery flow plus VISION/LANGUAGE/PLAN/TASKS files seeded with real content
triggers:
  - "scaffold"
  - "bootstrap"
  - "new project"
  - "init project"
  - "starting a new app"
  - "begin a new project"
---

# Skill: Scaffold (New Project Bootstrap)

## When to load
- I say "scaffold," "bootstrap," "new project," or similar
- I describe wanting to start a new app and there are no project files yet

## What this skill does
First triage whether this is a small/throwaway tool or a real maintained product — then run the appropriate discovery flow and produce the right files. Templates live at `~/.pi/agent/templates/`.

## Hard rules
1. **No code or directory structure until VISION + PLAN are agreed.** Discovery first, scaffolding second.
2. **Use templates from `~/.pi/agent/templates/`.** Read them, populate, don't reinvent the structure.
3. **Show proposed content before writing each file.** Wait for approval per file.
4. **Apply Simplicity First.** No speculative features in v1.

## Triage (ask this first, before anything else)

> "Is this a small/throwaway tool (scripts, CLIs, one-off automations under ~300 lines), or a real product you'll maintain and grow over time?"

**Small/throwaway path:**
- Skip VISION.md and LANGUAGE.md entirely.
- Produce only: a brief PLAN.md (3–5 bullet points, no phases) and a TASKS.md (still use `Done when:` per task — it's one sentence, even for throwaway work).
- End with: "Want to validate the riskiest bit first? `/skill:spike`"

**Real-product path:**
- Run the full 5-question discovery flow below, then produce all five files.

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

1. **VISION.md** — populated from discovery answers. Show first, get approval, then write.
2. **LANGUAGE.md** — seeded with terms that emerged in discovery. Will grow during work.
3. **PLAN.md** — phases for v1 only. Don't plan v2/v3 here. Phases small and end-to-end useful.
4. **TASKS.md** — concrete tasks for Phase 1 of v1 only. Don't fill in future phases. Every task must have a `Done when:` criterion. `Estimate:` is optional.
5. **PROGRESS.md** — empty template, ready for first session-end summary.

For each file: show proposed content → wait for approval → write to project root.

## Tech stack defaults

When I don't specify, default to my primary stacks (from global AGENTS.md):
- **Backend (substantial)**: Java + Spring Boot
- **Frontend**: React (or Angular if I prefer)
- **Lightweight backend**: Python + Flask
- **DB**: SQLite for local-first apps, Postgres for multi-user
- **Deploy**: Railway or Render

If I request something outside these, push back gently once ("you usually use X — sticking with it, or different reason?") then defer to my answer.

## After scaffolding

End with a summary of what was created and a recommended first concrete task. Suggest invoking `/skill:plan-then-implement` for the first task, or `/skill:grill` if the v1 design feels uncertain.

## Anti-patterns

- **Don't run the full discovery flow for a 300-line script.** The triage exists for this reason — use it.
- **Don't scaffold without discovery.** Even a one-paragraph brief needs the constraints question.
- **Don't write all five files in one shot.** File-by-file approval catches drift early.
- **Don't pad VISION with future-state aspirations.** Capture v1 reality. v2 lives in TASKS or a separate doc.
