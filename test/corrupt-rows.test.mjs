import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";

const HEADER = { version: 0, id: "session-corrupt-row", createdAt: 1, delegationDepth: 0 };
const ev = (seq, type, data) => ({ type, seq, time: seq + 1, data });
const MODEL = { kind: "model", provider: "p", model: "m" };
const message = (id = "m2") => ({ id, role: "assistant", source: MODEL, content: [{ type: "text", text: "x" }] });

/** A valid frame whose middle row (seq 2) is the row under test. */
const frame = (row) => [ev(0, "turn/start", { turn: 1 }), ev(1, "step/start", { turn: 1, step: 1 }), row, ev(3, "step/end", { turn: 1, step: 1 }), ev(4, "turn/end", { turn: 1, reason: { kind: "completed" } })];
const okMessage = (turn = 1) => ev(2, "assistant/message", { turn, step: 1, message: message() });

/**
 * Rows a truncated or half-written log really contains: the type survived, a
 * member the released inventory requires did not. Inspecting such a file is the
 * whole job, so every one of these must be reported rather than thrown.
 */
const ROWS = {
  "assistant/message without message": frame(ev(2, "assistant/message", { turn: 1, step: 1 })),
  "assistant/message without content": frame(ev(2, "assistant/message", { turn: 1, step: 1, message: { id: "m2", role: "assistant", source: MODEL } })),
  "assistant/message with content not a list": frame(ev(2, "assistant/message", { turn: 1, step: 1, message: { ...message(), content: "x" } })),
  "assistant/message without source": frame(ev(2, "assistant/message", { turn: 1, step: 1, message: { id: "m2", role: "assistant", content: [{ type: "text", text: "x" }] } })),
  "assistant/message with null message": frame(ev(2, "assistant/message", { turn: 1, step: 1, message: null })),
  "assistant/message without step": frame(ev(2, "assistant/message", { turn: 1, message: message() })),
  "user/message without content": frame(ev(2, "user/message", { id: "u2", role: "user", source: { kind: "user" } })),
  "user/message without source": frame(ev(2, "user/message", { id: "u2", role: "user", content: [{ type: "text", text: "hi" }] })),
  "tool/result without message": frame(ev(2, "tool/result", { turn: 1, step: 1 })),
  "tool/call without arguments": frame(ev(2, "tool/call", { turn: 1, step: 1, callId: "c1", name: "bash" })),
  "permission/preset without preset": frame(ev(2, "permission/preset", { origin: "x" })),
  "turn/start without turn": [ev(0, "turn/start", {}), ev(1, "step/start", { turn: 1, step: 1 }), okMessage(), ev(3, "step/end", { turn: 1, step: 1 }), ev(4, "turn/end", { turn: 1, reason: { kind: "completed" } })],
  "step/start without step": [ev(0, "turn/start", { turn: 1 }), ev(1, "step/start", { turn: 1 }), okMessage(), ev(3, "step/end", { turn: 1, step: 1 }), ev(4, "turn/end", { turn: 1, reason: { kind: "completed" } })],
  "step/end without step": [ev(0, "turn/start", { turn: 1 }), ev(1, "step/start", { turn: 1, step: 1 }), okMessage(), ev(3, "step/end", { turn: 1 }), ev(4, "turn/end", { turn: 1, reason: { kind: "completed" } })],
  "turn/end without reason": [ev(0, "turn/start", { turn: 1 }), ev(1, "step/start", { turn: 1, step: 1 }), okMessage(), ev(3, "step/end", { turn: 1, step: 1 }), ev(4, "turn/end", { turn: 1 })],
  "subagent/descriptor without version": frame(ev(2, "subagent/descriptor", { mode: "one-shot", provider: "spawn", label: "x" })),
  "event with no data member": [{ type: "turn/start", seq: 0, time: 1 }, ev(1, "step/start", { turn: 1, step: 1 }), okMessage(), ev(3, "step/end", { turn: 1, step: 1 }), ev(4, "turn/end", { turn: 1, reason: { kind: "completed" } })],
  "unknown event with no data": frame({ type: "future/thing", seq: 2, time: 3 }),
  "assistant/chunk without chunk": frame(ev(2, "assistant/chunk", { turn: 1, step: 1 })),
  "agent/inbox/spliced without inserted": frame(ev(2, "agent/inbox/spliced", { target: "next-turn", start: 2 })),
  "agent/inbox/spliced without target": frame(ev(2, "agent/inbox/spliced", { start: 2, inserted: [{ id: "i1", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "x" }] }] })),
  "goal/change without version": frame(ev(2, "goal/change", { kind: "goal/change", operation: "create", goal: { id: "g1", objective: "o" } })),
  "goal/change without operation": frame(ev(2, "goal/change", { kind: "goal/change", version: 1, goal: { id: "g1", objective: "o" } })),
};

