import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeSessionBuffer, missingMessageIds } from "../src/decode.mjs";
import { planRepair, repairFile } from "../src/repair.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/synthetic");

async function copyFixture(name) {
  const dir = await mkdtemp(join(tmpdir(), "surgeon-message-id-"));
  const dest = join(dir, "session.jsonl.zstd");
  await cp(join(FIX, name), dest);
  return dest;
}

const HEADER = { version: 0, id: "session-mid", createdAt: 1, delegationDepth: 0 };

const EVENTS = [
  { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
  {
    type: "user/message",
    seq: 1,
    time: 2,
    data: { role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } },
  },
  {
    type: "assistant/message",
    seq: 2,
    time: 3,
    data: {
      message: {
        role: "assistant",
        source: { kind: "model", model: "test", provider: "test" },
        content: [{ type: "text", text: "ok" }],
      },
    },
  },
  { type: "turn/end", seq: 3, time: 4, data: { turn: 1, reason: { kind: "completed" } } },
];

test("missingMessageIds flags only message-bearing events without ids", () => {
  const seqs = missingMessageIds(EVENTS);
  assert.deepEqual(seqs, [1, 2]);
});

test("planRepair fills missing ids without dropping events", () => {
  const plan = planRepair({
    header: HEADER,
    headerClass: { ok: true, code: "header-ok", header: HEADER },
    events: EVENTS,
    health: "message-missing-id",
    issues: [{ code: "message-missing-id", message: "x", seqs: [1, 2] }],
    failedFrames: 0,
  });
  assert.ok(plan.actions.some((a) => a.code === "message-missing-id"));
  assert.equal(plan.events.length, EVENTS.length);
  const user = plan.events.find((e) => e.seq === 1);
  const asst = plan.events.find((e) => e.seq === 2);
  assert.ok(typeof user.data.id === "string" && user.data.id !== "");
  assert.ok(typeof asst.data.message.id === "string" && asst.data.message.id !== "");
  assert.equal(plan.mustWrite, true);
});

test("messageId:false leaves missing ids alone", () => {
  const plan = planRepair(
    {
      header: HEADER,
      headerClass: { ok: true, code: "header-ok", header: HEADER },
      events: EVENTS,
      health: "message-missing-id",
      issues: [],
      failedFrames: 0,
    },
    { steps: { messageId: false } },
  );
  assert.equal(plan.actions.some((a) => a.code === "message-missing-id"), false);
});

test("apply on fixture fills ids and file decodes clean", async () => {
  const dest = await copyFixture("healthy-packed.session.jsonl.zstd");
  const result = await repairFile(dest, { dryRun: false });
  assert.equal(result.wrote, false); // fixture is already healthy
  const after = decodeSessionBuffer(await (await import("node:fs/promises")).readFile(dest));
  assert.equal(after.health, "ok");
});

test("encode round-trip keeps filled ids", async () => {
  const { encodeSession } = await import("../src/encode.mjs");
  const plan = planRepair({
    header: HEADER,
    headerClass: { ok: true, code: "header-ok", header: HEADER },
    events: EVENTS,
    health: "message-missing-id",
    issues: [],
    failedFrames: 0,
  });
  const buf = await encodeSession({ header: HEADER, events: plan.events });
  const after = decodeSessionBuffer(buf);
  assert.equal(after.health, "ok");
  assert.deepEqual(missingMessageIds(after.events), []);
});
