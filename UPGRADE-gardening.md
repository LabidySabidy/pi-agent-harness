# GARDENING UPGRADE — Windows PC Implementation (Executable)

**Executor:** Pi agent on Kasim-PC, session opened at the harness root `~/.pi`
**Reference PRD:** PRD-gardening-upgrade.md (v1.0) — this document operationalizes it
**Kickoff:** paste/place this file at `~/.pi/UPGRADE-gardening.md`, then tell Pi:
*"Read UPGRADE-gardening.md. Set up the project tracker (§B), then execute Phase 0a and stop."*

---

## A. Operating mode — this upgrade IS a scaffold project

Before touching anything else, apply the harness's own methodology to the upgrade itself:

1. Create `PLAN.md` at the harness root: a short plan derived from the phases below (goals, sequencing, risks).
2. Create `TASKS.md` at the harness root: every numbered task from this document as a checkbox line, grouped by phase, statuses `[ ]` todo / `[~]` in progress / `[x]` done / `[!]` blocked-with-note.
3. Append the **Definition of Done (§H)** to the bottom of TASKS.md as its own checklist.
4. **After every completed task:** update TASKS.md immediately. PROGRESS.md updates flow through the existing session-summary extension as normal.
5. **At every phase boundary:** run a *DoD reconciliation* — re-read §H, mark newly-satisfied items with one line of evidence (file path, test output, commit hash), list remaining gaps — then STOP and present the phase report + reconciliation for human review. Do not start the next phase without approval.
6. On final completion, branch-hygiene archives PLAN.md/TASKS.md per its normal merge flow.

## B. Ground rules (non-negotiable)

