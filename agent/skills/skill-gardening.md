---
name: gardening
description: Config-driven memory gardening — review, clean, demote, compress, and report on your agent's memory files. Replaces promote-lessons.
triggers:
  - "garden"
  - "gardening"
  - "clean up lessons"
  - "review memory"
  - "what's stale"
  - "prune"
  - "promote lessons"
  - "memory over budget"
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
   (all writes were already printed as proposals in step 2 — the contract
   guarantees zero fs operations).

This pattern is mandatory. A pass that writes during the decide phase has
broken the gate — the confirmation happens after writes already landed, making
the gate a rubber-stamp and making --dry a lie.

## Safety contract — read and acknowledge before executing

Before executing any pass, you MUST acknowledge this contract aloud in your
response:

> "I am running /skill:gardening. I have read garden.json. I understand that
> --dry mode means ZERO file writes, moves, or deletes — I will print proposed
> changes only. I will check the deny-list (resolved absolute against harnessRoot)
> before every fs write, move, or delete operation. I will redirect transient
> artifacts to scratchDir if they don't land in an allowed directory. I will
> gate every gated pass with a per-pass y/n confirmation — no batching."

If `--dry` is active, add: "DRY RUN — no files will be modified."

## File paths and resolution

**Denied paths** (from `garden.json → paths.denied.paths`):
Expand each against `harnessRoot` (`~/.pi`) into an absolute prefix ONCE at load.
Before any fs write/move/delete: `path.resolve(target)` to absolute, then
`startsWith(expandedDeniedPrefix)`. If match → abort, report, do not proceed.

Exempt: Pass 7 (break-in review) — its proposals are advisory-only and
human-applied. Pass 8 (report) — writes only to allowed dirs (checked separately).

**Allowed paths** (from `garden.json → paths.allowed`):
Project-cwd-relative. Before any create/write of a transient artifact:
`path.resolve(target, projectCwd)` then verify `startsWith(resolvedAllowedDir)`.
If not → redirect to `scratchDir` (`paths.allowed.scratchDir`).

**Harness root** is always `~/.pi` — `path.resolve(os.homedir(), '.pi')`.

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

**Must check:** deny-list before LESSONS.md write (LESSONS.md is allowed). Allowed-dir check before creating/updating lesson-stats.json.

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

**Must check:** deny-list before LESSONS.md write. Allowed-dir check for stats.

## Pass 3 — Demote

**Autonomy:** gated

Evaluate every lesson for demotion. Rules:
- Read `lesson-stats.json` for decay scores and hit counts.
- Candidate: `decay < garden.json.decay.candidateBelow` AND not in grace period
  (`sessions since added > garden.json.decay.graceSessions`) AND not an anchor.
- Low-confidence + high-hits items: surface as **rewrite-first** flags, NOT demote
  candidates. Pattern: "this lesson is cited often but the text may be wrong —
  review and rewrite before considering demotion."
- For each genuine candidate: show lesson, decay score, hit count, last used.
  Ask: demote (remove from LESSONS.md, archive), keep, or rewrite.

If telemetry.jsonl or lesson-stats.json is missing/empty: skip this pass with
"Not enough telemetry data for demotion — skipping."

**Must check:** deny-list before LESSONS.md write. Allowed-dir check for archive.

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

**Must check:** deny-list before LESSONS.md write.

## Pass 5 — Progress horizon

**Autonomy:** auto (from garden.json)

Archive old PROGRESS.md entries. Rules:
- Newest `garden.json.progress.verbatimSessions` sessions: keep verbatim.
- Older than that but within `garden.json.progress.archiveAfterDays` days: keep
  one-line summary per session.
- Older than `archiveAfterDays`: move to `.agent/archive/PROGRESS-YYYY-MM.md`.
- Write the compacted PROGRESS.md back to disk.

**Must check:** deny-list before PROGRESS.md write. Allowed-dir check for archive files.

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
- Never touch anything under denied paths. The deny-list check is mandatory here —
  sweeps move files, and a misfire on a denied path is the worst plausible outcome.

**Must check:** deny-list before EVERY move. This is the highest-risk pass.
Before touching any file: resolve to absolute, check against expanded denied prefixes.
Abort on match. Allowed-dir check for archive destinations.

## Pass 7 — Break-in review

**Autonomy:** n/a — advisory only (deny-list exempt)

Review skills with `break-in` status and ≥2 logged runs. Rules:
- Read telemetry.jsonl for skill invocation history (scan `harness.skills` field
  across running records).
- For each break-in skill: summarize its invocation patterns, typical session
  context, and any issues observed.
- Propose SKILL.md edits (triggers, description, process refinements).
- **All proposals are advisory.** Skill files are on the deny-list — gardening
  cannot write them. Print proposals for human review and manual application.
- Update break-in status in garden.json when a skill graduates.

This pass is EXEMPT from the deny-list write check because it never writes to
denied paths — it prints proposals only. If telemetry.jsonl is missing: skip.

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

**Must check:** allowed-dir check before report write (reportsDir is allowed).

## Quick reference

| Flag | Effect |
|------|--------|
| `--dry` | Print all proposed changes. Zero writes, moves, or deletes. Must acknowledge contract. |

| Autonomy | Behavior |
|----------|----------|
| `auto` | Execute without confirmation |
| `gated` | Present changes, ask per-pass y/n. Never batch. |

## Deprecation notice

This skill replaces `promote-lessons`. If you arrived here via `/skill:promote-lessons`:
that skill is now a pointer to gardening. Use `--pass intake` to review pending lessons,
or run the full gardening session for a complete memory review.

## Anti-patterns

- **Never skip the deny-list check.** Every pass that writes/moves/deletes must
  resolve the target to absolute and check against expanded denied prefixes.
  The check is repeated in every pass for a reason — context drift in long sessions.
- **Never batch gate confirmations.** Each gated pass is a separate y/n. Batching
  collapses multiple decisions into one rubber-stamp.
- **Never write to denied paths.** If a target matches the deny-list, abort. Do not
  "redirect to scratchDir" — denied means denied.
- **Never write transient artifacts to the harness root or agent/.** Use allowed
  directories or scratchDir. If a target doesn't match an allowed prefix, redirect.
