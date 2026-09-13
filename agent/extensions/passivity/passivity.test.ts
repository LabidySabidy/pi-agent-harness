/**
 * passivity.test.ts — the interceptor's pure half.
 * Run: node --test "agent/extensions/passivity/*.test.ts"  (from ~/.pi)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPassivePrompt, lastUserMessageText, PASSIVE_RE, PASSIVITY_MESSAGE } from "./passivity.ts";

test("the regex is verbatim from the original: app.js:22-23", () => {
  // Copied from the recovered source so a reworded regex is caught here rather than in the field.
  assert.equal(
    PASSIVE_RE.source,
    "^(?:ok|okay|k+|cool|got ?it|makes? ?sense|next|proceed|continue|go ?on|y|yes|yeah|sure|fine|right|nice|great|\\.+)$",
  );
  assert.equal(PASSIVE_RE.flags, "i");
});

test("the notification carries the marker the CLIENT matches on", () => {
  // app.js:249 — `e.message.includes("PASSIVITY")`. Reword the copy and the client stops listening.
  assert.ok(PASSIVITY_MESSAGE.includes("PASSIVITY"));
});

test("a nod is passive; a reply is not", () => {
  for (const nod of ["ok", "OK", "okay", "k", "kk", "cool", "got it", "gotit", "makes sense",
    "make sense", "next", "proceed", "continue", "go on", "y", "yes", "yeah", "sure", "fine",
    "right", "nice", "great", "...", "  ok  "]) {
    assert.equal(isPassivePrompt(nod), true, `${JSON.stringify(nod)} is a nod`);
  }

  for (const reply of ["", "no", "state is a snapshot", "yes but the closure is stale",
    "ok, but why does the second call read the old value?", "I think batching explains it"]) {
    assert.equal(isPassivePrompt(reply), false, `${JSON.stringify(reply)} is not a nod`);
  }
});

test("the last thing the learner said is what gets checked", () => {
  const entries = [
    { type: "message", message: { role: "user", content: "an earlier real question" } },
    { type: "message", message: { role: "assistant", content: "a reply" } },
    { type: "message", message: { role: "user", content: "ok" } },
  ];
  assert.equal(lastUserMessageText(entries), "ok", "the assistant's turn is skipped");
  assert.equal(isPassivePrompt(lastUserMessageText(entries)!), true);
});

test("a skill invocation is checked like any other prompt and is never a nod", () => {
  const entries = [
    { type: "message", message: { role: "user", content: '<skill name="grill-misconception" location="/s.md">\nbody\n</skill>' } },
  ];
  const text = lastUserMessageText(entries)!;
  assert.ok(text.includes("grill-misconception"));
  assert.equal(isPassivePrompt(text), false, "a grill dispatch must never be read as passivity");
});

test("content arrays are read, and an empty history yields nothing", () => {
  const entries = [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "ok" }] } },
  ];
  assert.equal(lastUserMessageText(entries), "ok");
  assert.equal(lastUserMessageText([]), null);
  assert.equal(lastUserMessageText([{ type: "message", message: { role: "assistant", content: "hi" } }]), null);
});
