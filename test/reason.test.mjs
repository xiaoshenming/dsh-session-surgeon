import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";
import { turnEndReasonHits } from "../src/integrity.mjs";
import { SESSION_FORMAT_VERSION } from "../src/header.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const HEADER = { type: "session", version: 4, id: "session-reason", createdAt: 1, cwd: "/tmp/surgeon", isSeeded: false, delegationDepth: 0 };
const ev = (type, seq, data, extra = {}) => ({ type, seq, time: seq + 1, ...extra, data });

/** One closed turn whose `turn/end` carries `reason`. */
function log(reason, present = true) {
  return [
    ev("turn/start", 0, { turn: 1 }),
    ev("step/start", 1, { turn: 1, step: 1 }),
    ev("user/message", 2, { id: "u2", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "hi" }] }, { surfaceOp: "append" }),
    ev("step/end", 3, { turn: 1, step: 1 }),
    ev("turn/end", 4, present ? { turn: 1, reason } : { turn: 1 }),
  ];
}

/** The released fold, when the v3→v4 package is resolvable. */
function officialFold() {
  let dirs = [];
  try {
    dirs = readdirSync(join(ROOT, "node_modules", ".pnpm")).filter((name) => name.startsWith("@deepseek-ai+dsh-session-format-v3-to-v4@"));
  } catch {
    return null;
  }
  const dir = dirs.sort().at(-1);
  if (dir === undefined) return null;
  return import(pathToFileURL(join(ROOT, "node_modules", ".pnpm", dir, "node_modules", "@deepseek-ai", "dsh-session-format-v3-to-v4", "lib", "index.js")).href);
}

test("a turn/end without a reason object is reported, with the value it carries", () => {
  assert.deepEqual(turnEndReasonHits(log(null)), [{ seq: 4, reason: "null" }]);
  assert.deepEqual(turnEndReasonHits(log("completed")), [{ seq: 4, reason: "\"completed\"" }]);
  assert.deepEqual(turnEndReasonHits(log({ kind: "" })), [{ seq: 4, reason: "{\"kind\":\"\"}" }]);
  assert.deepEqual(turnEndReasonHits(log(undefined, false)), [{ seq: 4, reason: "missing" }]);
  assert.deepEqual(turnEndReasonHits(log({ kind: "completed" })), []);
  assert.deepEqual(turnEndReasonHits(log({ kind: "error", error: { code: "UNKNOWN" } })), []);
});

test("decode reports the code and repair writes nothing", async (t) => {
  if (SESSION_FORMAT_VERSION < 4) {
    t.skip("no session format runtime installed");
    return;
  }
  const decoded = decodeSessionBuffer(await encodeSession({ header: HEADER, events: log(null), packChunks: false }));
  assert.equal(decoded.health, "turn-end-reason-invalid");
  const issue = decoded.issues.find((entry) => entry.code === "turn-end-reason-invalid");
  assert.deepEqual(issue.seqs, [4]);
  assert.deepEqual(issue.reasons, ["null"]);
  assert.match(issue.message, /reason\.kind without a null guard/);
  const plan = planRepair(decoded);
  assert.equal(plan.mustWrite, false, "the reason a turn ended is not recoverable");
  assert.equal(plan.refuse, undefined);
});

// Measured once over this machine's store: 27 sessions, 116 turn/end rows, all
// object reasons, so the predicate has no false positives on real logs.
test("a log whose turns end with a reason object stays ok", async (t) => {
  if (SESSION_FORMAT_VERSION < 4) {
    t.skip("no session format runtime installed");
    return;
  }
  const decoded = decodeSessionBuffer(await encodeSession({ header: HEADER, events: log({ kind: "interrupted" }), packChunks: false }));
  assert.equal(decoded.health, "ok");
});

test("both released gates accept the row we report", async (t) => {
  const v3to4 = await officialFold();
  if (!v3to4) {
    t.skip("the v3-to-v4 format package is not resolvable");
    return;
  }
  const known = new Set(["turn/start", "step/start", "user/message", "step/end", "turn/end"]);
  const fold = (events) => v3to4.assertReleasedV4Relationships({ events: JSON.parse(JSON.stringify(events)), header: HEADER, inheritedEventCount: 0 }, known);
  // The code exists because this passes: the row breaks the client, not the reader.
  fold(log(null));
  fold(log(undefined, false));
});