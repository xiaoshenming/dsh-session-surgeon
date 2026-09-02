import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";

const header = {
  version: 0,
  id: "session-forward-event",
  createdAt: 1,
  delegationDepth: 0,
};

function ev(type, seq, data) {
  return { type, seq, time: 1000 + seq, data };
}

async function decode(events) {
  return decodeSessionBuffer(await encodeSession({ header, events, packChunks: false }));
}

test("model/selection gets a lossless older-harness shim", async () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("turn/end", 1, { turn: 1, reason: { kind: "completed" } }),
    ev("model/selection", 2, {
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      reasoningEffort: "high",
    }),
  ];
  const before = await decode(events);
  assert.equal(before.health, "unknown-type");
  assert.ok(before.issues.some((issue) => issue.code === "forward-event-shim"));

  const plan = planRepair(before);
  assert.equal(plan.refuse, undefined);
  assert.equal(plan.mustWrite, true);
  assert.deepEqual(plan.events[2], { ...events[2], ignorable: true });
  assert.ok(plan.actions.some((action) => action.code === "forward-event-shim"));

  const after = await decode(plan.events);
  assert.equal(after.health, "ok");
  assert.deepEqual(after.events[2], { ...events[2], ignorable: true });
});

test("malformed model/selection remains unknown and is not shimmed", async () => {
  const events = [ev("model/selection", 0, { provider: "x", model: "y", extra: true })];
  const decoded = await decode(events);
  const plan = planRepair(decoded);
  assert.equal(decoded.health, "unknown-type");
  assert.ok(!decoded.issues.some((issue) => issue.code === "forward-event-shim"));
  assert.ok(!plan.actions.some((action) => action.code === "forward-event-shim"));
  assert.equal(plan.mustWrite, false);
  assert.deepEqual(plan.events, events);
});

test("model/selection with a foreign envelope field is not shimmed", async () => {
  const events = [{
    ...ev("model/selection", 0, { provider: "x", model: "y" }),
    surfaceOp: "append",
  }];
  const decoded = await decode(events);
  const plan = planRepair(decoded);
  assert.ok(!plan.actions.some((action) => action.code === "forward-event-shim"));
  assert.equal(plan.mustWrite, false);
});

test("arbitrary unknown plugin events never receive ignorable", async () => {
  const events = [ev("plugin/future", 0, { value: 1 })];
  const decoded = await decode(events);
  const plan = planRepair(decoded);
  assert.equal(decoded.health, "unknown-type");
  assert.equal(plan.mustWrite, false);
  assert.equal(plan.events[0].ignorable, undefined);
});
