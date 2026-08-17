import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeSessionBuffer, eventsSeqOk } from "../src/decode.mjs";
import { repairFile } from "../src/repair.mjs";
import { containsLoneSurrogate } from "../src/redact.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/synthetic");

async function copyFixture(name) {
  const dir = await mkdtemp(join(tmpdir(), "surgeon-repair-"));
  const dest = join(dir, "session.jsonl.zstd");
  await cp(join(FIX, name), dest);
  return dest;
}

test("dry-run does not rewrite the file", async () => {
  const dest = await copyFixture("torn-tail.session.jsonl.zstd");
  const before = await readFile(dest);
  const result = await repairFile(dest, { dryRun: true });
  assert.equal(result.wrote, false);
  assert.deepEqual(await readFile(dest), before);
});

test("torn-tail --apply yields continuous seq and a turn/end", async () => {
  const dest = await copyFixture("torn-tail.session.jsonl.zstd");
  const result = await repairFile(dest, { dryRun: false });
  assert.equal(result.wrote, true);
  const after = decodeSessionBuffer(await readFile(dest));
  assert.ok(eventsSeqOk(after.events));
  assert.equal(after.events.at(-1)?.type, "turn/end");
  assert.equal(after.tornStart, undefined);
});

test("seq-gap-committed --apply keeps the last turn/end before the hole", async () => {
  const dest = await copyFixture("seq-gap-committed.session.jsonl.zstd");
  const result = await repairFile(dest, { dryRun: false });
  assert.equal(result.wrote, true);
  const after = decodeSessionBuffer(await readFile(dest));
  assert.ok(eventsSeqOk(after.events));
  assert.equal(after.events.at(-1)?.type, "turn/end");
  assert.ok(!after.events.some((e) => e.type === "turn/start" && e.data?.turn === 2));
});

test("lone-surrogate --apply strips isolated surrogates and keeps seq", async () => {
  const dest = await copyFixture("lone-surrogate.session.jsonl.zstd");
  const before = decodeSessionBuffer(await readFile(dest));
  const result = await repairFile(dest, { dryRun: false });
  assert.equal(result.wrote, true);
  const after = decodeSessionBuffer(await readFile(dest));
  assert.equal(after.events.length, before.events.length);
  assert.ok(eventsSeqOk(after.events));
  assert.equal(after.health, "ok");
  const dump = JSON.stringify(after.events);
  assert.equal(containsLoneSurrogate(dump), false);
});

test("mid-turn committed gap truncates to the previous turn/end, not an open turn", async () => {
  const { encodeSession } = await import("../src/encode.mjs");
  const { atomicWrite } = await import("../src/encode.mjs");
  const header = { version: 0, id: "session-midgap", createdAt: 1, delegationDepth: 0 };
  const events = [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    { type: "turn/end", seq: 1, time: 2, data: { turn: 1, reason: { kind: "completed" } } },
    { type: "turn/start", seq: 2, time: 3, data: { turn: 2 } },
    { type: "user/message", seq: 3, time: 4, data: { id: "u", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "x" }] } },
    { type: "assistant/message", seq: 9, time: 5, data: { turn: 2, step: 1, message: { id: "a", role: "assistant", source: { kind: "model", provider: "x", model: "y" }, content: [{ type: "text", text: "y" }] } } },
    { type: "turn/end", seq: 10, time: 6, data: { turn: 2, reason: { kind: "completed" } } },
  ];
  const dir = await (await import("node:fs/promises")).mkdtemp((await import("node:path")).join((await import("node:os")).tmpdir(), "surgeon-midgap-"));
  const dest = (await import("node:path")).join(dir, "session.jsonl.zstd");
  await atomicWrite(dest, await encodeSession({ header, events, packChunks: false }));
  const result = await repairFile(dest, { dryRun: false });
  assert.equal(result.wrote, true);
  const after = decodeSessionBuffer(await readFile(dest));
  assert.ok(eventsSeqOk(after.events));
  assert.equal(after.events.at(-1)?.type, "turn/end");
  assert.ok(!after.events.some((e) => e.type === "turn/start" && e.data?.turn === 2));
});

test("apply writes a .bak.* sibling", async () => {
  const dest = await copyFixture("torn-tail.session.jsonl.zstd");
  await repairFile(dest, { dryRun: false });
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(dirname(dest));
  assert.ok(names.some((n) => n.startsWith("session.jsonl.zstd.bak.")));
});
