# Pi Agent Harness

![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue?style=flat-square) ![Routing](https://img.shields.io/badge/routing-100%25%20local-success?style=flat-square)

A solo-developer harness for the [Pi coding agent](https://github.com/badlogic/pi-mono). It gives Pi a set of composable **skills**, persistent per-project **memory**, and event-driven **extensions** — so the agent plans before it builds, remembers what it learned, and keeps its own context healthy over time.

Everything runs locally. Skill routing is deterministic keyword matching plus Pi's built-in self-selection — no classifier API, no per-message network calls.

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

On startup Pi loads the skills and extensions from `~/.pi/agent/` automatically. No install script, no build step — the extensions are TypeScript that Pi runs directly.

---

## How it works

Three layers. Skills stay separate and reference each other by name; they don't merge into one giant prompt.

| Layer | Location | What it does |
|---|---|---|
| **Skills** | `~/.pi/agent/skills/` | Self-contained workflows the agent loads on demand — one per file |
| **Extensions** | `~/.pi/agent/extensions/` | TypeScript hooks on Pi's lifecycle events — routing, progress, lessons, telemetry |
| **Memory** | `<project>/` + `~/.pi/agent/` | Markdown files that persist across sessions and shape every decision |

### Session lifecycle

1. **Start** — Pi reads the global files (`AGENTS.md`, `STANDARDS.md`, `LESSONS.md`) and, if present, the project's `VISION.md`, `PROGRESS.md` (newest few entries only), and `LESSONS.md`. Then `git log -20` for recent context.
2. **Route** — For every message, two things point the agent at the right skill: Pi's native self-selection (skill names + descriptions live in the system prompt) and the `skill-router` extension (deterministic keyword match → a one-line routing hint). Explicit `/skill:name` always works too.
3. **Run** — The skill executes. `session-summary` keeps a rolling `PROGRESS.md` entry, `extract-patterns` collects lesson candidates, and `telemetry` records real token usage and lesson citations.
4. **End** — The rolling progress entry is finalized. If Pi is killed hard, the next session's start hook finalizes the stale entry automatically.

### Design principles

- **Skills over monolith** — each skill owns one workflow; they compose by reference, not by concatenation.
- **Memory over amnesia** — `VISION.md`, `LESSONS.md`, and `PROGRESS.md` accumulate across sessions.
- **Triage over uniform process** — a throwaway spike and a real feature don't get the same ceremony.
- **Verification over assertion** — never claim "done" without fresh test/build/command output in the message.
- **Git is the safety net** — destructive maintenance runs only on a clean tree, and `git diff` is the review.

---

## Skills

Skills live at `~/.pi/agent/skills/`. Say what you want in natural language and the matching skill loads; or invoke it explicitly with `/skill:name`.

| Skill | Use it when | What it does |
|---|---|---|
| [scaffold](agent/skills/skill-scaffold.md) | Starting a genuinely new project | Triage → discovery → `VISION.md`, `PLAN.md`, `TASKS.md`, repo, deploy |
| [spike](agent/skills/skill-spike.md) | "Can this even work?" | One throwaway script to validate the riskiest assumption, then PROCEED / PIVOT / KILL |
| [grill](agent/skills/skill-grill.md) | A design feels shaky | Adversarial interrogation across 8 dimensions → `.agent/grill/` |
| [plan-then-implement](agent/skills/skill-plan-then-implement.md) | Building a real feature | Read → `PLAN.md` → `TASKS.md` → TDD per phase → acceptance gates |
| [investigate-bug](agent/skills/skill-investigate-bug.md) | Something's broken | 8-step defect investigation → evidence-backed root cause → TDD fix |
| [branch-hygiene](agent/skills/skill-branch-hygiene.md) | Ready to branch or ship | Create `feat/*`, open a PR, or clean up merged branches |
| [gardening](agent/skills/skill-gardening.md) | Memory is getting cluttered | Git-guarded maintenance: intake, merge, demote, compress, archive, report |

`promote-lessons` is a deprecated redirect to gardening's intake pass — the stub stays so explicit invocation still resolves.

### How routing actually works

A skill can fire two ways, and they reinforce each other:

- **Native self-selection.** At startup Pi puts every skill's `name` and `description` into the system prompt. The model reads your message and loads the skill whose description fits. This is why descriptions are written as routing hooks ("Use when something is broken, failing, regressed…").
- **skill-router nudge.** The `skill-router` extension keyword-matches each message against skill trigger phrases and, on a hit, injects a one-line hint (`matches skill: X`) into the system prompt. It's deterministic, fully local, and its decision is shown in the UI — never a silent input rewrite.

Both read the same source of truth: each skill's `description` plus its optional `triggers:` frontmatter list. Explicit `/skill:name` bypasses routing entirely.

---

## Memory

The harness keeps a small set of markdown files per project. They're the difference between an agent that re-learns your project every session and one that remembers.

| File | Scope | Holds |
|---|---|---|
| `VISION.md` | project | What the app is, who it's for, the domain glossary |
| `PLAN.md` | project | The current feature's plan and phases |
| `TASKS.md` | project | Granular `T-NNN` tasks with "done when" criteria |
| `PROGRESS.md` | project | Rolling session summaries, newest first |
| `LESSONS.md` | project + global | Danger zones, gotchas, decisions — `L-NNN` (project) / `GL-NNN` (global) |

### Lesson citations

Every lesson has a stable ID. When a lesson shapes the agent's approach it cites the ID (e.g. "per GL-003"), and the `telemetry` extension records one hit per citation in `lesson-stats.json` (kept out of `LESSONS.md` so the loaded file stays cache-stable). Citations are counted **per message, not per session** — mentioning a lesson once doesn't keep inflating its count for the rest of the session, and IDs that don't exist in `LESSONS.md` are ignored. The stats are a lightweight signal for the human at gardening time — *which lessons actually earn their place* — not an input to any automatic removal. Demotion is always a human decision.

### PROGRESS windowing

`PROGRESS.md` grows forever, but boot only reads the newest few entries (`garden.json → progressWindow.loadEntries`). The rest stays on disk for lazy lookup. Boot cost stays flat no matter how long the file gets — the durable win of the memory system.

---

## Gardening & safety

`/skill:gardening` (or `/gardening`) runs up to 8 maintenance passes over your memory files: intake pending lessons, merge duplicates, demote stale ones, compress over-budget files, archive old progress entries, sweep stale artifacts, review break-in skills, and report. Judgment passes are gated — one `y/n` per pass, never batched.

Safety is **git**, not a hand-rolled guard:

- **`/gardening` refuses to start on a dirty tree.** The command checks `git status --porcelain` in both `~/.pi` and the project and blocks until you commit or stash. A clean starting point means every change gardening makes is visible in `git diff`.
- **`git diff` is the review and `git checkout` is the undo.** Nothing is hard-deleted — stale files are archived — and anything you don't like is one revert away.
- **`--dry` means plan only:** decide and present the changes, write nothing.

`garden.json` holds the tunable parameters (budgets, sweep horizons, autonomy levels). It's advisory config the skill reads — nothing in it is code-enforced. The git guard is the enforcement.

---

## Extensions

Five TypeScript modules in `~/.pi/agent/extensions/` hook Pi's event system:

| Extension | Hooks | What it does |
|---|---|---|
| **skill-router** | `input`, `before_agent_start` | Keyword-matches messages against skill triggers and injects a routing hint into the system prompt. Deterministic, local, zero network calls; routing decisions are surfaced in the UI. |
| **session-summary** | `session_start`, `turn_end`, `session_shutdown` | Maintains a rolling `PROGRESS.md` entry; finalizes stale entries on the next start if a session was killed |
| **extract-patterns** | `agent_end`, `session_shutdown` | Scans assistant messages for lesson candidates → `.agent/lessons-pending.md`; incremental and deduped |
| **telemetry** | `session_start`, `turn_end`, `agent_end`, `session_shutdown` | Records real API token usage, per-message lesson citations, and skill invocations to append-only JSONL with journal recovery |
| **gardening-command** | command | Registers `/gardening`, enforces the clean-tree guard, and loads the gardening skill |

---

## Configuration

Everything is optional — the harness works on defaults.

| File | Location | Purpose |
|---|---|---|
| `AGENTS.md` | `~/.pi/agent/` | Your context: role, stack, platform, operating principles (gitignored — personal) |
| `STANDARDS.md` | `~/.pi/agent/` | Capability mappings and per-stack acceptance gates |
| `LESSONS.md` | `~/.pi/agent/` | Your cross-project lessons (gitignored — personal) |
| `garden.json` | `~/.pi/agent/` | Gardening budgets, sweep horizons, autonomy levels |
| Templates | `~/.pi/agent/templates/` | Scaffold seeds: `VISION.md`, `PLAN.md`, `TASKS.md`, `PROGRESS.md`, `LESSONS.md`, `DECISIONS.md` |

---

## Prerequisites

- **[Pi](https://github.com/badlogic/pi-mono)** — the coding agent this harness runs on
- **Node.js 18+** — Pi runs the TypeScript extensions directly

No third-party API key is required. Skill routing is fully local; the only network calls are the ones your primary model already makes.

---

## File layout

```
~/.pi/agent/                    # Global harness
├── AGENTS.md                   # Your preamble, rules, memory protocol (personal)
├── STANDARDS.md                # Gates + capability mapping
├── LESSONS.md                  # Cross-project lessons (personal)
├── garden.json                 # Gardening config (advisory)
├── lesson-stats.json           # Citation stats (telemetry-maintained, personal)
├── skills/                     # Composable skills (one workflow per file)
├── extensions/                 # skill-router, session-summary, extract-patterns,
│                               #   telemetry, gardening-command
├── references/                 # Lazy-loaded reference docs
└── templates/                  # Scaffold templates

<project>/                      # Per-project memory
├── VISION.md   PLAN.md   TASKS.md   PROGRESS.md   LESSONS.md
└── .agent/                     # Generated: telemetry, pending lessons, grill/, archive/, reports/
```

---

## A note on honesty

This harness has one recurring failure mode worth naming: describing systems that don't actually run. Extensions load at session start, so code written in a session isn't the code running in that session — a fix can only be verified after a restart, by reading back the artifact it produced. That rule is baked into the operating instructions (`GL-013`). If you extend this harness, hold the docs to the same standard: **the README should describe only what executes.**
