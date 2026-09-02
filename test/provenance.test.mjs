import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { planRepair } from "../src/repair.mjs";
import { encodeSession } from "../src/encode.mjs";
import {
  expandCompressedSeqRanges,
  expandSeqRangeList,
  hasCompressedSeqRanges,
  isSeqRangePair,
} from "../src/provenance.mjs";

const OFFICIAL_SESSION =
  "/home/ming/.nvm/versions/node/v22.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js";

const header = {
  version: 0,
  id: "session-alpha-ranges",
  createdAt: 1,
  cwd: "/tmp/surgeon",
  delegationDepth: 0,
};

function ev(type, seq, data, extra = {}) {
  return { type, seq, time: 1000 + seq, data, ...extra };
}

test("isSeqRangePair accepts [start,end] and rejects flat ints", () => {
  assert.equal(isSeqRangePair([1331, 1424]), true);
  assert.equal(isSeqRangePair([3, 2]), false);
  assert.equal(isSeqRangePair(1331), false);
  assert.equal(isSeqRangePair([1331]), false);
});

test("expandSeqRangeList flattens pairs and keeps mixed ints", () => {
  assert.deepEqual(expandSeqRangeList([[0, 2], 5, [7, 8]]), [0, 1, 2, 5, 7, 8]);
});

test("decode flags compressed sourceEventSeqs as newer-format-ranges, not corrupt", async () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("user/message", 1, {
      id: "u1",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "go" }],
    }, { surfaceOp: "append" }),
    ev("assistant/message", 2, {
      turn: 1,
      step: 1,
      message: {
        id: "a1",
        role: "assistant",
        source: { kind: "model", provider: "x", model: "y" },
        content: [{ type: "text", text: "hi" }],
      },
    }, { surfaceOp: "append", sourceEventSeqs: [[0, 1]] }),
    ev("turn/end", 3, { turn: 1, reason: { kind: "completed" } }),
  ];
  assert.equal(hasCompressedSeqRanges(events), true);
  const buf = await encodeSession({ header, events, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  assert.equal(decoded.health, "newer-format-ranges");
  assert.ok(decoded.issues.some((i) => i.code === "newer-format-ranges"));
  const plan = planRepair(decoded);
  assert.equal(plan.refuse, undefined);
  assert.equal(plan.mustWrite, true);
  assert.ok(plan.actions.some((a) => a.code === "newer-format-ranges"));
  assert.deepEqual(plan.events[2].sourceEventSeqs, [0, 1]);
  assert.equal(hasCompressedSeqRanges(plan.events), false);
});

test("repair expansion is lossless for inclusive [start,end]", () => {
  const events = [
    ev("assistant/message", 4476, {
      turn: 1,
      step: 1,
      message: { id: "a", role: "assistant", content: [] },
    }, {
      surfaceOp: "append",
      sourceEventSeqs: [[4433, 4475]],
    }),
  ];
  const { value, expanded } = expandCompressedSeqRanges(events);
  assert.equal(expanded, 1);
  const seqs = value[0].sourceEventSeqs;
  assert.equal(seqs[0], 4433);
  assert.equal(seqs.at(-1), 4475);
  assert.equal(seqs.length, 4475 - 4433 + 1);
  assert.ok(seqs.every((n, i) => n === 4433 + i));
});

test("expanded events pass official foldSurface", async (t) => {
  let foldSurface;
  try {
    ({ foldSurface } = await import(OFFICIAL_SESSION));
  } catch {
    t.skip("official dsh-session not installed");
    return;
  }
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("user/message", 1, {
      id: "u1",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "go" }],
    }, { surfaceOp: "append" }),
    ev("assistant/chunk", 2, { turn: 1, step: 1, chunk: { type: "text", text: "hi" } }),
    ev("assistant/message", 3, {
      turn: 1,
      step: 1,
      message: {
        id: "a1",
        role: "assistant",
        source: { kind: "model", provider: "x", model: "y" },
        content: [{ type: "text", text: "hi" }],
      },
    }, { surfaceOp: "append", sourceEventSeqs: [[2, 2]] }),
    ev("turn/end", 4, { turn: 1, reason: { kind: "completed" } }),
  ];
  assert.throws(() => foldSurface(events), /densely contain/);
  const plan = planRepair({
    header,
    headerClass: { ok: true, code: "header-ok", header },
    events,
    health: "newer-format-ranges",
    issues: [],
    failedFrames: 0,
  });
  assert.equal(plan.refuse, undefined);
  foldSurface(plan.events);
});