/** Codes these rows must produce today. */
const REPORTED = {
  "assistant/message without message": "v0-missing-member",
  "assistant/message without content": "v0-missing-member",
  "assistant/message with content not a list": "v0-missing-member",
  "assistant/message without source": "v0-missing-member",
  "assistant/message with null message": "v0-missing-member",
  "assistant/message without step": "v0-missing-member",
  "user/message without content": "v0-missing-member",
  "user/message without source": "v0-missing-member",
  "tool/result without message": "v0-missing-member",
  "tool/call without arguments": "v0-missing-member",
  "permission/preset without preset": "v0-missing-member",
  "turn/start without turn": "v0-missing-member",
  "step/start without step": "v0-missing-member",
  "step/end without step": "v0-missing-member",
  "turn/end without reason": "v0-missing-member",
  "subagent/descriptor without version": "v0-descriptor-version",
  "agent/inbox/spliced without inserted": "v0-missing-member",
  "agent/inbox/spliced without target": "v0-missing-member",
  "goal/change without version": "v0-missing-member",
  "goal/change without operation": "v0-missing-member",
  "event with no data member": "v0-missing-member",
  "unknown event with no data": "unknown-type",
};

/** Rows the released gate accepts, so reporting nothing is the correct answer. */
const ACCEPTED = ["assistant/chunk without chunk"];

/**
 * Shapes we still report nothing for. Empty today: the two gaps that used to be
 * here (`agent/inbox/spliced`, `goal/change`) were closed by ablating them
 * against the released gate, exactly as `src/released-shape.mjs` documents. A
 * row lands here again only when a refusal is known and not yet covered.
 */
const KNOWN_GAP = [];

for (const [label, events] of Object.entries(ROWS)) {
  test(`decode never throws: ${label}`, async () => {
    const buf = await encodeSession({ header: HEADER, events, packChunks: false });
    const decoded = decodeSessionBuffer(buf);
    assert.equal(decoded.events.length, events.length, "every row survives decoding");
    const expected = REPORTED[label];
    if (expected) {
      assert.ok(decoded.issues.some((i) => i.code === expected), `expected ${expected}, got ${decoded.issues.map((i) => i.code).join(", ") || "none"}`);
    } else if (KNOWN_GAP.includes(label)) {
      assert.deepEqual(decoded.issues.map((i) => i.code), [], "known gap: nothing is reported yet");
    } else {
      assert.deepEqual(decoded.issues.map((i) => i.code), [], "the released gate accepts this row, so silence is correct");
    }
  });

  test(`planRepair survives: ${label}`, async () => {
    const buf = await encodeSession({ header: HEADER, events, packChunks: false });
    const plan = planRepair(decodeSessionBuffer(buf));
    assert.ok(Array.isArray(plan.events));
  });
}

test("every row is classified: reported, accepted by the gate, or a known gap", () => {
  const classified = [...Object.keys(REPORTED), ...ACCEPTED, ...KNOWN_GAP].sort();
  assert.deepEqual(classified, Object.keys(ROWS).sort());
});

test("a healthy v0 log reports nothing", async () => {
  const events = [ev(0, "turn/start", { turn: 1 }), ev(1, "step/start", { turn: 1, step: 1 }), okMessage(), ev(3, "step/end", { turn: 1, step: 1 }), ev(4, "turn/end", { turn: 1, reason: { kind: "completed" } })];
  const decoded = decodeSessionBuffer(await encodeSession({ header: HEADER, events, packChunks: false }));
  assert.deepEqual(decoded.issues, []);
  assert.equal(decoded.health, "ok");
});
