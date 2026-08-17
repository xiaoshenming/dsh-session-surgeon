import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeStorageRecord, packChunkRuns } from "../src/packed.mjs";

function delta(seq, text) {
  return {
    type: "assistant/chunk",
    seq,
    time: 1000 + seq,
    data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text } },
  };
}

test("packs >=3 same-block text-delta and expands with continuous seq", () => {
  const events = [delta(0, "a"), delta(1, "b"), delta(2, "c"), delta(3, "d")];
  const packed = packChunkRuns(events);
  assert.equal(packed.length, 1);
  assert.equal(packed[0].type, "text-chunks");
  const expanded = decodeStorageRecord(packed[0]);
  assert.equal(expanded.length, 4);
  assert.ok(expanded.every((event, i) => event.seq === i));
  assert.deepEqual(expanded.map((e) => e.data.chunk.text), ["a", "b", "c", "d"]);
});

test("malformed packed row throws", () => {
  assert.throws(
    () =>
      decodeStorageRecord({
        type: "text-chunks",
        seq0: 0,
        time0: 1,
        data: { turn: 1, step: 1, index: 0, texts: ["a", "b"] },
      }),
    /malformed/,
  );
});

test("two events stay verbatim", () => {
  const events = [delta(0, "a"), delta(1, "b")];
  const packed = packChunkRuns(events);
  assert.equal(packed.length, 2);
});
