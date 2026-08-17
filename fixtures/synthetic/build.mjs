#!/usr/bin/env node
/**
 * Synthesize golden session fixtures. Never copies ~/.dsh/sessions.
 * Layout matches official JSONL+zstd: header-only first frame, later
 * frames are event batches, each compressed with checksumFlag=1.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { constants, zstdCompress } from "node:zlib";
import { assert, verifyGap, verifyHealthy, verifyLone, verifyOrphan, verifyTorn } from "./verify.mjs";

const compressAsync = promisify(zstdCompress);
const ROOT = dirname(fileURLToPath(import.meta.url));
const T0 = 1_700_000_000_000;
const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };

function header(id) {
  return {
    type: "session",
    version: 0,
    id,
    createdAt: T0,
    cwd: "/tmp/dsh-session-surgeon-fixtures",
    delegationDepth: 0,
    agentPreset: "standard",
  };
}

function ev(type, seq, data, extra) {
  return extra
    ? { type, seq, time: T0 + seq, data, ...extra }
    : { type, seq, time: T0 + seq, data };
}

function jsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function compressFrame(text) {
  return compressAsync(Buffer.from(text), CHECKSUM);
}

async function writeConcat(rel, frames) {
  const path = join(ROOT, rel);
  await mkdir(dirname(path), { recursive: true });
  const bytes = Buffer.concat(frames);
  await writeFile(path, bytes);
  return { path, bytes, frames };
}

function userMessage(seq, text, id) {
  return ev("user/message", seq, {
    id,
    role: "user",
    source: { kind: "user" },
    content: [{ type: "text", text }],
  }, { surfaceOp: "append" });
}

function assistantMessage(seq, turn, step, text, id, sourceEventSeqs) {
  return ev("assistant/message", seq, {
    turn,
    step,
    message: {
      id,
      role: "assistant",
      source: { kind: "model", provider: "synthetic", model: "fixture" },
      content: [{ type: "text", text }],
    },
  }, { surfaceOp: "append", sourceEventSeqs });
}

function textDelta(seq, turn, step, text) {
  return ev("assistant/chunk", seq, {
    turn,
    step,
    chunk: { type: "text-delta", index: 0, text },
  });
}

function packTextRun(chunks) {
  const first = chunks[0];
  return {
    type: "text-chunks",
    seq0: first.seq,
    time0: first.time,
    data: {
      turn: first.data.turn,
      step: first.data.step,
      index: first.data.chunk.index,
      dt: chunks.slice(1).map((event, i) => event.time - chunks[i].time),
      texts: chunks.map((event) => event.data.chunk.text),
    },
  };
}

async function main() {
  const chunks = ["Hel", "lo", " ", "world."].map((text, i) => textDelta(3 + i, 1, 1, text));
  const healthyEvents = [
    ev("turn/start", 0, { turn: 1 }),
    userMessage(1, "Say hello.", "msg-healthy-user"),
    ev("step/start", 2, { turn: 1, step: 1 }),
    packTextRun(chunks),
    assistantMessage(7, 1, 1, "Hello world.", "msg-healthy-asst", [3, 4, 5, 6]),
    ev("step/end", 8, { turn: 1, step: 1 }),
    ev("turn/end", 9, { turn: 1, reason: { kind: "completed" } }),
  ];
  const healthy = await writeConcat("healthy-packed.session.jsonl.zstd", [
    await compressFrame(jsonl([header("session-synthetic-healthy-packed")])),
    await compressFrame(jsonl(healthyEvents)),
  ]);

  const tornPrefix = [
    ev("turn/start", 0, { turn: 1 }),
    userMessage(1, "Continue.", "msg-torn-user"),
    ev("step/start", 2, { turn: 1, step: 1 }),
  ];
  const tornTailEvents = [
    textDelta(3, 1, 1, "partial "),
    textDelta(4, 1, 1, "reply "),
    textDelta(5, 1, 1, "stream"),
  ];
  const tornLast = await compressFrame(jsonl(tornTailEvents));
  assert(tornLast.length > 8, "torn: last frame too small to truncate");
  const torn = await writeConcat("torn-tail.session.jsonl.zstd", [
    await compressFrame(jsonl([header("session-synthetic-torn-tail")])),
    await compressFrame(jsonl(tornPrefix)),
    tornLast.subarray(0, tornLast.length - 4),
  ]);

  const gapEvents = [
    ev("turn/start", 0, { turn: 1 }),
    userMessage(1, "First turn.", "msg-gap-user-1"),
    ev("step/start", 2, { turn: 1, step: 1 }),
    assistantMessage(3, 1, 1, "Done.", "msg-gap-asst-1", []),
    ev("step/end", 4, { turn: 1, step: 1 }),
    ev("turn/end", 5, { turn: 1, reason: { kind: "completed" } }),
    ev("turn/start", 9, { turn: 2 }),
    userMessage(10, "Second turn.", "msg-gap-user-2"),
    assistantMessage(11, 2, 1, "Dirty tail.", "msg-gap-asst-2", []),
    ev("turn/end", 12, { turn: 2, reason: { kind: "completed" } }),
  ];
  const gap = await writeConcat("seq-gap-committed.session.jsonl.zstd", [
    await compressFrame(jsonl([header("session-synthetic-seq-gap-committed")])),
    await compressFrame(jsonl(gapEvents)),
  ]);

  const loneText = `hello ${String.fromCharCode(0xd800)} world`;
  const loneEvents = [
    ev("turn/start", 0, { turn: 1 }),
    userMessage(1, loneText, "msg-lone-user"),
    ev("step/start", 2, { turn: 1, step: 1 }),
    assistantMessage(3, 1, 1, "ok", "msg-lone-asst", []),
    ev("step/end", 4, { turn: 1, step: 1 }),
    ev("turn/end", 5, { turn: 1, reason: { kind: "completed" } }),
  ];
  const lone = await writeConcat("lone-surrogate.session.jsonl.zstd", [
    await compressFrame(jsonl([header("session-synthetic-lone-surrogate")])),
    await compressFrame(jsonl(loneEvents)),
  ]);

  const orphanEvents = [
    ev("turn/start", 0, { turn: 1 }),
    userMessage(1, "tiny", "msg-orphan-user"),
    ev("turn/end", 2, { turn: 1, reason: { kind: "completed" } }),
  ];
  const orphan = await writeConcat("orphan-tmp/session.jsonl.zstd", [
    await compressFrame(jsonl([header("session-synthetic-orphan-tmp")])),
    await compressFrame(jsonl(orphanEvents)),
  ]);
  await writeFile(
    join(ROOT, "orphan-tmp/session.jsonl.zstd.tmp"),
    orphan.bytes.subarray(0, Math.max(8, Math.floor(orphan.bytes.length / 2))),
  );

  verifyHealthy(healthy);
  await verifyTorn(torn, tornLast);
  verifyGap(gap, gapEvents);
  verifyLone(lone);
  verifyOrphan(orphan);

  for (const item of [healthy, torn, gap, lone, orphan]) {
    console.log(`wrote ${item.path.slice(ROOT.length + 1)} (${item.bytes.length} bytes)`);
  }
  console.log("wrote orphan-tmp/session.jsonl.zstd.tmp");
}

await main();
