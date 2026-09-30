# Pi Harness Seam Audit: `@earendil-works/pi-coding-agent` 0.84.3

*Re-audited 2026-09-11 against the actually-running install. The first version of this file was written against a stale global copy (0.80.3); see "Install finding" below. Read-only: nothing under the install or `~/.pi` was modified during the re-audit.*

**Bottom line:** all four fixes (A bash, B skills, C reads, D token accounting) remain buildable as extensions against 0.84.3. Every seam the plan depends on still exists, with these signature changes that matter:

1. `pi.appendEntry()` is now `appendEntry(customType, data)` — a two-arg call, not the old one-arg form.
2. `ToolResultEvent` gained a `usage` field; `tool_result` handlers can now return `{content?, details?, isError?, usage?}`.
3. `ToolCallEventResult` gained a `terminate?` field (still block-only, cannot substitute a result).
4. `ToolDefinition` fields are `promptSnippet` / `promptGuidelines` (renamed from the prior `snippet` / `guidelines`); `execute` returns `AgentToolResult` (`{content, details, usage?, addedToolNames?, terminate?}`).
5. Skill loader now **validates names** (`[a-z0-9-]+`, ≤64 chars, no leading/trailing `-`, no `--`) and **requires a description ≤1024 chars**. `triggers:` is still ignored.
6. The system prompt now lists skills in **XML `<available_skills>` format**; `disable-model-invocation` skills are excluded. Description is still the only routing signal.
7. A **`powershell` built-in tool** now exists (8 built-ins total: bash, edit, find, grep, ls, powershell, read, write).

Every citation is `file:line` in the installed code that actually runs (`dist/` JS and `.d.ts`), in local files, or in session JSONL. "~tok" means characters ÷ 4, pi's own estimator.

