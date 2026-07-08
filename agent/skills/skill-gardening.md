---
name: gardening
description: Config-driven memory gardening — review, clean, demote, compress, and report on agent memory files. Use when it's time to garden, review memory, clean up lessons, prune stale content, promote lessons, or when memory is over budget. Replaces promote-lessons.
  - "consolidate progress"
---

# Skill: Gardening

Config-driven memory gardening. Eight passes that review, clean, compress, and
report on your agent's memory files. Configured via `agent/garden.json` (global)
with per-project `.agent/garden.json` overrides.

## Gating pattern (mandatory for ALL gated passes)

No gated pass may interleave deciding and writing. The pattern is rigid:

1. **Decide** — walk candidates, collect every proposed change into a plan.
   Do NOT write anything yet. Do NOT modify any file.
2. **Present** — show the complete plan: what will be written, moved, deleted,
   and to which files.
3. **Gate** — ask "Execute pass <N> (<name>)? (y/n)". Wait for explicit y or n.
4. **Write** — ONLY on y, execute all changes. In --dry mode: skip this step
   (all writes were already printed as proposals in step 2).

This pattern is mandatory. A pass that writes during the decide phase has
broken the gate — the confirmation happens after writes already landed, making
the gate a rubber-stamp and making --dry a lie.

## Step 0 — Git safety check (mandatory)

Before executing any pass, run `git status --porcelain` in `~/.pi` and the
project cwd. If either is dirty, stop and ask the user to commit or stash.
Do not proceed on a dirty tree.

> /gardening is the recommended entrance — it enforces this check in code
> and blocks the pass from starting on a dirty tree. /skill:gardening goes
> through Pi's native door; this Step 0 is the prose guard on that path.

`--dry` mode means: decide and present, skip the write step. The real undo
is git — the tree was clean at start, so `git diff` after the run shows
every change gardening made to tracked files, and `git checkout .` undoes it.

## Gating UX

A pass with autonomy `"gated"` must:
1. Present its proposed changes. In --dry mode: print diffs. In live mode: print
   a summary of what will change.
2. Ask: "Execute pass <N> (<name>)? (y/n)"
3. Wait for explicit y or n. On y: execute. On n: skip this pass, move to next.
4. NEVER batch confirmations. Each gated pass gets its own y/n. The meter light
   admits one car at a time.

A pass with autonomy `"auto"` runs without confirmation.

## Pass 1 — Intake

**Autonomy:** gated (from garden.json)

Follow the gating pattern: decide → present → gate → write.

### Phase A — Decide

Walk `.agent/lessons-pending.md` one candidate at a time. For each:

1. Show category + text + context excerpt (if present as `> ` blockquote).
2. Ask: scope (project `p` or global `g`), anchor (`a` for yes), edit text if needed.
3. Generate the next ID (project: `L-NNN`, global: `GL-NNN` — read existing LESSONS.md
   to find the highest ID and increment).
4. Collect the candidate into the plan. Do NOT write yet.

### Phase A.5 — Migration check (separate gate)

If this is the first intake for a project LESSONS.md that uses old-style bullets
(no L-NNN IDs): ANNOUNCE the migration separately before intake proceeds. Show
what the old-style bullets will become. Ask "Migrate old-style lessons to L-NNN IDs? (y/n)"
— this is a separate gate from the intake gate. If approved, collect the
migration into the plan alongside the new candidates.

### Phase B — Present

Show the complete plan:
- N candidates accepted (project), each with generated ID, category, text
- M candidates promoted (global), each with generated GL-ID
- P candidates skipped
- Migration: X old-style bullets → L-NNN IDs (if applicable)

### Phase C — Gate

"Execute pass 1 (Intake)? (y/n)"

### Phase D — Write (only on y, skip in --dry)

Write accepted candidates to the respective LESSONS.md. Auto-create category
sections if missing. Remove accepted/skipped items from lessons-pending.md.

## Pass 2 — Merge

**Autonomy:** gated

Find near-duplicate lesson pairs. Criteria:
- Same scope (both project or both global)
- Similar text (case-insensitive substring or word-overlap > 70%)
- Different IDs

For each pair:
1. Show both lessons with full text and IDs.
2. Propose survivor (older ID) and absorb the absorbed ID.
3. Archive absorbed ID in `LESSONS.md` with `<!-- merged-into <survivor-id> -->`.
4. Update lesson-stats.json: transfer hits to survivor, mark absorbed as `merged-into`.

## Pass 3 — Demote (manual review)

**Autonomy:** gated

Walk lessons sorted by `last_used` ascending then `hits` ascending. For each:
- Show lesson ID, text, hit count, last used date.
- Decision: demote (remove from LESSONS.md, archive), keep, or rewrite.
- High-citation lessons whose text looks wrong: flag as **rewrite-first** —
  the prose may be inaccurate despite frequent use — before considering demotion.
- Anchor lessons are damage-preventing; give them extra scrutiny and never
  propose for removal.

If lesson-stats.json is missing/empty: skip this pass with
"No telemetry data for demotion — skipping."

**Must check:** git safety (Step 0 ran at start). Write to LESSONS.md; archive to .agent/archive/.

## Pass 4 — Compress

**Autonomy:** gated

Compress LESSONS.md if it exceeds budget. Rules:
- Only runs if `garden.json.budgets.observeMode` is `false`. If true: report current
  size vs budget and skip.
