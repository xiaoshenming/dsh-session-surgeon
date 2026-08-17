import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionLogScanner } from "../src/scanner.mjs";
import { encodeSession } from "../src/encode.mjs";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { planRepair } from "../src/repair.mjs";

const header = {
  version: 0,
  id: "session-scanner",
  createdAt: 1,
  delegationDepth: 0,
};

function ev(type, seq, data) {
  return { type, seq, time: 10 + seq, data };
}

test("empty JSONL line is unparsable and stops the prefix", () => {
  const headerRec = Buffer.from(JSON.stringify({ type: "session", ...header }) + "\n");
  const scanner = new SessionLogScanner(headerRec);
  scanner.write(Buffer.from(JSON.stringify(ev("turn/start", 0, { turn: 1 })) + "\n\n" + JSON.stringify(ev("turn/end", 1, { turn: 1 })) + "\n"));
  const done = scanner.finish();
  assert.ok(done.issues.some((i) => i.code === "unparsable-line"));
  assert.equal(done.events.length, 1);
  assert.equal(done.events[0].type, "turn/start");
});

test("empty line inside a complete zstd frame is unparsable-line", async () => {
  const { compressFrame } = await import("../src/zstd-frames.mjs");
  const head = await compressFrame(JSON.stringify({ type: "session", ...header }) + "\n");
  const body = await compressFrame(
    JSON.stringify(ev("turn/start", 0, { turn: 1 })) + "\n\n" + JSON.stringify(ev("turn/end", 1, { turn: 1, reason: { kind: "completed" } })) + "\n",
  );
  const decoded = decodeSessionBuffer(Buffer.concat([head, body]));
  assert.equal(decoded.health, "unparsable-line");
  assert.equal(decoded.events.length, 1);
  assert.equal(decoded.events[0].type, "turn/start");
});

test("healthy packed session still decodes after scanner rewrite", async () => {
  const { readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const FIX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/synthetic/healthy-packed.session.jsonl.zstd");
  const decoded = decodeSessionBuffer(await readFile(FIX));
  assert.equal(decoded.health, "ok");
  const plan = planRepair(decoded);
  assert.equal(plan.mustWrite, false);
});

test("encode+decode round-trip of two events", async () => {
  const events = [ev("turn/start", 0, { turn: 1 }), ev("turn/end", 1, { turn: 1, reason: { kind: "completed" } })];
  const buf = await encodeSession({ header, events, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  assert.equal(decoded.health, "ok");
  assert.equal(decoded.events.length, 2);
});