**Path prefixes used below**
- No prefix (`dist/…`) → `F:\Development\pi-web\node_modules\@earendil-works\pi-coding-agent\`
- `core:` → `…\pi-coding-agent\node_modules\@earendil-works\pi-agent-core\dist\`
- `ai:` → `…\pi-coding-agent\node_modules\@earendil-works\pi-ai\dist\`
- `ext:` → `C:\Users\Kasim Alam\.pi\agent\extensions\`
- `agent:` → `C:\Users\Kasim Alam\.pi\agent\`
- `sessions:` → `agent:sessions\`

## ⚠ Install finding: two pi installs, and the audit-vs-install mismatch

The prior audit was produced against the **global** install `C:\Users\Kasim Alam\.npm-global\node_modules\@earendil-works\pi-coding-agent`, which is **0.80.3**. The **running** harness is **0.84.3** at `F:\Development\pi-web\node_modules\@earendil-works\pi-coding-agent`.

Evidence:
- `F:\Development\pi-web\node_modules\.bin` is at PATH position 5; `C:\Users\Kasim Alam\.npm-global` is at position 49. `pi` resolves to the pi-web local copy → `pi --version` prints **0.84.3**.
- `npm_package_name=@agegr/pi-web`, `INIT_CWD=F:\Development\pi-web` — sessions are launched by `@agegr/pi-web` (a Next.js app) which pins `@earendil-works/pi-coding-agent: 0.84.3` in its `package.json`.
- 0.84.3's `dist/core/tools/` contains `powershell.js`; 0.80.3's does not. The live session exposes a `powershell` tool ⇒ running 0.84.3.
- `agent:settings.json` is uncommitted-modified with `lastChangelogVersion: 0.80.3 → 0.84.3` and `defaultThinkingLevel: medium → high` — pi auto-bumps this field when it runs. There was **no downgrade**; the global 0.80.3 is a stale, PATH-shadowed copy.

**Consequence for the plan:** every `file:line` in the first audit bound 0.80.3's `dist`. The agent loop moved into `pi-agent-core/dist/harness/`, `agent-session.js` was split into `agent-session-runtime.js` / `agent-session-services.js`, and a new `sdk.js` / `event-bus.js` layer appeared. This re-audit re-verifies every seam and fix against 0.84.3. Where session-history evidence is quoted (the ≈254k / ≈922k / 20× numbers), it is carried over unchanged — it is recorded JSONL, independent of install version.

## Seam table

| Seam | Exists? | Verified at | Notes |
|---|---|---|---|
| `tool_result` | Yes | `agent-session.js:242-266` (`afterToolCall` hook); dispatched by `runner.js:649-698` (`emitToolResult`) | Can replace `content` fully. Handlers chain. Partial patches work. Event now carries `usage`. |
| `tool_call` | Yes, **block only** | `agent-session.js:222-240` (`beforeToolCall`); `runner.js:701-719` (`emitToolCall`) | Returns `{block, reason, terminate?}`. No way to substitute a result. A throwing handler rethrows and blocks. |
| `context` | Yes | `runner.js:747-775` (`emitContext`) | Gets a `structuredClone` copy. Changes apply to that one request only. Messages can be removed/replaced. |
| `input` | Yes | `runner.js:930-957` (`emitInput`) | Fires before skill/template expansion. `steer()` and `followUp()` skip it (`agent-session.js:983-1030`). |
| `before_agent_start` | Yes | `runner.js:837-889` (`emitBeforeAgentStart`) | System prompt change lasts one prompt, then resets. Multiple extensions chain. `systemPromptOptions` present. |
| Built-in tool override by name | Yes | `agent-session.js:2030-2100` (`_refreshToolRegistry`) | An extension tool silently replaces the built-in with the same name; among extensions, first registration wins (`runner.js:281-297`). |
| `pi.appendEntry` | Yes, not sent to the LLM | `agent-session.js:1954-1955` → `session-manager.js:820-832` | Writes `type:"custom"` entries; the context builder skips them (`session-manager.js:164-175`). **Now `appendEntry(customType, data)`.** |
| `ctx.getContextUsage()` | Yes, one number | `agent-session.js:2632-2681` | Returns `{tokens\|null, contextWindow, percent\|null}`. `tokens` is `null` after compaction until the next response. No per-layer breakdown. |

## Step 0: What's layered on top of pi (0.84.3)

**Settings and project directories**
- `agent:settings.json` has no `extensions` or `packages` keys, so only the standard directories load. It currently records `lastChangelogVersion: 0.84.3` (uncommitted), `defaultProvider: deepseek`, `defaultModel: deepseek-v4-pro`, `defaultThinkingLevel: high`, `theme: dark`.
- `CONFIG_DIR_NAME` is `.pi` (`config.js:402`). Project-local resources live at `cwd/.pi/`.
- No `.agents/` directory exists in any location checked.
- The trust store `agent:trust.json` is still absent (the file `ProjectTrustStore` reads/writes — `trust-manager.js:157-160`).

**Context files**
- The global `agent:AGENTS.md` loads every session; project `AGENTS.md` / `CLAUDE.md` (candidates: `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD` — `resource-loader.js:33`) are taken from cwd and each ancestor, and are **not** trust-gated (only `.pi/` resources and `.agents/skills` are — `trust-manager.js:140-161`).
- `SYSTEM.md` and `APPEND_SYSTEM.md` now also load from project `.pi/` and global agent dir (`resource-loader.js:810-825`).

**Extensions** (unchanged set; same local files, now running against 0.84.3)

| Extension | Location | Events hooked | Tools | Commands | Overrides a built-in? | Provenance |
|---|---|---|---|---|---|---|
| extract-patterns | `ext:extract-patterns/index.ts` | `agent_end`, `session_shutdown` | none | none | No | Local |
| gardening-command | `ext:gardening-command/index.ts` | none | none | `gardening` | No | Local |
| learning-state-manager | `ext:learning-state-manager.ts` | `message_end` (strips telemetry JSON) | none | none | No | Local |
| lobdell-timer | `ext:lobdell-timer.ts` | `session_start`, `input`, `message_end` | none | none | No | Local |
| passivity-interceptor | `ext:passivity-interceptor.ts` | `input` (rewrites to `/skill:feynman-recite`) | none | none | No | Local |
| session-summary | `ext:session-summary/index.ts` | `session_start`, `turn_end`, `session_shutdown` | none | none | No | Local |
| skill-router | `ext:skill-router/index.ts` | `input`, `before_agent_start` | none | none | No | Local |
| telemetry | `ext:telemetry/index.ts` | `session_start`, `turn_end`, `agent_end`, `session_shutdown` | none | none | No | Local |
| telepi-handoff | `ext:telepi-handoff.ts` | none | none | `handoff` | No | **Packaged** |

**Load order.** `discoverAndLoadExtensions` (`loader.js:610-647`): project `.pi/extensions` → global `agent/extensions` → configured paths. Within a directory, raw `readdirSync` with no sort (`loader.js:580-601`). On NTFS that is alphabetical (not observed at runtime):

> extract-patterns → gardening-command → learning-state-manager → lobdell-timer → passivity-interceptor → session-summary → skill-router → telemetry → telepi-handoff

Handlers run in that extension order (`runner.js:649-698`, `701-719`, `747-775`, `930-957`).

**Q1. Does anything hook `tool_result`?** No. A `bash-quiet` extension would be the only handler. The two `message_end` rewriters touch assistant messages, not tool results.
**Q2. What hooks `input`, `before_agent_start`, or `context`?** `input`: lobdell-timer, passivity-interceptor, skill-router. `before_agent_start`: skill-router only. `context`: nothing.
**Q3. Does any extension override a built-in tool?** No. No local extension calls `registerTool`.
**Q4. Which tools do extensions register?** **None.** The only tools are the 8 built-ins.

**Q5. Skills.** Same set as before (11 `skill-*.md` tracked + 8 untracked `*/SKILL.md` folders). Loader facts that changed since 0.80.3:
- `loadSkillFromFile` reads only `frontmatter.name`, `frontmatter.description`, `frontmatter["disable-model-invocation"]` (`skills.js:208-268`). `triggers:` is ignored (`SkillFrontmatter` has `[key:string]:unknown`).
- **New validation:** name must match `[a-z0-9-]+` and be ≤64 chars; description is **required** and ≤1024 chars (`skills.js:61-87`). Violations are warnings, not load failures — but an empty/missing description drops the skill.
- `formatSkillsForPrompt` renders XML `<available_skills><skill><name><description><location>` and filters out `disableModelInvocation` skills (`skills.js:275-306`). The skill section is appended to the system prompt only when the `read` tool is active (`system-prompt.js:29,113-114`).
- Project-local skills load from `cwd/.pi/skills`; global from `agent/skills`; global wins on name collision (`skills.js:309-400`).

## Step 1: Version

- **Running pi: 0.84.3**, `@earendil-works/pi-coding-agent`, launched by `@agegr/pi-web` from `F:\Development\pi-web\node_modules\...\dist\bundle\cli.js`.
- `pi-agent-core`, `pi-ai`, `pi-tui` are all 0.84.3, nested under `pi-coding-agent/node_modules/@earendil-works/`.
- A **stale 0.80.3** sits at `C:\Users\Kasim Alam\.npm-global\node_modules\...` and is shadowed on PATH. It is not what runs.
- Only `dist/` is present; source maps embed the TypeScript.
- **Extension type definitions:** `dist/core/extensions/types.d.ts`, re-exported from `dist/index.d.ts`. At runtime, extension imports resolve to the running package via the loader's virtual-module map and `resolveWorkspaceOrImport` aliases (`loader.js:31-55, 84-106`) — both `@earendil-works/` and `@mariozechner/` scopes map to the running package.

## Step 2: The seams

### 1. `tool_result`: exists

- **Signature:** `on("tool_result", ExtensionHandler<ToolResultEvent, ToolResultEventResult>)`.
- **Event:** `{type, toolCallId, toolName, input: Record<string,unknown>, content, isError, details, usage?}` (`types.d.ts:719-756`). Built-in tools narrow via exported guards `isBashToolResult`, `isReadToolResult`, etc. (`index.d.ts`).
- **Return:** `{content?, details?, isError?, usage?}` (`types.d.ts:820-824`).
- **Wiring:** `agent-session.js:242-266` — `afterToolCall` fires after execution with `{toolCall, args, result, isError}`; it calls `emitToolResult` (only if a handler exists) and applies the returned fields. `content` defaults back to the original if not replaced.
- **Chaining:** handlers run in load order, share one mutated `currentEvent` (`runner.js:649-698`). A handler that throws is logged and skipped — a bug degrades to current behavior, not a session break.
- **Partial patches:** only non-`undefined` returned fields are applied (`runner.js:665-684`). Returning `details: undefined` means "no change", not "clear".

Limits (unchanged semantics): only runs when a handler exists; does not fire for not-found / invalid-argument / blocked calls; does fire when a tool throws (the agent loop finalizes the result as `isError: true`).

### 2. `tool_call`: exists, block only

- **Signature:** `on("tool_call", ExtensionHandler<ToolCallEvent, ToolCallEventResult>)`.
- **Event:** `{type, toolCallId, toolName, input}` (`types.d.ts:709-718`). `event.input` is mutable in place; mutations are not re-validated.
- **Return:** `{block?: boolean, reason?: string, terminate?: boolean}` (`types.d.ts:803-814`). First `block` stops the chain.
- **No substitution.** There is no result field. The model sees a blocked call as an error result with text = `reason`.
- **A throwing handler blocks:** `beforeToolCall` wraps `emitToolCall` in try/catch and rethrows (`agent-session.js:222-240`); the agent loop turns it into a blocked, errored call.

### 3. `context`: exists

- **Signature:** `on("context", ExtensionHandler<ContextEvent, ContextEventResult>)`. Event `{messages}`; return `{messages?}`.
- **Deep copy:** `emitContext` does `structuredClone(messages)`, then chains, each handler seeing the prior's array (`runner.js:747-775`).
- **This request only.** The result is a local variable for one LLM call; session history is untouched.
- **Messages can be removed/replaced.** Returned array replaces the list with no validation.
- Rewriting earlier messages changes the prompt prefix and breaks provider prompt caching. `getContextUsage()` still measures the unmodified messages.

### 4. `input`: exists

- **Event:** `{text, images?, source, streamingBehavior?}`. **Return:** `{action:"continue"} | {action:"transform", text, images?} | {action:"handled"}`.
- **Ordering:** extension commands are dispatched first, then `input` fires, then skill/template expansion (`agent-session.js:920-955`). The handler sees raw `/skill:name` text.
- **`steer()` / `followUp()` bypass `input`** and expand skills directly (`agent-session.js:989-1030`). Callers: RPC `steer`/`follow_up`, and the TUI's replay of queued messages during compaction.

### 5. `before_agent_start`: exists

- **Event:** `{prompt, images?, systemPrompt, systemPromptOptions}`. **Return:** `{message?, systemPrompt?}`.
- **Per prompt, not persistent.** Multiple extensions chain (`runner.js:837-889`). A returned `message` becomes a `custom_message` entry (sent to the LLM, stays in history). `systemPromptOptions` now carries structured `contextFiles` / `skills` for inspection.

**New in 0.84.3 (useful for Pass 5 accounting):** `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `message_start`, `message_update`, `agent_settled`, `turn_start`, `before_provider_request`, `before_provider_headers`, `after_provider_response`, `resources_discover`, `user_bash`, `model_select`, `thinking_level_select`, and the `session_before_*` / `session_compact*` family. All are `on(...)` overloads on `ExtensionAPI` (`types.d.ts:891-927`).

