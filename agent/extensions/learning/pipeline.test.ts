/**
 * pipeline.test.ts — tests for the event expansion, grill detection, and the
 * session-record projection.
 * Run: node --test "agent/extensions/learning/*.test.ts"  (from ~/.pi)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reduceEvents, telemetryToEvents, type LearningEvent } from "./events.ts";
import { detectGrillTurn, lastUserMessageText } from "./signal.ts";
import { renderSessionMarkdown, sessionFileName, staleSessions } from "./sessions.ts";

const META = { ts: "2026-09-13T07:41:02.311Z", session_id: "01a090ae-x", session_file: "/t.jsonl", cwd: "/c", source: "tool" as const };

// ---------------------------------------------------------------------------
// telemetry -> events
// ---------------------------------------------------------------------------

test("telemetryToEvents expands a full payload", () => {
  const events = telemetryToEvents(
    {
      concept: "rls-policies",
      status: "🟨",
      sm2: { interval: 2, ease_factor: 2.5, repetitions: 1 },
      misconception: { id: "MIS-001", description: "RLS is just a client filter", status: "open" },
      note: "took two attempts",
      decision: "use one simple USING policy",
    },
    META,
  );
  assert.deepEqual(
    events.map((e) => e.kind),
    ["badge", "sm2", "misconception_open", "note", "decision"],
  );
  assert.equal(events[0].to, "🟨");
  assert.equal(events[0].source, "tool");
  assert.equal(events[2].id, "MIS-001");
  assert.ok(events.every((e) => e.v === 1 && e.session_id === "01a090ae-x"));
});

test("telemetryToEvents emits a resolve (not an open) when status is resolved", () => {
  const events = telemetryToEvents(
    {
      concept: "rls-policies",
      status: "🟩",
      sm2: { interval: 6, ease_factor: 2.5, repetitions: 2 },
      misconception: {
        id: "MIS-001",
        description: "RLS is just a client filter",
        status: "resolved",
        corrected: "RLS is enforced by the database, not the client",
      },
    },
    META,
  );
  const kind = events.map((e) => e.kind);
  assert.ok(kind.includes("misconception_resolved"));
  assert.ok(!kind.includes("misconception_open"));
  assert.equal(events.find((e) => e.kind === "misconception_resolved")?.corrected,
    "RLS is enforced by the database, not the client");
});

test("the expanded events fold back into the state they describe", () => {
  const events = telemetryToEvents(
    { concept: "x", status: "🟦", sm2: { interval: 30, ease_factor: 2.6, repetitions: 5 } },
    META,
  );
  const state = reduceEvents(events);
  assert.equal(state.concepts.get("x")?.badge, "🟦");
  assert.equal(state.concepts.get("x")?.sm2?.interval, 30);
});

// ---------------------------------------------------------------------------
// grill detection (the telemetry_missing trigger)
// ---------------------------------------------------------------------------

const userMsg = (text: string) => ({ type: "message", message: { role: "user", content: text } });

test("detectGrillTurn: a skill expansion is the signal", () => {
  const entries = [
    userMsg("hello"),
    userMsg('<skill name="grill-misconception" location="/s.md">\nbody\n</skill>\nRLS policies'),
  ];
  const r = detectGrillTurn(entries);
  assert.equal(r.active, true);
  assert.equal(r.evidence, "grill-misconception");
});

test("detectGrillTurn: ordinary chat is not a grill turn", () => {
  assert.equal(detectGrillTurn([userMsg("what is RLS?")]).active, false);
  assert.equal(detectGrillTurn([]).active, false);
});

test("detectGrillTurn: only the MOST RECENT user message counts", () => {
  const entries = [
    userMsg('<skill name="grill-misconception" location="/s.md">\nbody\n</skill>'),
    userMsg("thanks, carry on"),
  ];
  assert.equal(detectGrillTurn(entries).active, false);
});

test("lastUserMessageText reads content arrays too", () => {
  const entries = [
    { type: "message", message: { role: "assistant", content: "hi" } },
    { type: "message", message: { role: "user", content: [{ type: "text", text: "from a block" }] } },
  ];
  assert.equal(lastUserMessageText(entries), "from a block");
});

// ---------------------------------------------------------------------------
// session record
// ---------------------------------------------------------------------------

test("sessionFileName is stable and filesystem-safe", () => {
  assert.equal(sessionFileName("2026-09-13T07:41:02.311Z", "01a090ae-fb9d"), "2026-09-13-0741-01a090ae.md");
});

test("renderSessionMarkdown records an open session with no data", () => {
  const state = reduceEvents([
    { v: 1, ts: "2026-09-13T07:41:02.311Z", kind: "session_start", session_id: "s1", session_file: "/t.jsonl" } as LearningEvent,
  ]);
  const md = renderSessionMarkdown(state, "s1", { final: false });
  assert.match(md, /- \*\*Status:\*\* open/);
  assert.match(md, /- \*\*Transcript:\*\* \/t\.jsonl/);
  assert.match(md, /_None recorded\._/);
  assert.match(md, /## Next/);
});

test("renderSessionMarkdown captures badges, misconceptions and the recorded gap", () => {
  const state = reduceEvents([
    { v: 1, ts: "2026-09-13T07:41:02.311Z", kind: "session_start", session_id: "s1" } as LearningEvent,
    { v: 1, ts: "2026-09-13T07:42:00.000Z", kind: "badge", concept: "rls-policies", to: "🟨" } as LearningEvent,
    { v: 1, ts: "2026-09-13T07:42:00.000Z", kind: "sm2", concept: "rls-policies", sm2: { interval: 2, ease_factor: 2.5, repetitions: 1 } } as LearningEvent,
    { v: 1, ts: "2026-09-13T07:42:01.000Z", kind: "misconception_open", id: "MIS-001", concept: "rls-policies", description: "just a client filter" } as LearningEvent,
    { v: 1, ts: "2026-09-13T07:43:00.000Z", kind: "decision", text: "one simple USING policy" } as LearningEvent,
    { v: 1, ts: "2026-09-13T07:44:00.000Z", kind: "telemetry_missing", reason: "grill-turn-without-telemetry", evidence: "grill-misconception" } as LearningEvent,
    { v: 1, ts: "2026-09-13T07:50:00.000Z", kind: "session_end", turns: 4 } as LearningEvent,
  ]);
  const md = renderSessionMarkdown(state, "s1", { final: true });
  assert.match(md, /- \*\*Status:\*\* closed/);
  assert.match(md, /- \*\*Turns:\*\* 4/);
  assert.match(md, /- 🟨 \*\*rls-policies\*\* — next review in 2d/);
  assert.match(md, /`MIS-001` \(open\) rls-policies: just a client filter/);
  assert.match(md, /- \*\*decision\*\* one simple USING policy/);
  assert.match(md, /telemetry missing \(grill-turn-without-telemetry\): grill-misconception/);
});

test("staleSessions finds sessions left open by a crash, not the current one", () => {
  const state = reduceEvents([
    { v: 1, ts: "2026-09-13T07:00:00.000Z", kind: "session_start", session_id: "crashed" } as LearningEvent,
    { v: 1, ts: "2026-09-13T08:00:00.000Z", kind: "session_start", session_id: "current" } as LearningEvent,
    { v: 1, ts: "2026-09-13T07:30:00.000Z", kind: "session_start", session_id: "closed" } as LearningEvent,
    { v: 1, ts: "2026-09-13T07:40:00.000Z", kind: "session_end" } as LearningEvent,
  ]);
  const stale = staleSessions(state, "current");
  assert.deepEqual(stale, ["crashed"]);
});
