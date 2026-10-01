import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";
import {
  disambiguateDuplicateToolCallIds,
  duplicateAdvertisedToolCallIds,
} from "../src/duplicates.mjs";
import { MIGRATION_REFUSES_DUPLICATE_TOOL_CALL_IDS } from "../src/runtime.mjs";

const HEADER = { version: 0, id: "session-dup-calls", createdAt: 1, delegationDepth: 0 };

function assistant(seq, ids) {
  return {
    type: "assistant/message",
    seq,
    time: seq + 1,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: "a" + seq,
        role: "assistant",
        source: { kind: "model", provider: "x", model: "y" },
        content: ids.map((id) => ({
          type: "tool-call",
          id,
          name: "bash",
          arguments: "{}",
        })),
        stream: ids.map((id, index) => ({
          type: "tool-call-chunks",
          time0: seq + 1,
          index,
          dt: [1],
          id,
          args: ["{}"],
        })),
      },
    },
  };
}

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
        toolCallId: callId,
        content: [{ type: "text", text: "ok" }],
      },
    },
  };
}

const DUP = [
  { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
  assistant(1, ["call_x|fc_1", "call_x|fc_1"]),
  call(2, "call_x|fc_1"),
  call(3, "call_x|fc_1"),
  result(4, "call_x|fc_1"),
  result(5, "call_x|fc_1"),
  { type: "turn/end", seq: 6, time: 7, data: { turn: 1, reason: { kind: "completed" } } },
];

test("duplicateAdvertisedToolCallIds flags a second advertise in the same step", () => {
  const hits = duplicateAdvertisedToolCallIds(DUP);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].seq, 1);
  assert.equal(hits[0].callId, "call_x|fc_1");
});

test("disambiguate suffixes later duplicates and remaps call/result in order", () => {
  const { value, rewritten } = disambiguateDuplicateToolCallIds(DUP);
  assert.ok(rewritten >= 1);
  const ids = value[1].data.message.content.map((b) => b.id);
  assert.deepEqual(ids, ["call_x|fc_1", "call_x|fc_1#2"]);
  assert.equal(value[2].data.callId, "call_x|fc_1");
  assert.equal(value[3].data.callId, "call_x|fc_1#2");
  assert.equal(value[4].data.message.source.callId, "call_x|fc_1");
  assert.equal(value[5].data.message.source.callId, "call_x|fc_1#2");
  assert.equal(value[4].data.message.toolCallId, "call_x|fc_1");
  assert.equal(value[5].data.message.toolCallId, "call_x|fc_1#2");
  assert.equal(value[1].data.message.stream[1].id, "call_x|fc_1#2");
  assert.equal(duplicateAdvertisedToolCallIds(value).length, 0);
});

test("preserves the mapped id across a tool/result surface replacement", () => {
  const events = [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    assistant(1, ["call_x|fc_1", "call_x|fc_1"]),
    call(2, "call_x|fc_1"),
    call(3, "call_x|fc_1"),
    result(4, "call_x|fc_1"),
    {
      ...result(5, "call_x|fc_1"),
      sourceEventSeqs: [4],
      surfaceOp: { op: "replace", startSeq: 4, endSeq: 4 },
      data: {
        ...result(5, "call_x|fc_1").data,
        message: {
          ...result(5, "call_x|fc_1").data.message,
          content: [{ type: "text", text: "replacement" }],
        },
      },
    },
    { type: "turn/end", seq: 6, time: 7, data: { turn: 1, reason: { kind: "completed" } } },
  ];
  const { value } = disambiguateDuplicateToolCallIds(events);
  assert.equal(value[4].data.message.source.callId, "call_x|fc_1");
  assert.equal(value[5].data.message.source.callId, "call_x|fc_1");
  assert.equal(value[5].data.message.toolCallId, "call_x|fc_1");
});

test("decode/repair of duplicate advertised ids follows the installed format version", async () => {
  const buf = await encodeSession({ header: HEADER, events: DUP, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  assert.ok(decoded.issues.some((i) => i.code === "duplicate-tool-call-id"));
  const plan = planRepair(decoded);
  assert.equal(plan.refuse, undefined);
  if (MIGRATION_REFUSES_DUPLICATE_TOOL_CALL_IDS) {
    assert.equal(decoded.health, "duplicate-tool-call-id");
    assert.equal(plan.mustWrite, true);
    assert.ok(plan.actions.some((a) => a.code === "duplicate-tool-call-id"));
    assert.equal(duplicateAdvertisedToolCallIds(plan.events).length, 0);
  } else {
    assert.notEqual(decoded.health, "duplicate-tool-call-id");
    assert.equal(plan.mustWrite, false);
  }
});

test("planRepair rewrites when health is duplicate-tool-call-id", () => {
  const plan = planRepair({
    header: HEADER,
    headerClass: { ok: true, code: "header-ok", header: HEADER },
    events: DUP,
    health: "duplicate-tool-call-id",
    issues: [],
    failedFrames: 0,
  });
  assert.equal(plan.refuse, undefined);
  assert.equal(plan.mustWrite, true);
  assert.equal(duplicateAdvertisedToolCallIds(plan.events).length, 0);
});