- Rank non-anchor lessons by: size (desc), hits (asc). Least-cited, longest-text
  lessons compress first.
- Compression: reduce body to ≤2 lines while preserving the core lesson. Ask for
  approval on each rewrite.
- Stop when file size ≤ budget or all compressible lessons exhausted.
- Report: bytes before/after, lessons compressed, tokens freed.

If LESSONS.md is already under budget: "LESSONS.md is within budget — nothing to compress."

## Pass 5 — Progress horizon

**Autonomy:** auto (from garden.json)

Archive old PROGRESS.md entries. Rules:

### Step 1 — Drop worthless entries

Before compacting, filter entries that add no value. Dropped entries move to
`.agent/archive/PROGRESS-dropped-YYYYMMDD.md` (never-delete applies — archive, don't delete).
Drop criteria (mechanical only — no interpretation, no reading body for intent):
- No date header (e.g., `## 1` stubs — malformed entries without a `YYYY-MM-DD HH:MM` prefix)
- Body is purely a code fence or hash paste with no prose (checkable without interpretation)
When unsure, compact rather than drop — a wrongly-compacted entry stays in the file;
a wrongly-dropped entry is gone. Bias toward keeping.

### Step 2 — Dormancy check

Before compacting: count how many entries are within `archiveAfterDays` days.
If **zero** entries are within that window, the project is dormant.

- **Dormant project:** STOP after Step 1. Only clean stale `session-in-progress`
  markers (killed-session artifacts). Leave all entries untouched — they're
  re-entry context for when you return. No compaction, no archiving.
  Windowing already makes old entries free at boot.
- **Active project:** proceed to Step 3. Compaction and archiving are safe
  because ongoing work supersedes old detail.

### Step 3 — Compact remaining entries

- Newest `garden.json.progress.verbatimSessions` REAL sessions: keep verbatim.
  Count only sessions that survived the drop step — a dropped entry does not
  consume a verbatim slot.
- Older than that but within `garden.json.progress.archiveAfterDays` days: keep
  one-line summary per session.
- Older than `archiveAfterDays` AND project is active: move to
  `.agent/archive/PROGRESS-YYYY-MM.md`. If project is dormant, these stay
  compacted in PROGRESS.md instead (see Step 2).
- Write the compacted PROGRESS.md back to disk.

## Pass 6 — Asset sweeps

**Autonomy:** auto (from garden.json)

Archive stale files. Never hard-delete — the "never delete" invariant means
everything moves to archive, nothing is removed. Archive gets pruned later under
a separate, longer horizon (archive rollups in future gardening runs).

Rules:
- Grill files in `.agent/grill/`: age > `garden.json.sweeps.grillMaxAgeDays` →
  move to `.agent/archive/grill-YYYY-MM/`.
- Spike files (`.agent/spike/` or throwaway artifacts): age > `sweeps.spikeMaxAgeDays` →
  move to `.agent/archive/spike-YYYY-MM/`. Spikes are throwaway by definition, but
  archive them anyway — deletion happens on a separate archive-pruning horizon.
- Session logs/session dirs (check `.agent/`, `agent/sessions/`, and any
  orphaned session directories): age > `sweeps.sessionLogMaxAgeDays` →
  move to `.agent/archive/sessions-YYYY-MM/`.
- Reports in `.agent/reports/`: EXEMPT from sweeps. Reports are durable records.

## Pass 7 — Break-in review

**Autonomy:** n/a — advisory only

Review skills with `break-in` status and ≥2 logged runs. Rules:
- Read telemetry.jsonl for skill invocation history (scan `harness.skills` field
  across running records).
- For each break-in skill: summarize its invocation patterns, typical session
  context, and any issues observed.
- Propose SKILL.md edits (description, process refinements).
- **All proposals are advisory.** Print proposals for human review and manual application.
- Update break-in status in garden.json when a skill graduates.

If telemetry.jsonl is missing: skip.

## Pass 8 — Report

**Autonomy:** auto

Print a summary of the gardening session:
- Passes executed and their outcomes (changes made, skipped, failed).
- Tokens freed per file (boot payload before/after).
- Action counts: lessons added, merged, demoted, compressed; files archived.
- Auto-action ledger: every auto pass lists what it did with timestamps.
- Pit-board line (one-line status for Phase 3 consumption):
  `ctx ▓▓▓░░ 42% (60% ⚑) │ $0.83 │ pace +38% │ ☀️ gates`

Write the full report to `reportsDir/gardening-report-YYYY-MM-DD-HHMM.md`.
Reports are durable (exempt from sweep passes) and live under `.agent/reports/`.

## Quick reference

| Flag | Effect |
|------|--------|
| `--dry` | Decide and present, skip writes. Git is the real undo — the tree was clean at start. |

| Autonomy | Behavior |
|----------|----------|
| `auto` | Execute without confirmation |
| `gated` | Present changes, ask per-pass y/n. Never batch. |

## Deprecation notice

This skill replaces `promote-lessons`. If you arrived here via `/skill:promote-lessons`:
that skill is now a pointer to gardening. Use `--pass intake` to review pending lessons,
or run the full gardening session for a complete memory review.

## Anti-patterns

- **Never batch gate confirmations.** Each gated pass is a separate y/n. Batching
  collapses multiple decisions into one rubber-stamp.
- **Never start gardening on a dirty git tree.** Step 0 checks this; skipping it
  means git can't undo the run.
