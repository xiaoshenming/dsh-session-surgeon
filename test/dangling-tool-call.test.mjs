import { test } from "node:test";
import assert from "node:assert/strict";
import { danglingToolCalls, decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";

const HEADER = { version: 0, id: "session-dangling", createdAt: 1, delegationDepth: 0 };

function call(seq, callId) {
  return {
    type: "tool/call",
    seq,
    time: seq + 1,
    data: { turn: 1, step: 1, callId, name: "bash", arguments: "{}" },
  };
}

function result(seq, callId) {
  return {
    type: "tool/result",
    seq,
    time: seq + 1,
    data: {
      message: {
        id: "msg-" + seq,
        role: "tool",
        source: { kind: "tool", callId },
        content: [{ type: "text", text: "ok" }],
      },
    },
  };
}

const PAIRED = [
  { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
  call(1, "call-a"),
  result(2, "call-a"),
  { type: "turn/end", seq: 3, time: 4, data: { turn: 1, reason: { kind: "completed" } } },
];

const DANGLING = [
  { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
  call(1, "call-a"),
  { type: "turn/end", seq: 2, time: 3, data: { turn: 1, reason: { kind: "error" } } },
];

test("danglingToolCalls is empty when every call has a result", () => {
  assert.deepEqual(danglingToolCalls(PAIRED), []);
});

test("danglingToolCalls flags a tool/call with no matching tool/result", () => {
  assert.deepEqual(danglingToolCalls(DANGLING), [{ seq: 1, callId: "call-a" }]);
});

test("empty callId is always dangling, even if a result also has empty id", () => {
  const events = [
    call(0, ""),
    result(1, ""),
  ];
  assert.deepEqual(danglingToolCalls(events), [{ seq: 0, callId: "" }]);
});

test("decodeSessionBuffer reports dangling-tool-call without refusing the log", async () => {
  const buf = await encodeSession({ header: HEADER, events: DANGLING, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  assert.equal(decoded.health, "dangling-tool-call");
  assert.ok(decoded.issues.some((i) => i.code === "dangling-tool-call"));
  assert.equal(decoded.events.length, DANGLING.length);
});

test("planRepair does not invent a tool/result for dangling calls", () => {
  const plan = planRepair({
    header: HEADER,
    headerClass: { ok: true, code: "header-ok", header: HEADER },
    events: DANGLING,
    health: "dangling-tool-call",
    issues: [{ code: "dangling-tool-call", message: "x", seqs: [1] }],
    failedFrames: 0,
  });
  assert.equal(plan.refuse, undefined);
  assert.equal(plan.actions.some((a) => a.code === "dangling-tool-call"), false);
  assert.equal(plan.events.some((e) => e.type === "tool/result"), false);
  assert.equal(plan.events.filter((e) => e.type === "tool/call").length, 1);
});
