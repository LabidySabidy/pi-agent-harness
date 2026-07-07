# Phase 2 — /skill:gardening

> References: [Grill session](.agent/grill/gardening.md)

## Goal
Config-driven memory gardening skill with 8 passes, replacing promote-lessons. One body, two entrances. Three safety layers: hard (deny-list + snapshot), harder (contract + per-pass gating), soft (write-guard patterns).

## Approach
Phase 2 in three chunks: T13 (garden.json with allow/deny paths), T14 (skill + command + router), T15-16 (testing). Single `skill-gardening.md` file — the command extension reads it via `fs.readFileSync`. No backing code beyond the command registration.

### Safety architecture
1. **Deny-list** (garden.json): `agent/skills/`, `agent/extensions/`, `agent/bin/`, `auth.json`, `.git/` — absolute path prefix match before any write/move/delete. Deny beats allow.
2. **Pre-run snapshot**: Before pass 1, copy affected files to `.agent/archive/pre-gardening-YYYYMMDD-HHMM/`. Rollback instruction on failure.
3. **--dry contract**: Agent must restate "zero writes" before executing.
4. **Per-pass gating**: Gated passes present diff (dry) or summary (live), ask y/n. Never batch.

## Phases

### T13 — Config (garden.json)
- Create `agent/garden.json` with all keys from UPGRADE-gardening.md
- Add `deniedPaths` array (absolute-path prefix match, deny beats allow)
- Add `allowedPaths` array (directories gardening may touch)
- Validate JSON

### T14a — Skill file (skill-gardening.md)
- YAML frontmatter: name, description, triggers
- Top: --dry contract acknowledgment, safePaths rule, gating UX contract
- Body: 8 pass descriptions, each with: mandatory deny-list check, write-guard pattern, gating behavior
- Deprecation notice for promote-lessons

### T14b — Extension + router
- Create `agent/extensions/gardening-command/index.ts` — reads skill-gardening.md, injects as context
- Add gardening triggers to classifier-router AVAILABLE_SKILLS
- Deprecate promote-lessons skill body (→ one-line pointer)

### T15-16 — Testing
- Dry-run at harness root: must produce zero file changes
- Gated run with per-pass human approval
- Acceptance: boot payload ≤ pre-run, promote-lessons routes to gardening

## Files that will change

| File | Change | Phase |
|---|---|---|
| `agent/garden.json` | Create — config + deny-list + allow-list | T13 |
| `agent/skills/skill-gardening.md` | Create — skill body with safety layers | T14a |
| `agent/extensions/gardening-command/index.ts` | Create — thin command loader | T14b |
| `agent/extensions/classifier-router/index.ts` | Edit — add gardening triggers | T14b |
| `agent/skills/skill-promote-lessons.md` | Edit — body → pointer to gardening | T14b |

## Acceptance criteria
- [ ] garden.json parses as valid JSON with all keys including deniedPaths/allowedPaths
- [ ] /skill:gardening loads and displays 8-pass menu with safety contract
- [ ] --dry produces zero file changes (verified by git diff)
- [ ] Deny-list blocks writes to agent/skills/, extensions/, bin/, auth.json, .git/
- [ ] promote-lessons routes to gardening
- [ ] Boot payload ≤ pre-Phase-2 value

## Not in scope
- Pit board (Phase 3) — locked until ≥5 telemetry sessions
- Weekly Discord report (Phase 4)
- Mac convergence (Phase 5)
- Fixing agent_end/turn_end duplicate record issue (noted in UPGRADE-gardening.md)