## Step 3: The four fixes (re-verified against 0.84.3)

### A. Bash output truncation: implementable as an extension

- **Current limits:** tail truncation at **2,000 lines or 51,200 bytes (50 KB)**, whichever first (`truncate.js:10-11`). Full output goes to a `pi-bash*` temp file **only when truncated** (`bash.js:290-341`).
- **Utilities importable:** `truncateHead`, `truncateTail`, `truncateLine`, `formatSize`, `DEFAULT_MAX_BYTES` (`50*1024`), `DEFAULT_MAX_LINES` (`2000`) — all exported from the package root (`index.d.ts`; `tools/index.js:9`). Real values at runtime via the loader alias.
- **Success signal:** `tool_result` has **no exit code** — only `isError` and text. `BashToolDetails` is `{truncation?, fullOutputPath?}` (`bash.d.ts:16-19`). Exit 0 → `isError:false` with `details` set only if truncated. Non-zero exit → `throw` → `isError:true` with `details` lost (`bash.js:351-353`). Timeouts and aborts are also `isError:true` (`bash.js:344-350`).
- **Approach (unchanged from plan):** handle `tool_result` where `toolName === "bash"`, `!isError`, and `event.input.command` matches a verification pattern. Write full output to an extension-owned temp file; return only `{content: [{type:"text", text:"✓ passed · N lines · full: <path>"}]}`. Omit `details`. Leave failures untouched.
- **Evidence (carried over, session-JSONL):** ≈254k tok of successful verification-style bash output over 800 chars; ≈922k tok of other successful bash output; failures ≈275k tok (kept).

