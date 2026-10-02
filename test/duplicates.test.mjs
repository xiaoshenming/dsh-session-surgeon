import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";
import {
  disambiguateDuplicateToolCallIds,
  duplicateAdvertisedToolCallIds,
} from "../src/duplicates.mjs";
import { MIGRATION_REFUSES_DUPLICATE_TOOL_CALL_IDS, SESSION_MODULE_PATH, dshRequires } from "../src/runtime.mjs";

const HEADER = { version: 0, id: "session-dup-calls", createdAt: 1, delegationDepth: 0 };

function assistant(seq, ids, extraStream = []) {
  return {
    type: "assistant/message",
    seq,
    time: seq + 1,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: "a" + seq,
        role: "assistant",
        source: { kind: "model", provider: "x", model: "y" },
        content: ids.map((id) => ({
          type: "tool-call",
          id,
          name: "bash",
          arguments: "{}",
        })),
      },
      stream: [
        ...ids.map((id, index) => ({
          type: "tool-call-chunks",
          time0: seq + 1,
          index,
          dt: [],
          id,
          name: "bash",
          args: ["{}"],
        })),
        ...extraStream,
      ],
    },
  };
}

function call(seq, callId) {
  return {
    type: "tool/call",
    seq,
    time: seq + 1,
    data: { turn: 1, step: 1, callId, name: "bash", arguments: "{}" },
  };
}

function result(seq, callId) {
  return {
    type: "tool/result",
    seq,
    time: seq + 1,
    data: {
      message: {
        id: "msg-" + seq,
        role: "tool",
        source: { kind: "tool", callId },
        toolCallId: callId,
        content: [{ type: "text", text: "ok" }],
      },
    },
  };
}

const DUP = [
  { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
  assistant(1, ["call_x|fc_1", "call_x|fc_1"]),
  call(2, "call_x|fc_1"),
  call(3, "call_x|fc_1"),
  result(4, "call_x|fc_1"),
  result(5, "call_x|fc_1"),
  { type: "turn/end", seq: 6, time: 7, data: { turn: 1, reason: { kind: "completed" } } },
];

test("duplicateAdvertisedToolCallIds flags a second advertise in the same step", () => {
  const hits = duplicateAdvertisedToolCallIds(DUP);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].seq, 1);
  assert.equal(hits[0].callId, "call_x|fc_1");
});

test("disambiguate suffixes later duplicates and remaps call/result in order", () => {
  const { value, rewritten } = disambiguateDuplicateToolCallIds(DUP);
  assert.ok(rewritten >= 1);
  const ids = value[1].data.message.content.map((b) => b.id);
  assert.deepEqual(ids, ["call_x|fc_1", "call_x|fc_1#2"]);
  assert.equal(value[2].data.callId, "call_x|fc_1");
  assert.equal(value[3].data.callId, "call_x|fc_1#2");
  assert.equal(value[4].data.message.source.callId, "call_x|fc_1");
  assert.equal(value[5].data.message.source.callId, "call_x|fc_1#2");
  assert.equal(value[4].data.message.toolCallId, "call_x|fc_1");
  assert.equal(value[5].data.message.toolCallId, "call_x|fc_1#2");
  assert.equal(value[1].data.stream[1].id, "call_x|fc_1#2");
  assert.equal(value[1].data.message.stream, undefined, "the stream stays a data member, not a message member");
  assert.equal(duplicateAdvertisedToolCallIds(value).length, 0);
});

test("rewrites every stream record that carries the id, block-end included", () => {
  const events = [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    assistant(1, ["call_x|fc_1", "call_x|fc_1"], [
      { type: "chunk", time: 3, chunk: { type: "block-end", index: 1, block: { type: "tool-call", id: "call_x|fc_1", name: "bash", arguments: "{}" } } },
      { type: "chunk", time: 3, chunk: { type: "tool-call-delta", index: 1, id: "call_x|fc_1", name: "", argumentsDelta: "{}" } },
    ]),
    { type: "turn/end", seq: 2, time: 3, data: { turn: 1, reason: { kind: "completed" } } },
  ];
  const { value } = disambiguateDuplicateToolCallIds(events);
  const stream = value[1].data.stream;
  assert.equal(stream[1].id, "call_x|fc_1#2", "the compact run follows the content");
  assert.equal(stream[2].chunk.block.id, "call_x|fc_1#2", "block-end hands its block back verbatim");
  assert.equal(stream[3].chunk.id, "call_x|fc_1#2", "an unmerged delta is remapped too");
  assert.equal(stream[2].chunk.block.name, "bash", "only the id changes");
});

