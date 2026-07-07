# Gardening Upgrade — Task Tracker

> Statuses: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked-with-note

---

## Phase 0a — Pre-flight (on `main`)

- [x] **T1.** Commit deliberate local improvements
  - Commit `classifier-router/index.ts`: `router: add branch-hygiene/promote-lessons/spike to AVAILABLE_SKILLS; tighten scaffold triggers; null-return for approvals/meta`
  - Commit `skill-scaffold.md`: `scaffold: auto GitHub+Vercel on real-product path; Playwright E2E; write-verification heredoc fallback; new triggers + anti-patterns`
  Done when: Two commits exist on main with those exact messages.

- [x] **T2.** Relocate stray utility scripts
  - Create `~/scripts/`
  - Move `check-size.ps1`, `drill.ps1`, `recent-files.ps1` there
  Done when: Scripts removed from `~/.pi/` and present in `~/scripts/`.

- [x] **T3.** Update Pi to ≥0.74 + migrate package scope
  - Update Pi using its own update mechanism
  - Verify version ≥0.74
  - Update imports in `classifier-router/index.ts`, `extract-patterns/index.ts`, `session-summary/index.ts` from `@mariozechner/pi-coding-agent` → `@earendil-works/pi-coding-agent`
  - Start a test session; confirm all extensions load and router routes
  - Commit: `extensions: migrate to @earendil-works package scope (Pi 0.74)`
  Done when: Pi version ≥0.74 printed; test session routes a skill; commit on main.

- [x] **T4.** .gitignore surgery
  - REMOVE `agent/extensions/` ignore rule
  - ADD: `agent/extensions/telepi-handoff.ts`, `TelePi/`, `test-results/`, `*.ps1`, `/PROGRESS.md`, `/PLAN.md.archive`, `.agent/`
  - KEEP: `agent/auth.json`, `agent/sessions/`, `agent/bin/`
  - Verify with `git status --ignored`
  - Commit
  Done when: `git status --ignored` matches intent; extensions show as tracked.

- [x] **T5.** README corrections
  - (a) Fix extract-state filename: `.agent/.extract-state.json` (leading dot, both mentions consistent)
  - (b) Document real extension events in extensions table (`input`, `session_start`, `agent_end`, `session_shutdown`)
  - (c) Remove LANGUAGE.md from templates list
  - Commit
  Done when: README reflects all three changes; no LANGUAGE.md reference in README.

- [x] **T6.** Fix PROGRESS read-direction bug
  - In global `AGENTS.md`, change "read the last 50 lines of PROGRESS.md" → "read the FIRST 50 lines"
  - Commit
  Done when: AGENTS.md line reads "read the FIRST 50 lines."

- [x] **T7.** Retire LANGUAGE.md
  - Grep `agent/skills/`, `agent/extensions/`, `AGENTS.md`, `README.md` for `LANGUAGE`
  - Update any references to point at VISION.md's glossary section
  - `git rm agent/templates/LANGUAGE.md`
  - Commit: `templates: retire legacy LANGUAGE.md (glossary lives in VISION.md)`
  Done when: LANGUAGE.md removed; no remaining standalone LANGUAGE references (except as glossary pointer).

- [x] **T8.** Cut `feature/gardening`
  - `git checkout -b feature/gardening`
  Done when: `git branch --show-current` = `feature/gardening`.

---

## Phase 0b — Verification (on branch)

- [x] **T9.** Inspect `@earendil-works/pi-coding-agent` package and record in VERIFICATION.md
  - List of extension lifecycle events in 0.74
  - Whether footer/status-line API exists for pit board
  - Whether per-message token usage/cost exposed to extensions
  - `pi.registerCommand` signature
  Done when: VERIFICATION.md answers all four questions with evidence from package source.

---

## Phase 1 — Telemetry + lesson identity (on branch)

- [x] **T10.** Create `agent/extensions/telemetry/index.ts`
  - `session_start`: boot payload measurement + journal recovery
  - `agent_end`: upsert running record (cumulative tokens, skills, lesson citations, gate results)
  - `session_shutdown`: mark record finalized
  - OTel + harness field names as specified in UPGRADE-gardening.md
  - Target: `<project>/.agent/telemetry.jsonl`; harness → `~/.pi/.agent/telemetry.jsonl`
  - Windows path normalization
  - Stats maintenance: update `lesson-stats.json` after upsert
  - Fail-open: errors logged to `.agent/telemetry-errors.log`
  Done when: Two test sessions produce records; deliberate `per GL-001` citation increments stats.

- [x] **T11.** Migrate global LESSONS.md to GL-NNN IDs
  - Backup to `~/.pi/.agent/archive/pre-gardening-YYYYMMDD/`
  - Each bullet → `- GL-NNN [flags] <body ≤3 lines>`
  - Sequential zero-padded IDs
  - Propose `[anchor]` where lesson encodes damage-preventing/recovery knowledge
  - Add header comment with citation instruction
  - Show full diff; human approves
  - Seed `~/.pi/agent/lesson-stats.json`
  Done when: Every entry parses; IDs unique; stats seeded; backup exists.

