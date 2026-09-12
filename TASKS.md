# TASKS — Pass 5: Token accounting by layer

- [x] **T-101** — `bucketMessages()` pure function: bucket messages by layer (user/skill/read/bash/other/thinking/toolCall/assistant). `Done when:` unit test in `.agent/scratch/buckets.test.ts` passes. ✅
- [x] **T-102** — `context` handler in telemetry: call `bucketMessages`, store snapshot, return nothing. `Done when:` typechecks; no message mutation. ✅
- [x] **T-103** — `before_agent_start` + `message_end` handlers: size system prompt/contextFiles/skills; capture provider `usage`. `Done when:` typechecks. ✅
- [x] **T-104** — `appendEntry("tokens", …)` persistence + `/tokens` command rendering breakdown + calibration delta. `Done when:` typechecks; command registered. ✅
- [ ] **T-105** — Verification: restart pi, run a real session, compare `/tokens` total vs `getContextUsage()` and a manual JSONL parse. `Done when:` delta within ~20% and `custom` entries absent from LLM context.
