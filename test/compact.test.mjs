import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeSession, backupThenWrite, atomicWrite } from "../src/encode.mjs";
import { decodeSessionBuffer, eventsSeqOk } from "../src/decode.mjs";
import { applyCompact, planCompact } from "../src/compact.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

const V4_HEADER = { version: 4, id: "session-compact-v4", createdAt: 1, cwd: "/tmp/surgeon", isSeeded: false, delegationDepth: 0 };

/** Two turns whose second one carries a step and a completed tool call, with the
 *  event-level members the released v4 gate requires: `surfaceOp`, the
 *  `sourceEventSeqs` a result uses to name its call, and the `assistant/message`
 *  that advertises the call (`Relationships.tool` refuses a call nobody
 *  advertised). The advertised message streams nothing, which is the one value
 *  the stream gate skips (`timed.length === 0`). */
function withToolCall() {
  const callId = "call_00_compact";
  return [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    { type: "user/message", seq: 1, time: 2, surfaceOp: "append", data: { id: "u1", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "one" }] } },
    { type: "step/start", seq: 2, time: 3, data: { turn: 1, step: 1 } },
    { type: "step/end", seq: 3, time: 4, data: { turn: 1, step: 1 } },
    { type: "turn/end", seq: 4, time: 5, data: { turn: 1, reason: { kind: "completed" } } },
    { type: "turn/start", seq: 5, time: 6, data: { turn: 2 } },
    { type: "user/message", seq: 6, time: 7, surfaceOp: "append", data: { id: "u2", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "two" }] } },
    { type: "step/start", seq: 7, time: 8, data: { turn: 2, step: 1 } },
    { type: "assistant/message", seq: 8, time: 9, surfaceOp: "append", data: { turn: 2, step: 1, stream: [], message: { id: "a1", role: "assistant", source: { kind: "model", provider: "deepseek-account", model: "deepseek-flash" }, content: [{ type: "tool-call", id: callId, name: "bash", arguments: "{}" }] } } },
    { type: "tool/call", seq: 9, time: 10, data: { turn: 2, step: 1, callId, name: "bash", arguments: "{}" } },
    { type: "tool/result", seq: 10, time: 11, surfaceOp: "append", sourceEventSeqs: [9], data: { turn: 2, step: 1, message: { id: "r1", role: "tool", source: { kind: "tool", callId }, toolCallId: callId, content: [{ type: "text", text: "ok" }] } } },
    { type: "step/end", seq: 11, time: 12, data: { turn: 2, step: 1 } },
    { type: "turn/end", seq: 12, time: 13, data: { turn: 2, reason: { kind: "completed" } } },
  ];
}

/** The released reader, when this checkout has it installed. */
async function officialPackages() {
  const { readdirSync } = await import("node:fs");
  const { pathToFileURL } = await import("node:url");
  const pnpm = join(ROOT, "node_modules", ".pnpm");
  let dirs;
  try {
    dirs = readdirSync(pnpm).filter((name) => name.startsWith("@deepseek-ai+dsh-session-format-v3-to-v4@"));
  } catch {
    return null;
  }
  const dir = dirs.sort().at(-1);
  if (dir === undefined) return null;
  const v3to4 = await import(pathToFileURL(join(pnpm, dir, "node_modules", "@deepseek-ai", "dsh-session-format-v3-to-v4", "lib", "index.js")).href);
  const sessionDirs = readdirSync(pnpm).filter((name) => name.startsWith("@deepseek-ai+dsh-session@"));
  const sessionDir = sessionDirs.sort().at(-1);
  if (sessionDir === undefined) return null;
  const session = await import(pathToFileURL(join(pnpm, sessionDir, "node_modules", "@deepseek-ai", "dsh-session", "lib", "index.js")).href);
  return { v3to4, Session: session.Session, knownTypes: session.KNOWN_SESSION_EVENT_TYPES };
}