### B. Skill injection dedup: the biggest cause was local (unchanged conclusion)

- **Where pi decides (0.84.3):** the system prompt lists each skill's name/description/location in XML and instructs "Use the read tool to load a skill's file when the task matches its description" (`skills.js:275-306`). Explicit `/skill:name` pastes the body (`_expandSkillCommand`, `agent-session.js:956-982`). pi has **no keyword matching**.
- **The local `skill-router`** is the keyword matcher; its hint ("Invoke /skill:X now") tells the model to run a slash command, which only user input expands — structurally unfollowable, and it ignores `disable-model-invocation`. (To be deleted in Pass 1.)
- **`passivity-interceptor`** rewrites passive replies to `/skill:feynman-recite` — the latent 20×-injection pattern. (To be deleted.)
- **Evidence (carried over):** 20× `investigate-bug` ≈18.8k tok; Whisper-VTT ×33 ≈31k tok each; zero router-caused blocks since skill-router replaced classifier-router.

### C. Read caching and large files: implementable as an extension

- **Read schema:** `{path, offset? (1-indexed), limit?}` (`read.js:17-20`; `read.d.ts:4-8`). `details` is `{truncation?}`. Offset beyond EOF throws (`read.js:204`).
- **`createReadToolDefinition(cwd, options?)`** is exported from the package root (`index.d.ts`; `tools/index.js:8`). It returns `ToolDefinition<readSchema, ReadToolDetails|undefined>` including the built-in `promptSnippet` / `promptGuidelines` / `renderCall` / `renderResult`. **Rebuild the override by spreading it** — writing from scratch loses the prompt contribution ("Read file contents" / "Use read to examine files instead of cat or sed.") and renderers.
- **Override mechanics:** `registerTool({name:"read", …})` replaces the built-in silently; first extension registration wins, no warning (`agent-session.js:2030-2100`; `runner.js:281-297`).
- **`execute` shape to match:** `execute(toolCallId, params, signal, onUpdate, ctx)` returning `Promise<AgentToolResult<TDetails>>` = `{content, details, usage?, addedToolNames?, terminate?}` (`types.d.ts:344-386`; `core:types.d.ts:316-337`). Throw on failure so `isError` is set.
- **Cache helpers available to extensions:** `ctx.sessionManager` is a `ReadonlySessionManager` exposing `getBranch`, `buildContextEntries`, `getEntries`, `getLeafEntry`, `getEntry` (`session-manager.d.ts:140`). `getLatestCompactionEntry(entries)` is a standalone package-root export; `CompactionEntry` has `firstKeptEntryId` (`session-manager.d.ts:39,146`).
- **Caveats:** only return a reference if the original result is still present on the branch after the latest compaction's `firstKeptEntryId`. Invalidate on `edit`/`write` of that path (hook `tool_result` for `edit`/`write`, or the new `tool_execution_end`).
- **Evidence (carried over):** KBD 87% repeat reads (`kbd_homepage.html` ×68); Whisper-VTT 71% (`__main__.py` ×30); DirftScout 74%.

