import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { planRepair } from "../src/repair.mjs";
import { encodeSession } from "../src/encode.mjs";
import { hasCompressedSeqRanges, isSeqRangePair } from "../src/provenance.mjs";

const header = {
  version: 0,
  id: "session-alpha-ranges",
  createdAt: 1,
  cwd: "/tmp/surgeon",
  delegationDepth: 0,
};

function ev(type, seq, data) {
  return { type, seq, time: 1000 + seq, data };
}

test("isSeqRangePair accepts [start,end] and rejects flat ints", () => {
  assert.equal(isSeqRangePair([1331, 1424]), true);
  assert.equal(isSeqRangePair([3, 2]), false);
  assert.equal(isSeqRangePair(1331), false);
  assert.equal(isSeqRangePair([1331]), false);
});

test("decode flags compressed sourceEventSeqs as newer-format-ranges, not corrupt", async () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("user/message", 1, {
      id: "u1",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "go" }],
    }),
    ev("assistant/message", 2, {
      turn: 1,
      step: 1,
      message: {
        id: "a1",
        role: "assistant",
        source: { kind: "model", provider: "x", model: "y" },
        content: [{ type: "text", text: "hi" }],
      },
      sourceEventSeqs: [[0, 2]],
    }),
    ev("turn/end", 3, { turn: 1, reason: { kind: "completed" } }),
  ];
  assert.equal(hasCompressedSeqRanges(events), true);
  const buf = await encodeSession({ header, events, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  assert.equal(decoded.health, "newer-format-ranges");
  assert.ok(decoded.issues.some((i) => i.code === "newer-format-ranges"));
  const plan = planRepair(decoded);
  assert.equal(plan.mustWrite, false);
  assert.match(plan.refuse ?? "", /upgrade the harness/);
});
