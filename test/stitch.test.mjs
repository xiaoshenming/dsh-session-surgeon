import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeSessionBuffer, eventsSeqOk } from "../src/decode.mjs";
import { encodeSession, atomicWrite } from "../src/encode.mjs";
import { planRepair, repairFile } from "../src/repair.mjs";
import { stitchLiveWriterTail, recoveryCloserStart } from "../src/stitch.mjs";

const header = {
  version: 0,
  id: "session-live-writer",
  createdAt: 1,
  delegationDepth: 0,
};

function ev(type, seq, data) {
  return { type, seq, time: 1000 + seq, data };
}

function interruptedResult(seq, callId) {
  return ev("tool/result", seq, {
    turn: 1,
    step: 1,
    message: {
      id: `interrupted-tool-result-${callId}-${seq}`,
      role: "user",
      source: { kind: "tool", callId },
      content: [{ type: "tool-result", toolCallId: callId, isError: true, content: [{ type: "text", text: "interrupted" }] }],
    },
  });
}

/** Prefix 0..5 closed, then recovery closers 6..9, then live writer reuses 6.. */
function recoveryThenLive() {
  const prefix = [
    ev("turn/start", 0, { turn: 1 }),
    ev("user/message", 1, {
      id: "u1",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "go" }],
    }),
    ev("step/start", 2, { turn: 1, step: 1 }),
    ev("tool/code-dispatch-start", 3, { turn: 1, step: 1, callId: "c1" }),
    ev("assistant/message", 4, {
      turn: 1,
      step: 1,
      message: {
        id: "a1",
        role: "assistant",
        source: { kind: "model", provider: "x", model: "y" },
        content: [{ type: "tool-call", id: "c1", name: "run", arguments: "{}" }],
      },
    }),
    ev("tool/call", 5, { turn: 1, step: 1, callId: "c1", name: "run", arguments: "{}" }),
  ];
  const closers = [
    interruptedResult(6, "c1"),
    ev("step/end", 7, { turn: 1, step: 1 }),
    ev("turn/end", 8, { turn: 1, reason: { kind: "interrupted" } }),
    ev("session/end-seed", 9, {}),
  ];
  const live = [
    ev("tool/code-dispatch", 6, { turn: 1, step: 1, callId: "c1" }),
    ev("tool/result", 7, {
      turn: 1,
      step: 1,
      message: {
        id: "real-result",
        role: "user",
        source: { kind: "tool", callId: "c1" },
        content: [{ type: "tool-result", toolCallId: "c1", isError: false, content: [{ type: "text", text: "ok" }] }],
      },
    }),
    ev("step/end", 8, { turn: 1, step: 1 }),
    ev("turn/end", 9, { turn: 1, reason: { kind: "completed" } }),
    ev("turn/start", 10, { turn: 2 }),
    ev("user/message", 11, {
      id: "u2",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "later" }],
    }),
    ev("turn/end", 12, { turn: 2, reason: { kind: "completed" } }),
  ];
  return { prefix, closers, live, events: [...prefix, ...closers, ...live] };
}

test("recoveryCloserStart finds interrupted-tool-result suffix", () => {
  const { prefix, closers } = recoveryThenLive();
  const events = [...prefix, ...closers];
  assert.equal(recoveryCloserStart(events), prefix.length);
});

test("stitchLiveWriterTail drops recovery closers and keeps the live branch", () => {
  const { prefix, closers, live } = recoveryThenLive();
  const stitched = stitchLiveWriterTail([...prefix, ...closers], live);
  assert.ok(stitched);
  assert.equal(stitched.droppedClosers, closers.length);
  assert.equal(stitched.keptLive, live.length);
  assert.equal(stitched.events.at(-1).type, "turn/end");
  assert.equal(stitched.events.at(-1).data.reason.kind, "completed");
  assert.ok(stitched.events.some((e) => e.data?.message?.id === "real-result"));
  assert.ok(!stitched.events.some((e) => String(e.data?.message?.id ?? "").startsWith("interrupted-tool-result-")));
});

test("decode keeps overflow after the first seq defect", async () => {
  const { events } = recoveryThenLive();
  const buf = await encodeSession({ header, events, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  assert.equal(decoded.health, "seq-gap-committed");
  assert.ok((decoded.overflow?.length ?? 0) >= 4);
  assert.equal(decoded.overflow[0].seq, 6);
  assert.ok(decoded.events.every((event, i) => event.seq === i));
});

test("repair --apply stitches the live writer instead of truncating at the first gap", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surgeon-live-"));
  const dest = join(dir, "session.jsonl.zstd");
  const { events, live } = recoveryThenLive();
  await atomicWrite(dest, await encodeSession({ header, events, packChunks: false }));
  const decoded = decodeSessionBuffer(await (await import("node:fs/promises")).readFile(dest));
  const plan = planRepair(decoded);
  assert.ok(plan.actions.some((a) => a.code === "live-writer-tail"));
  assert.ok(!plan.actions.some((a) => a.code === "seq-gap-committed"));
  const result = await repairFile(dest, { dryRun: false });
  assert.equal(result.wrote, true);
  const after = decodeSessionBuffer(await (await import("node:fs/promises")).readFile(dest));
  assert.ok(eventsSeqOk(after.events));
  assert.equal(after.health, "ok");
  assert.ok(after.events.some((e) => e.type === "turn/start" && e.data?.turn === 2));
  assert.equal(after.events.filter((e) => e.type === "turn/end").length, 2);
  assert.ok(after.events.length >= live.length);
});

test("ordinary committed gap still truncates when overflow is a later jump, not a live replay", () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("turn/end", 1, { turn: 1, reason: { kind: "completed" } }),
    ev("turn/start", 9, { turn: 2 }),
    ev("turn/end", 10, { turn: 2, reason: { kind: "completed" } }),
  ];
  const plan = planRepair({
    header,
    headerClass: { ok: true, code: "header-ok", header },
    events: events.slice(0, 2),
    overflow: events.slice(2),
    health: "seq-gap-committed",
    issues: [],
    failedFrames: 0,
  });
  assert.ok(plan.actions.some((a) => a.code === "seq-gap-committed"));
  assert.ok(!plan.actions.some((a) => a.code === "live-writer-tail"));
  assert.equal(plan.events.at(-1).type, "turn/end");
  assert.ok(!plan.events.some((e) => e.data?.turn === 2));
});
