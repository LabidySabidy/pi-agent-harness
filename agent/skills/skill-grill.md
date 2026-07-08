---
name: grill
description: Adversarial design interrogation — walk the design tree before non-trivial implementation. Use when asked to grill me, poke holes, red team, stress test, challenge a design, or find flaws.
---

# Skill: Grill (Adversarial Design Interrogation)

## When to load
- I explicitly say "grill me," "poke holes," "red team this," or similar
- I describe a non-trivial implementation plan and you sense ambiguity, hidden assumptions, or scope drift
- The model self-selects this skill from its description when a design or plan is described

## What this skill does
Force a shared design concept before any code is written. You play adversarial system architect, walking down branches of the design tree until either: (a) we have a coherent plan with explicit assumptions, or (b) we discover the plan is wrong and need to back up.

## Hard rules
1. **Never write code while grilling.** Grilling ends with "ready to implement?" — until then, no implementation.
2. **One area of focus per round.** Don't fan out into ten questions. Ask 2-4 sharp questions on the most load-bearing assumption first.
3. **Every criticism comes with a concrete suggestion.** Identify problems, propose paths through.
4. **Surface tradeoffs explicitly.** When the answer is "it depends," name what it depends on.
5. **Save findings to disk.** Append to `.agent/grill/<topic>.md` so the design concept persists across sessions.

## Interrogation dimensions

Walk through these in roughly this order. Skip dimensions clearly N/A; spend more time where assumptions are weakest.

### 1. Goal clarity
- What's the actual outcome we're optimizing for?
- Who's the user/caller of this thing?
- How will we know it's working?

### 2. Assumptions
- What are we assuming about input data, environment, upstream/downstream systems?
- Which assumptions, if false, would invalidate the whole approach?
- Are any untested?

### 3. Failure modes
- What happens with empty / malformed / huge input?
- What happens when an external dependency is down / slow / rate-limited?
- What happens on partial success?
- What's the worst plausible outcome and how do we detect it?

### 4. Scope and boundaries
- What's deliberately out of scope?
- What does "done" look like — concrete, verifiable?
- What's the smallest version that proves the approach works?

### 5. Integration points
- What does this connect to upstream and downstream?
- What contracts (data shape, rate, error format) does it honor?
- What breaks when we change those contracts?

### 6. Performance and scale
- Expected load? Failure mode at 10x?
- What can we measure to know we're approaching limits?

### 7. Testing
- How do we verify each acceptance condition?
- What's hard to test, and is that telling us something?
- What test gives the highest signal per minute spent writing it?

### 8. Risk ranking
At the end, rank discovered risks: CRITICAL / HIGH / MEDIUM / LOW. Each with a concrete recommendation.

## Output format

After the dialog, produce a structured summary saved to `.agent/grill/<short-topic-name>.md`:

```markdown
# Design Concept — <topic>

## Goal
<one sentence>

## Approach
<2-4 sentences>

## Assumptions (with confidence)
- HIGH: <assumption> — <why we trust it>
- MEDIUM: <assumption> — <how we'd validate it>
- LOW: <assumption> — <test before relying on it>

## Risks (ranked)
- CRITICAL: <risk> → <recommendation>
- HIGH: <risk> → <recommendation>
- MEDIUM: <risk> → <recommendation>

## Out of scope
- <thing>

## Open questions
- <question, if any remain>

## Ready to implement?
Yes / No / Need more info on <thing>
```

If skill-plan-then-implement loads next, it should reference this file in PLAN.md's **References** section. Link both ways — grill records are findable from PLAN.md, and PLAN.md is traceable back to the grill session that informed it.

## Anti-patterns

- **Don't grill for grilling's sake.** If the change is genuinely trivial (single-file mechanical edit, copy-paste from existing pattern), don't load this skill.
- **Don't ask questions I've already answered.** Read the conversation and existing files first.
- **Don't accept "it should work" as an answer.** Push for "here's the specific evidence."
