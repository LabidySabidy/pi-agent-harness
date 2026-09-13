# PLAN — Harness fixes from the socrates-web audit

## Goal

Fix three defects the socrates-web session audit exposed: bash-quiet under-collapsing, and telemetry's per-message snapshot bloat.

## Approach

Surgical edits to two existing extensions. No new files in the shipped harness, no new dependencies.

1. **`bash-quiet.ts` — add `node --test` to `VERIFY_PATTERNS`.** The socrates-web project (and the harness's own `buckets.test.ts`) use Node's built-in test runner; 120 test invocations matched no pattern and never collapsed.
2. **`bash-quiet.ts` — make the `error`/`fail` failure hints zero-count aware.** Passing test summaries end with `fail 0` / `0 errors`, which trip `\bfail`/`\berror` and block the collapse; 62 otherwise-passing verification outputs were not collapsed because of this. Fix: exclude the word when adjacent to a zero count (lookarounds), while still matching real `2 failed` / `error TS2365` / `Build failed`.
3. **`telemetry/index.ts` — throttle the `/tokens` snapshot.** `message_end` fires for every message (user/assistant/tool), so the handler appended 1,819 `tokens` entries in one session. Change to append only on **assistant** messages (≈ once per turn).

## Phases

- **P1 — bash-quiet patterns + hints (TDD):** write a regex test (RED), then edit the two constant lists (GREEN).
- **P2 — telemetry throttle:** gate the `appendEntry` on `message.role === "assistant"`.
- **P3 — verify:** syntax-check both, re-run the P1 test, confirm no regression to the existing failure behavior.

## Files that will change

| File | Change | Phase |
|---|---|---|
| `agent/extensions/bash-quiet.ts` | add `node --test` pattern; zero-count-aware `error`/`fail` hints | P1 |
| `agent/extensions/telemetry/index.ts` | gate `appendEntry("tokens", …)` on assistant messages | P2 |
| `.agent/scratch/bash-quiet-hints.test.mjs` | regex test (throwaway, scratch) | P1 |

## Acceptance criteria

- [ ] `node --test …` and `node <flag> --test …` match `VERIFY_PATTERNS`.
- [ ] `fail 0`, `0 errors`, `0 failures` do **not** match the verification failure hints.
- [ ] `2 failed`, `error TS2365`, `Build failed`, `EXIT: 2`, `aborted`, `timed out` still match.
- [ ] `EXIT: 0` still does not match.
- [ ] telemetry appends `tokens` only on assistant `message_end`.
- [ ] both extensions syntax-check clean.

## Not in scope

- read-cache (no change — its idleness is a model `bash cat` habit, not a defect).
- Any change to the general-tier failure hints (`GENERAL_FAILURE_HINTS` stay as-is).
- New verification tooling beyond what the audit showed (only `node --test` is added).

## Open questions

- None blocking. The zero-count lookaround is the only judgment call; it is unit-tested.
