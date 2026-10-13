import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { SESSION_FORMAT_VERSION } from "../src/runtime.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEADER = { version: 4, id: "session-surface", createdAt: 1, cwd: "/tmp/surgeon", isSeeded: false, delegationDepth: 0 };

/**
 * Without an installed harness the format fallback is 0, so a v4 artifact is
 * reported `foreign-version` and the decoder returns before any detector runs.
 */
const READS_V4 = SESSION_FORMAT_VERSION >= 4;

const CALL_ID = "call-1";
const MODEL_SOURCE = { kind: "model", provider: "deepseek-account", model: "deepseek-flash" };
const TOOL_SOURCE = { kind: "tool", callId: CALL_ID };

function toolResult(seq, time, content, surfaceOp, sourceEventSeqs, id = `r${seq}`) {
  const event = {
    seq,
    type: "tool/result",
    time,
    surfaceOp,
    data: {
      turn: 1,
      step: 1,
      message: { id, role: "tool", toolCallId: CALL_ID, source: TOOL_SOURCE, content },
    },
  };
  if (sourceEventSeqs !== undefined) event.sourceEventSeqs = sourceEventSeqs;
  return event;
}

const TEXT = (text) => [{ type: "text", text }];

/**
 * One appended `tool/result` (seq 5) and one replacement (seq 6) that shadows
 * it. A replacement that shadows a surface is a `tool/result`: the seed gate
 * refuses `assistant/message embeds its source stream and cannot carry
 * sourceEventSeqs`, and the real store's replacements are all tool/results.
 */
function surfaceEvents({ startSeq = 5, endSeq = 5, sourceEventSeqs = [5], dropSourceEventSeqs = false } = {}) {
  // A replacement may change only content, so it keeps the shadowed row's id.
  const replacement = toolResult(6, 7, TEXT("shadowed"), { op: "replace", startSeq, endSeq }, sourceEventSeqs, "r5");
  if (dropSourceEventSeqs) delete replacement.sourceEventSeqs;
  return [
    { seq: 0, type: "turn/start", time: 1, data: { turn: 1 } },
    { seq: 1, type: "step/start", time: 2, data: { turn: 1, step: 1 } },
    {
      seq: 2,
      type: "request/header",
      time: 3,
      data: { reason: "initial", header: { config: { provider: "deepseek-account", model: "deepseek-flash" } } },
    },
    {
      seq: 3,
      type: "assistant/message",
      time: 4,
      surfaceOp: "append",
      data: {
        turn: 1,
        step: 1,
        message: {
          id: "m1",
          role: "assistant",
          source: MODEL_SOURCE,
          content: [{ type: "tool-call", id: CALL_ID, name: "read", arguments: "{}" }],
        },
        stream: [],
      },
    },
    { seq: 4, type: "tool/call", time: 5, data: { turn: 1, step: 1, callId: CALL_ID, name: "read", arguments: "{}" } },
    toolResult(5, 6, TEXT("original"), "append"),
    replacement,
    { seq: 7, type: "step/end", time: 8, data: { turn: 1, step: 1 } },
    { seq: 8, type: "turn/end", time: 9, data: { turn: 1, reason: { kind: "completed" } } },
  ];
}

async function decode(events) {
  return decodeSessionBuffer(await encodeSession({ header: HEADER, events }));
}

async function officialReader() {
  const pnpm = join(ROOT, "node_modules", ".pnpm");
  let names;
  try {
    names = readdirSync(pnpm);
  } catch {
    return null;
  }
  const formatDir = names.filter((n) => n.startsWith("@deepseek-ai+dsh-session-format-v3-to-v4@")).sort().at(-1);
  const sessionDir = names.filter((n) => n.startsWith("@deepseek-ai+dsh-session@")).sort().at(-1);
  if (formatDir === undefined || sessionDir === undefined) return null;
  const v3to4 = await import(pathToFileURL(join(pnpm, formatDir, "node_modules", "@deepseek-ai", "dsh-session-format-v3-to-v4", "lib", "index.js")).href);
  const session = await import(pathToFileURL(join(pnpm, sessionDir, "node_modules", "@deepseek-ai", "dsh-session", "lib", "index.js")).href);
  return {
    fold: (events) => v3to4.assertReleasedV4Relationships({ events, header: HEADER, inheritedEventCount: 0 }, session.KNOWN_SESSION_EVENT_TYPES),
    seed: (events) => session.Session.fromRestore(HEADER.id, events, HEADER, 0, "detached", []),
  };
}

test("a healthy surface replacement is accepted and reports nothing", async () => {
  const decoded = await decode(surfaceEvents());
  assert.deepEqual(decoded.surfaceHits, []);
  assert.equal(decoded.health, READS_V4 ? "ok" : "foreign-version");
  const reader = await officialReader();
  if (reader === null) return;
  // The fixture has to be one the released gates accept, or the mutations below
  // prove nothing about the shapes we claim to detect.
  assert.doesNotThrow(() => reader.fold(surfaceEvents()));
  assert.doesNotThrow(() => reader.seed(surfaceEvents()));
});

/** Rows the released gates refuse while `health` used to stay `ok`. */
const CASES = [
  { name: "a replacement whose startSeq is not on the surface", args: { startSeq: 4 } },
  { name: "a replacement whose endSeq is not on the surface", args: { endSeq: 4 } },
  { name: "a replacement that omits the row it shadows", args: { sourceEventSeqs: [] } },
  { name: "a replacement without sourceEventSeqs", args: { dropSourceEventSeqs: true } },
];

for (const { name, args } of CASES) {
  test(`reports surface-replacement-invalid for ${name}`, async () => {
    const events = surfaceEvents(args);
    const decoded = await decode(events);
    if (!READS_V4) {
      assert.equal(decoded.health, "foreign-version");
      return;
    }
    assert.equal(decoded.health, "surface-replacement-invalid");
    assert.ok(decoded.issues.some((issue) => issue.code === "surface-replacement-invalid"));
    const reader = await officialReader();
    if (reader === null) return;
    assert.throws(() => reader.fold(events), "the released fold must refuse the mutated artifact");
  });
}

test("the surface walk stops at the first violation", async () => {
  // The fold aborts there, so every later index is undefined; continuing would
  // only manufacture cascade hits.
  const decoded = await decode(surfaceEvents({ startSeq: 4 }));
  if (!READS_V4) return;
  assert.equal(decoded.surfaceHits.length, 1);
});

test("a header-only artifact still carries the surface array", async () => {
  const decoded = decodeSessionBuffer(await encodeSession({ header: HEADER, events: [] }));
  assert.deepEqual(decoded.surfaceHits, []);
});
