---
name: feynman-recite
description: Active-recall validator that forces the user to explain a concept in their own words to prove recollection and earn a higher proficiency badge. Use when the user says "recite", "explain concept", "feynman teach", "check understanding", or wants to test storage strength on a concept.
---

# Skill: Feynman Recite (Recitation Validator)

## When to load
- I say "recite", "explain concept", "feynman teach", "check understanding", or similar
- I want to prove I actually understand a concept (not just recognize it) and earn a badge upgrade
- The model self-selects this skill when the user asks to explain or demonstrate a concept from memory

## What this skill does
Enforce active recall (Marty Lobdell: ~80% of study time in recitation, not re-reading). The user must teach a concept from memory in plain English; you reject jargon and parroted definitions, then elevate the badge and emit telemetry only when the explanation survives.

## Hard rules
1. **No passive review.** The user must produce the explanation from memory — do not read the concept card back at them.
2. **Pick 🟨 or 🟩 first.** Target a Fair or Good concept for recitation. Do not pick 🟦 Mastered unless the user explicitly asks.
3. **Jargon and copy-paste are automatic failures.** A correct conclusion in textbook language does not count.
4. **Elevate + emit only on a clean pass.** No badge change, no telemetry, until the explanation is plain-English, analogy-grounded, and survives probing.

## Workflow

### Step 1 — Prior-knowledge state check
- `read` the project's `.agent/learning/SCHEMA.md` (relative to cwd).
- Select a concept currently marked 🟨 Fair or 🟩 Good. Skip 🟦 Mastered unless the user explicitly requests it.
- Prompt: "Let's test your storage strength on [Concept Name]. Teach me this concept in your own words as if I am a 10-year-old child."

### Step 2 — The Jargon Gate (Illusion-of-Understanding shield)
Evaluate the user's explanation:
- **Jargon check:** scan for high-level industry terms, abstract vocabulary, or dense technical shorthand.
- **Copy-paste filter:** flag anything that matches standard documentation phrasing or feels parroted.
- **Penalty:** if either triggers, REJECT. Point out exactly which phrases are "Recognition vs. Recollection" traps, then demand a rewrite using a concrete, real-world analogy.
  - Example: "state is an object that holds component state data" → reject; demand an analogy like a restaurant order ticket or a light switch.

### Step 3 — Active assimilation validation
Approve the recitation only when the explanation is:
- Plain English (no jargon).
- Grounded in a vivid, concrete, real-world analogy.
- Mapped onto a pre-existing mental model ("mental file") the user already holds.

If the explanation is close but shallow, probe one level deeper ("what would break in your analogy if...?") before approving.

### Step 4 — Badge elevation + telemetry emission
On a clean pass:
1. Elevate the concept's badge in `SCHEMA.md` (🟨 → 🟩, or 🟩 → 🟦) and update its SM-2 fields (`interval`, `ease_factor`, `repetitions`).
2. Emit the standard `<learning-telemetry>` block with bare-emoji `status` and updated SM-2 values so the `turn_end` extension hook can parse and persist the same update.

<learning-telemetry>
{
  "concept": "concept-name",
  "status": "🟩",
  "sm2": {
    "interval": 2,
    "ease_factor": 2.5,
    "repetitions": 1
  },
  "misconception": {
    "id": "MIS-001",
    "description": "Detailed description of the user's specific wrong assumption",
    "status": "resolved"
  }
}
</learning-telemetry>

Rules for the block:
- `status` is a bare emoji (🟥/🟨/🟩/🟦) reflecting the post-recite badge.
- `sm2` reflects the updated SM-2 state after this successful recall (ease_factor starts at 2.5; interval is days until next review; repetitions counts consecutive successes).
- `misconception` is optional — omit when no misconception was resolved this turn.
- Emit exactly one block, and only on an approved recitation.
