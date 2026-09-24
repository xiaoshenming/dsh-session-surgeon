import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fillInsertedMessageFields,
  insertedMessageHits,
  renameRetiredSourceKinds,
  retiredSourceKindHits,
} from "../src/message-shapes.mjs";

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