1. **Sequencing:** Phase 0a fixes land as individual commits on `main` (they're baseline corrections both machines need). After 0a, cut branch `feature/gardening`; Phases 0b–4 happen there. One commit per phase minimum; acceptance gates green before each commit.
2. **Never delete — move.** Any content removal goes to an archive location with ID/date/reason. Backups of any memory file precede its first rewrite (`~/.pi/.agent/archive/pre-gardening-YYYYMMDD/`).
3. **Do not touch** `agent/extensions/telepi-handoff.ts` or `~/.pi/TelePi/` — they belong to the TelePi package, not the harness. Never modify, track, or relocate them.
4. **Fail-open instrumentation.** All telemetry code wrapped in error handling; failures append to `.agent/telemetry-errors.log` and the session continues. A broken profiler must never take down the car.
5. **No LLM calls in session hooks.** Model calls (DeepSeek via existing OpenRouter path) are allowed only inside explicit gardening passes that need judgment. Everything countable, movable, or matchable is done with scripts/regex/file ops — housekeeping that spends heavy tokens defeats itself.
6. **Repo beats spec.** Where this document contradicts observed reality, trust the repo, adapt, and log the deviation in the phase report.
7. Note for context: TelePi sessions are ordinary Pi sessions — the telemetry extension will and should capture them. `/handoff` deliberately kills sessions; the journal-recovery design (Phase 1) exists partly for this.

---

## Phase 0a — Pre-flight (on `main`)

**T1. Commit the deliberate local improvements.**
Review and commit as two commits:
- `classifier-router/index.ts` → msg: `router: add branch-hygiene/promote-lessons/spike to AVAILABLE_SKILLS; tighten scaffold triggers; null-return for approvals/meta`
- `skill-scaffold.md` → msg: `scaffold: auto GitHub+Vercel on real-product path; Playwright E2E; write-verification heredoc fallback; new triggers + anti-patterns`

**T2. Relocate stray utility scripts.** Create `~/scripts/`; move `check-size.ps1`, `drill.ps1`, `recent-files.ps1` there. They are disk-audit one-offs, not harness code.

**T3. Update Pi to ≥0.74** using Pi's own update mechanism. Verify version. Then update imports in the three core extensions (`classifier-router`, `extract-patterns`, `session-summary`) from `@mariozechner/pi-coding-agent` → `@earendil-works/pi-coding-agent`. Start a test session; confirm all extensions load and the router still routes. Commit: `extensions: migrate to @earendil-works package scope (Pi 0.74)`.

**T4. .gitignore surgery.** Edit to:
- REMOVE the `agent/extensions/` ignore rule (extensions are core harness code — the old rule silently orphaned every new extension)
- ADD: `agent/extensions/telepi-handoff.ts` (TelePi-owned), `TelePi/`, `test-results/`, `*.ps1`, `/PROGRESS.md`, `/PLAN.md.archive`, `.agent/`
- KEEP: `agent/auth.json`, `agent/sessions/`, `agent/bin/`
Verify with `git status --ignored` that intent matches reality. Commit.

**T5. README corrections.** (a) extract-state filename is `.agent/.extract-state.json` — leading dot, both mentions consistent; (b) document the real extension events in the extensions table (`input`, `session_start`, `agent_end`, `session_shutdown`); (c) remove LANGUAGE.md from the templates list (see T7). Commit.

**T6. Fix the PROGRESS read-direction bug.** In global `AGENTS.md`, the protocol says to read the *last* 50 lines of PROGRESS.md; session-summary writes newest-first, so boot reads the oldest entries. Change to "read the FIRST 50 lines." One line. Commit.

**T7. Retire LANGUAGE.md.** Grep `agent/skills/`, `agent/extensions/`, `AGENTS.md`, `README.md` for `LANGUAGE`. If references exist, update them to point at VISION.md's glossary section. `git rm agent/templates/LANGUAGE.md`. Commit: `templates: retire legacy LANGUAGE.md (glossary lives in VISION.md)`.

**T8. Cut `feature/gardening`.**

**Phase boundary:** DoD reconciliation + STOP.

---

## Phase 0b — Verification (on branch)

**T9.** Inspect the installed `@earendil-works/pi-coding-agent` package (types/docs in node_modules) and record in `VERIFICATION.md` at repo root:
- Full list of extension lifecycle events available in 0.74 (confirm `session_start`, `agent_end`, `session_shutdown`, `input`; check for `context`, `session_before_compact`, others)
- Whether a footer/status-line API exists for the pit board (fallback = session_start banner)
- Whether per-message token usage and cost are exposed to extensions (`estimator: "pi-ai"`) or must be estimated (`"chars4"`)
- The `pi.registerCommand` signature (reference: telepi-handoff.ts — read-only)

**Phase boundary:** present VERIFICATION.md + reconciliation. STOP. (Findings here may adjust Phase 1/3 implementation details — repo beats spec.)

---

## Phase 1 — Telemetry + lesson identity (on branch)

**T10. Create `agent/extensions/telemetry/index.ts`** (mirror the classifier-router folder pattern). Behavior:
- `session_start`: measure boot payload (token estimate per file actually loaded per AGENTS.md protocol + ~200 for git log) → write a `boot` record. Then **journal recovery**: if the previous session's record lacks a final state, close it out now from whatever was last upserted.
- `agent_end` (every turn): UPSERT the current session's running record — cumulative tokens, skills invoked (scan for `/skill:` + router decisions if observable), lesson citations (regex `\b(GL|L)-\d{3}\b` over new assistant messages), gate results if detected. **Nothing waits for shutdown.**
- `session_shutdown` (bonus only): mark the record cleanly finalized.
- Fields — OTel names for standards, `harness.*` for ours: `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.request.model`, `harness.usage.cache_read_tokens/cache_write_tokens` (if exposed), `harness.boot.payload` (per-file map), `harness.lesson_hits`, `harness.skills`, `harness.gates`, `harness.device` (hostname), `harness.git_sha` (harness HEAD), `harness.estimator`, `harness.session_id`, `ts`.
- Target file: `<project>/.agent/telemetry.jsonl` (create `.agent/` only if the project already has one OR the project has memory files — never scaffold into bare projects). Harness's own sessions log to `~/.pi/.agent/telemetry.jsonl`.
- **Windows path normalization:** resolve 8.3 short names and drive-letter casing before using paths as project keys.
- Stats maintenance: after upserting, update `lesson-stats.json` (project for `L-*`, `~/.pi/agent/lesson-stats.json` for `GL-*`): `hits`, `last_used`, `device_last_hit`; decay/confidence fields initialized but only *modified* by gardening passes.

**T11. Migrate global LESSONS.md to IDs.** Backup first (§B.2). Keep the category sections; each bullet becomes `- GL-NNN [flags] <body ≤3 lines>`; sequential zero-padded IDs; propose `[anchor]` where the lesson encodes damage-preventing/recovery knowledge (human confirms each). Add header comment: `<!-- When a lesson shapes your approach, cite its ID in your reply, e.g. "per GL-007". -->` Show full diff; human approves; validate every entry parses and IDs are unique. Seed `~/.pi/agent/lesson-stats.json` with one entry per lesson (`hits:0, decay:1.0, confidence:0.5, added:<today>, category:<section>`). Project LESSONS files migrate lazily when gardening first runs in each project (Phase 2).

**T12. Acceptance (run all, record evidence in TASKS.md):**
- Two test sessions produce boot + running records; deliberate `per GL-001` citation increments stats
- Kill the terminal mid-session (no shutdown); next boot's journal recovery finalizes the orphaned record
- Inject a thrown error into the telemetry hook; session proceeds normally; error logged
- Both LESSONS parse; backups exist; commit `telemetry + lesson identity`

**Phase boundary:** reconciliation + STOP.

**Phase 1 findings (2026-07-07):**
- `agent_end` doesn't fire in VS Code bridge mode (agent never reaches "no tool calls" state). Switched primary hook to `turn_end`; `agent_end` kept as fallback for text-only responses.
- The `agent_end` fallback handler competes with `turn_end`, producing duplicate records with reset `turn_index` mid-session. Fix needed: either guard `agent_end` more tightly or remove it if `turn_end` covers all cases.

---

## Phase 2 — /skill:gardening (on branch)

**T13. Config.** Create `~/.pi/agent/garden.json` (global defaults) with project-level `.agent/garden.json` override support:
```json
{
  "budgets": { "observeMode": true, "globalBootTokens": 3670,
    "perProject": { "seedFromMeasured": true } },
  "decay": { "citedReset": 1.0, "ignoredFactor": 0.9, "candidateBelow": 0.35, "graceSessions": 3 },
  "anchors": { "inflationWarnPct": 25 },
  "progress": { "verbatimSessions": 5, "archiveAfterDays": 30 },
  "sweeps": { "grillMaxAgeDays": 45, "spikeMaxAgeDays": 30, "sessionLogMaxAgeDays": 90 },
  "autonomy": { "progressHorizon": "auto", "telemetryRotation": "auto", "archiveRollups": "auto",
    "grillSweep": "auto", "spikeSweep": "auto", "sessionSweep": "auto",
    "intake": "gated", "merge": "gated", "demote": "gated", "compress": "gated", "anchorReVet": "gated" },
  "graduation": { "cleanRunsToAuto": 3 }
}
```

**T14. Create `agent/skills/skill-gardening.md`** (format-identical to promote-lessons) + register `pi.registerCommand("gardening")` via a thin extension, + add router triggers: "garden", "gardening", "clean up lessons", "review memory", "what's stale", "prune", "promote lessons", "memory over budget", "consolidate progress". Passes, in order, each respecting its autonomy setting and supporting `--dry`:
1. **Intake** — walk `.agent/lessons-pending.md` one candidate at a time (promote → scope, next ID, anchor y/n, ≤3-line body; also migrate that project's LESSONS.md to IDs on first touch)
2. **Merge** — near-duplicate pairs across scope; survivor keeps older ID; absorbed ID archived with `merged-into`
3. **Demote** — candidates: decay < 0.35 AND past grace AND not anchor; low-confidence+high-hits items surface FIRST as rewrite-first flags, never as demote candidates
4. **Compress** — only when a file exceeds budget AND observeMode is false; rank non-anchor by size desc, hits asc
5. **Progress horizon** — newest `verbatimSessions` blocks verbatim; older → one line each; >30 days → `.agent/archive/PROGRESS-YYYY-MM.md`
6. **Asset sweeps** — grill files, spike throwaways, orphaned/aged session dirs (incl. the C:→F: orphans and `--C--Users--`) → archive per config ages
7. **Skill break-in review** — any skill with `break-in` status and ≥2 logged runs: summarize its telemetry spans; propose SKILL.md diffs
8. **Report** — tokens freed per file, boot before/after, action counts, auto-action ledger with undo IDs, pit-board line
Update decay/confidence during pass 3 evaluation from telemetry-observed load/cite history. Deprecate `promote-lessons` (body → one-line pointer to gardening). README gains a "Memory lifecycle" section.

**T15. First real run (gated everywhere):** execute gardening at harness root (its own `.agent` has 1 pending lesson — the system's first intake is about itself), then in DriftScout when convenient (6 pending). `--dry` must produce zero file changes first.

**T16. Acceptance:** dry-run clean; full gated run completes with human approvals; boot payload ≤ pre-run; promote-lessons routes to gardening; first promoted lesson documents this migration. Commit.

**Phase boundary:** reconciliation + STOP.

---

## Phase 3 — Pit board (LOCKED until ≥5 sessions of telemetry exist)

**T17.** Per VERIFICATION.md findings: footer/status API (else session_start banner). Render from local JSON only:
`ctx ▓▓▓░░ 42% (60% ⚑) │ $0.83 │ pace +38% │ ☀️ gates`
Context fill % with 60% compaction marker · session cost so far · pace delta vs median session at this elapsed point · gate weather over last 5 runs (all ☀️ / majority ⛅ / else 🌧). Zero model calls, zero measurable latency. Commit.

---

## Phase 4 — Weekly Discord report

**T18. Secrets.** Create `agent/gardening-secrets.json` (already covered by auth-style handling — confirm gitignored; add explicitly if not): `{ "discordWebhookUrl": "<paste manually>" }`. Human pastes the URL from Discord (Channel Settings → Integrations → Webhooks).

**T19. Reporter.** `agent/tools/weekly-report.ts` (Node, cross-platform): reads all reachable telemetry.jsonl + stats files → builds memory-health (boot trend, hit rate, dead weight, queue depth, stale/anchor counts, net growth), spend by project/skill, auto-action ledger with undo IDs, device/git-SHA drift check, break-in reviews due → posts one Discord embed (≤6k chars) + attaches the full markdown report file. Handle 429 with retry-after.

**T20. Schedule.** Register via `schtasks`: Sundays 09:00 local, run `node agent/tools/weekly-report.ts`, "run whether user is logged on or not." Acceptance: one manual run delivers to the channel; then one scheduled run. Commit.

**Phase boundary:** reconciliation + STOP. Merge `feature/gardening` → `main` after human sign-off; branch-hygiene archives PLAN/TASKS.

---

## Phase 5 — Mac convergence + Syncthing (LAST — not executed by this run)

Checklist only; requires the Mac and a human decision to begin:
- [ ] Mac: back up `~/.pi/agent` runtime (auth.json, settings.json, sessions/); replace copy-install with clone-in-place (`~/.pi` = repo, PC topology); pull `main` (now includes everything above); restore runtime files; delete orphan clone at `~/pi-agent-harness`
- [ ] Manually copy `gardening-secrets.json` to Mac (Decision D: auth stays per-machine/manual)
- [ ] Syncthing both machines: sync `agent/lesson-stats.json`, `agent/garden.json`; `.stignore`: `sessions/`, `bin/`, `settings.json`, `auth.json`, everything git-tracked
- [ ] Verify: session on Mac cites a GL lesson → stat visible on PC after sync

---

## H. Definition of Done (agent maintains this in TASKS.md)

- [ ] Phase 0a: seven fixes committed on main; `git status --ignored` matches intent; telepi files untouched
- [ ] Phase 0b: VERIFICATION.md answers all four questions
- [ ] Telemetry: per-turn upserts; journal recovery proven by terminal-kill test; fault-injection passed; OTel+harness fields present; Windows paths normalized
- [ ] Global LESSONS migrated to GL-IDs with categories preserved; citation mechanism proven; stats seeded
- [ ] /skill:gardening + command + router triggers live; all 8 passes implemented; autonomy map enforced; --dry safe; promote-lessons deprecated
- [ ] Budgets in observe-mode, seeded from measured values; first gardening report generated at harness root
- [ ] Pit board rendering (or documented as blocked on API + banner fallback shipped)
- [ ] Weekly Discord report: one manual + one scheduled delivery with ledger + attachment
- [ ] Every phase has a commit with gates green; every deviation from this doc logged in phase reports
- [ ] PLAN/TASKS archived by branch-hygiene on merge
- [ ] Phase 5 checklist handed off (not executed) — Mac + Syncthing remain open by design