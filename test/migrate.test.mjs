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

test("plugin source form is aligned to its members; members are kept", () => {
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
  assert.deepEqual(hits, [
    { seq: 2, setForm: "notice" },
    { seq: 3, setForm: "notice" },
  ]);
  const { value } = applyMigrationFixes(events, {});
  assert.equal(value[2].data.source.form, "notice");
  assert.equal(value[2].data.source.summary, "imported");
  assert.equal(value[3].data.source.form, "notice");
  assert.equal(value[3].data.source.summary, "s");
});

test("summary+sections pair conflict drops only the extra member", () => {
  const events = [
    ...BASE,
    ev("user/message", 3, {
      id: "u3",
      role: "user",
      source: { kind: "plugin", plugin: "p", form: "notice", summary: "s", sections: [{ type: "text", text: "x" }] },
      content: [{ type: "text", text: "hi" }],
    }, { surfaceOp: "append" }),
  ];
  assert.deepEqual(pluginSourceFormHits(events), [
    { seq: 2, setForm: "notice" },
    { seq: 3, drop: "sections" },
  ]);
  const { value } = applyMigrationFixes(events, {});
  assert.equal(value[3].data.source.form, "notice");
  assert.equal(value[3].data.source.summary, "s");
  assert.equal(Object.hasOwn(value[3].data.source, "sections"), false);
});

test("llm/retry closes the attempt; provenance spanning the retry is flagged", () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    chunk(1, 1, 1, "a1"),
    ev("assistant/chunk", 2, { turn: 1, step: 1, chunk: { type: "finish", reason: { kind: "tool-calls" } } }),
    ev("llm/retry", 3, { turn: 1, step: 1, reason: {} }),
    ev("llm/retry-started", 4, { turn: 1, step: 1 }),
    chunk(5, 1, 1, "b1"),
    chunk(6, 1, 1, "b2"),
    ev("assistant/message", 7, {
      turn: 1,
      step: 1,
      message: {
        id: "a1",
        role: "assistant",
        source: { kind: "model", provider: "p", model: "m" },
        content: [{ type: "text", text: "b1b2" }],
      },
    }, { surfaceOp: "append", sourceEventSeqs: [1, 2, 5, 6] }),
  ];
  const hits = chunkProvenanceHits(events);
  assert.deepEqual(hits, [{ seq: 7, expect: [5, 6] }]);
  const { value } = applyMigrationFixes(events, {});
  assert.deepEqual(value[7].sourceEventSeqs, [5, 6]);
});

test("replacement messages citing shadowed surface nodes are never rewritten", () => {
  const events = [
    ...BASE,
    ev("assistant/message", 3, {
      turn: 20,
      step: 2,
      message: { id: "a1", role: "assistant", content: [] },
    }, {
      sourceEventSeqs: [179132, 179133],
      surfaceOp: { op: "replace", start: 179132, end: 179133 },
    }),
  ];
  assert.deepEqual(chunkProvenanceHits(events), []);
  const { value, actions } = applyMigrationFixes(events, {});
  assert.deepEqual(value[3].sourceEventSeqs, [179132, 179133]);
  assert.ok(!actions.some((a) => a.code === "v0-chunk-provenance"));
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
test("decode and planRepair handle both #6559 shapes end to end", async () => {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("agent/inbox/spliced", 1, {
      target: "next-turn",
      start: 1,
      inserted: [{ content: [{ type: "text", text: "hi" }], source: { kind: "user" } }],
    }),
    ev("user/message", 2, {
      id: "u1",
      role: "user",
      source: { kind: "instruction-hint", plugin: "anchored-tool-bootstrap" },
      content: [{ type: "text", text: "go" }],
    }, { surfaceOp: "append" }),
    ev("turn/end", 3, { turn: 1, reason: { kind: "completed" } }),
  ];
  const buf = await encodeSession({ header, events, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  const codes = new Set(decoded.issues.map((i) => i.code));
  assert.ok(codes.has("v0-retired-source-kind"));
  assert.ok(codes.has("v0-inbox-inserted-message"));
  const plan = planRepair(decoded);
  if (!MIGRATES_V0_ON_LOAD) {
    assert.equal(decoded.health, "ok");
    assert.equal(plan.mustWrite, false);
    return;
  }
  assert.equal(decoded.health, "v0-retired-source-kind");
  assert.equal(plan.refuse, undefined);
  const actions = plan.actions.map((a) => a.code);
  assert.ok(actions.includes("v0-retired-source-kind"));
  assert.ok(actions.includes("v0-inbox-inserted-message"));
  assert.equal(plan.events[2].data.source.kind, "plugin");
  assert.equal(plan.events[1].data.inserted[0].role, "user");
});
