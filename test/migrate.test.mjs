import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { planRepair } from "../src/repair.mjs";
import { encodeSession } from "../src/encode.mjs";
import {
  applyMigrationFixes,
  chunkProvenanceHits,
  descriptorVersionHits,
  MIGRATES_V0_ON_LOAD,
  migrationRefusalIssues,
  pluginSourceFormHits,
  presetExtraMemberHits,
} from "../src/migrate.mjs";

const header = { version: 0, id: "session-migrate", createdAt: 1, delegationDepth: 0 };

function ev(type, seq, data, extra = {}) {
  return { type, seq, time: 1000 + seq, data, ...extra };
}

function chunk(seq, turn, step, text) {
  return ev("assistant/chunk", seq, { turn, step, chunk: { type: "text", text } });
}

const BASE = [
  ev("turn/start", 0, { turn: 1 }),
  ev("permission/preset", 1, { preset: "workspace-write", origin: "default" }),
  ev("user/message", 2, {
    id: "u1",
    role: "user",
    source: { kind: "plugin", plugin: "dsh-chat-import", summary: "imported" },
    content: [{ type: "text", text: "go" }],
  }, { surfaceOp: "append" }),
];

test("preset extra member is detected and stripped, preset kept", () => {
  const hits = presetExtraMemberHits(BASE);
  assert.deepEqual(hits, [{ seq: 1, extra: ["origin"] }]);
  const { value, actions } = applyMigrationFixes(BASE, {});
  assert.deepEqual(value[1].data, { preset: "workspace-write" });
  assert.ok(actions.some((a) => a.code === "v0-preset-extra-member"));
});

test("descriptor version 2 is detected and bumped to 3", () => {
  const events = [
    ...BASE,
    ev("subagent/descriptor", 3, { mode: "child", version: 2, provider: "x", label: "sub" }),
  ];
  assert.deepEqual(descriptorVersionHits(events), [{ seq: 3, version: 2 }]);
  const { value } = applyMigrationFixes(events, {});
  assert.equal(value[3].data.version, 3);
  assert.equal(value[3].data.mode, "child");
});

test("plugin source without form gains notice form; wrong-form summary is dropped", () => {
  const events = [
    ...BASE,
    ev("user/message", 3, {
      id: "u2",
      role: "user",
      source: { kind: "plugin", plugin: "p", form: "relay", summary: "s" },
      content: [{ type: "text", text: "hi" }],
    }, { surfaceOp: "append" }),
  ];
  const hits = pluginSourceFormHits(events);
  assert.equal(hits.length, 2);
  const { value } = applyMigrationFixes(events, {});
  assert.equal(value[2].data.source.form, "notice");
  assert.equal(value[2].data.source.summary, "imported");
  assert.equal(value[3].data.source.form, "relay");
  assert.equal(Object.hasOwn(value[3].data.source, "summary"), false);
});

test("chunk provenance must cite the complete ordered run; repair rewrites it", () => {
  const events = [
    ...BASE,
    chunk(3, 1, 1, "a"),
    chunk(4, 1, 1, "b"),
    ev("assistant/message", 5, {
      turn: 1,
      step: 1,
      message: {
        id: "a1",
        role: "assistant",
        source: { kind: "model", provider: "p", model: "m" },
        content: [{ type: "text", text: "ab" }],
      },
    }, { surfaceOp: "append", sourceEventSeqs: [3] }),
    chunk(6, 1, 2, "c"),
    ev("assistant/message", 7, {
      turn: 1,
      step: 2,
      message: {
        id: "a2",
        role: "assistant",
        source: { kind: "model", provider: "p", model: "m" },
        content: [{ type: "text", text: "c" }],
      },
    }, { surfaceOp: "append", sourceEventSeqs: [3, 4] }),
  ];
  const hits = chunkProvenanceHits(events);
  assert.deepEqual(hits, [
    { seq: 5, expect: [3, 4] },
    { seq: 7, expect: [6] },
  ]);
  const { value } = applyMigrationFixes(events, {});
  assert.deepEqual(value[5].sourceEventSeqs, [3, 4]);
  assert.deepEqual(value[7].sourceEventSeqs, [6]);
});

test("cross-turn stale citations and missing citations are both flagged", () => {
  const events = [
    ...BASE,
    chunk(3, 1, 1, "a"),
    ev("assistant/message", 4, {
      turn: 1,
      step: 1,
      message: { id: "a1", role: "assistant", source: { kind: "model", provider: "p", model: "m" }, content: [] },
    }),
    ev("assistant/message", 5, {
      turn: 2,
      step: 1,
      message: { id: "a2", role: "assistant", source: { kind: "model", provider: "p", model: "m" }, content: [] },
    }, { surfaceOp: "append", sourceEventSeqs: [3] }),
  ];
  const hits = chunkProvenanceHits(events);
  assert.deepEqual(hits.map((h) => h.seq), [4, 5]);
  const { value } = applyMigrationFixes(events, {});
  assert.deepEqual(value[4].sourceEventSeqs, [3]);
  assert.deepEqual(value[5].sourceEventSeqs, []);
});

test("decode reports migration issues only as v0-* codes", async () => {
  const events = [
    ...BASE,
    ev("turn/end", 3, { turn: 1, reason: { kind: "completed" } }),
  ];
  const buf = await encodeSession({ header, events, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  const codes = new Set(decoded.issues.map((i) => i.code));
  assert.ok(codes.has("v0-preset-extra-member"));
  assert.ok(codes.has("v0-plugin-source-form"));
  if (MIGRATES_V0_ON_LOAD) assert.equal(decoded.health, "v0-preset-extra-member");
});

test("planRepair fixes migration shapes end to end when the runtime migrates", async () => {
  const events = [
    ...BASE,
    ev("turn/end", 3, { turn: 1, reason: { kind: "completed" } }),
  ];
  const buf = await encodeSession({ header, events, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  const plan = planRepair(decoded);
  if (!MIGRATES_V0_ON_LOAD) {
    assert.equal(plan.mustWrite, false);
    return;
  }
  assert.equal(plan.refuse, undefined);
  assert.equal(plan.mustWrite, true);
  const codes = plan.actions.map((a) => a.code);
  assert.ok(codes.includes("v0-preset-extra-member"));
  assert.ok(codes.includes("v0-plugin-source-form"));
  assert.deepEqual(plan.events[1].data, { preset: "workspace-write" });
});

test("migrationRefusalIssues aggregates one issue per code", () => {
  const issues = migrationRefusalIssues(BASE);
  assert.deepEqual(issues.map((i) => i.code), ["v0-preset-extra-member", "v0-plugin-source-form"]);
});
