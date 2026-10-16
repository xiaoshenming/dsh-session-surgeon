import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";
import { SESSION_FORMAT_VERSION } from "../src/runtime.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEADER = { version: 4, id: "session-ptc", createdAt: 1, cwd: "/tmp/surgeon", isSeeded: false, delegationDepth: 0 };

/**
 * Without an installed harness the format fallback is 0, so a v4 artifact is
 * reported `foreign-version` and the decoder returns before any detector runs.
 */
const READS_V4 = SESSION_FORMAT_VERSION >= 4;

const ROOT_CALL = "call-1";

function ptc(subCallId, type, overrides = {}) {
  return {
    type,
    time: 5,
    data: {
      rootCallId: ROOT_CALL,
      parentCallId: ROOT_CALL,
      subCallId,
      name: "session_scan",
      arguments: {},
      ...overrides,
    },
  };
}

/** One well-formed dispatch pair: a start and the row that settles it. */
function ptcEvents(rows = [ptc(`${ROOT_CALL}:ptc:1`, "tool/ptc-dispatch-start"), ptc(`${ROOT_CALL}:ptc:1`, "tool/ptc-dispatch")]) {
  return [
    { seq: 0, type: "turn/start", time: 1, data: { turn: 1 } },
    { seq: 1, type: "step/start", time: 2, data: { turn: 1, step: 1 } },
    {
      seq: 2,
      type: "request/header",
      time: 3,
      data: { reason: "initial", header: { config: { provider: "deepseek-account", model: "deepseek-flash" } } },
    },
    ...rows.map((row, index) => ({ ...row, seq: 3 + index, time: 4 + index })),
    { seq: 3 + rows.length, type: "step/end", time: 40, data: { turn: 1, step: 1 } },
    { seq: 4 + rows.length, type: "turn/end", time: 41, data: { turn: 1, reason: { kind: "completed" } } },
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
  return (events) =>
    v3to4.assertReleasedV4Relationships({ events, header: HEADER, inheritedEventCount: 0 }, session.KNOWN_SESSION_EVENT_TYPES);
}

test("a well-formed PTC pair is accepted and reports nothing", async () => {
  const decoded = await decode(ptcEvents());
  assert.deepEqual(decoded.ptcHits, []);
  assert.equal(decoded.health, READS_V4 ? "ok" : "foreign-version");
  const fold = await officialReader();
  if (fold === null) return;
  // The fixture has to be one the released fold accepts, or the mutations below
  // prove nothing about the shapes we claim to detect.
  assert.doesNotThrow(() => fold(ptcEvents()));
});

/** Rows the released relationships fold refuses while `health` used to stay `ok`. */
const CASES = [
  {
    name: "a start that repeats a sub-call id already settled",
    rows: () => [
      ptc(`${ROOT_CALL}:ptc:1`, "tool/ptc-dispatch-start"),
      ptc(`${ROOT_CALL}:ptc:1`, "tool/ptc-dispatch"),
      ptc(`${ROOT_CALL}:ptc:1`, "tool/ptc-dispatch-start"),
    ],
  },
  {
    name: "a dispatch whose name differs from its start",
    rows: () => [
      ptc(`${ROOT_CALL}:ptc:1`, "tool/ptc-dispatch-start"),
      ptc(`${ROOT_CALL}:ptc:1`, "tool/ptc-dispatch", { name: "other-tool" }),
    ],
  },
  {
    name: "a dispatch whose rootCallId was emptied",
    rows: () => [
      ptc(`${ROOT_CALL}:ptc:1`, "tool/ptc-dispatch-start"),
      ptc(`${ROOT_CALL}:ptc:1`, "tool/ptc-dispatch", { rootCallId: "" }),
    ],
  },
  {
    name: "a dispatch whose parentCallId belongs to nothing",
    rows: () => [
      ptc(`${ROOT_CALL}:ptc:1`, "tool/ptc-dispatch-start"),
      ptc(`${ROOT_CALL}:ptc:1`, "tool/ptc-dispatch", { parentCallId: "call-unrelated" }),
    ],
  },
  {
    name: "a dispatch with no start at all",
    rows: () => [ptc(`${ROOT_CALL}:ptc:1`, "tool/ptc-dispatch")],
  },
  {
    name: "a start whose subCallId was emptied",
    rows: () => [ptc("", "tool/ptc-dispatch-start")],
  },
];

for (const { name, rows } of CASES) {
  test(`reports ptc-dispatch-invalid for ${name}`, async () => {
    const events = ptcEvents(rows());
    const decoded = await decode(events);
    if (!READS_V4) {
      assert.equal(decoded.health, "foreign-version");
      return;
    }
    assert.equal(decoded.health, "ptc-dispatch-invalid");
    assert.ok(decoded.issues.some((issue) => issue.code === "ptc-dispatch-invalid"));
    const fold = await officialReader();
    if (fold === null) return;
    assert.throws(() => fold(events), "the released fold must refuse the mutated artifact");
  });
}

test("the PTC walk stops at the first violation", async () => {
  // The fold aborts there, so continuing would only manufacture cascade hits.
  const decoded = await decode(ptcEvents([ptc("", "tool/ptc-dispatch-start"), ptc("", "tool/ptc-dispatch")]));
  if (!READS_V4) return;
  assert.equal(decoded.ptcHits.length, 1);
});

test("a header-only artifact still carries the PTC array", async () => {
  const decoded = decodeSessionBuffer(await encodeSession({ header: HEADER, events: [] }));
  assert.deepEqual(decoded.ptcHits, []);
});

/** The #9677 shape: the same parent call re-issued, the counter back at 1. */
function repeatedPair() {
  const id = `${ROOT_CALL}:ptc:1`;
  return ptcEvents([
    ptc(id, "tool/ptc-dispatch-start"),
    ptc(id, "tool/ptc-dispatch"),
    ptc(id, "tool/ptc-dispatch-start"),
    ptc(id, "tool/ptc-dispatch"),
  ]);
}

test("a healthy file is not written", async () => {
  const decoded = await decode(ptcEvents());
  if (!READS_V4) return;
  assert.equal(planRepair(decoded).mustWrite, false);
});

test("a repeated PTC sub-call id is repaired by renaming the later occurrence", async () => {
  const decoded = await decode(repeatedPair());
  if (!READS_V4) return;
  assert.equal(decoded.health, "ptc-dispatch-invalid");

  const plan = planRepair(decoded);
  assert.equal(plan.mustWrite, true);
  assert.ok(plan.actions.some((action) => action.code === "ptc-dispatch-invalid"));

  // The first occurrence keeps the id a child row may already name, the second
  // gets a fresh suffix, and nothing is deleted.
  const starts = plan.events.filter((event) => event.type === "tool/ptc-dispatch-start");
  assert.equal(starts.length, 2);
  assert.equal(starts[0].data.subCallId, `${ROOT_CALL}:ptc:1`);
  assert.equal(starts[1].data.subCallId, `${ROOT_CALL}:ptc:1::r1`);
  assert.equal(plan.events.length, repeatedPair().length);

  const after = await decode(plan.events);
  assert.equal(after.health, "ok");
  assert.deepEqual(after.ptcHits, []);
  assert.equal(planRepair(after).mustWrite, false, "the repair must be idempotent");

  const fold = await officialReader();
  if (fold === null) return;
  assert.throws(() => fold(repeatedPair()), "the released fold must refuse the repeated id");
  assert.doesNotThrow(() => fold(plan.events));
});

test("a PTC violation that is not a repeated id is refused, not renamed", async () => {
  const decoded = await decode(ptcEvents([ptc("", "tool/ptc-dispatch-start")]));
  if (!READS_V4) return;
  assert.equal(decoded.health, "ptc-dispatch-invalid");
  const plan = planRepair(decoded);
  assert.equal(plan.mustWrite, false);
  assert.match(plan.refuse, /cannot repair the PTC dispatches/);
});
