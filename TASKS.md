# TASKS — thinking off for read sweeps

- [x] **T-301** — Pure decision function `nextLevel(state, signal)` in `agent/extensions/reasoning-level/level.ts` + tests in `level.test.ts`. `Done when:` the declared test file passes. ✅ **10 tests, RED → GREEN.**
- [x] **T-302** — Declare `level.test.ts` in `run-extension-tests.mjs` and raise the floor. `Done when:` `node run-extension-tests.mjs` passes with the new file listed and its count attributable. ✅ **54 tests / 5 files, floor 54.**
- [x] **T-303** — Hook wiring in `agent/extensions/reasoning-level/index.ts`. `Done when:` a real session shows a `thinking_level_change` entry after the 3rd consecutive inspection. ✅ **Verified — see below.**
- [x] **T-304** — Document the extension and its threshold in `README.md`. ✅ **Entries table, hook row, and the token-cost section updated.**
- [x] **T-305** — Verify on a real session. ✅ **See evidence below.**

## Verification evidence (T-303 / T-305)

Real session `2026-09-14T00-38-44-828Z`, prompt forcing a three-step inspection sweep:

| turn | tool | thinking | level |
|---|---|---|---|
| 1 | `bash` (ls skills) | 919 ch | high |
| 2 | `read` (level.ts) | 113 ch | high |
| 3 | `bash` (grep extensions) | 0 ch | **→ off** — `read sweep (3 consecutive inspections)` |
| 4 | — (summary) | **0 ch** | off, `in=6387 cr=0` (thinking stripped, no new thinking generated) |

- [x] `node run-extension-tests.mjs` → 54 tests / 5 files / floor 54, exit 0
- [x] `pi -p "reply with exactly: PI OK"` → `PI OK` (GL-027 startup check)
- [x] `thinking_level_change` entry appears after the 3rd inspection, and the following request carries the new level
- [x] Decision log records the trigger (`pi.appendEntry("reasoning-level", …)`)
- [x] Turn count unchanged — 4 turns for 3 steps + summary; no extra turns were added
- [~] Thinking layer measurably smaller: **partially verified** — the post-`off` turn generated 0 thinking against 919 ch on the planning turn. A full armed-vs-unarmed session comparison has not been run.
- [x] Never stranded at `off` — pinned by unit test (new prompt → baseline); the one-shot session had only one prompt so it was not exercised live.