### D. Token accounting by layer: implementable as an extension (estimates only)

- **`ctx.getContextUsage()`** returns `{tokens:number|null, contextWindow, percent:number|null}`. `tokens` = last valid assistant usage + chars/4 estimate of trailing messages; `null` after compaction until the next response (`agent-session.js:2632-2681`).
- **`pi.appendEntry(customType, data)`** → `appendCustomEntry` → `{type:"custom", customType, data}`. Custom entries are excluded from LLM context (`session-manager.js:164-175, 820-832`).
- **`estimateTokens`** (chars/4; assistant blocks count thinking + toolCall name+args) and **`parseSkillBlock`** (`<skill name="X" location="Y">…</skill>` + optional trailing user message) are exported from the package root (`index.d.ts`; `compaction.js:188-217`; `agent-session.js:45-56`).
- **Only assistant messages carry `usage`** (per-API-call totals; `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `cost`). User and tool-result messages have no token fields.
- **The local `telemetry` extension** already hooks `session_start`, `turn_end`, `agent_end`, `session_shutdown` and logs per-turn cumulative usage — extend it, don't fork it.
- **Exact per-layer counts remain impossible** — providers report totals only. Label as calibrated estimates and surface the calibration delta.

## Step 4: The prior audit's open questions (re-verified)

**1. "Extension tools self-gate; `tool_call` fires only for built-ins" — still REFUTED.**
- The single dispatch point is now in `pi-agent-core`'s agent loop (`core:harness/`), wired by `agent-session.js:221-267` via `beforeToolCall` / `afterToolCall`. It applies to *any* tool, built-in or extension. Moot here anyway: no local extension registers a tool.

**2. "The trust gate resolves silently in non-interactive modes" — still CONFIRMED, default DENY.**
- Order in `resolveProjectTrusted` (`project-trust.js:21-58`): (1) `trustOverride` CLI flag; (2) no trust-requiring resources → trusted; (3) `project_trust` extension handler; (4) stored decision (`agent/trust.json`); (5) `defaultProjectTrust` (`always`/`never`/`ask`); (6) **no UI → `false`, silent**; (7) prompt.
- Trust-requiring = `cwd/.pi/{settings.json, extensions, skills, prompts, themes, SYSTEM.md, APPEND_SYSTEM.md}`, or `.agents/skills` in cwd or any ancestor (`trust-manager.js:140-161`).
- The trust store is `agent/trust.json` (`trust-manager.js:157-160`). **It does not exist yet** — so the first run in any `.pi`-bearing project must be interactive, or skills/extensions silently won't load.
- `ctx.hasUI` is `true` in TUI and RPC; `false` in print/json. The trust gate's own `hasUI` is a separate value (mode-derived); in `-p` / `--mode json` / `--mode rpc` non-interactive paths it is `false` → silent deny.

## Step 5: Verdict

**What caused each problem** (unchanged from prior audit):

| Fix | Cause |
|---|---|
| **A. Bash output** | **pi.** Successful commands return up to 2,000 lines / 50 KB and nothing shrinks successful output. |
| **B. Skill injection** | **Local.** 20× came from the deleted `classifier-router`; today's under-loading comes from `skill-router`'s unfollowable hint; `passivity-interceptor` is the latent repeat. |
| **C. Reads** | **pi plus the model.** No read cache, no outline tool; repeats are mostly source files. |
| **D. Accounting** | **pi.** Only per-call totals exist; the local `telemetry` extension already covers part of it. |

- **Buildable as extensions with no harness changes:** A, B, C, D — all four, against 0.84.3.
- **Needing a patched pi:** none. (Dedupe of `/skill:` on the `steer`/`followUp` paths would need a patch *before* expansion; the `context` workaround covers it. A result-substituting `tool_call` isn't needed because overriding `read` covers C.)
- **Build first:** **A** (a ~30-line `tool_result` extension), per the plan.

**Other local issues noticed** (left untouched):
- `/gardening` injects nothing. `ctx.injectContext` does not exist on `ExtensionContext` (`types.d.ts:209-287`); the command is guarded by `typeof ctx.injectContext === "function"`, so it falls through to `ctx.ui.notify(...)` and `return {contextInjection: skillContent}` — and pi ignores command return values (`agent-session.js:932-938`). The git guard also blocks it on a dirty tree.
- `lobdell-timer` appends ~0.5 KB to every assistant message after 30 minutes; persisted to history, re-sent every later turn.
- `agent:AGENTS.md:49` refers to `/skill:branch`, which does not exist (the skill is `branch-hygiene`); pi passes unknown slash commands through as literal text (`agent-session.js:966-967`).
- The deprecated `promote-lessons` stub is still listed in every system prompt (no deprecation filter).
