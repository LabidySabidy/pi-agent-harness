# Pi Agent Harness

> A solo-developer agent harness: composable skills, persistent project memory, event-driven extensions, and a config-driven memory-lifecycle system that keeps your agent's context healthy over time.

---

## Quick Start

```bash
# 1. Clone — the repo root is ~/.pi, so agent/ lands at ~/.pi/agent/
git clone https://github.com/LabidySabidy/pi-agent-harness.git ~/.pi

# 2. Seed your personal files (templates → live)
cp ~/.pi/agent/LESSONS.md.template ~/.pi/agent/LESSONS.md
cp ~/.pi/agent/AGENTS.md.template ~/.pi/agent/AGENTS.md
# Edit AGENTS.md: replace the Context section with your role, stack, platform.

# 3. Start Pi in any project directory
cd ~/my-project
pi
```

Pi auto-loads skills from `~/.pi/agent/skills/` and extensions from `~/.pi/agent/extensions/` on startup. No config files, no install scripts.

---

## How it works

Three layers. Skills compose via one-line invocations — they don't merge text.

| Layer | Location | What it does |
|---|---|---|
| **Skills** | `~/.pi/agent/skills/` | Reusable workflows invoked via `/skill:name` or auto-selected by the model from skill descriptions |
| **Extensions** | `~/.pi/agent/extensions/` | TypeScript hooks on agent lifecycle events — update PROGRESS.md, extract lessons, collect telemetry, guard gardening |
| **Memory** | `<project>/` + `~/.pi/agent/` | Markdown files that persist across sessions — VISION.md, LESSONS.md, PROGRESS.md, PLAN.md |

### Session lifecycle

1. **Start** — Reads global files (STANDARDS.md, LESSONS.md), then project files (VISION.md, PROGRESS.md, LESSONS.md). Runs `git log -20`. Checks branch tracking.
2. **Routing** — Pi scans skill descriptions at startup and injects them into the system prompt. The primary model self-selects skills from natural language — no separate classifier.
3. **Execution** — Skills run. `session-summary` updates PROGRESS.md after each turn. `extract-patterns` scans for lesson candidates. `telemetry` tracks tokens, citations, and skills.
4. **End** — Rolling PROGRESS.md entry finalized. Extract-patterns does a final sweep. Branch-hygiene archives PLAN.md and TASKS.md on merge.

### Design principles

- **Skills over monolith** — Each skill owns one workflow. Compose via one-line invocations, not merged text.
- **Memory over amnesia** — VISION.md, LESSONS.md, and PROGRESS.md accumulate across sessions.
- **Triage over uniform process** — Throwaway tool vs real product. Trivial change vs grill-worthy. The process scales to the stakes.
- **Verification over assertion** — Never claim "done" without fresh test output, build log, or curl response in the message.

---

## Skills

All skills live at `~/.pi/agent/skills/`. Invoke explicitly (`/skill:name`) or describe your task in natural language — the model self-selects the right skill from its description.

| Skill | What it does |
|---|---|
| [scaffold](agent/skills/skill-scaffold.md) | Bootstrap a genuinely new project: discovery → VISION.md, PLAN.md, TASKS.md, PROGRESS.md |
| [spike](agent/skills/skill-spike.md) | Throwaway prototype to validate one risky assumption before committing to a plan |
| [grill](agent/skills/skill-grill.md) | Adversarial design review — walk the design tree before non-trivial implementation |
| [plan-then-implement](agent/skills/skill-plan-then-implement.md) | Read → PLAN.md → TASKS.md → TDD per phase → acceptance gates |
| [investigate-bug](agent/skills/skill-investigate-bug.md) | Structured 8-step defect investigation → root cause with evidence → TDD fix plan |
| [branch-hygiene](agent/skills/skill-branch-hygiene.md) | Create `feat/*` branch, push PR, merge/discard, cleanup stale branches |
| [gardening](agent/skills/skill-gardening.md) | Config-driven memory maintenance: intake, merge, demote, compress, progress-horizon, sweeps, reporting. Replaces promote-lessons. |

