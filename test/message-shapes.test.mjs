import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fillInsertedMessageFields,
  insertedMessageHits,
  literalPluginSourceHits,
  renameRetiredSourceKinds,
  retiredSourceKindHits,
} from "../src/message-shapes.mjs";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";
import { SESSION_FORMAT_VERSION } from "../src/runtime.mjs";

function ev(type, seq, data, extra = {}) {
  return { type, seq, time: 1000 + seq, data, ...extra };
}

test("retired source kind is renamed to its successor with the same members (#6559)", () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("user/message", 1, {
      id: "u1",
      role: "user",
      source: { kind: "instruction-hint", plugin: "anchored-tool-bootstrap" },
      content: [{ type: "text", text: "go" }],
    }, { surfaceOp: "append" }),
  ];
  assert.deepEqual(retiredSourceKindHits(events), [{ seq: 1, kind: "instruction-hint" }]);
  const { value, hits } = renameRetiredSourceKinds(events);
  assert.equal(hits.length, 1);
  assert.equal(value[1].data.source.kind, "plugin");
  assert.equal(value[1].data.source.plugin, "anchored-tool-bootstrap");
  assert.deepEqual(value[1].data.content, [{ type: "text", text: "go" }]);
});

test("retired source kind with unreleased members is left untouched", () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("user/message", 1, {
      id: "u1",
      role: "user",
      source: { kind: "instruction-hint", plugin: "p", hint: "legacy" },
      content: [{ type: "text", text: "go" }],
    }, { surfaceOp: "append" }),
    ev("assistant/message", 2, {
      turn: 1,
      step: 1,
      message: {
        id: "a1",
        role: "assistant",
        source: { kind: "instruction-hint", plugin: "p" },
        content: [],
      },
    }),
  ];
  assert.deepEqual(retiredSourceKindHits(events), [{ seq: 2, kind: "instruction-hint" }]);
  const { value } = renameRetiredSourceKinds(events);
  assert.equal(value[1].data.source.kind, "instruction-hint");
  assert.equal(value[2].data.message.source.kind, "plugin");
});

test("spliced inbox messages gain the id/role the v0 converter requires (#6559)", () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("agent/inbox/spliced", 1, {
      target: "next-turn",
      start: 1,
      inserted: [
        { content: [{ type: "text", text: "hi" }], source: { kind: "user" } },
        { id: "kept", content: [{ type: "text", text: "again" }], source: { kind: "user" } },
        { id: "done", role: "user", content: [{ type: "text", text: "ok" }], source: { kind: "user" } },
        { content: [{ type: "text", text: "unreleased" }], source: { kind: "user" }, extra: true },
      ],
    }),
  ];
  assert.deepEqual(insertedMessageHits(events), [
    { seq: 1, index: 0, needsId: true, needsRole: true },
    { seq: 1, index: 1, needsId: false, needsRole: true },
  ]);
  const { value, hits } = fillInsertedMessageFields(events);
  assert.equal(hits.length, 2);
  const inserted = value[1].data.inserted;
  assert.equal(typeof inserted[0].id, "string");
  assert.ok(inserted[0].id.length > 0);
  assert.equal(inserted[0].role, "user");
  assert.deepEqual(inserted[0].content, [{ type: "text", text: "hi" }]);
  assert.equal(inserted[0].source.kind, "user");
  assert.equal(inserted[1].id, "kept");
  assert.equal(inserted[1].role, "user");
  assert.deepEqual(inserted[2], events[1].data.inserted[2]);
  assert.deepEqual(inserted[3], events[1].data.inserted[3]);
});

const PLUGIN_WRAPPER = { kind: "plugin", plugin: "dsh-mnemon" };

test("the retired plugin source wrapper is reported in every message slot (#7772)", () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("user/message", 1, {
      id: "u1",
      role: "user",
      source: PLUGIN_WRAPPER,
      content: [{ type: "text", text: "hi" }],
    }, { surfaceOp: "append" }),
    ev("assistant/message", 2, {
      turn: 1,
      step: 1,
      message: { id: "a1", role: "assistant", source: PLUGIN_WRAPPER, content: [] },
    }),
    ev("tool/result", 3, {
      turn: 1,
      step: 1,
      message: { id: "t1", role: "tool", source: PLUGIN_WRAPPER, content: [] },
    }),
    ev("agent/inbox/spliced", 4, {
      target: "next-turn",
      start: 1,
      inserted: [{ id: "i1", role: "user", content: [], source: PLUGIN_WRAPPER }],
    }),
    ev("user/message", 5, {
      id: "u2",
      role: "user",
      source: { kind: "plugin:dsh-mnemon" },
      content: [{ type: "text", text: "ok" }],
    }, { surfaceOp: "append" }),
  ];
  assert.deepEqual(literalPluginSourceHits(events), [
    { seq: 1, plugin: "dsh-mnemon" },
    { seq: 2, plugin: "dsh-mnemon" },
    { seq: 3, plugin: "dsh-mnemon" },
    { seq: 4, plugin: "dsh-mnemon" },
  ]);
});

test("a v4 log carrying the retired wrapper is reported, never rewritten (#7772)", async () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("step/start", 1, { turn: 1, step: 1 }),
    ev("user/message", 2, {
      id: "u1",
      role: "user",
      source: PLUGIN_WRAPPER,
      content: [{ type: "text", text: "hi" }],
    }, { surfaceOp: "append" }),
    ev("step/end", 3, { turn: 1, step: 1 }),
    ev("turn/end", 4, { turn: 1, reason: { kind: "completed" } }),
  ];
  const v4 = decodeSessionBuffer(await encodeSession({
    header: { version: 4, id: "session-v4-plugin", createdAt: 1, delegationDepth: 0, isSeeded: false },
    events,
    packChunks: false,
  }));
  if (SESSION_FORMAT_VERSION < 4) {
    // A runtime that cannot read v4 refuses the header itself; nothing to report.
    assert.equal(v4.health, "foreign-version");
    assert.equal(planRepair(v4).mustWrite, false);
    return;
  }
  const codes = new Set(v4.issues.map((issue) => issue.code));
  assert.ok(codes.has("v4-literal-plugin-source"));
  assert.equal(v4.health, "v4-literal-plugin-source");
  const plan = planRepair(v4);
  assert.equal(plan.mustWrite, false);
  assert.equal(plan.refuse, undefined);
});

test("the same retired wrapper is legal below v4: the v3->v4 stage lifts it (#7772)", async () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("step/start", 1, { turn: 1, step: 1 }),
    ev("user/message", 2, {
      id: "u1",
      role: "user",
      source: PLUGIN_WRAPPER,
      content: [{ type: "text", text: "hi" }],
    }, { surfaceOp: "append" }),
    ev("step/end", 3, { turn: 1, step: 1 }),
    ev("turn/end", 4, { turn: 1, reason: { kind: "completed" } }),
  ];
  const v0 = decodeSessionBuffer(await encodeSession({
    header: { version: 0, id: "session-v0-plugin", createdAt: 1, delegationDepth: 0 },
    events,
    packChunks: false,
  }));
  assert.equal(v0.issues.some((issue) => issue.code === "v4-literal-plugin-source"), false);
});

