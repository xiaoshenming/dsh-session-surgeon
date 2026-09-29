import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";
import { settlementShapeHits } from "../src/settlement.mjs";
import { SESSION_MODULE_PATH } from "../src/runtime.mjs";

const V4_HEADER = { version: 4, id: "session-settlement", createdAt: 1, cwd: "/tmp/surgeon", isSeeded: false, delegationDepth: 0 };
const V0_HEADER = { version: 0, id: "session-settlement-v0", createdAt: 1, delegationDepth: 0 };
const SOURCE = { kind: "model", provider: "deepseek-official", model: "deepseek-flash" };

function ev(type, seq, data) {
  return { type, seq, time: seq + 1, data };
}

/** A v4 log whose only assistant row is `mutate`d — the shape #8084 reports. */
function v4Events(mutate) {
  const message = { id: "m1", role: "assistant", source: SOURCE, content: [{ type: "text", text: "hi" }] };
  const data = {
    turn: 1,
    step: 1,
    message,
    stream: [{ type: "chunk", time: 1, chunk: { type: "block-start", index: 0, blockType: "text" } }],
  };
  if (mutate) mutate(data);
  return [
    ev("turn/start", 0, { turn: 1 }),
    ev("step/start", 1, { turn: 1, step: 1 }),
    { ...ev("assistant/message", 2, data), surfaceOp: "append" },
    ev("step/end", 3, { turn: 1, step: 1 }),
    ev("turn/end", 4, { turn: 1, reason: { kind: "completed" } }),
  ];
}

async function decodeV4(mutate) {
  return decodeSessionBuffer(await encodeSession({ header: V4_HEADER, events: v4Events(mutate), packChunks: false }));
}

test("settlementShapeHits accepts a healthy assistant row and an unrelated type", () => {
  const healthy = v4Events();
  assert.deepEqual(settlementShapeHits(healthy), []);
  assert.deepEqual(settlementShapeHits([{ type: "user/message", seq: 0, data: {} }]), []);
});

test("settlementShapeHits names the members the gate refuses", () => {
  const rows = {
    "turn": (d) => delete d.turn,
    "step": (d) => delete d.step,
    "stream": (d) => delete d.stream,
  };
  for (const [member, mutate] of Object.entries(rows)) {
    assert.deepEqual(settlementShapeHits(v4Events(mutate)), [{ seq: 2, type: "assistant/message", members: [member] }]);
  }
  // -0 is >= 0 but the gate rejects it explicitly; so do a float, a string and null.
  assert.deepEqual(settlementShapeHits(v4Events((d) => { d.turn = -0; })), [{ seq: 2, type: "assistant/message", members: ["turn"] }]);
  assert.deepEqual(settlementShapeHits(v4Events((d) => { d.turn = 1.5; })), [{ seq: 2, type: "assistant/message", members: ["turn"] }]);
  assert.deepEqual(settlementShapeHits(v4Events((d) => { d.step = "1"; })), [{ seq: 2, type: "assistant/message", members: ["step"] }]);
  assert.deepEqual(settlementShapeHits(v4Events((d) => { d.stream = null; })), [{ seq: 2, type: "assistant/message", members: ["stream"] }]);
});

test("assistant/attempt is checked by the same predicate", () => {
  const hit = settlementShapeHits([{ type: "assistant/attempt", seq: 7, data: { turn: 1, step: 1 } }]);
  assert.deepEqual(hit, [{ seq: 7, type: "assistant/attempt", members: ["stream"] }]);
});

test("a healthy v4 log stays ok, and the detector costs nothing on it", async (t) => {
  if (!SESSION_MODULE_PATH) {
    t.skip("without a runtime the bundled fallback reads v0 only, so a v4 log is foreign-version");
    return;
  }
  const decoded = await decodeV4();
  assert.deepEqual(decoded.issues, []);
  assert.equal(decoded.health, "ok");
  assert.deepEqual(decoded.settlementHits, []);
});

test("a v4 row with broken settlement fields is reported, not repaired", async (t) => {
  if (!SESSION_MODULE_PATH) {
    t.skip("without a runtime the bundled fallback reads v0 only, so a v4 log is foreign-version");
    return;
  }
  const decoded = await decodeV4((d) => { delete d.stream; });
  assert.equal(decoded.health, "invalid-settlement-fields");
  const issue = decoded.issues.find((i) => i.code === "invalid-settlement-fields");
  assert.ok(issue, "the refusal is reported");
  assert.deepEqual(issue.seqs, [2]);
  assert.deepEqual(issue.settlement, ["assistant/message:stream"]);
  const plan = planRepair(decoded);
  assert.deepEqual(plan.actions, [], "stream is not recoverable, so repair must not write");
  assert.deepEqual(plan.events, decoded.events);
});

test("a v0 row without stream is left alone: the released v0 inventory forbids stream there", async () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("step/start", 1, { turn: 1, step: 1 }),
    ev("assistant/message", 2, { turn: 1, step: 1, message: { id: "m1", role: "assistant", source: SOURCE, content: [] } }),
    ev("step/end", 3, { turn: 1, step: 1 }),
    ev("turn/end", 4, { turn: 1, reason: { kind: "completed" } }),
  ];
  const decoded = decodeSessionBuffer(await encodeSession({ header: V0_HEADER, events, packChunks: false }));
  assert.deepEqual(decoded.settlementHits, []);
  assert.equal(decoded.health, "ok");
});

test("the predicate matches the official seed gate on the same events", async (t) => {
  if (!SESSION_MODULE_PATH) {
    t.skip("official dsh-session not resolvable");
    return;
  }
  const { Session } = await import(SESSION_MODULE_PATH);
  const build = (mutate) => Session.fromRestore(V4_HEADER.id, v4Events(mutate), V4_HEADER, 0, "detached", []);
  build(); // the healthy fixture is a session the released runtime accepts
  for (const mutate of [(d) => delete d.stream, (d) => { d.stream = null; }, (d) => { d.turn = -0; }, (d) => delete d.turn]) {
    assert.throws(build.bind(null, mutate), /seed assistant\/message at index 2 has invalid settlement fields/);
  }
});
