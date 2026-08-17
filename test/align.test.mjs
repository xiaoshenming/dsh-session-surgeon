
import { test } from "node:test";
import assert from "node:assert/strict";
import { compressFrame, decodeFrames, scanZstdFrames } from "../src/zstd-frames.mjs";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { classifyHeader, parseHeaderRecord, toHeaderLine } from "../src/header.mjs";
import { decodeStorageRecord, packChunkRuns } from "../src/packed.mjs";
import { isExactHeaderRecord } from "../src/scanner.mjs";

const header = {
  type: "session",
  version: 0,
  id: "session-align",
  createdAt: 1,
  delegationDepth: 0,
};

function ev(type, seq, data) {
  return { type, seq, time: 10 + seq, data };
}

test("header frame with a second line is header-frame-corrupt", async () => {
  const extra = JSON.stringify(header) + "\n" + JSON.stringify(ev("turn/start", 0, { turn: 1 })) + "\n";
  const buf = await compressFrame(extra);
  const decoded = decodeSessionBuffer(buf);
  assert.equal(decoded.health, "header-frame-corrupt");
  assert.equal(isExactHeaderRecord(extra), false);
});

test("complete event frame without trailing newline is torn JSONL", async () => {
  const head = await compressFrame(JSON.stringify(header) + "\n");
  const body = await compressFrame(JSON.stringify(ev("turn/start", 0, { turn: 1 }))); // no NL
  const decoded = decodeSessionBuffer(Buffer.concat([head, body]));
  assert.ok(decoded.issues.some((i) => /torn JSONL/.test(i.message) || i.code === "unparsable-line"));
  assert.equal(decoded.events.length, 0);
});

test("JSONL split across two complete frames still joins", async () => {
  const rec = JSON.stringify(ev("turn/start", 0, { turn: 1 })) + "\n";
  const mid = Math.floor(rec.length / 2);
  const head = await compressFrame(JSON.stringify(header) + "\n");
  const a = await compressFrame(rec.slice(0, mid));
  const b = await compressFrame(rec.slice(mid));
  const decoded = decodeSessionBuffer(Buffer.concat([head, a, b]));
  assert.equal(decoded.health, "ok");
  assert.equal(decoded.events.length, 1);
  assert.equal(decoded.events[0].type, "turn/start");
});

test("parseHeaderRecord requires a trailing newline", () => {
  assert.throws(() => parseHeaderRecord(JSON.stringify(header)), /newline|header/i);
  const rec = parseHeaderRecord(JSON.stringify(header) + "\n");
  assert.equal(rec.id, "session-align");
  assert.equal(toHeaderLine(rec).delegationDepth, 0);
});

test("reserved block type throws", () => {
  // magic + descriptor 0 + window byte + 3-byte block header (last=1, type=3)
  const buf = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00, 0x07, 0x00, 0x00]);
  assert.throws(() => scanZstdFrames(buf), /reserved block type/);
});

test("packs reasoning-chunks and tool-call-chunks", () => {
  const reasoning = [0, 1, 2].map((i) => ev("assistant/chunk", i, {
    turn: 1, step: 1, chunk: { type: "reasoning-delta", index: 0, text: "r" + i },
  }));
  const packedR = packChunkRuns(reasoning);
  assert.equal(packedR[0].type, "reasoning-chunks");
  assert.equal(decodeStorageRecord(packedR[0]).length, 3);

  const tools = [0, 1, 2].map((i) => ev("assistant/chunk", i, {
    turn: 1,
    step: 1,
    chunk: { type: "tool-call-delta", index: 0, id: "call-1", name: "bash", argumentsDelta: "{}" + i },
  }));
  const packedT = packChunkRuns(tools);
  assert.equal(packedT[0].type, "tool-call-chunks");
  const expanded = decodeStorageRecord(packedT[0]);
  assert.equal(expanded.length, 3);
  assert.equal(expanded[2].data.chunk.name, "bash");
});

test("unknown-type is kept", async () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("custom/future", 1, { hello: true }),
    ev("turn/end", 2, { turn: 1, reason: { kind: "completed" } }),
  ];
  const { encodeSession } = await import("../src/encode.mjs");
  const buf = await encodeSession({
    header: { version: 0, id: "session-unknown", createdAt: 1, delegationDepth: 0 },
    events,
    packChunks: false,
  });
  const decoded = decodeSessionBuffer(buf);
  assert.equal(decoded.health, "unknown-type");
  assert.ok(decoded.events.some((e) => e.type === "custom/future"));
});
