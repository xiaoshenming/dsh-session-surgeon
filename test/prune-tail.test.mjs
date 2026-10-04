import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";
import { planPruneTail, prunePassHits } from "../src/prune-tail.mjs";
import { SESSION_MODULE_PATH } from "../src/runtime.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const HEADER = { type: "session", version: 4, id: "session-prune-tail", createdAt: 1, cwd: "/tmp/surgeon", isSeeded: false, delegationDepth: 0 };

/** The released fold, when the v3→v4 package is resolvable. */
function officialFold() {
  const pnpm = join(ROOT, "node_modules", ".pnpm");
  let dirs = [];
  try {
    dirs = readdirSync(pnpm).filter((name) => name.startsWith("@deepseek-ai+dsh-session-format-v3-to-v4@"));
  } catch {
    return null;
  }
  const dir = dirs.sort().at(-1);
  if (dir === undefined) return null;
  const entry = join(pnpm, dir, "node_modules", "@deepseek-ai", "dsh-session-format-v3-to-v4", "lib", "index.js");
  return import(pathToFileURL(entry).href);
}

const ev = (type, seq, data, extra = {}) => ({ type, seq, time: seq + 1, ...extra, data });

/** One closed turn, then the idle pruner's own tail (#8812). */
function pruned(fix) {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("step/start", 1, { turn: 1, step: 1 }),
    ev("assistant/message", 2, {
      turn: 1,
      step: 1,
      message: {
        id: "a2",
        role: "assistant",
        source: { kind: "model", provider: "p", model: "m" },
        content: [{ type: "tool-call", id: "c1", name: "t", arguments: "{}" }],
      },
      stream: [],
    }, { surfaceOp: "append" }),
    ev("tool/call", 3, { turn: 1, step: 1, callId: "c1", name: "t", arguments: "{}" }),
    ev("tool/result", 4, {
      turn: 1,
      step: 1,
      message: { id: "r4", role: "tool", toolCallId: "c1", source: { kind: "tool", callId: "c1" }, content: [{ type: "text", text: "original" }] },
    }, { surfaceOp: "append" }),
    ev("step/end", 5, { turn: 1, step: 1 }),
    ev("turn/end", 6, { turn: 1, reason: { kind: "completed" } }),
    ev("compaction/prune", 7, { shadowedRange: { start: 4, end: 4 }, shadowedSeqs: [4] }),
    ev("tool/result", 8, {
      turn: 1,
      step: 1,
      message: { id: "r8", role: "tool", toolCallId: "c1", source: { kind: "tool", callId: "c1" }, content: [{ type: "text", text: "pruned" }] },
    }, { surfaceOp: { op: "replace", startSeq: 4, endSeq: 4 }, sourceEventSeqs: [4] }),
  ];
  if (fix) fix(events);
  return events;
}

test("a healthy turn carries no prune-pass hit", () => {
  assert.deepEqual(prunePassHits(pruned((events) => events.splice(7, 2))), []);
});

test("the idle prune tail is one hit: the replacement, not the prune row", () => {
  assert.deepEqual(prunePassHits(pruned()), [{ seq: 8, type: "tool/result" }]);
});

test("decode names the shape and offers the cut", async (t) => {
  if (!SESSION_MODULE_PATH) {
    t.skip("without a runtime the bundled fallback reads v0 only, so a v4 log is foreign-version");
    return;
  }
  const decoded = decodeSessionBuffer(await encode(pruned()));
  assert.equal(decoded.health, "prune-tail-outside-turn");
  const issue = decoded.issues.find((i) => i.code === "prune-tail-outside-turn");
  assert.ok(issue);
  assert.deepEqual(issue.seqs, [8]);
  assert.equal(issue.count, 1);
  const plan = planRepair(decoded);
  assert.equal(plan.refuse, undefined);
  assert.equal(plan.mustWrite, true);
  assert.deepEqual(plan.actions.map((a) => a.code), ["prune-tail-outside-turn"]);
  assert.deepEqual(plan.events.map((event) => event.seq), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(plan.events[4].data.message.content[0].text, "original", "the unpruned result is the one that survives");
});

test("a healthy log stays untouched", async (t) => {
  if (!SESSION_MODULE_PATH) {
    t.skip("without a runtime the bundled fallback reads v0 only, so a v4 log is foreign-version");
    return;
  }
  const decoded = decodeSessionBuffer(await encode(pruned((events) => events.splice(7, 2))));
  assert.equal(decoded.health, "ok");
  const plan = planRepair(decoded);
  assert.equal(plan.mustWrite, false);
  assert.deepEqual(plan.actions, []);
});

test("a tail that carries real work is refused, not truncated", () => {
  const events = pruned();
  events.push(ev("user/message", 9, { id: "u9", role: "user", content: [{ type: "text", text: "next question" }], source: { kind: "user" } }));
  assert.match(planPruneTail(events).refuse, /carries 1 event\(s\) a prune pass did not write \(user\/message\)/);
});

test("a replacement that shadows at or after the cut is refused", () => {
  const events = pruned();
  events[8].sourceEventSeqs = [9];
  assert.match(planPruneTail(events).refuse, /shadows a surface node at or after the cut/);
});

test("a prune pass followed by real work is refused", () => {
  // The pass sits between two turns: cutting back to its own turn/end would
  // drop the turn that came after it, so the repair must not run.
  const events = pruned();
  events.push(ev("turn/start", 9, { turn: 2 }), ev("step/start", 10, { turn: 2, step: 1 }));
  assert.match(planPruneTail(events).refuse, /carries 2 event\(s\) a prune pass did not write \(turn\/start, step\/start\)/);
});

test("with no turn/end to cut back to, the pass is reported only", () => {
  // A pass that is the whole log: the rows land before any turn ever opened,
  // so there is no closed boundary to cut back to.
  const events = pruned((list) => list.splice(0, 7));
  assert.equal(events[0].type, "compaction/prune");
  assert.match(planPruneTail(events).refuse, /follows no turn\/end/);
});

test("the released fold refuses the tail and accepts the cut", async (t) => {
  const v3to4 = SESSION_MODULE_PATH ? await officialFold() : null;
  if (!v3to4) {
    t.skip("official v3-to-v4 package not resolvable");
    return;
  }
  const known = new Set(v3to4.RELEASED_V3_EVENT_TYPES);
  const fold = (events) => v3to4.assertReleasedV4Relationships({ events, header: HEADER, inheritedEventCount: 0 }, known);
  assert.throws(() => fold(pruned()), /tool\/result is outside an open turn/, "the released fold refuses what the writer wrote");
  const plan = planRepair(decodeSessionBuffer(await encode(pruned())));
  fold(plan.events);
});

/** The stored artifact for one event list. */
function encode(events) {
  return encodeSession({ header: HEADER, events, packChunks: false });
}