test("refuses instead of guessing when the stream outruns the content", () => {
  const events = [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    assistant(1, ["call_x|fc_1", "call_x|fc_1"], [
      { type: "tool-call-chunks", time0: 9, index: 2, dt: [1], id: "call_x|fc_1", args: ["{}"] },
    ]),
    { type: "turn/end", seq: 2, time: 3, data: { turn: 1, reason: { kind: "completed" } } },
  ];
  const { value, rewritten } = disambiguateDuplicateToolCallIds(events);
  assert.equal(rewritten, 0, "nothing is written when the mapping is not total");
  assert.deepEqual(value, events);
});

test("preserves the mapped id across a tool/result surface replacement", () => {
  const events = [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    assistant(1, ["call_x|fc_1", "call_x|fc_1"]),
    call(2, "call_x|fc_1"),
    call(3, "call_x|fc_1"),
    result(4, "call_x|fc_1"),
    {
      ...result(5, "call_x|fc_1"),
      sourceEventSeqs: [4],
      surfaceOp: { op: "replace", startSeq: 4, endSeq: 4 },
      data: {
        ...result(5, "call_x|fc_1").data,
        message: {
          ...result(5, "call_x|fc_1").data.message,
          content: [{ type: "text", text: "replacement" }],
        },
      },
    },
    { type: "turn/end", seq: 6, time: 7, data: { turn: 1, reason: { kind: "completed" } } },
  ];
  const { value } = disambiguateDuplicateToolCallIds(events);
  assert.equal(value[4].data.message.source.callId, "call_x|fc_1");
  assert.equal(value[5].data.message.source.callId, "call_x|fc_1");
  assert.equal(value[5].data.message.toolCallId, "call_x|fc_1");
});

