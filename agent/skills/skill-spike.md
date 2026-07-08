---
name: spike
description: Throwaway prototype to validate the riskiest technical assumption before committing to a full plan. Use for a spike, prototype, proof of concept, feasibility check, throwaway script, or can-this-even-work question.
triggers:
  - "does this even work"
  - "can we even"
  - "is it possible to"
  - "not sure if"
  - "wonder if this"
  - "before we commit"
  - "before I invest"
  - "before building"
  - "before we build"
  - "quick test"
  - "quick script"
  - "quick and dirty"
  - "scratch script"
  - "rough test"
  - "sanity check"
  - "test the waters"
  - "see if this works"
  - "check if this is possible"
  - "does the API"
  - "will this library"
  - "validate this"
  - "validate the approach"
  - "experiment"
  - "try this out"
  - "try before"
---

# Skill: Spike (Technical Feasibility Validation)

## When to load
- I say "spike," "proof of concept," "throwaway script," or similar
- I describe uncertainty about whether something is technically feasible
- I want to validate an API, library, data shape, or integration before committing to a plan
- I say "not sure if," "wonder if," "can we even," or "before we build" about a technical approach
- The model self-selects this skill from its description for feasibility checks or uncertain assumptions

## What this skill does
Identify the single riskiest technical assumption, write the smallest possible throwaway script that proves or disproves it, run it, and decide: proceed, pivot, or kill.

## Hard rules
1. **One question per spike.** A spike answers exactly one technical uncertainty — not two, not "and while we're at it."
2. **Throwaway code.** No error handling, no tests, no structure, no comments beyond what's needed to run it. It runs once and teaches us something.
3. **15-minute cap.** If the spike itself is complex enough to need a plan, the approach is wrong — simplify the question.
4. **Run it.** A spike that isn't executed is just speculation. Run the script, capture the output.
5. **Decide explicitly.** End with PROCEED / PIVOT / KILL. No "it sort of works, let's see."
6. **Fold learnings forward.** If proceeding, note what we learned as input to the upcoming PLAN.md or LESSONS.md.

## Workflow

### Step 1 — Identify the risky assumption
Ask (if not obvious from context):
> "What's the one thing that, if it doesn't work, kills the whole approach?"

Common spike targets:
- Can this API return what we need? (auth, rate limits, data shape)
- Does this library actually support our use case?
- Can we hit acceptable performance with this approach?
- Does the data look like we think it does?
- Can these two systems talk to each other at all?

State the assumption as a falsifiable sentence: **"We assume X will do Y when given Z."**

### Step 2 — Write the minimal script
- Single file. Any language fastest to validate with — don't default to the project's stack if a shell one-liner proves it faster.
- Hardcode everything. No config, no env file unless the credential is literally unavoidable (API key).
- Shortest path to an answer. If 3 lines of `curl` prove it, don't write Python.
- Location: project root or a temp path — `spike-<topic>.{ext}`. Doesn't matter; it's throwaway.

### Step 3 — Run it and capture output
Execute the script. Show stdout/stderr verbatim. Note: did it prove or disprove the assumption?

### Step 4 — Decide
Present the verdict in this format:

```
## Spike result: <assumption in one line>

**Outcome:** PROVED / DISPROVED / PARTIAL

**Evidence:** <what the output actually showed>

**Decision:** PROCEED / PIVOT / KILL

**Learnings for plan:**
- <concrete fact we now know>
- <constraint or gotcha discovered, if any>
```

### Step 5 — Clean up and hand off
- **PROCEED** → suggest `/skill:scaffold` (new project) or `/skill:plan-then-implement` (existing project). Surface the learnings so they land in PLAN.md.
- **PIVOT** → restate the revised approach and offer to spike again on the new risky assumption.
- **KILL** → state why clearly. Save a one-paragraph note to `.agent/grill/spike-<topic>.md` so we don't retry the same dead end later.
- Delete the spike file unless I say to keep it.

## Anti-patterns

- **Don't spike the whole feature.** A spike answers one question. Multiple files = you're building, not spiking.
- **Don't polish spike code.** The moment you add error handling or structure, you're anchoring on throwaway code. Stop.
- **Don't skip running it.** "I think this would work" is not a spike result. Execute it.
- **Don't spike the obvious.** If the answer is in the docs and confirmable in 30 seconds, read the docs.
- **Don't let spike code survive into the real implementation.** It's evidence that informed a decision — not a foundation to build on.
