# TASKS — fixes from the socrates-web audit

- [x] **T-201** — bash-quiet: add `node --test` (and `node <flag> --test`) to `VERIFY_PATTERNS`. `Done when:` regex test passes for `node --test …`. ✅
- [x] **T-202** — bash-quiet: make `error`/`fail` failure hints zero-count aware (`fail 0`, `0 errors`, `0 failures` no longer block; real failures still match; `failures` plural now matches). `Done when:` hint test passes. ✅
- [x] **T-203** — telemetry: append the `/tokens` snapshot only on assistant `message_end` (≈ once per turn), not every message. `Done when:` guard present; syntax OK. ✅
- [x] **T-204** — verify: both extensions syntax-check; regex test passes. ✅
