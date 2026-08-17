import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeSessionBuffer, eventsSeqOk } from "../src/decode.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/synthetic");

test("healthy-packed expands packed rows and is seq-continuous", async () => {
  const decoded = decodeSessionBuffer(await readFile(join(FIX, "healthy-packed.session.jsonl.zstd")));
  assert.equal(decoded.health, "ok");
  assert.ok(decoded.packedRows >= 1);
  assert.ok(eventsSeqOk(decoded.events));
  assert.equal(decoded.events.at(-1)?.type, "turn/end");
});

test("torn-tail is reported and prefix is kept", async () => {
  const decoded = decodeSessionBuffer(await readFile(join(FIX, "torn-tail.session.jsonl.zstd")));
  assert.ok(["torn-tail", "ok"].includes(decoded.health) || decoded.tornStart !== undefined);
  assert.ok(decoded.tornStart !== undefined);
  assert.ok(decoded.events.length >= 1);
  assert.equal(decoded.events[0].type, "turn/start");
});

test("seq-gap-committed stops before the hole", async () => {
  const decoded = decodeSessionBuffer(await readFile(join(FIX, "seq-gap-committed.session.jsonl.zstd")));
  assert.equal(decoded.health, "seq-gap-committed");
  assert.ok(decoded.issues.some((i) => i.code === "seq-gap-committed"));
  assert.ok(decoded.events.every((event, i) => event.seq === i));
  assert.equal(decoded.events.at(-1)?.type, "turn/end");
  assert.ok(!decoded.events.some((e) => e.data?.turn === 2 && e.type === "turn/end"));
});

test("lone-surrogate is flagged", async () => {
  const decoded = decodeSessionBuffer(await readFile(join(FIX, "lone-surrogate.session.jsonl.zstd")));
  assert.equal(decoded.health, "lone-surrogate");
  assert.ok(decoded.issues.some((i) => i.code === "lone-surrogate"));
});
