import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { SESSION_FORMAT_VERSION } from "../src/runtime.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEADER = { version: 4, id: "session-pairing", createdAt: 1, cwd: "/tmp/surgeon", isSeeded: false, delegationDepth: 0 };

/**
 * Without an installed harness the format fallback is 0, so a v4 artifact is
 * reported `foreign-version` rather than the code its own rows carry. Both
 * layouts have to assert this, or the suite passes locally and breaks CI.
 */
const READS_V4 = SESSION_FORMAT_VERSION >= 4;

/**
 * A v4 session the released fold accepts: one turn, one step, one tool call
 * that is advertised by the assistant message and answered by a tool/result.
 */
function healthyEvents() {
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
          source: { kind: "model", provider: "deepseek-account", model: "deepseek-flash" },
          content: [{ type: "tool-call", id: "call-1", name: "read", arguments: "{}" }],
        },
        stream: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        replayState: {},
      },
    },
    { seq: 4, type: "tool/call", time: 5, data: { turn: 1, step: 1, callId: "call-1", name: "read", arguments: "{}" } },
    {
      seq: 5,
      type: "tool/result",
      time: 6,
      surfaceOp: "append",
      data: {
        turn: 1,
        step: 1,
        message: {
          id: "m2",
          role: "tool",
          toolCallId: "call-1",
          source: { kind: "tool", callId: "call-1" },
          content: [{ type: "text", text: "ok" }],
        },
      },
    },
    { seq: 6, type: "step/end", time: 7, data: { turn: 1, step: 1 } },
    { seq: 7, type: "turn/end", time: 8, data: { turn: 1, reason: { kind: "completed" } } },
  ];
}

/** Drive the real decoder: the detector must be reachable through decodeSessionBuffer. */
async function decode(events, header = HEADER) {
  return decodeSessionBuffer(await encodeSession({ header, events }));
}

/** The released reader, when this checkout has it installed. */
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
  return (events, header = HEADER) =>
    v3to4.assertReleasedV4Relationships({ events, header, inheritedEventCount: 0 }, session.KNOWN_SESSION_EVENT_TYPES);
}

test("the v4 baseline this suite mutates is one the released fold accepts", async () => {
  const decoded = await decode(healthyEvents());
  assert.equal(decoded.health, READS_V4 ? "ok" : "foreign-version");
  assert.deepEqual(decoded.pairingHits, []);
  const fold = await officialReader();
  if (fold === null) return;
  assert.doesNotThrow(() => fold(healthyEvents()));
});

/**
 * Every row below is refused by the released walker while `health` used to stay
 * `ok` — the worse failure, because the user is told the file is fine. The
 * mutations come from the false-negative sweep recorded in docs/REPAIR-SPEC.md
 * section 3b.
 */
const CASES = [
  { name: "turn/start that does not open the expected turn", code: "turn-step-mismatch", pick: (e) => e.type === "turn/start", apply: (e) => { e.data.turn += 1; } },
  { name: "step/start that is not the open turn's next step", code: "turn-step-mismatch", pick: (e) => e.type === "step/start", apply: (e) => { e.data.step += 1; } },
  { name: "step/start that names another turn", code: "turn-step-mismatch", pick: (e) => e.type === "step/start", apply: (e) => { e.data.turn += 1; } },
  { name: "assistant/message that names another turn", code: "turn-step-mismatch", pick: (e) => e.type === "assistant/message", apply: (e) => { e.data.turn += 1; } },
  { name: "turn/end that does not match the open turn", code: "turn-step-mismatch", pick: (e) => e.type === "turn/end", apply: (e) => { e.data.turn += 1; } },
  { name: "tool/result whose toolCallId no longer names its call", code: "tool-result-invalid", pick: (e) => e.type === "tool/result", apply: (e) => { e.data.message.toolCallId = "other-id"; } },
  { name: "tool/result whose toolCallId was dropped", code: "tool-result-invalid", pick: (e) => e.type === "tool/result", apply: (e) => { delete e.data.message.toolCallId; } },
  { name: "tool/result whose surfaceOp was dropped", code: "tool-result-invalid", pick: (e) => e.type === "tool/result", apply: (e) => { delete e.surfaceOp; } },
];

for (const { name, code, pick, apply } of CASES) {
  test(`reports ${code} for a ${name}`, async () => {
    const events = healthyEvents();
    const row = events.find(pick);
    assert.ok(row, "the baseline must contain the row this case mutates");
    apply(row);
    const decoded = await decode(events);
    if (!READS_V4) {
      // Without a harness that reads v4 the decoder refuses the generation
      // before any detector runs, so there is no row-level verdict to assert.
      assert.equal(decoded.health, "foreign-version");
      return;
    }
    assert.equal(decoded.health, code);
    assert.ok(decoded.issues.some((issue) => issue.code === code), `expected an issue carrying ${code}`);
    const fold = await officialReader();
    if (fold === null) return;
    assert.throws(() => fold(events), "the released fold must refuse the mutated artifact");
  });
}

test("an older generation is not judged by the v4 pairing rules", async () => {
  // The v3 shape keeps the call id inside content[0] and gives the message role
  // "user"; the v3→v4 stage lifts it into message.toolCallId before validating.
  // Judging the raw v3 row reported a violation the loader never sees — this
  // module did exactly that on a real v3 session until the caller was gated.
  const events = healthyEvents().map((event) => {
    if (event.type !== "tool/result") return event;
    const { toolCallId, ...rest } = event.data.message;
    return {
      ...event,
      data: {
        ...event.data,
        message: {
          ...rest,
          role: "user",
          content: [{ type: "tool-result", toolCallId, content: [{ type: "text", text: "ok" }], isError: false }],
        },
      },
    };
  });
  const decoded = await decode(events, { ...HEADER, version: 3 });
  assert.deepEqual(decoded.pairingHits, []);
  assert.equal(decoded.issues.some((issue) => issue.code === "tool-result-invalid" || issue.code === "turn-step-mismatch"), false);
});

test("a header-only artifact still carries the pairing array", async () => {
  // An early return that omitted it made inspect throw "not iterable".
  const decoded = decodeSessionBuffer(await encodeSession({ header: HEADER, events: [] }));
  assert.deepEqual(decoded.pairingHits, []);
});
