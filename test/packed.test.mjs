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

test("matches official packChunkRuns / decodeStorageRecord when present", async (t) => {
  const officialPath =
    "/home/ming/.nvm/versions/node/v22.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/chunk-rows.js";
  let official;
  try {
    official = await import(officialPath);
  } catch {
    t.skip("official dsh-session chunk-rows not resolvable");
    return;
  }
  const events = [
    delta(0, "a"),
    delta(1, "b"),
    delta(2, "c"),
    {
      type: "assistant/chunk",
      seq: 3,
      time: 1003,
      data: {
        turn: 1,
        step: 1,
        chunk: { type: "tool-call-delta", index: 1, id: "call-1", name: "bash", argumentsDelta: "{" },
      },
    },
    {
      type: "assistant/chunk",
      seq: 4,
      time: 1004,
      data: {
        turn: 1,
        step: 1,
        chunk: { type: "tool-call-delta", index: 1, id: "call-1", name: "bash", argumentsDelta: "}" },
      },
    },
    {
      type: "assistant/chunk",
      seq: 5,
      time: 1005,
      data: {
        turn: 1,
        step: 1,
        chunk: { type: "tool-call-delta", index: 1, id: "call-1", name: "bash", argumentsDelta: "x" },
      },
    },
  ];
  const ours = packChunkRuns(events);
  const theirs = official.packChunkRuns(events);
  assert.deepEqual(
    ours.map((row) => ({ type: row.type, seq0: row.seq0, data: row.data })),
    theirs.map((row) => ({ type: row.type, seq0: row.seq0, data: row.data })),
  );
  for (const row of ours) {
    if (typeof row.type === "string" && row.type.endsWith("-chunks")) {
      assert.deepEqual(decodeStorageRecord(row), official.decodeStorageRecord(row));
    }
  }
});