### When to use which

```
New project?                    → /skill:scaffold
Uncertain if something works?   → /skill:spike
Building a feature?             → /skill:plan-then-implement
Design feels shaky?             → /skill:grill
Something's broken?             → /skill:investigate-bug
Ready to merge?                 → /skill:branch
Memory getting cluttered?       → /skill:gardening
```

---

## Memory lifecycle

The harness maintains project memory files across sessions. Over time these files grow — more lessons, more progress entries, more design artifacts. The memory-lifecycle system (gardening + telemetry) keeps this sustainable.

### Lesson identity and stats

Every lesson gets a unique ID (`GL-NNN` for global, `L-NNN` for project). The `telemetry` extension tracks every citation — when the agent references a lesson in a response, it registers a hit in `lesson-stats.json`. This powers:

- **Citation tracking** — hit counts and last-used timestamps let gardening sort lessons by recency and relevance
- **Anchor lessons** — damage-preventing lessons flagged as `[anchor]` get extra scrutiny; gardening never proposes removing them
- **Merge detection** — near-duplicate lessons with different IDs can be consolidated

### PROGRESS.md windowing

PROGRESS.md accumulates entries indefinitely, but the boot protocol only reads the newest `N` entries (configured in `garden.json → progressWindow.loadEntries`). The rest stays on disk for lazy lookup — same principle as `references/`. This keeps boot cost constant regardless of PROGRESS.md size.

### Gardening passes

`/skill:gardening` runs up to 8 configurable passes: intake (review lesson candidates), merge, demote (manual review), compress, progress horizon (archive old entries), asset sweeps, break-in review, and summary reporting. Each pass is independently gated or auto-run per `garden.json → autonomy`. Safety model: gardening is blocked from starting on a dirty git tree — `git diff` shows every change, `git checkout .` undoes it.

### What's on by default

- `telemetry` extension: on. Tracks citations, tokens, skills. Writes to `.agent/telemetry.jsonl`.
- `extract-patterns` extension: on. Scans for lesson candidates. Writes to `.agent/lessons-pending.md`.
- `session-summary` extension: on. Rolling PROGRESS.md entries.
- `gardening-command` extension: on. Provides the `/gardening` command (code-enforced git-safety guard) as an alternate entrance to `/skill:gardening`.

---

## Boot payload

Every session starts by loading protocol files into context. This table reflects what's actually read:

| File | chars | tokens |
|---|---|---|
| AGENTS.md (global) | ~7,928 | ~1,982 |
| STANDARDS.md (global) | ~3,717 | ~929 |
| LESSONS.md (global) | ~3,112 | ~778 |
| PROGRESS.md (windowed: first 50 lines) | ~102 | ~25 |
| git log -20 | ~800 | ~200 |
| **Total** | **~12,559** | **~3,914** |

PROGRESS.md's first 50 lines are currently 102 chars due to a ~94-line blank gap between the header and first entry — a formatting artifact. When entries sit directly below the header, expect ~2,000 chars / ~500 tokens. The PROGRESS-windowing win is structural: 108 entries on disk, constant ~5 entries loaded at boot regardless of file growth.

Plus project-level files when present (project AGENTS.md, STANDARDS.md, VISION.md, PROGRESS.md, LESSONS.md). Project PROGRESS.md is also windowed to 5 entries.

PROGRESS windowing is the durable win: 108 entries on disk, 5 loaded at boot — constant cost regardless of file growth. The AGENTS.md diet from an earlier pass was marginal (the file-layout reference was relocated to `references/authoring.md`; all operating rules remain in AGENTS.md). No further obvious candidates for relocation — the remaining content is all session-start protocol and operating principles.

---

## Acceptance gates

Per-stack verification commands run in order (lint → type → test → build → security). Stop at first failure. Project STANDARDS.md overrides defaults.

