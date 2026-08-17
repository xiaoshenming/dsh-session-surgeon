import { test } from "node:test";
import assert from "node:assert/strict";
import { interruptedTurnClosers, TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from "../src/closers.mjs";

const OFFICIAL =
  "/home/ming/.nvm/versions/node/v22.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/repair.js";

function ev(type, seq, data) {
  return { type, seq, time: 10 + seq, data };
}

test("balanced log returns empty", () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("turn/end", 1, { turn: 1, reason: { kind: "completed" } }),
  ];
  assert.deepEqual(interruptedTurnClosers(events), []);
});

test("open turn with unstarted tool-call synthesizes result + turn/end", () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("step/start", 1, { turn: 1, step: 1 }),
    ev("assistant/message", 2, {
      turn: 1,
      step: 1,
      message: {
        id: "m1",
        role: "assistant",
        source: { kind: "model", provider: "x", model: "y" },
        content: [{ type: "tool-call", id: "call-1", name: "bash", arguments: "{}" }],
      },
    }),
  ];
  const closers = interruptedTurnClosers(events);
  assert.equal(closers[0].type, "tool/result");
  assert.equal(closers[0].data.error.code, TOOL_NOT_STARTED);
  assert.equal(closers[1].type, "step/end");
  assert.equal(closers[2].type, "turn/end");
  assert.equal(closers[2].data.reason.kind, "interrupted");
  assert.equal(closers[0].seq, 3);
});

test("started tool-call uses TOOL_OUTCOME_UNKNOWN and sourceEventSeqs", () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("step/start", 1, { turn: 1, step: 1 }),
    ev("assistant/message", 2, {
      turn: 1,
      step: 1,
      message: {
        id: "m1",
        role: "assistant",
        source: { kind: "model", provider: "x", model: "y" },
        content: [{ type: "tool-call", id: "call-1", name: "bash", arguments: "{}" }],
      },
    }),
    ev("tool/call", 3, { callId: "call-1" }),
  ];
  const closers = interruptedTurnClosers(events);
  assert.equal(closers[0].data.error.code, TOOL_OUTCOME_UNKNOWN);
  assert.deepEqual(closers[0].sourceEventSeqs, [3]);
});

test("matches official interruptedTurnClosers when the package is present", async (t) => {
  let official;
  try {
    official = await import(OFFICIAL);
  } catch {
    t.skip("official dsh-session not resolvable");
    return;
  }
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("step/start", 1, { turn: 1, step: 1 }),
    ev("assistant/message", 2, {
      turn: 1,
      step: 1,
      message: {
        id: "m1",
        role: "assistant",
        source: { kind: "model", provider: "x", model: "y" },
        content: [{ type: "tool-call", id: "call-1", name: "bash", arguments: "{}" }],
      },
    }),
    ev("tool/call", 3, { callId: "call-1" }),
  ];
  const ours = interruptedTurnClosers(events);
  const theirs = official.interruptedTurnClosers(events);
  assert.equal(ours.length, theirs.length);
  for (let i = 0; i < ours.length; i++) {
    assert.equal(ours[i].type, theirs[i].type);
    assert.equal(ours[i].seq, theirs[i].seq);
    if (ours[i].type === "turn/end") {
      assert.deepEqual(ours[i].data.reason, theirs[i].data.reason);
    }
    if (ours[i].type === "tool/result") {
      assert.equal(ours[i].data.error.code, theirs[i].data.error.code);
    }
  }
});
