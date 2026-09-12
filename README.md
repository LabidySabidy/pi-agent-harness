# Pi Agent Harness

![Node.js](https://img.shields.io/badge/Node.js-22%2B-brightgreen?style=flat-square) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue?style=flat-square)

A solo-developer harness for the [Pi coding agent](https://github.com/earendil-works/pi). It gives Pi a set of composable **skills**, persistent per-project **memory**, and event-driven **extensions** — so the agent plans before it builds, remembers what it learned, controls its own token cost, and keeps its memory healthy over time.

Skill selection is model-driven: Pi lists every skill's name and description in the system prompt, and the model loads the one that fits. There is no keyword router, no classifier, and no per-message network call for routing.

Built and verified against **pi 0.84.3**.

---

## Get started

```bash
# 1. Clone — the repo root is ~/.pi, so agent/ lands at ~/.pi/agent/
git clone https://github.com/LabidySabidy/pi-agent-harness.git ~/.pi

# 2. Seed your personal files (templates → live, gitignored)
cp ~/.pi/agent/AGENTS.md.template   ~/.pi/agent/AGENTS.md
cp ~/.pi/agent/LESSONS.md.template  ~/.pi/agent/LESSONS.md
#    Edit AGENTS.md: replace the Context section with your role, stack, platform.

# 3. Start Pi in any project directory
cd ~/my-project
pi
```

Pi loads the skills and extensions from `~/.pi/agent/` automatically on startup. No build step — the extensions are TypeScript that Pi runs directly.

Prefer a GUI? The harness pairs naturally with **pi-web** (`@agegr/pi-web`), a browser UI for Pi: `npm i -g @agegr/pi-web && pi-web`, then open `http://localhost:30141`.

> **A `.pi/` directory is trust-requiring.** Any project with a `.pi/` (or a skill-lab scratch project) prompts for trust on first run. Run it interactively the first time; a `-p` / `--mode json` / `--mode rpc` first run denies silently.

---

## How it works

Three layers. Skills stay separate and reference each other by name; they don't merge into one giant prompt.

| Layer | Location | What it does |
|---|---|---|
| **Skills** | `~/.pi/agent/skills/` | Self-contained workflows the agent loads on demand — one per file |
| **Extensions** | `~/.pi/agent/extensions/` | TypeScript hooks on Pi's lifecycle events — telemetry, progress, lessons, and token-cost control |
| **Memory** | `<project>/` + `~/.pi/agent/` | Markdown files that persist across sessions and shape every decision |

### Session lifecycle

1. **Start** — Pi reads the global files (`AGENTS.md`, `STANDARDS.md`, `LESSONS.md`) and, if present, the project's `VISION.md`, `PROGRESS.md` (newest few entries), and `LESSONS.md`. Then `git log -20` for recent context.
2. **Route** — the model picks a skill from the names + descriptions in the system prompt, or you invoke one explicitly with `/skill:name`.
3. **Run** — the skill executes. `session-summary` maintains a rolling `PROGRESS.md` entry, `extract-patterns` collects lesson candidates, and `telemetry` records real token usage, cost, and skill invocations.
4. **End** — the rolling progress entry is finalized; a killed session is finalized on the next start.

### Design principles

- **Skills over monolith** — each skill owns one workflow; they compose by reference, not by concatenation.
- **Memory over amnesia** — `VISION.md`, `LESSONS.md`, and `PROGRESS.md` accumulate across sessions.
- **Triage over uniform process** — a throwaway spike and a real feature don't get the same ceremony.
- **Verification over assertion** — never claim "done" without fresh test/build/command output in the message.
- **Tokens are a budget** — the extensions shrink context automatically (see below) and `/tokens` makes the spend visible.
- **Git is the safety net** — destructive maintenance runs only on a clean tree, and `git diff` is the review.

---

## Skills

Skills live at `~/.pi/agent/skills/`. The model loads them from their descriptions; explicit `/skill:name` always works too.

| Skill | Use it when | What it does |
|---|---|---|
| [scaffold](agent/skills/skill-scaffold.md) | Starting a genuinely new project | Triage → discovery → `VISION.md`, `PLAN.md`, `TASKS.md`, repo, deploy |
| [spike](agent/skills/skill-spike.md) | "Can this even work?" | One throwaway script to validate the riskiest assumption → PROCEED / PIVOT / KILL |
| [grill](agent/skills/skill-grill.md) | A design or plan feels shaky | Adversarial interrogation of a design → `.agent/grill/` |
| [grill-misconception](agent/skills/skill-grill-misconception.md) | Testing *your* grasp of a concept | Socratic cross-examination; you answer from memory |
| [feynman-recite](agent/skills/skill-feynman-recite.md) | Checking you can explain a concept | You recite it in plain English to earn a proficiency badge |
| [plan-then-implement](agent/skills/skill-plan-then-implement.md) | Building a real feature | Read → `PLAN.md` → `TASKS.md` → TDD per phase → acceptance gates |
| [investigate-bug](agent/skills/skill-investigate-bug.md) | Something's broken | 8-step defect investigation → evidence-backed root cause → TDD fix |
| [branch-hygiene](agent/skills/skill-branch-hygiene.md) | Ready to branch or ship | Create `feat/*`, open a PR, or clean up merged branches |
| [gardening](agent/skills/skill-gardening.md) | Memory is getting cluttered | Git-guarded maintenance: intake, merge, demote, compress, archive, report |
| scaffold-learning | Starting a *learning* project | Interview → 20-hour curriculum → `.agent/learning/` (hidden from the model; explicit `/skill:scaffold-learning` only) |

Descriptions are the routing signal: each states what the skill is for **and** what it is not (its neighbour), so adjacent skills don't shadow each other.

---

## Token-cost control

Three pieces keep the context small and the spend visible — the harness's answer to "why is my context so big?"

| Piece | What it does |
|---|---|
| **bash-quiet** | Collapses successful bash output. Verification commands (`build`/`test`/`lint`/`tsc`/`gradle`/`mvn`…) → a one-line `✓ passed · N lines · full: <path>`; any other successful output over 200 lines → a head/tail window. Failures always pass through untouched. |
| **read-cache** | Returns a one-line reference when the model re-reads an unchanged file at the same `(path, offset, limit)`. Cleared on compaction, invalidated on edit/write. |
| **`/tokens`** | On-demand breakdown of the current session: system prompt, then per-layer estimates (user text, skill blocks, read results, bash results, thinking, tool-call args, assistant text) plus the calibration delta vs the provider's real total. Labeled as estimates — providers only report totals. |

Run `/tokens` any time to see which layer is eating your context window.

---

## Memory

A small set of markdown files per project — the difference between an agent that re-learns your project every session and one that remembers.

| File | Scope | Holds |
|---|---|---|
| `VISION.md` | project | What the app is, who it's for, the domain glossary |
| `PLAN.md` | project | The current feature's plan and phases |
| `TASKS.md` | project | Granular `T-NNN` tasks with "done when" criteria |
| `PROGRESS.md` | project | Rolling session summaries, newest first |
| `LESSONS.md` | project + global | Danger zones, gotchas, decisions — `L-NNN` (project) / `GL-NNN` (global) |

### Lesson citations

Every lesson has a stable ID. When a lesson shapes the agent's approach it cites the ID (e.g. "per GL-003"), and `telemetry` records one hit per citation in `lesson-stats.json` (kept out of `LESSONS.md` so the loaded file stays cache-stable). Citations are counted **per message, not per session**; IDs that don't exist in `LESSONS.md` are ignored. The stats are a signal for the human at gardening time — *which lessons earn their place* — never an input to automatic removal.

### PROGRESS windowing

`PROGRESS.md` grows forever, but boot reads only the newest few entries (`garden.json → progressWindow.loadEntries`). The rest stays on disk. Boot cost stays flat no matter how long the file gets.

---

## Gardening & safety

`/skill:gardening` runs up to 7 maintenance passes over your memory files: intake pending lessons, merge duplicates, demote stale ones, compress over-budget files, archive old progress entries, sweep stale artifacts, and report. Judgment passes are gated — one `y/n` per pass, never batched. Compress is currently **observe-only** (`garden.json → budgets.observeMode: true`): it measures against budget but never rewrites.

Safety is **git**, not a hand-rolled guard:

- **Gardening refuses to start on a dirty tree.** Commit or stash first — a clean start means every change is visible in `git diff`.
- **`git diff` is the review; `git checkout` is the undo.** Nothing is hard-deleted; stale files are archived.
- **`--dry` means plan only** — decide and present, write nothing.

`garden.json` is advisory config; the git guard is the enforcement.

---

## Extensions

Seven modules in `~/.pi/agent/extensions/` hook Pi's event system:

| Extension | Hooks | What it does |
|---|---|---|
| **telemetry** | `session_start`, `turn_end`, `agent_end`, `session_shutdown` | Append-only JSONL of token usage, cost, skill invocations, and lesson citations; also registers `/tokens` |
| **bash-quiet** | `tool_result` | Collapses successful bash output to a summary + temp-file path |
| **read-cache** | `tool_result`, `session_compact` | Returns a reference for unchanged, already-in-context re-reads |
| **session-summary** | `session_start`, `turn_end`, `session_shutdown` | Maintains a rolling `PROGRESS.md` entry; finalizes stale entries on next start |
| **extract-patterns** | `agent_end`, `session_shutdown` | Scans assistant messages for lesson candidates → `.agent/lessons-pending.md`; incremental and deduped |
| **learning-state-manager** | `message_end` | Strips telemetry JSON from assistant messages |
| **telepi-handoff** | command | Registers `/handoff` (packaged, not authored here) |

---

## Weekly report (separate repo)

A companion app (`LabidySabidy/pi-weekly-report`) reads the telemetry JSONL and posts a weekly digest to Discord: sessions, commits, token volume, actual API spend, context reuse, cost outliers, and dormant skills. It's scheduled (Monday + logon trigger) and posts at most once a week. Install it from its own repo — it's intentionally not part of the harness, because reporting and the harness itself evolve at different speeds.

---

## Configuration

Everything is optional — the harness works on defaults.

| File | Location | Purpose |
|---|---|---|
| `AGENTS.md` | `~/.pi/agent/` | Your context: role, stack, platform, operating principles (gitignored — personal) |
| `STANDARDS.md` | `~/.pi/agent/` | Capability mappings and per-stack acceptance gates |
| `LESSONS.md` | `~/.pi/agent/` | Your cross-project lessons (gitignored — personal) |
| `garden.json` | `~/.pi/agent/` | Gardening budgets, sweep horizons, autonomy levels |
| `settings.json` | `~/.pi/agent/` | Provider/model/thinking defaults |
| Templates | `~/.pi/agent/templates/` | Scaffold seeds: `VISION.md`, `PLAN.md`, `TASKS.md`, `PROGRESS.md`, `LESSONS.md`, `DECISIONS.md` |

---

## Prerequisites

- **[Pi](https://github.com/earendil-works/pi)** — **0.84.3** (the extensions target this version's API)
- **Node.js 22+**
- **A model API key** (DeepSeek/OpenRouter/etc.) — supplied by you via `/login` or `auth.json`, never bundled here

---

## File layout

```
~/.pi/agent/                    # Global harness
├── AGENTS.md                   # Your preamble, rules, memory protocol (personal)
├── STANDARDS.md                # Gates + capability mapping
├── LESSONS.md                  # Cross-project lessons (personal)
├── garden.json                 # Gardening config (advisory)
├── settings.json               # Provider/model/thinking defaults
├── lesson-stats.json           # Citation stats (telemetry-maintained, personal)
├── skills/                     # Composable skills (one workflow per file)
├── extensions/                 # telemetry, bash-quiet, read-cache, session-summary,
│                               #   extract-patterns, learning-state-manager, telepi-handoff
├── references/                 # Lazy-loaded reference docs
└── templates/                  # Scaffold templates

<project>/                      # Per-project memory
├── VISION.md   PLAN.md   TASKS.md   PROGRESS.md   LESSONS.md
└── .agent/                     # Generated: telemetry, pending lessons, grill/, archive/, reports/
```

---

## A note on honesty

This harness has one recurring failure mode worth naming: describing systems that don't actually run. Extensions load at session start, so code written in a session isn't the code running in that session — a fix can only be verified after a restart, by reading back the artifact it produced (`GL-013`). If you extend this harness, hold the docs to the same standard: **the README describes only what executes.**
