# Pi Agent Harness

![Node.js](https://img.shields.io/badge/Node.js-22%2B-brightgreen?style=flat-square) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue?style=flat-square)

A solo-developer harness for the [Pi coding agent](https://github.com/earendil-works/pi). It gives Pi a set of composable **skills**, persistent per-project **memory**, and event-driven **extensions** — so the agent plans before it builds, remembers what it learned, controls its own token cost, and keeps its memory healthy over time.

Skill selection is model-driven: Pi lists every skill's name and description in the system prompt, and the model loads the one that fits. There is no keyword router, no classifier, and no per-message network call for routing.

Built and verified against **pi 0.84.3** (the version bundled with pi-web).

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

Prefer a GUI? The harness pairs with **pi-web** (`@agegr/pi-web`): `npm i -g @agegr/pi-web && pi-web`, then open `http://localhost:30141`.

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
| [browser](agent/skills/skill-browser.md) | A page must be driven or scraped | Drives a real browser via the `agent-browser` CLI — navigate, fill, click, screenshot |
| scaffold-learning | Starting a *learning* project | Interview → 20-hour curriculum → `.agent/learning/` (hidden from the model; explicit `/skill:scaffold-learning` only) |

Descriptions are the routing signal: each states what the skill is for **and** what it is not (its neighbour), so adjacent skills don't shadow each other.

---

## Model pinning

`agent/models.json` pins the model record so a session cannot silently resolve to a different one.

It sets two things for `deepseek-flash`, and the distinction matters:

- **`models`** — declares the id, so it exists even on a pi build with no remote catalog (0.80.3 has none, and cannot resolve `deepseek-flash` without this).
- **`modelOverrides`** — patches name, cost, context window, max output, `input: ["text","image"]`, and the thinking compat. On 0.84.3 this is the topmost config layer, applied after the remote catalog overlay.

**What this does and does not do.** It stabilises *fields* on a record that resolves. It does not guarantee the id exists: if upstream drops `deepseek-flash` and no bundled catalog carries it, there is nothing to patch and the session falls back to another model. A malformed `models.json` can also return an empty config silently, which would look pinned but not be.

Both are why every session writes a `boot` record naming what actually served it — see [Observability](#observability).

> The retired id `deepseek-v4-flash` is a bundled snapshot of a model DeepSeek no longer serves (it routes to V4.1 Flash and bills at the Flash price). Its bundled record declares `input: ["text"]`, so selecting it **silently omits images from every request**. It is overridden here to the V4.1 Flash capability set, and `defaultModel` is `deepseek-flash`, not the retired id.

---

## Token-cost control & cost model

### What the layers actually cost

Measured over a week of real telemetry, at DeepSeek's published rates:

| Layer | Share of Flash spend | Share of tokens |
|---|---|---|
| Cache-hit input | **~63%** | ~99.4% |
| Output (incl. thinking) | ~23% | ~0.2% |
| Cache-miss input | ~13% | ~0.4% |

Context dominates by volume; **output dominates by marginal value** — an output token costs **200×** a cache-hit token, and a cache-miss costs **50×**. That is why context reduction and output reduction are different projects with very different value per token.

### Off-peak pricing

DeepSeek bills **peak** rates as the base and **off-peak at exactly half**. Peak is Mon–Fri **01:00–04:00 and 06:00–10:00 UTC**; everything else is off-peak. Measured over the invoice window, **77% of tokens fall off-peak** (64% of cost — output is weighted toward peak hours).

The model `cost` blocks hold the peak rate, and nothing in the stack applied the discount — so the harness's own spend figure was **~2× too high**. The weekly report now applies the multiplier per record timestamp (a session can span both bands, so a per-session bucket would reintroduce the error).

Measured over 2026-09-10 → 2026-09-17: peak-rate total **$40.00** became **$23.69** adjusted, against a provider invoice of **$21.45** for the same window.

### Extensions

| Piece | What it does |
|---|---|
| **reasoning-level** | Turns thinking **off** after 3 consecutive inspections — a read sweep, where the reasoning between inspections is trivial — and back on for a write, tool error, non-inspection work, a new prompt, or a user-asserted level. Deterministic (needs no agent compliance) and turn-neutral. |
| **`/tokens`** | On-demand breakdown of the current session: system prompt, then per-layer estimates (user text, skill blocks, read results, bash results, thinking, tool-call args, assistant text) plus the calibration delta vs the provider's real total. Labeled as estimates — providers report totals, never per-layer splits. |

**What `reasoning-level` is worth, measured rather than asserted.** Reasoning is **46% of all output tokens** (77% on V4 Pro, 36% on Flash). Priced at live rates that is roughly **9% of Flash spend** — a real but modest lever, not the headline. Independent prior work reached a similar estimate.

The `off` transition is verified live against the API: `thinking: {type: "disabled"}` suppresses `reasoning_content` entirely, while `enabled` produces it. Graduated levels map to `reasoning_effort` and are sent, but DeepSeek's own docs collapse `low`/`medium`/`high` to three discrete levels, so treat them as coarse.

Two output-suppression extensions — `bash-quiet` and `read-cache` — were **removed** after replaying recorded sessions through their own logic showed they cost more than they saved: bash-quiet's hidden output was refetched **109%** of the time (net −2,271 tokens), and its >200-line path never fired across 38.8 hours. Recorded as GL-028 in `agent/LESSONS.md`.

### Compaction

`settings.json` sets `compaction.reserveTokens: 400000`, so on a 1M-token window compaction fires at **60%** rather than pi's default of ~98%. A second user therefore cannot drift to the top of the window before anything intervenes.

Two caveats, stated because they are real: the reserve is a **fixed token subtraction, not a fraction** — on a model with a smaller window the same number is a much larger share, and below ~400K it would compact continuously. Pi does not guard against that. And compaction **invalidates the cached prefix**, so compacting more often costs more misses; measured, that is negligible (a 478K-token miss is roughly $0.07).

### Visibility

You don't have to remember to look:

- A one-line **cost warning** fires once per session when the off-peak-adjusted estimate passes $0.50.
- A one-line **session summary** at shutdown: estimated cost, model exchanges, user prompts.
- `/tokens` on demand.

---

## Observability

Every session writes a `boot` record so a drift is visible rather than inferred. This is a real record, abbreviated:

```jsonc
"harness.model": {
  "id": "deepseek-flash", "name": "DeepSeek V4.1 Flash", "provider": "deepseek",
  "input": ["text", "image"], "contextWindow": 1000000,
  "cost": { "input": 0.3, "output": 1.2, "cacheRead": 0.006, "cacheWrite": 0 },
  "source": "override",            // override | cache | bundled
  "catalogLastModified": "2026-09-10T12:33:10.000Z",
  "pinned": true
},
"harness.pi": { "version": "0.80.3", "surface": "cli" }   // surface: cli | pi-web | unknown
```

Observed values above are from the CLI. `surface` is `pi-web` when the host sets `NEXT_RUNTIME`, which pi-web does as a Next.js server; if no marker matches it records `unknown` rather than guessing, so treat an unexpected `unknown` as "field present, detection failed" rather than as a bug in the session.

`source` and `pinned` are the fields that make a failed pin loud: if `pinned` is false or `source` is `bundled`, the pin is not in effect. `input` tells you whether images will survive the request.

Turn counts are recorded as **two** distinct numbers, because they are not the same quantity: `turn_index` counts **model exchanges**, `user_turns` counts **your prompts**. One prompt spans several exchanges whenever tools run, and pi re-enters its loop for retries and compaction without a new user message.

---

## Weekly report (`weekly-report/`)

A companion app that reads the telemetry JSONL and posts a weekly digest to Discord: sessions, commits, token volume, **estimated spend (off-peak adjusted)**, context reuse, cost outliers, dormant skills, and a four-week trend.

```bash
cd ~/.pi/weekly-report
npm install
npm run dry        # writes the local report, no Discord POST
npm run typecheck
```

It keeps its own `.gitignore`, so the repo ships **source only** — `.secrets.json` (your Discord webhook), `reports/`, `history.json`, run logs, and the launcher scripts (which embed absolute user paths) stay local. Set `DISCORD_WEBHOOK_URL` or create `.secrets.json` to enable posting; a scheduled task or logon trigger runs it at most once a week.

It also **flags** sessions that resolved to a retired id or a stale rate schedule rather than silently repricing them — a stale record means the arithmetic is on the wrong schedule, and rewriting it would hide that.

> The report is an **estimate**: tokens × the resolved model record's rate, with the off-peak discount applied. It is not API billing, and the provider's own usage page is the authority.

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

### The extension guard

```bash
node ~/.pi/run-extension-tests.mjs      # from any directory
```

Every test file is declared explicitly, each is run separately with its own count asserted against a floor, and the run **refuses** if a declared file is missing or an undeclared `*.test.ts` exists on disk. A glob would match only what happens to be there, so a file nobody named would silently never run.

It also refuses any extension entry point that does not `export default` a factory — a direct `agent/extensions/*.ts` **or** a `<subdir>/index.ts|js`. Pi loads every one of those at startup, so a file without a default factory breaks pi **in every project**, and the symptom appears three layers away in whatever consumed pi.

---

## Extensions

Five modules in `~/.pi/agent/extensions/`:

| Extension | Hooks | What it does |
|---|---|---|
| **telemetry** | `session_start`, `turn_end`, `agent_end`, `session_shutdown`, `context`, `message_start`, `before_agent_start`, `message_end` | Append-only JSONL of token usage, cost, and skill/lesson activity; writes the boot record; registers `/tokens` |
| **session-summary** | `session_start`, `turn_end`, `session_shutdown` | Maintains a rolling `PROGRESS.md` entry; finalizes stale entries on next start |
| **extract-patterns** | `agent_end`, `session_shutdown` | Scans assistant messages for lesson candidates → `.agent/lessons-pending.md`; incremental and deduped |
| **reasoning-level** | `session_start`, `session_shutdown`, `before_agent_start`, `message_start`, `thinking_level_select`, `agent_settled`, `tool_call`, `tool_result` | Turns thinking off for read sweeps and back on for real work |
| **telepi-handoff** | command | Registers `/handoff` (packaged, not authored here) |

Extensions load at **session start**. Code written during a session is not the code running in that session, so a change to one of these is only verified after a restart, by reading back the artifact it produced.

---

## Configuration

Everything is optional — the harness works on defaults.

| File | Location | Purpose |
|---|---|---|
| `AGENTS.md` | `~/.pi/agent/` | Your context: role, stack, platform, operating principles (gitignored — personal) |
| `STANDARDS.md` | `~/.pi/agent/` | Capability mappings and per-stack acceptance gates |
| `LESSONS.md` | `~/.pi/agent/` | Your cross-project lessons (gitignored — personal) |
| `garden.json` | `~/.pi/agent/` | Gardening budgets, sweep horizons, autonomy levels |
| `settings.json` | `~/.pi/agent/` | Provider/model/thinking defaults, compaction thresholds |
| `models.json` | `~/.pi/agent/` | Model-record pin: id presence + field overrides |
| Templates | `~/.pi/agent/templates/` | Scaffold seeds: `VISION.md`, `PLAN.md`, `TASKS.md`, `PROGRESS.md`, `LESSONS.md`, `DECISIONS.md` |

---

## Prerequisites

- **[Pi](https://github.com/earendil-works/pi)** — **0.84.3** recommended (extensions target this version's API)
- **Node.js 22.19+** (pi 0.84.3 declares `engines.node >= 22.19.0`)
- **A model API key** (DeepSeek/OpenRouter/etc.) — supplied by you via `/login` or `auth.json`, never bundled here

> **On pi versions.** The harness runs on both 0.80.3 and 0.84.3, but they are not equivalent. 0.84.3 ships a **remote model catalog** (`https://pi.dev`, cached to `models-store.json`, 4h TTL) that supplies `deepseek-flash` with vision. **0.80.3 has no remote catalog**, so without `agent/models.json` it cannot resolve `deepseek-flash` at all and falls through to a provider with no key. The `models` entry in that file is what makes the CLI work on 0.80.3.

---

## File layout

```
~/.pi/
├── README.md
├── run-extension-tests.mjs     # Guarded test runner (see above)
├── agent/                      # Global harness
│   ├── AGENTS.md               # Your preamble, rules, memory protocol (personal)
│   ├── STANDARDS.md            # Gates + capability mapping
│   ├── LESSONS.md              # Cross-project lessons (personal)
│   ├── garden.json             # Gardening config (advisory)
│   ├── settings.json           # Provider/model/thinking + compaction defaults
│   ├── models.json             # Model-record pin
│   ├── lesson-stats.json       # Citation stats (telemetry-maintained, personal)
│   ├── skills/                 # Composable skills (one workflow per file)
│   ├── extensions/             # telemetry, session-summary, extract-patterns,
│   │                           #   reasoning-level, telepi-handoff
│   ├── references/             # Lazy-loaded reference docs
│   └── templates/              # Scaffold templates
└── weekly-report/              # Discord digest (source ships; secrets do not)

<project>/                      # Per-project memory
├── VISION.md   PLAN.md   TASKS.md   PROGRESS.md   LESSONS.md
└── .agent/                     # Generated: telemetry, pending lessons, grill/, archive/, reports/
```

---

## A note on honesty

This harness has one recurring failure mode worth naming: describing systems that don't actually run. Extensions load at session start, so code written in a session isn't the code running in that session — a fix can only be verified after a restart, by reading back the artifact it produced (`GL-013`). If you extend this harness, hold the docs to the same standard: **the README describes only what executes.**

That standard has teeth. Earlier revisions of this file documented two extensions (`learning`, `passivity`) that had been moved out of the repo, and described the weekly report as living in a separate repo after its source had been absorbed into this one. Both were caught by re-reading the code, not the prose. The same discipline applies to numbers: the spend figure in this README was wrong by ~2× until it was reconciled against a provider invoice rather than against itself.