- [x] **T12.** Acceptance
  - [x] Two test sessions produce boot + running records
  - [x] Terminal-kill mid-session → next boot's journal recovery finalizes orphaned record
  - [x] Inject thrown error → session proceeds; error logged
  - [x] Both LESSONS parse; backups exist
  - Commit: `telemetry + lesson identity`
  Done when: All four acceptance criteria pass.

---

## Phase 2 — /skill:gardening (on branch)

- [x] **T13.** Config — create `~/.pi/agent/garden.json` with project-level `.agent/garden.json` override
  Done when: garden.json exists with all keys from UPGRADE-gardening.md; JSON valid.

- [x] **T14.** Create `agent/skills/skill-gardening.md` + `pi.registerCommand("gardening")` + router triggers
  - 8 passes: intake, merge, demote, compress, progress horizon, asset sweeps, break-in review, report
  - Each respects autonomy setting; `--dry` supported
  - Deprecate promote-lessons (body → one-line pointer)
  - README "Memory lifecycle" section
  Done when: All 8 passes implemented; `--dry` produces zero file changes; promote-lessons routes to gardening.

- [x] **T15.** First real run (gated everywhere)
  - Harness root (1 pending lesson)
  - `--dry` must produce zero file changes first
  Done when: Dry-run clean; gated run completes with human approvals; boot payload ≤ pre-run.

- [~] **T16.** Acceptance
  - [x] Dry-run clean (isolation-test proven)
  - [x] Full gated run completes (merge executed, intake declined — gate works both ways)
  - [ ] Boot payload ≤ pre-run (blocked — requires T16b: session-summary fix + pass 5 compaction of 847-line PROGRESS.md)
  - [ ] promote-lessons routes to gardening (verify after /reload)
  - Commit: `telemetry + lesson identity`
  Done when: All criteria pass.

---

## Phase 2.5 — Extraction quality fixes (surfaced by gardening live run)

- [ ] **T16a.** Reclassify progressHorizon from auto → gated in garden.json
  Done when: garden.json progressHorizon = "gated". ✅ (done)

- [ ] **T16b.** Fix session-summary capture + telemetry skill-scan regex
  - session-summary extension writes prompt fragments, pasted hashes, half-sessions into PROGRESS.md
  - telemetry SKILL_RE regex grabs backtick garbage (e.g., `gardening\`,` instead of `gardening`)
  - Both are sloppy extraction patterns — upstream fix needed before gardening passes 5 and 7 can work with clean data
  Done when: PROGRESS.md entries are proper summaries; harness.skills contains clean skill names.

- [ ] **T16c.** Stats hit-count reset after regex fix
  - Current counts (GL-006=26, GL-008=13, GL-012=14) are inflated by meta-conversation that built/ tested the system
  - Contaminated counts compound through operations (e.g., 13+13=26 merge was one debugging echo doubled)
  - After T16b: zero all hit counts, let real usage re-accumulate before decay/demote goes live
  Done when: All lesson-stats.json hit counts reset to 0; confirmed after one real-work session.

---
  - promote-lessons routes to gardening
  - First promoted lesson documents migration
  - Commit
  Done when: All criteria pass.

---

## Phase 3 — Pit board (LOCKED until ≥5 sessions of telemetry)

- [ ] **T17.** Render context-fill bar from local JSON
  - `ctx ▓▓▓░░ 42% (60% ⚑) │ $0.83 │ pace +38% │ ☀️ gates`
  - Footer/status API if available; else session_start banner
  - Zero model calls, zero measurable latency
  - Commit
  Done when: Pit board renders in sessions; locked-gate enforces ≥5 sessions.

---

## Phase 4 — Weekly Discord report

- [ ] **T18.** Secrets — create `agent/gardening-secrets.json` (gitignored)
  Done when: File exists, gitignored, human pastes webhook URL.

- [ ] **T19.** Reporter — `agent/tools/weekly-report.ts`
  - Reads all telemetry.jsonl + stats → memory-health, spend, auto-action ledger, device drift, break-in reviews
  - Posts one Discord embed (≤6k chars) + full markdown attachment
  - Handle 429 with retry-after
  Done when: One manual run delivers to Discord channel.

- [ ] **T20.** Schedule via `schtasks` — Sundays 09:00
  Done when: One manual run + one scheduled run deliver to channel.

---

## Phase 4.5 — CRLF cleanup (deferred to before Mac clone)

- [x] **T21.** Add `.gitattributes` with `* text=auto eol=lf`
  Done when: `.gitattributes` committed; `git add --renormalize .` shows no CRLF→LF churn on any tracked text file.

---

## Phase 5 — Mac convergence + Syncthing (checklist only)

- [ ] Mac: backup runtime; clone-in-place; pull main; restore runtime; delete orphan clone
- [ ] Mac: manually copy `gardening-secrets.json`
- [ ] Syncthing: sync `lesson-stats.json`, `garden.json`; `.stignore` configured
- [ ] Verify: Mac session cites GL lesson → stat visible on PC after sync
  Done when: All four checkboxes ticked (executed on Mac by human).

---

## Definition of Done

Per UPGRADE-gardening.md §H:

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