| Stack | Gates |
|---|---|
| Java / Spring Boot | `mvn checkstyle:check` → `mvn test` → `mvn package` |
| TypeScript (React/Angular) | `npm run lint` → `tsc --noEmit` → `npm test` → `npm run build` → `npm audit` |
| Python / Flask | `ruff check .` → `mypy src/` → `pytest -v` → `pip-audit` |

**Verification-before-claim rule:** Never claim "done," "fixed," or "passing" without fresh test/build/curl output in the current message. Past output is stale.

---

## Extensions

Three TypeScript modules in `~/.pi/agent/extensions/` hook into Pi's event system:

| Extension | Hooks | What it does |
|---|---|---|
| **session-summary** | `agent_end`, `session_start`, `session_shutdown` | Maintains a rolling PROGRESS.md entry; auto-finalizes on shutdown |
| **extract-patterns** | `agent_end`, `session_shutdown` | Scans new assistant messages for lesson candidates; incremental via `.agent/.extract-state.json` |
| **telemetry** | `session_start`, `turn_end`, `agent_end`, `session_shutdown` | Session-level telemetry: boot payload, API token usage, lesson citations, skill invocations. Append-only JSONL with journal recovery. |
| **gardening-command** | `command` | `/gardening` command: code-enforced git-clean guard before loading the gardening skill |

---

## Prerequisites

- **Pi** 0.80+ (the coding agent itself)
- **Node.js** 18+ (for extensions)

---

## Configuration

User-customizable files (all optional — the harness works with defaults):

| File | Location | Purpose |
|---|---|---|
| `AGENTS.md` | `~/.pi/agent/AGENTS.md` | Your personal context: role, stack, platform, operating principles |
| `garden.json` | `~/.pi/agent/garden.json` | Gardening budgets, autonomy levels, progress/sweep horizons |
| `STANDARDS.md` | `~/.pi/agent/STANDARDS.md` | Capability mappings, acceptance gates per stack |
| `LESSONS.md.template` | `~/.pi/agent/` | Seed your global lessons file (copy to `LESSONS.md` via Quick Start step 2) |
| Templates | `~/.pi/agent/templates/` | Project scaffold templates: VISION.md, PLAN.md, TASKS.md, PROGRESS.md, LESSONS.md |

---

## File layout

```
~/.pi/agent/                         # Global harness
├── AGENTS.md                        # Preamble, rules, memory protocol
├── STANDARDS.md                     # Gates, capability mapping
├── LESSONS.md                       # Cross-project patterns
├── garden.json                      # Memory-lifecycle config (budgets, autonomy, horizons)
├── lesson-stats.json                # Lesson citation stats (telemetry-maintained)
├── skills/                          # Composable skills
│   ├── skill-scaffold.md
│   ├── skill-spike.md
│   ├── skill-grill.md
│   ├── skill-plan-then-implement.md
│   ├── skill-investigate-bug.md
│   ├── skill-branch-hygiene.md
│   └── skill-gardening.md
├── extensions/                      # Event-driven TypeScript
│   ├── session-summary/
│   ├── extract-patterns/
│   ├── telemetry/
│   └── gardening-command/
└── templates/                       # File templates for scaffold
    ├── VISION.md
    ├── PLAN.md
    ├── TASKS.md
    ├── PROGRESS.md
    └── LESSONS.md                   # Project-scaffold LESSONS template (not the seed)

<project>/                           # Per-project memory
├── VISION.md                        # App identity + glossary + architecture
├── PLAN.md                          # Current implementation plan
├── TASKS.md                         # Task list
├── LESSONS.md                       # Project-specific patterns
├── PROGRESS.md                      # Session summaries
└── .agent/                          # System data
    ├── lessons-pending.md
    ├── .extract-state.json
    ├── telemetry.jsonl
    ├── lesson-stats.json
    ├── grill/                       # Design interrogation
    ├── archive/                     # Historical plans/tasks
    └── reports/                     # Gardening reports (durable, never swept)
```