test("keep 1 drops the first turn and renumbers seqs, turns and steps from the top", async () => {
  const events = twoTurns();
  const buf = await encodeSession({ header, events, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  const plan = planCompact(decoded, { keepLastTurns: 1 });
  assert.equal(plan.mustWrite, true);
  assert.equal(plan.droppedTurns, 1);
  assert.ok(eventsSeqOk(plan.events));
  assert.equal(plan.events[0].seq, 0);
  assert.equal(plan.events[0].type, "turn/start");
  // The released fold demands the next turn number, so the kept turn becomes 1.
  assert.equal(plan.events[0].data.turn, 1);
  assert.equal(plan.events.at(-1).type, "turn/end");
  assert.equal(plan.events.at(-1).data.turn, 1);
});

test("compact shifts a seq reference that stays inside the slice", async () => {
  const decoded = decodeSessionBuffer(await encodeSession({ header, events: withToolCall() }));
  const plan = planCompact(decoded, { keepLastTurns: 1 });
  assert.equal(plan.refuse, undefined);
  const result = plan.events.find((e) => e.type === "tool/result");
  const call = plan.events.find((e) => e.type === "tool/call");
  assert.deepEqual(result.sourceEventSeqs, [call.seq], "the reference follows its call");
  assert.equal(result.data.turn, 1);
  assert.equal(result.data.step, 1);
  assert.deepEqual(plan.events.filter((e) => e.type === "step/start").map((e) => e.data.step), [1]);
});

test("compact refuses when the kept slice points at a dropped event", async () => {
  const events = withToolCall();
  // A call in the kept turn that names a seq before the cut leaves the cut
  // without a unique answer.
  events[9] = { ...events[9], sourceEventSeq: 1 };
  const decoded = decodeSessionBuffer(await encodeSession({ header, events }));
  const plan = planCompact(decoded, { keepLastTurns: 1 });
  assert.equal(plan.mustWrite, false);
  assert.match(plan.refuse ?? "", /points at dropped events/);
});

test("compact refuses a session with an inherited seed prefix", () => {
  for (const inherited of [{ isSeeded: true }, { seedLength: 3 }]) {
    const withPrefix = { ...V4_HEADER, ...inherited };
    const decoded = {
      header: withPrefix,
      headerClass: { ok: true, code: "header-ok", header: withPrefix },
      events: twoTurns(),
      health: "ok",
      failedFrames: 0,
    };
    const plan = planCompact(decoded, { keepLastTurns: 1 });
    assert.equal(plan.mustWrite, false, JSON.stringify(inherited));
    assert.match(plan.refuse ?? "", /inherited seed prefix/);
  }
});

test("a compacted v4 slice still passes the released read-time gates", async (t) => {
  const official = await officialPackages();
  if (!official) {
    t.skip("official reader not resolvable");
    return;
  }
  const decoded = decodeSessionBuffer(await encodeSession({ header: V4_HEADER, events: withToolCall() }));
  const plan = planCompact(decoded, { keepLastTurns: 1 });
  assert.equal(plan.mustWrite, true);
  official.v3to4.assertReleasedV4Relationships(
    { events: plan.events, header: plan.header, inheritedEventCount: 0 },
    official.knownTypes,
  );
  official.Session.fromRestore(plan.header.id, plan.events, plan.header, 0, "detached", []);
});

test("compact refuses a session with a seq gap", () => {
  const decoded = {
    header,
    headerClass: { ok: true, code: "header-ok", header },
    events: twoTurns(),
    health: "seq-gap-committed",
    failedFrames: 0,
  };
  const plan = planCompact(decoded, { keepLastTurns: 1 });
  assert.equal(plan.mustWrite, false);
  assert.match(plan.refuse ?? "", /repair first/);
});

test("compact refuses a decode with failed middle frames", () => {
  const decoded = {
    header,
    headerClass: { ok: true, code: "header-ok", header },
    events: twoTurns(),
    failedFrames: 1,
  };
  const plan = planCompact(decoded, { keepLastTurns: 1 });
  assert.equal(plan.mustWrite, false);
  assert.match(plan.refuse ?? "", /middle frame/);
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

test("backupThenWrite keeps a unique bak when the stamp collides", async () => {
  const { readdir } = await import("node:fs/promises");
  const { bakUtcStamp } = await import("../src/encode.mjs");
  const dir = await mkdtemp(join(tmpdir(), "surgeon-bak-"));
  const file = join(dir, "session.jsonl.zstd");
  const first = await encodeSession({ header, events: twoTurns(), packChunks: false });
  await atomicWrite(file, first);
  const now = new Date("2026-01-02T03:04:05.006Z");
  await backupThenWrite(file, first, now);
  await backupThenWrite(file, first, now);
  const names = (await readdir(dir)).filter((name) => name.includes(".bak."));
  assert.ok(names.length >= 2, names.join(","));
  assert.ok(names.some((name) => name.includes(bakUtcStamp(now))));
});
