import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeSession, backupThenWrite, atomicWrite } from "../src/encode.mjs";
import { decodeSessionBuffer, eventsSeqOk } from "../src/decode.mjs";
import { applyCompact, planCompact } from "../src/compact.mjs";

function ev(type, seq, data) {
  return { type, seq, time: 1000 + seq, data };
}

function twoTurns() {
  return [
    ev("turn/start", 0, { turn: 1 }),
    ev("user/message", 1, {
      id: "u1",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "one" }],
    }),
    ev("turn/end", 2, { turn: 1, reason: { kind: "completed" } }),
    ev("turn/start", 3, { turn: 2 }),
    ev("user/message", 4, {
      id: "u2",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "two" }],
    }),
    ev("turn/end", 5, { turn: 2, reason: { kind: "completed" } }),
  ];
}

const header = {
  version: 0,
  id: "session-compact",
  createdAt: 1,
  delegationDepth: 0,
};

test("keep 1 drops the first turn and renumbers from 0", async () => {
  const events = twoTurns();
  const buf = await encodeSession({ header, events, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  const plan = planCompact(decoded, { keepLastTurns: 1 });
  assert.equal(plan.mustWrite, true);
  assert.equal(plan.droppedTurns, 1);
  assert.ok(eventsSeqOk(plan.events));
  assert.equal(plan.events[0].seq, 0);
  assert.equal(plan.events[0].type, "turn/start");
  assert.equal(plan.events[0].data.turn, 2);
  assert.equal(plan.events.at(-1).type, "turn/end");
});

test("apply compact writes a legal session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surgeon-compact-"));
  const file = join(dir, "session.jsonl.zstd");
  const buf = await encodeSession({ header, events: twoTurns(), packChunks: false });
  await atomicWrite(file, buf);
  const decoded = decodeSessionBuffer(buf);
  const result = await applyCompact({ file, decoded, keepLastTurns: 1, dryRun: false });
  assert.equal(result.wrote, true);
  const after = decodeSessionBuffer(await (await import("node:fs/promises")).readFile(file));
  assert.ok(eventsSeqOk(after.events));
  assert.equal(after.events.filter((e) => e.type === "turn/start").length, 1);
});
