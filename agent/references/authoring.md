# Authoring Reference

> Consulted when writing, editing, or debugging skills and extensions.
> This file is NOT loaded every session — it lives on the shelf and is
> read on-demand when the trigger applies. Relocated from AGENTS.md to
> reduce per-session boot cost.

## File layout reference

**Global** (`~/.pi/agent/`):
- `AGENTS.md` — this file
- `STANDARDS.md` — default gates + capability mapping
- `LESSONS.md` — cross-project gotchas, danger zones, anti-patterns
- `skills/` — global skills, invocable as `/skill:name`

**Per project** (`<project>/`):
- `AGENTS.md` — project preamble overrides (create only when overriding global defaults)
- `STANDARDS.md` — project gate overrides (create only when overriding global defaults)
- `VISION.md` — what the app is
- `PLAN.md` — current phase and approach
- `TASKS.md` — task list with checkboxes
- `PROGRESS.md` — rolling session summaries
- `LESSONS.md` — danger zones, gotchas, mock maps
- `.agent/tasks/T-XXX/` — per-task contracts and artifacts (once contract-gen is active)
- `.agent/archive/` — historical PLAN.md snapshots archived on merge/PR success
