# Plan — Thinking off for read sweeps

> Active work plan. One feature/phase at a time. Replace contents when starting a new feature.

## Goal
Stop paying for reasoning during mechanical read sweeps, where the thinking between consecutive
inspections is trivial — the single largest measurable lever on context and cost in this harness.

## Approach
A **deterministic state machine in free hooks**. No agent compliance required, no blocking, no extra
turns.

Three measured findings decide the shape:

1. **The level is read per turn** (`agent-session.js:288` — `prepareNextTurnWithContext` returns
   `thinkingLevel: this.agent.state.thinkingLevel`), so a change made in a `tool_result` handler
   applies to the very next model call.
2. **Turns cost ~200× cached tokens.** Output is $1.20/M against cacheRead $0.006/M. Each tool turn
   generates ~264 tokens of thinking; a token of thinking is worth ~200 tokens of carried context.
   → *Never trade a turn for fewer tokens.* This is why blocking gates are rejected: they buy
   compliance at output prices.
3. **Reads are batched into single commands, not single turns.** 789 file-reading bash calls carried
   1,669 file ops, and 93% of tool turns hold exactly one tool call. The model batches *files per
   command*, which is the efficient shape — so no rule should push it toward one-file-per-call.

Rejected on evidence, not taste:
- **Enforcing the `read` tool over `bash cat`** — converting 789 calls into ~1,669 reads adds ~880
  turns ≈ **+232K output-priced tokens**, against ~205K cached tokens saved. Net ≈ −$0.3 plus an
  earlier compaction.
- **`tool_call` blocking** — each block costs a wasted turn (~264 output tok + a context re-read).
- **`context` injection of reminders** — an injected message changes the context, so it invalidates
  the cached prefix. Not free, contrary to first assumption.
- **Hash-dedupe of repeat reads** — real but small: 52 of 202 distinct paths (26%) re-read,
  ~**17,490 tok** saved, and it costs shell parsing plus a cache reset per substitution. Deferred.

### The state machine

```ts
const INSPECT = /(^|[\s;&|])(cat|head|tail|sed -n|ls|rg|grep|find|wc|git (status|log|diff|show))\b/;
const INSPECT_TOOLS = new Set(["read", "grep", "ls", "find"]);
const THRESHOLD = 3;

session_start      -> baseline = pi.getThinkingLevel()
before_agent_start -> run = 0; apply(baseline)        // once per user prompt
tool_result        -> isError                       -> run = 0; apply(baseline)
                      inspecting (tool/command match) -> run++ ; run >= 3 && apply("off")
                      otherwise                     -> run = 0; apply(baseline)
apply(next)        -> no-op when next === current     // an unchanged level costs nothing
```

Rationale for the threshold of 3: a *single* interpretive read should keep thinking on — the turn
that interprets a file is where the reasoning lives. Only a *run* of inspections has trivial
reasoning between them. Any error resets the counter immediately, so a sweep that turns up a problem
returns to baseline.

## Phases

1. **Pure decision function + tests** — `nextLevel(state, event) → { state, level }`, no pi runtime,
   so it is unit-testable and goes into the declared test suite with a floor.
2. **Hook wiring, armed *and* logged** — register the hooks; apply the level; also append what it
   chose and why to the session. Logging is free (no turn, no request change), so Phase 2 yields the
   saving and the calibration evidence in the same session.
3. **Verification** — one real session: does the thinking layer shrink, and does the log show the
   heuristic firing where a human would agree?

## Files that will change

| File | Change | Phase |
|---|---|---|
| `agent/extensions/reasoning-level/level.ts` | new — pure decision function + constants | 1 |
| `agent/extensions/reasoning-level/level.test.ts` | new — tests for the decision function | 1 |
| `agent/extensions/reasoning-level/index.ts` | new — hook wiring, level application, logging | 2 |
| `run-extension-tests.mjs` | declare the new test file; raise the floor | 1 |
| `README.md` | document the extension and its threshold | 3 |

Four files. No telemetry change — the decision log goes through `pi.appendEntry`, which already
exists for this purpose.

## Acceptance criteria

- [ ] `node run-extension-tests.mjs` passes with the new test declared and the floor raised.
- [ ] `pi -p "reply with exactly: PI OK"` → `PI OK` (the GL-027 startup check).
- [ ] In a real session, a `thinking_level_change` entry appears after the 3rd consecutive inspection and the request that follows carries the new level.
- [ ] That session's thinking layer is measurably smaller than an equivalent unarmed session.
- [ ] No session is left at `off` across a new user prompt.
- [ ] The decision log records every change with its trigger, so misfires are auditable after the fact.
- [ ] The turn count does **not** increase versus an unarmed session — the feature must be turn-neutral.

## Not in scope
- **Hash-dedupe of repeat reads** — measured at ~17.5K tok, requires shell parsing, and costs a cache reset per substitution. Revisit only if sweep-thinking-off proves insufficient.
- **The agent-driven `set_thinking_level` tool** — deferred, not dropped. It costs ~150 tokens *per request* and its adherence is unproven (`record_learning` fired 7 times across 180 sessions; pi's own "use read instead of cat" guideline lost 20:1). Revisit only if the decision log shows the heuristic misfiring in ways a human would call wrong.
- **`tool_call` blocking** — rejected on cost: it buys compliance with turns, at output prices.
- Graduated levels — DeepSeek reasoning is binary; `low`/`medium`/`high` produce equivalent thinking.
- Changes to other providers, models, or the `STANDARDS.md` capability map.

## Risks

| Risk | Rank | Mitigation built into this plan |
|---|---|---|
| The sweep heuristic misfires (turns thinking off where reasoning was needed) | MEDIUM | `isError` resets immediately; threshold is 3, not 1; the decision log makes misfires auditable; a wrong `off` costs re-derivation, not correctness |
| `off` transitions each cost a cache reset (~$0.0006) | LOW | `apply()` no-ops on an unchanged level, so only real transitions pay |
| A session could be stranded at `off` | LOW | `before_agent_start` resets to baseline once per user prompt |
| The heuristic's benefit is smaller than the estimate | MEDIUM | Criterion 4 measures the thinking layer on a real session; the estimate is ~124K tok from sweeps × 264 tok/turn |

## References
- [Grill record — dynamic thinking level](.agent/grill/dynamic-thinking-level.md) — the self-interrogation that established the free-hook design and the adherence finding.

## Open questions
- Is `THRESHOLD = 3` right? The decision log from Phase 2 is the instrument that answers it — no session data exists yet to justify another number.