test("decode/repair of duplicate advertised ids follows the installed format version", async () => {
  const buf = await encodeSession({ header: HEADER, events: DUP, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  assert.ok(decoded.issues.some((i) => i.code === "duplicate-tool-call-id"));
  const plan = planRepair(decoded);
  assert.equal(plan.refuse, undefined);
  if (MIGRATION_REFUSES_DUPLICATE_TOOL_CALL_IDS) {
    assert.equal(decoded.health, "duplicate-tool-call-id");
    assert.equal(plan.mustWrite, true);
    assert.ok(plan.actions.some((a) => a.code === "duplicate-tool-call-id"));
    assert.equal(duplicateAdvertisedToolCallIds(plan.events).length, 0);
  } else {
    assert.notEqual(decoded.health, "duplicate-tool-call-id");
    assert.equal(plan.mustWrite, false);
  }
});

test("planRepair rewrites when health is duplicate-tool-call-id", () => {
  const plan = planRepair({
    header: HEADER,
    headerClass: { ok: true, code: "header-ok", header: HEADER },
    events: DUP,
    health: "duplicate-tool-call-id",
    issues: [],
    failedFrames: 0,
  });
  assert.equal(plan.refuse, undefined);
  assert.equal(plan.mustWrite, true);
  assert.equal(duplicateAdvertisedToolCallIds(plan.events).length, 0);
});

const V4_HEADER = { version: 4, id: "session-dup-v4", createdAt: 1, cwd: "/tmp/surgeon", isSeeded: false, delegationDepth: 0 };

/** A v4 log whose one step advertises the same callId twice (#5909 on v4). */
function v4DuplicateEvents() {
  const ids = ["call_x", "call_x"];
  const message = {
    id: "a2",
    role: "assistant",
    source: { kind: "model", provider: "x", model: "y" },
    content: ids.map((id) => ({ type: "tool-call", id, name: "bash", arguments: "{}" })),
  };
  const result = (seq) => ({
    type: "tool/result",
    seq,
    time: seq + 1,
    surfaceOp: "append",
    data: {
      turn: 1,
      step: 1,
      message: {
        id: "r" + seq,
        role: "tool",
        toolCallId: "call_x",
        source: { kind: "tool", callId: "call_x" },
        content: [{ type: "text", text: "ok" }],
      },
    },
  });
  return [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    { type: "step/start", seq: 1, time: 2, data: { turn: 1, step: 1 } },
    {
      type: "assistant/message",
      seq: 2,
      time: 3,
      surfaceOp: "append",
      data: {
        turn: 1,
        step: 1,
        message,
        stream: ids.map((id, index) => ({ type: "tool-call-chunks", time0: 3, index, dt: [], id, name: "bash", args: ["{}"] })),
      },
    },
    { type: "tool/call", seq: 3, time: 4, data: { turn: 1, step: 1, callId: "call_x", name: "bash", arguments: "{}" } },
    { type: "tool/call", seq: 4, time: 5, data: { turn: 1, step: 1, callId: "call_x", name: "bash", arguments: "{}" } },
    result(5),
    result(6),
    { type: "step/end", seq: 7, time: 8, data: { turn: 1, step: 1 } },
    { type: "turn/end", seq: 8, time: 9, data: { turn: 1, reason: { kind: "completed" } } },
  ];
}

/**
 * The official current-generation verifier, which is the only entry that runs
 * both the relationship fold and the content/stream agreement.
 */
function verifierPath() {
  for (const from of [createRequire(import.meta.url), ...dshRequires()]) {
    try {
      return join(dirname(from.resolve("@deepseek-ai/dsh-session-persistence-jsonl")), "worker.cjs");
    } catch {
      // Try the next resolver.
    }
  }
  return null;
}

test("the repaired v4 duplicates pass the released generation verifier", async (t) => {
  const worker = verifierPath();
  if (!worker) {
    t.skip("official persistence-jsonl not resolvable");
    return;
  }
  const { Session } = await import(SESSION_MODULE_PATH);
  const home = await mkdtemp(join(tmpdir(), "dsh-surgeon-dup-"));
  let run = 0;
  /** @returns {Promise<{ok: boolean, message?: string}>} */
  const verify = async (events) => {
    const header = { ...V4_HEADER, id: V4_HEADER.id + "-" + (++run) };
    const dir = join(home, "run" + run, "--tmp-surgeon--", header.id);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "session.v4.jsonl.zstd");
    await writeFile(path, await encodeSession({ header, events, packChunks: false }));
    return new Promise((resolve, reject) => {
      const thread = new Worker(worker, {
        workerData: { path, compression: "zstd", expectedId: header.id, expectedEventCount: events.length },
      });
      thread.once("message", (message) => resolve(message.ok ? { ok: true } : { ok: false, message: message.message }));
      thread.once("error", reject);
    });
  };
  try {
    const refused = await verify(v4DuplicateEvents());
    assert.equal(refused.ok, false, "the released fold refuses the raw duplicates");
    assert.match(refused.message, /repeats advertised tool call/);

    const decoded = decodeSessionBuffer(await encodeSession({ header: V4_HEADER, events: v4DuplicateEvents(), packChunks: false }));
    assert.equal(decoded.health, "duplicate-tool-call-id");
    const plan = planRepair(decoded);
    assert.ok(plan.actions.some((a) => a.code === "duplicate-tool-call-id"));
    Session.fromRestore(V4_HEADER.id, plan.events, V4_HEADER, 0, "detached", []);
    assert.deepEqual(await verify(plan.events), { ok: true }, "content, stream and toolCallId all agree after repair");

    // The stream is not decoration: the verifier compares the reconstruction
    // against message.content, so leaving it behind re-breaks the artifact.
    const stale = plan.events.map((event, index) => (index === 2 ? { ...event, data: { ...event.data, stream: v4DuplicateEvents()[2].data.stream } } : event));
    const withoutStream = await verify(stale);
    assert.equal(withoutStream.ok, false);
    assert.match(withoutStream.message, /content disagrees with its embedded stream/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
