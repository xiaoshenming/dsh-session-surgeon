import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeSessionBuffer, eventsSeqOk } from "../src/decode.mjs";
import { compressFrame } from "../src/zstd-frames.mjs";
import { toHeaderLine } from "../src/header.mjs";
import { planRepair, repairFile } from "../src/repair.mjs";
import { planCompact } from "../src/compact.mjs";
import { atomicWrite } from "../src/encode.mjs";

const header = {
  type: "session",
  version: 0,
  id: "session-packed-overlap",
  createdAt: 1,
  cwd: "/tmp/surgeon",
  delegationDepth: 0,
};

function ev(type, seq, data) {
  return { type, seq, time: 1000 + seq, data };
}

function delta(seq, text) {
  return {
    type: "assistant/chunk",
    seq,
    time: 1000 + seq,
    data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text } },
  };
}

function packedRow(seq0, texts) {
  return {
    type: "text-chunks",
    seq0,
    time0: 1000 + seq0,
    data: {
      turn: 1,
      step: 1,
      index: 0,
      dt: texts.slice(1).map(() => 1),
      texts,
    },
  };
}

async function writeRaw(records) {
  const frames = [
    await compressFrame(`${JSON.stringify(toHeaderLine(header))}\n`),
    await compressFrame(records.map((row) => JSON.stringify(row)).join("\n") + "\n"),
  ];
  return Buffer.concat(frames);
}

function prefixThrough(seq) {
  return [
    ev("turn/start", 0, { turn: 1 }),
    ev("user/message", 1, {
      id: "u1",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "go" }],
    }),
    ev("step/start", 2, { turn: 1, step: 1 }),
    ev("assistant/message", 3, {
      turn: 1,
      step: 1,
      message: {
        id: "a1",
        role: "assistant",
        source: { kind: "model", provider: "x", model: "y" },
        content: [{ type: "text", text: "hi" }],
      },
    }),
    ...[4, 5, 6, 7].map((s, i) => delta(s, "abcd"[i])),
  ].filter((event) => event.seq <= seq);
}

test("packed row overlapping the committed prefix keeps the contiguous suffix", async () => {
  const prefix = prefixThrough(5);
  const overlap = packedRow(4, ["a", "b", "c", "d", "e", "f"]);
  const rest = [
    ev("step/end", 10, { turn: 1, step: 1 }),
    ev("turn/end", 11, { turn: 1, reason: { kind: "completed" } }),
  ];
  const buf = await writeRaw([...prefix, overlap, ...rest]);
  const decoded = decodeSessionBuffer(buf);
  assert.equal(decoded.health, "packed-overlap-suffix");
  assert.ok(eventsSeqOk(decoded.events));
  assert.equal(decoded.packedOverlapKept, 4);
  assert.equal(decoded.events.at(-1).type, "turn/end");
  assert.deepEqual(
    decoded.events.filter((e) => e.type === "assistant/chunk").map((e) => e.data.chunk.text),
    ["a", "b", "c", "d", "e", "f"],
  );
  const plan = planRepair(decoded);
  assert.ok(plan.actions.some((a) => a.code === "packed-overlap-suffix"));
  assert.ok(!plan.actions.some((a) => a.code === "seq-gap-committed"));
});

test("packed overlap with a later hole still truncates at the hole", async () => {
  const prefix = prefixThrough(5);
  const overlap = packedRow(4, ["a", "b", "c", "d", "e", "f"]);
  const later = [
    ev("turn/start", 40, { turn: 2 }),
    ev("turn/end", 41, { turn: 2, reason: { kind: "completed" } }),
  ];
  const buf = await writeRaw([...prefix, overlap, ...later]);
  const decoded = decodeSessionBuffer(buf);
  assert.equal(decoded.health, "seq-gap-committed");
  assert.ok(decoded.packedOverlapKept >= 4);
  const plan = planRepair(decoded);
  assert.ok(plan.actions.some((a) => a.code === "seq-gap-committed"));
  assert.ok(!plan.events.some((e) => e.data?.turn === 2));
});

test("repair --apply of a packed-overlap file stays seq-continuous", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surgeon-packov-"));
  const dest = join(dir, "session.jsonl.zstd");
  const prefix = prefixThrough(5);
  const overlap = packedRow(4, ["a", "b", "c", "d", "e", "f"]);
  const rest = [
    ev("step/end", 10, { turn: 1, step: 1 }),
    ev("turn/end", 11, { turn: 1, reason: { kind: "completed" } }),
  ];
  await atomicWrite(dest, await writeRaw([...prefix, overlap, ...rest]));
  const result = await repairFile(dest, { dryRun: false });
  assert.equal(result.wrote, true);
  const after = decodeSessionBuffer(await (await import("node:fs/promises")).readFile(dest));
  assert.ok(eventsSeqOk(after.events));
  assert.equal(after.health, "ok");
  assert.equal(after.events.at(-1).type, "turn/end");
});

test("non-contiguous packed overlap is still a seq gap", async () => {
  const prefix = prefixThrough(5);
  const jump = packedRow(20, ["x", "y", "z"]);
  const buf = await writeRaw([...prefix, jump]);
  const decoded = decodeSessionBuffer(buf);
  assert.ok(decoded.health === "seq-gap-tail" || decoded.health === "seq-gap-committed");
  assert.equal(decoded.packedOverlapKept ?? 0, 0);
  assert.ok(decoded.events.every((event, i) => event.seq === i));
});
