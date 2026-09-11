# PLAN — Pass 5: Token accounting by layer

## Goal

Add per-layer token attribution (system prompt, user text, skill blocks, read results, bash results, thinking, tool-call args) to the existing `telemetry` extension, exposed via a `/tokens` command.

## Approach

Extend `agent/extensions/telemetry/index.ts` — do **not** create a parallel extension. It already hooks `session_start` / `turn_end` / `agent_end` / `session_shutdown`, so the new handlers live alongside them and share its state/helpers.

Three new read-only hooks + a command:

1. **`context` handler** — buckets the exact request's messages by layer (char/4 estimates), stores the result in memory, returns nothing (does not modify messages → preserves provider prompt caching).
2. **`before_agent_start` handler** — sizes the system prompt + its `contextFiles` + `skills`, stores in memory.
3. **`message_end` handler** — records the provider's reported `usage` (`input`/`output`/`cacheRead`/`cacheWrite`/`totalTokens`) for calibration.
4. **`pi.appendEntry("tokens", …)`** — persists the latest snapshot as a `custom` entry (excluded from LLM context).
5. **`/tokens` command** — reports the breakdown: `getContextUsage()` total, system-prompt size, per-layer buckets, and the **calibration delta** (sum-of-estimates vs context total).

**Key design decisions:**
- **No runtime imports from the package.** `parseSkillBlock` is re-implemented as a local regex (a global `<skill …>…</skill>` matcher, more robust than the single-block export) and the existing local `estimateTokens` (chars/4) is reused. Rationale: the telemetry extension is critical infrastructure, and the runtime-import path (`@earendil-works/pi-coding-agent`) was never conclusively proven in pi-web RPC during Pass 3 — a load error here would kill *all* telemetry.
- **Read-only `context` handler.** It must never return modified messages (would break prompt caching).
- **Honest precision.** Layer counts are chars/4 estimates; the `/tokens` output labels them "estimated" and shows the delta vs `getContextUsage()`.

## Phases

- **P1 — Bucketing (pure function, testable):** extract `bucketMessages(messages)` → `{ userText, skillBlocks, readResults, bashResults, otherToolResults, thinking, toolCallArgs, assistantText }` (token estimates). Unit-test it.
- **P2 — `context` handler:** call `bucketMessages`, store `lastBuckets`, return nothing.
- **P3 — `before_agent_start` + `message_end` handlers:** size system prompt; capture provider usage.
- **P4 — persistence + command:** `appendEntry` snapshot on `message_end`; `/tokens` command renders the breakdown + delta.
- **P5 — verify:** restart pi, run a real session, compare `/tokens` total vs `getContextUsage()` and vs a manual JSONL parse.

## Files that will change

| File | Change | Phase |
|---|---|---|
| `agent/extensions/telemetry/index.ts` | add `bucketMessages`, 3 handlers, `appendEntry`, `/tokens` command | P1–P4 |
| `agent/extensions/telemetry/buckets.ts` | new pure module for `bucketMessages` + its types (kept testable without pi) | P1 |
| `.agent/scratch/buckets.test.mjs` | unit test for `bucketMessages` | P1 |

## Acceptance criteria

- [ ] `bucketMessages` unit test passes (user/skill/read/bash/thinking/toolCall bucketing).
- [ ] Extension loads with no errors after restart.
- [ ] `/tokens` prints a breakdown with: context total, system-prompt size, per-layer estimates, and a calibration delta.
- [ ] The `/tokens` total is within ~20% of `getContextUsage()`.
- [ ] `appendEntry` data does **not** appear in the LLM context (verify via a fresh session JSONL — `type:"custom"` entries are not sent).
- [ ] A manual JSONL parse of the same session matches the `/tokens` layer split within a stated margin.

## Not in scope

- Exact per-layer counts (impossible — providers report totals only; this is calibrated estimates).
- Pass 4 (outline tool).
- Any change to `pi-agent-core`/`pi-ai` or the provider.
- Fixing the (already-known) cache-read double-count — that was fixed separately in `450dfc1`.

## Open questions

- None blocking. The only assumption is the `context` event message shape (`role` + `content` blocks, `toolResult` carrying `toolName`), which the re-audit already documented.
