import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";
import {
  flatReplayStateHits,
  isFlatReplayState,
  wrapFlatReplayState,
  wrapFlatReplayStates,
} from "../src/replay-state.mjs";
import { MIGRATION_REFUSES_DUPLICATE_TOOL_CALL_IDS } from "../src/runtime.mjs";

const HEADER = { version: 0, id: "session-replay-state", createdAt: 1, delegationDepth: 0 };

const FLAT = {
  kind: "pi-ai",
  version: 1,
  api: "openai-completions",
  provider: "x",
  model: "y",
  responseId: "resp-1",
  stopReason: "toolUse",
  blocks: [
    { type: "reasoning", thinkingSignature: "reasoning_content" },
    { type: "tool-call" },
  ],
};

function finishChunk(seq) {
  return {
    type: "assistant/chunk",
    seq,
    time: seq + 1,
    data: {
      turn: 1,
      step: 1,
      chunk: { type: "finish", reason: { kind: "tool-calls" }, replayState: structuredClone(FLAT) },
    },
  };
}

const EVENTS = [
  { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
  finishChunk(1),
  {
    type: "assistant/message",
    seq: 2,
    time: 3,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: "a1",
        role: "assistant",
        source: { kind: "model", provider: "x", model: "y", replayState: structuredClone(FLAT) },
        content: [{ type: "text", text: "ok" }],
      },
    },
  },
  { type: "turn/end", seq: 3, time: 4, data: { turn: 1, reason: { kind: "completed" } } },
];

test("wrapFlatReplayState moves kind under response and keeps blocks", () => {
  assert.equal(isFlatReplayState(FLAT), true);
  const { value, wrapped } = wrapFlatReplayState(FLAT);
  assert.equal(wrapped, true);
  assert.equal(value.response.kind, "pi-ai");
  assert.equal(value.response.version, 1);
  assert.equal(value.response.api, "openai-completions");
  assert.deepEqual(value.blocks, FLAT.blocks);
  assert.equal(Object.hasOwn(value, "kind"), false);
  assert.equal(isFlatReplayState(value), false);
});

test("wrapFlatReplayStates rewrites chunk and message source", () => {
  const { value, wrapped } = wrapFlatReplayStates(EVENTS);
  assert.equal(wrapped, 2);
  assert.equal(flatReplayStateHits(value).length, 0);
  assert.equal(value[1].data.chunk.replayState.response.kind, "pi-ai");
  assert.equal(value[2].data.message.source.replayState.response.kind, "pi-ai");
});

test("decode/repair of flat replayState follows the installed format version", async () => {
  const buf = await encodeSession({ header: HEADER, events: EVENTS, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  assert.ok(decoded.issues.some((i) => i.code === "legacy-replay-state"));
  const plan = planRepair(decoded);
  assert.equal(plan.refuse, undefined);
  if (MIGRATION_REFUSES_DUPLICATE_TOOL_CALL_IDS) {
    assert.equal(decoded.health, "legacy-replay-state");
    assert.equal(plan.mustWrite, true);
    assert.ok(plan.actions.some((a) => a.code === "legacy-replay-state"));
    assert.equal(flatReplayStateHits(plan.events).length, 0);
  } else {
    assert.notEqual(decoded.health, "legacy-replay-state");
    assert.equal(plan.mustWrite, false);
  }
});

test("planRepair wraps when health is legacy-replay-state", () => {
  const plan = planRepair({
    header: HEADER,
    headerClass: { ok: true, code: "header-ok", header: HEADER },
    events: EVENTS,
    health: "legacy-replay-state",
    issues: [],
    failedFrames: 0,
  });
  assert.equal(plan.refuse, undefined);
  assert.equal(plan.mustWrite, true);
  assert.equal(flatReplayStateHits(plan.events).length, 0);
});
