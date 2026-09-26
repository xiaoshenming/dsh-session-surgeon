import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSessionBuffer, turnStepImbalances } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";
import { MIGRATES_V0_ON_LOAD } from "../src/migrate.mjs";

const HEADER = { version: 0, id: "session-turn-step", createdAt: 1, delegationDepth: 0 };

const ev = (seq, type, data) => ({ type, seq, time: seq + 1, data });

const balanced = [
  ev(0, "turn/start", { turn: 1 }),
  ev(1, "step/start", { turn: 1, step: 1 }),
  ev(2, "assistant/message", { turn: 1, step: 1 }),
  ev(3, "step/end", { turn: 1, step: 1 }),
  ev(4, "turn/end", { turn: 1, reason: { kind: "completed" } }),
];

/** The #7824 shape: turn 450 closes at step 23, then steps 24+ keep writing. */
const message = (seq, turn, step) => ({
  type: "assistant/message",
  seq,
  time: seq + 1,
  data: {
    turn,
    step,
    message: {
      id: "m" + seq,
      role: "assistant",
      source: { kind: "model", provider: "probe", model: "probe" },
      content: [{ type: "text", text: "x" }],
    },
  },
});

const closedTurnContinues = [
  ev(0, "turn/start", { turn: 1 }),
  ev(1, "step/start", { turn: 1, step: 1 }),
  ev(2, "step/end", { turn: 1, step: 1 }),
  ev(3, "turn/end", { turn: 1, reason: { kind: "completed" } }),
  ev(4, "session/end-seed", { inherited: true }),
  message(5, 1, 2),
  ev(6, "step/end", { turn: 1, step: 2 }),
];

const turnEndsWithStepOpen = [
  ev(0, "turn/start", { turn: 1 }),
  ev(1, "step/start", { turn: 1, step: 1 }),
  ev(2, "turn/end", { turn: 1, reason: { kind: "interrupted" } }),
];

test("turnStepImbalances is empty on a balanced log", () => {
  assert.deepEqual(turnStepImbalances(balanced), []);
});

test("turnStepImbalances flags step events that continue a closed turn", () => {
  const hits = turnStepImbalances(closedTurnContinues);
  assert.deepEqual(hits.map((hit) => [hit.seq, hit.code]), [
    [5, "step-after-turn-end"],
    [6, "step-after-turn-end"],
  ]);
  assert.match(hits[0].detail, /already ended/);
});

test("turnStepImbalances flags a turn/end that lands while a step is open", () => {
  const hits = turnStepImbalances(turnEndsWithStepOpen);
  assert.deepEqual(hits.map((hit) => [hit.seq, hit.code]), [[2, "turn-end-while-step-open"]]);
  assert.match(hits[0].detail, /while step 1 is still open/);
});

test("a new turn after turn/end is not an imbalance", () => {
  const events = [
    ...balanced,
    ev(5, "turn/start", { turn: 2 }),
    ev(6, "step/start", { turn: 2, step: 1 }),
    ev(7, "step/end", { turn: 2, step: 1 }),
    ev(8, "turn/end", { turn: 2, reason: { kind: "completed" } }),
  ];
  assert.deepEqual(turnStepImbalances(events), []);
});

test("minimal logs that omit turn/step data are not flagged", () => {
  // The shape the other detectors' fixtures use: no step/start, no turn/step members.
  const events = [
    ev(0, "turn/start", { turn: 1 }),
    ev(1, "tool/call", { callId: "c1", name: "bash", arguments: "{}" }),
    ev(2, "turn/end", { turn: 1, reason: { kind: "error" } }),
  ];
  assert.deepEqual(turnStepImbalances(events), []);
});

test("decodeSessionBuffer reports the imbalance and never edits the log", async () => {
  const buf = await encodeSession({ header: HEADER, events: closedTurnContinues, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  const issue = decoded.issues.find((i) => i.code === "step-after-turn-end");
  assert.ok(issue, "the issue is reported whether or not this harness migrates v0");
  assert.deepEqual(issue.seqs, [5, 6]);
  assert.equal(issue.count, 2);
  if (MIGRATES_V0_ON_LOAD) assert.equal(decoded.health, "step-after-turn-end");
  else assert.equal(decoded.health, "ok");
  assert.equal(decoded.events.length, closedTurnContinues.length);
});

test("decodeSessionBuffer reports turn/end over an open step", async () => {
  const buf = await encodeSession({ header: HEADER, events: turnEndsWithStepOpen, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  assert.ok(decoded.issues.some((i) => i.code === "turn-end-while-step-open"));
  if (MIGRATES_V0_ON_LOAD) assert.equal(decoded.health, "turn-end-while-step-open");
});

test("planRepair leaves both shapes untouched", () => {
  for (const events of [closedTurnContinues, turnEndsWithStepOpen]) {
    const plan = planRepair({
      header: HEADER,
      headerClass: { ok: true, code: "header-ok", header: HEADER },
      events,
      health: "step-after-turn-end",
      issues: [{ code: "step-after-turn-end", message: "x", seqs: [5] }],
      failedFrames: 0,
    });
    assert.equal(plan.mustWrite, false);
    assert.deepEqual(plan.events, events);
  }
});
