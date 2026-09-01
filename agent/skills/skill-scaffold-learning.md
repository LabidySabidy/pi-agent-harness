---
name: scaffold-learning
description: Onboarding advisor that interviews the user, deconstructs a topic into a 20-hour sequenced curriculum, and instantiates the local .agent/learning/ files. Use when the user says "start learning", "onboard topic", "scaffold syllabus", "deconstruct skill", or wants to set up a new learning project.
---

# Skill: Scaffold Learning (Advisor)

## When to load
- I say "start learning", "onboard topic", "scaffold syllabus", "deconstruct skill", or similar
- I want to begin studying a new topic/codebase and need a plan
- The model self-selects this skill when a new learning project is starting

## What this skill does
Play the Advisor: run a four-question onboarding interview (Destination, Baseline, 20-hour deconstruction, Cut List), then instantiate the project's local learning files from the global templates. Never dump a pre-made syllabus.

## Hard rules
1. **No pre-made syllabus.** Interview first. Refuse to write any files before the four answers are collected and the user approves the plan.
2. **One question at a time.** Ask Destination, then Baseline, then Deconstruction, then Cut List. Never batch them into one message.
3. **Atomic sub-skills only.** Deconstruction yields the smallest units that can be practiced in one sitting and drive ~80% of results toward the destination.
4. **Write files only after approval.** Show the complete deconstructed plan, get explicit sign-off, then instantiate.

## Workflow

### Step 0 — Align the template contract (idempotent)
- `read` `~/.pi/agent/templates/learning/SCHEMA.md.template` and confirm its Telemetry Contract uses bare-emoji `status` (🟥/🟨/🟩/🟦) and the sm2 shape `interval` / `ease_factor` / `repetitions`.
- If it still says text like `"🟨 Fair"`, `edit` it to the bare-emoji format before continuing.

### Step 1 — Destination
- Ask: "What do you want to be able to do or build at the end of your first 20 hours?"
- Ground the answer in a concrete deliverable — a PR, a working feature, a refactor — not "understand X".

### Step 2 — Baseline
- Ask: "What's your current baseline? Have you touched this stack/topic before, or are you starting from zero?"
- Record what they can already explain versus what is genuinely new.

### Step 3 — The 20-hour deconstruction
- With Destination and Baseline in hand, propose atomic sub-skills. Ask the user to confirm or adjust which sub-skills are the most critical and will yield ~80% of the results.

### Step 4 — The Cut List
- Ask what to intentionally ignore for the first 20 hours: advanced, complex, or low-yield concepts. Force explicit exclusions to prevent cognitive overload.

### Step 5 — Approval
- Present the complete plan (Destination, Baseline, sub-skill list, Cut List). Get explicit approval before writing anything.

### Step 6 — Instantiate files
After approval, using filesystem tools (`read` + `write`, or `bash cp`):
1. Create `<project>/.agent/learning/` relative to the active workspace cwd.
2. Copy the global templates from `~/.pi/agent/templates/learning/` into that folder, renaming to `MISSION.md`, `PLAN.md`, and `SCHEMA.md` (drop the `.template` suffix).
3. Populate them fully:
   - `MISSION.md` — from the extracted Destination and motivations.
   - `PLAN.md` — a sequenced, week-by-week layout of the sub-skills, with the Cut List highlighted at the bottom.
   - `SCHEMA.md` — one concept card per deconstructed sub-skill, all initialized to ⬜ Unmeasured, with empty own-words definitions and SM-2 defaults (interval 0, ease_factor 2.5, repetitions 0).

## Telemetry / state
- This skill WRITES the initial `SCHEMA.md` (all ⬜). It does not emit `<learning-telemetry>` blocks — that is the grill/recitation skills' job.
