<!-- PROJECT LESSONS TEMPLATE — Used by /skill:scaffold when bootstrapping a new project. Lives at agent/templates/LESSONS.md. Not to be confused with agent/LESSONS.md.template (global personal-lessons seed). -->
# Lessons Learned — <Project Name>

> Project-specific patterns, danger zones, and gotchas. Loaded at session start.
> Cap at ~12k chars; consolidate or archive when approaching the limit.
> The `extract-patterns` hook (when active) proposes additions; you approve before commit.

## Danger zones

Files or operations that consistently cause problems. State the failure mode and the workaround.

- **<file or operation>** — <what goes wrong, and how to avoid it>

## Merge conflict patterns

Files that consistently conflict during rebases/merges, with resolution guidance.

- **<file path>** — <which side typically wins, or how to merge>

## State management gotchas

Closure traps, stale state, hydration mismatches, race conditions.

- **<symptom>** — <root cause and fix pattern>

## Component / library quirks

Specific framework or library gotchas observed in this codebase.

- **<library>: <component>** — <quirk and workaround>

## Pipeline / build / test issues

CI gotchas, environment differences, flaky tests, build cache problems.

- **<symptom>** — <cause and fix>

## API / mock maps

What's mocked vs. real in tests, dev environments, and previews.

| Surface | Test env | Dev env | Prod env |
|---|---|---|---|
| <API or service> | mock/real/stubbed | ... | ... |

## Decisions made

One-line records of past architectural choices and their rationale. Lets future sessions understand why things are the way they are.

- **<date> — <decision>** — <rationale, and what we considered instead>

## Anti-patterns to avoid

Things that have been tried and don't work in this codebase, with brief explanation.

- **<anti-pattern>** — <why it failed when tried>
