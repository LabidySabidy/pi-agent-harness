---
disable-model-invocation: true
name: scaffold-learning
description: Onboarding advisor for a learning project — interview the user, deconstruct a topic into a 20-hour curriculum, set up .agent/learning/ files. Explicit invocation only (hidden from the model). Not for bootstrapping a code project (scaffold).
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
5. **The learner's title wins.** The `#` heading of `MISSION.md` is the course's NAME — the app slugs it into the directory, the URL and the catalogue. Someone may already have set it. Step 7 is the only time you may write it, and only under the condition stated there.

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

### Step 7 — Name the course

The last thing you do, after the mission is settled. The heading is not decoration: the app derives the
course's slug, its directory, its URL and its catalogue entry from that one line, so a good title is a
real deliverable and a bad one becomes a folder name.

1. `read` `MISSION.md` and look at the first `#` line.
2. **If that line is still the seeded subject** — the learner's own words from the "Start a course" form,
   typically a sentence or a topic phrase — you have the pen. Propose a short, elegant title and write it
   as the H1:
   - **2–5 words.** It is a name, not a goal. The goal lives in `## Destination` and stays there.
   - **In the learner's vocabulary.** They have just spent this whole conversation telling you what they
     care about; use their words for it, not the textbook's. If they said "make the slow endpoint fast",
     the title is "Slow Endpoint Triage", not "Query Optimization Fundamentals".
   - **A noun phrase, title case, no trailing period**, no "Introduction to", no "Mastering".
   - Say the title back to them in one line so they can object — then write it.
3. **If that line is NOT the seeded subject** — the learner has already changed it, from the app or by
   hand — then **the learner has taken the pen and you must not write it.** Propose your title in
   conversation instead ("I'd call this *Wheel Alignment by String* — want it?") and let them set it.
   Overwriting a name someone chose mid-interview is never right, and you cannot tell the difference
   between their edit and yours by looking at the file, so the comparison in step 2 is what decides it.
4. If `MISSION.md` has no `#` line at all, add one at the top, above the blockquote.

The app watches for this: the next time it reads the course it renames the directory to match the new
heading. Do not move directories yourself, and do not add any alias or "old name" record.

## Telemetry / state
- This skill WRITES the initial `SCHEMA.md` (all ⬜). It does not emit `<learning-telemetry>` blocks — that is the grill/recitation skills' job.
