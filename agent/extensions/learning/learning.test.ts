/**
 * learning.test.ts — unit tests for the pure learning-extension modules.
 * Run: node --test "agent/extensions/learning/*.test.ts"  (from ~/.pi)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAndClean,
  extractTelemetry,
  isSeverity,
  normalizeJson,
  severityState,
  validateTelemetry,
} from "./telemetry.ts";
import {
  parseEventLine,
  parseEventLog,
  reduceEvents,
  serializeEvent,
  type LearningEvent,
} from "./events.ts";
import { findCardHeadings, findConceptCard, projectSchema, slug } from "./schema.ts";

const SCHEMA = `# SCHEMA — Demo

## 3. Misconception Registry

| ID | Concept | Misconception (what I believed) | Corrected model (my own words) | Status | Date |
|----|---------|---------------------------------|-------------------------------|--------|------|
| MIS-001 | react-state | thought state lived in the DOM | state is a runtime snapshot | resolved | 2026-07-01 |
| MIS-002 | component-lifecycle | believed effects run before render | effects run after commit | open | 2026-08-15 |

## 2. Schema Taxonomy

### ⬜ react-state

- **Status:** ⬜ Unmeasured
- **Definition (my own words):** <blank — fill during recitation, no jargon>
- **Connections:** nothing yet
- **SM-2 telemetry:**
  - \`last_tested\`: —
  - \`next_review\`: —
  - \`interval\`: 0
  - \`ease_factor\`: 2.5
  - \`repetitions\`: 0
- **Misconceptions:** —

### ⬜ component-lifecycle

- **Status:** ⬜ Unmeasured
- **Definition (my own words):** <blank>
- **Connections:** nothing yet
- **SM-2 telemetry:**
  - \`last_tested\`: —
  - \`next_review\`: —
  - \`interval\`: 0
  - \`ease_factor\`: 2.5
  - \`repetitions\`: 0
- **Misconceptions:** —

## 4. SM-2 Spaced Telemetry

| Concept | last_tested | next_review | interval (days) | ease_factor | repetitions |
|---------|-------------|-------------|-----------------|-------------|-------------|
| react-state | — | — | 0 | 2.5 | 0 |
| component-lifecycle | — | — | 0 | 2.5 | 0 |
`;

// ---------------------------------------------------------------------------
// telemetry.ts
// ---------------------------------------------------------------------------

test("normalizeJson strips fences and trailing commas", () => {
  assert.equal(normalizeJson('```json\n{"a": 1,}\n```'), '{"a": 1}');
  assert.equal(normalizeJson('{"a": [1, 2,],}'), '{"a": [1, 2]}');
});

test("validateTelemetry accepts a well-formed payload", () => {
  const t = validateTelemetry({
    concept: "react-state",
    status: "🟨",
    sm2: { interval: 2, ease_factor: 2.5, repetitions: 1 },
    misconception: { id: "MIS-003", description: "setState is sync", status: "open" },
  });
  assert.ok(t);
  assert.equal(t.concept, "react-state");
  assert.equal(t.status, "🟨");
  assert.equal(t.sm2.interval, 2);
  assert.equal(t.misconception?.id, "MIS-003");
});

test("validateTelemetry rejects garbage and self-heals SM-2", () => {
  assert.equal(validateTelemetry(null), null);
  assert.equal(validateTelemetry({}), null);
  assert.equal(validateTelemetry({ concept: "x" }), null);
  assert.equal(validateTelemetry({ concept: "x", status: "⬜" }), null, "⬜ is not an earned badge");
  assert.equal(validateTelemetry({ concept: "  ", status: "🟥" }), null);

  const healed = validateTelemetry({ concept: "x", status: "🟥" });
  assert.deepEqual(healed?.sm2, { interval: 1, ease_factor: 2.5, repetitions: 1 });
});

test("extractTelemetry pulls blocks out and leaves visible prose", () => {
  const text = `Slope is rise over run.\n<learning-telemetry>\n{"concept":"x","status":"🟨"}\n</learning-telemetry>\nDone.`;
  const { blocks, cleaned } = extractTelemetry(text);
  assert.equal(blocks.length, 1);
  assert.match(cleaned, /Slope is rise over run\./);
  assert.doesNotMatch(cleaned, /learning-telemetry/);
});

test("extractAndClean handles block arrays and leaves non-text blocks alone", () => {
  const { telemetryBlocks, cleanedContent } = extractAndClean([
    { type: "text", text: 'hi <learning-telemetry>{"concept":"x","status":"🟩"}</learning-telemetry>' },
    { type: "toolCall", id: "t1" },
  ]);
  assert.equal(telemetryBlocks.length, 1);
  const blocks = cleanedContent as { type: string; text?: string }[];
  assert.equal(blocks[0].text, "hi ");
  assert.deepEqual(blocks[1], { type: "toolCall", id: "t1" });
});

// ---------------------------------------------------------------------------
// events.ts
// ---------------------------------------------------------------------------

const ev = (e: Partial<LearningEvent>): LearningEvent =>
  ({ v: 1, ts: "2026-09-13T00:00:00.000Z", kind: "badge", ...e }) as LearningEvent;

test("events round-trip, and malformed lines are skipped not thrown", () => {
  const line = serializeEvent(ev({ concept: "react-state", to: "🟨" }));
  assert.equal(parseEventLine(line)?.concept, "react-state");
  assert.equal(parseEventLine("not json"), null);
  assert.equal(parseEventLine('{"ts":"x"}'), null, "missing kind");
  assert.equal(parseEventLine('{"kind":"bogus","ts":"x"}'), null, "unknown kind");

  const { events, malformed } = parseEventLog(`${line}\n{oops\n`);
  assert.equal(events.length, 1);
  assert.equal(malformed.length, 1);
});

test("reduceEvents: latest badge and SM-2 win", () => {
  const state = reduceEvents([
    ev({ kind: "badge", concept: "react-state", to: "🟨" }),
    ev({ kind: "badge", concept: "react-state", to: "🟩" }),
    ev({ kind: "sm2", concept: "react-state", sm2: { interval: 1, ease_factor: 2.5, repetitions: 1 } }),
    ev({ kind: "sm2", concept: "react-state", sm2: { interval: 6, ease_factor: 2.6, repetitions: 2 } }),
  ]);
  const c = state.concepts.get("react-state");
  assert.equal(c?.badge, "🟩");
  assert.equal(c?.sm2?.interval, 6);
});

test("reduceEvents: a repeated misconception id updates one row instead of duplicating", () => {
  const state = reduceEvents([
    ev({ kind: "misconception_open", id: "MIS-003", concept: "react-state", description: "setState is sync" }),
    ev({ kind: "misconception_open", id: "MIS-003", concept: "react-state", description: "setState is sync" }),
    ev({
      kind: "misconception_resolved",
      id: "MIS-003",
      concept: "react-state",
      corrected: "setState is async and batched",
    }),
  ]);
  assert.equal(state.misconceptions.size, 1);
  const row = state.misconceptions.get("MIS-003");
  assert.equal(row?.status, "resolved");
  assert.equal(row?.corrected, "setState is async and batched");
  assert.deepEqual(state.concepts.get("react-state")?.misconceptionIds, ["MIS-003"]);
});

test("reduceEvents: session_end closes the most recent open session", () => {
  const state = reduceEvents([
    ev({ kind: "session_start", session_id: "s1" }),
    ev({ kind: "session_start", session_id: "s2" }),
    ev({ kind: "session_end", turns: 7 }),
  ]);
  assert.equal(state.sessions[0].endedAt, null);
  assert.ok(state.sessions[1].endedAt);
  assert.equal(state.sessions[1].turns, 7);
});

// ---------------------------------------------------------------------------
// schema.ts — the projection (owned regions only)
// ---------------------------------------------------------------------------

test("findCardHeadings and findConceptCard: duplicates resolve to the first card", () => {
  const dup = SCHEMA.replace("### ⬜ component-lifecycle", "### ⬜ react-state");
  const headings = findCardHeadings(dup);
  assert.equal(headings.filter((h) => slug(h.name) === "react-state").length, 2);
  const first = findConceptCard(dup, "react-state");
  assert.ok(first);
  assert.ok(first.start < dup.indexOf("### ⬜ react-state", first.start + 1));
});

test("projectSchema applies badge, status, SM-2 and the misconception pointer", () => {
  const state = reduceEvents([
    ev({ kind: "badge", concept: "react-state", to: "🟨" }),
    ev({ kind: "sm2", concept: "react-state", sm2: { interval: 6, ease_factor: 2.6, repetitions: 2 } }),
    ev({ kind: "misconception_open", id: "MIS-003", concept: "react-state", description: "setState is sync" }),
  ]);
  const { text, warnings } = projectSchema(SCHEMA, state, { today: "2026-09-13" });

  assert.match(text, /^### 🟨 react-state$/m);
  assert.match(text, /- \*\*Status:\*\* 🟨 Fair/);
  assert.match(text, /`last_tested`: 2026-09-13/);
  assert.match(text, /`next_review`: 2026-09-19/);
  assert.match(text, /`interval`: 6/);
  assert.match(text, /`repetitions`: 2/);
  assert.match(text, /- \*\*Misconceptions:\*\* MIS-003/);
  assert.match(text, /\| MIS-003 \| react-state \| setState is sync \|  \| open \| 2026-09-13 \|/);
  assert.ok(!warnings.includes("no-registry-table"));
});

test("projectSchema never touches authored prose", () => {
  const state = reduceEvents([ev({ kind: "badge", concept: "react-state", to: "🟩" })]);
  const { text } = projectSchema(SCHEMA, state, { today: "2026-09-13" });
  assert.match(text, /- \*\*Definition \(my own words\):\*\* <blank — fill during recitation, no jargon>/);
  assert.match(text, /- \*\*Connections:\*\* nothing yet/);
  assert.match(text, /`ease_factor`: 2.5/);
});

test("projectSchema never deletes registry rows it does not know about", () => {
  const state = reduceEvents([
    ev({ kind: "misconception_open", id: "MIS-003", concept: "react-state", description: "setState is sync" }),
  ]);
  const { text } = projectSchema(SCHEMA, state, { today: "2026-09-13" });
  assert.match(text, /\| MIS-001 \|/, "authored row survives");
  assert.match(text, /\| MIS-002 \|/, "authored open row survives");
  assert.match(text, /\| MIS-003 \|/);
});

test("projectSchema updates an existing row in place rather than appending a duplicate", () => {
  const state = reduceEvents([
    ev({ kind: "misconception_resolved", id: "MIS-001", concept: "react-state", corrected: "state is a snapshot, not a DOM thing" }),
  ]);
  const { text } = projectSchema(SCHEMA, state, { today: "2026-09-13" });
  const occurrences = text.split("\n").filter((l) => l.startsWith("| MIS-001 ")).length;
  assert.equal(occurrences, 1);
  assert.match(text, /state is a snapshot, not a DOM thing/);
});

test("projectSchema is idempotent", () => {
  const state = reduceEvents([
    ev({ kind: "badge", concept: "react-state", to: "🟨" }),
    ev({ kind: "sm2", concept: "react-state", sm2: { interval: 3, ease_factor: 2.5, repetitions: 1 } }),
    ev({ kind: "misconception_open", id: "MIS-003", concept: "react-state", description: "d" }),
  ]);
  const once = projectSchema(SCHEMA, state, { today: "2026-09-13" });
  const twice = projectSchema(once.text, state, { today: "2026-09-13" });
  assert.equal(twice.text, once.text);
  assert.equal(twice.changed, 0, "a second projection must be a no-op");
});

test("projectSchema updates the SM-2 summary table", () => {
  const state = reduceEvents([
    ev({ kind: "sm2", concept: "component-lifecycle", sm2: { interval: 15, ease_factor: 2.7, repetitions: 3 } }),
  ]);
  const { text } = projectSchema(SCHEMA, state, { today: "2026-09-13" });
  assert.match(text, /\| component-lifecycle \| 2026-09-13 \| 2026-09-28 \| 15 \| 2.7 \| 3 \|/);
});

test("projectSchema warns instead of guessing: unknown concept, duplicate heading, badge drift", () => {
  const state = reduceEvents([
    ev({ kind: "badge", concept: "not-a-card", to: "🟥" }),
    ev({ kind: "badge", concept: "react-state", to: "🟦" }),
  ]);
  const dup = SCHEMA.replace("### ⬜ component-lifecycle", "### ⬜ react-state");
  const { warnings } = projectSchema(dup, state, { today: "2026-09-13" });
  assert.ok(warnings.includes("unknown-concept:not-a-card"));
  assert.ok(warnings.includes("duplicate-concept:react-state"));
  assert.ok(warnings.some((w) => w.startsWith("badge_drift:react-state:⬜->🟦")));
});

test("projectSchema flags pre-existing duplicate ids without repairing them", () => {
  // A duplicate id is indistinguishable from an authored row by id alone, so the
  // projection reports it and leaves both rows standing. Manual dedupe only.
  const dupRow = "| MIS-002 | component-lifecycle | believed effects run before render | effects run after commit | open | 2026-08-15 |";
  const dup = SCHEMA.replace(
    dupRow,
    "| MIS-001 | component-lifecycle | a second row reusing an id |  | open | 2026-08-15 |",
  );
  const state = reduceEvents([
    ev({ kind: "misconception_open", id: "MIS-009", concept: "react-state", description: "brand new" }),
  ]);
  const { text, warnings } = projectSchema(dup, state, { today: "2026-09-13" });

  assert.ok(warnings.includes("duplicate-registry-row:MIS-001"));
  const mis001 = text.split("\n").filter((l) => l.startsWith("| MIS-001 "));
  assert.equal(mis001.length, 2, "both duplicate rows preserved — nothing deleted");
  assert.equal(text.split("\n").filter((l) => l.startsWith("| MIS-009 ")).length, 1);
  assert.ok(!warnings.some((w) => w.includes("MIS-009")), "a clean new id raises no duplicate warning");
});

// ---------------------------------------------------------------------------
// misconception severity
// ---------------------------------------------------------------------------

test("severityState collapses stored status + severity into the five display states", () => {
  assert.equal(severityState("open", "root"), "root");
  assert.equal(severityState("open", "partial"), "partial");
  assert.equal(severityState("open", "edge"), "edge");
  assert.equal(severityState("open", ""), "unrated");
  assert.equal(severityState("open", undefined), "unrated");
  assert.equal(severityState("resolved", "root"), "resolved", "resolution outranks a stale rating");
  assert.equal(severityState("resolved", ""), "resolved");
});

test("validateTelemetry accepts root|partial|edge and ignores an invalid severity", () => {
  const mk = (severity: unknown) =>
    validateTelemetry({
      concept: "x",
      status: "🟨",
      misconception: { id: "MIS-1", description: "d", severity },
    });
  assert.equal(mk("root")?.misconception?.severity, "root");
  assert.equal(mk("edge")?.misconception?.severity, "edge");
  assert.equal(mk("resolved")?.misconception?.severity, undefined, "resolved is a status, not a severity");
  assert.equal(mk(7)?.misconception?.severity, undefined);
  assert.equal(mk(undefined)?.misconception?.severity, undefined);
  assert.equal(isSeverity("root"), true);
  assert.equal(isSeverity("unrated"), false, "unrated is derived, not storable");
});

test("reduceEvents: severity is set, preserved when omitted, and updated on re-assessment", () => {
  const open = (severity?: unknown) =>
    ev({
      kind: "misconception_open",
      id: "MIS-009",
      concept: "react-state",
      description: "setState is sync",
      ...(severity ? { severity } : {}),
    });

  assert.equal(reduceEvents([open()]).misconceptions.get("MIS-009")?.severity, "", "absent -> unrated");
  assert.equal(reduceEvents([open("root")]).misconceptions.get("MIS-009")?.severity, "root");

  // A later turn that omits severity must NOT clear the existing rating.
  const preserved = reduceEvents([open("root"), open()]);
  assert.equal(preserved.misconceptions.get("MIS-009")?.severity, "root");

  // Re-assessment may downgrade it.
  const updated = reduceEvents([open("root"), open("edge")]);
  assert.equal(updated.misconceptions.get("MIS-009")?.severity, "edge");
});

test("projectSchema writes severity as the 7th column", () => {
  const state = reduceEvents([
    ev({ kind: "misconception_open", id: "MIS-009", concept: "react-state", description: "d", severity: "partial" }),
  ]);
  const { text } = projectSchema(SCHEMA, state, { today: "2026-09-13" });
  assert.match(text, /\| MIS-009 \| react-state \| d \|  \| open \| 2026-09-13 \| partial \|/);
  assert.match(text, /^\| ID \| Concept \| Misconception \(what I believed\) \| Corrected model \(my own words\) \| Status \| Date \| Severity \|$/m);
});

test("projectSchema migrates a 6-column registry additively, then stops", () => {
  const state = reduceEvents([
    ev({ kind: "misconception_open", id: "MIS-009", concept: "react-state", description: "d", severity: "root" }),
  ]);
  const first = projectSchema(SCHEMA, state, { today: "2026-09-13" });
  assert.ok(first.warnings.includes("registry-migrated-to-7-columns"));
  assert.match(first.text, /\| MIS-001 \| react-state \|.*\| resolved \| 2026-07-01 \|  \|/, "authored row padded, not removed");
  assert.match(first.text, /\| MIS-002 \| component-lifecycle \|.*\| open \| 2026-08-15 \|  \|/);

  const second = projectSchema(first.text, state, { today: "2026-09-13" });
  assert.ok(!second.warnings.includes("registry-migrated-to-7-columns"), "migration is one-shot");
  assert.equal(second.text, first.text);
  assert.equal(second.changed, 0, "idempotent after migration");
});
