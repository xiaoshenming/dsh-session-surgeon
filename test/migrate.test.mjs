import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { planRepair } from "../src/repair.mjs";
import { encodeSession } from "../src/encode.mjs";
import { dshRequires } from "../src/runtime.mjs";
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
    source: { kind: "plugin", plugin: "dsh-chat-import", form: "relay", summary: "imported" },
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
    { seq: 2, patch: { form: "notice" } },
    { seq: 3, patch: { form: "notice" } },
  ]);
  const { value } = applyMigrationFixes(events, {});
  assert.equal(value[2].data.source.form, "notice");
  assert.equal(value[2].data.source.summary, "imported");
  assert.equal(value[3].data.source.form, "notice");
  assert.equal(value[3].data.source.summary, "s");
});

test("summary+sections pair conflict keeps the structured member", () => {
  const events = [
    ...BASE,
    ev("user/message", 3, {
      id: "u3",
      role: "user",
      source: { kind: "plugin", plugin: "p", form: "notice", summary: "s", sections: [{ name: "n", text: "x" }] },
      content: [{ type: "text", text: "hi" }],
    }, { surfaceOp: "append" }),
  ];
  assert.deepEqual(pluginSourceFormHits(events), [
    { seq: 2, patch: { form: "notice" } },
    { seq: 3, patch: { form: "snapshot", summary: undefined } },
  ]);
  const { value } = applyMigrationFixes(events, {});
  assert.equal(value[3].data.source.form, "snapshot");
  assert.deepEqual(value[3].data.source.sections, [{ name: "n", text: "x" }]);
  assert.equal(Object.hasOwn(value[3].data.source, "summary"), false);
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
  const issues = migrationRefusalIssues(BASE, 0);
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

/**
 * #7824: an assistant/message declares a range that sweeps in the seq of a
 * non-chunk event (there, a `session/end-seed`) sitting just before the
 * attempt's first chunk. The declared count is then one larger than the run the
 * migration reconstructs, and the v1→v2 stage refuses the session.
 */
const END_SEED_SWEPT = [
  ev("turn/start", 0, { turn: 1 }),
  ev("step/start", 1, { turn: 1, step: 1 }),
  ev("session/end-seed", 2, {}),
  chunk(3, 1, 1, "a"),
  chunk(4, 1, 1, "b"),
  chunk(5, 1, 1, "c"),
  ev("assistant/message", 6, {
    turn: 1,
    step: 1,
    message: {
      id: "a1",
      role: "assistant",
      source: { kind: "model", provider: "p", model: "m" },
      content: [{ type: "text", text: "abc" }],
    },
  }, { surfaceOp: "append", sourceEventSeqs: [[2, 5]] }),
  ev("step/end", 7, { turn: 1, step: 1 }),
  ev("turn/end", 8, { turn: 1, reason: { kind: "completed" } }),
];

test("a range sweeping in a non-chunk seq is trimmed to the on-disk run (#7824)", () => {
  assert.deepEqual(chunkProvenanceHits(END_SEED_SWEPT), [{ seq: 6, expect: [3, 4, 5] }]);
  const { value, actions } = applyMigrationFixes(END_SEED_SWEPT, { converters: true });
  assert.ok(actions.some((action) => action.code === "v0-chunk-provenance"));
  assert.deepEqual(value[6].sourceEventSeqs, [3, 4, 5]);
  assert.deepEqual(value[2], END_SEED_SWEPT[2]);
});

/** Paths to the two official stages of the v0→v1→v2 chain, or null. */
function officialChainPaths() {
  const names = {
    v0: "@deepseek-ai/dsh-session-format-v0-to-v1",
    v1to2: "@deepseek-ai/dsh-session-format-v1-to-v2",
  };
  const manifest = dshRequires()
    .map((requireFrom) => {
      try {
        return requireFrom.resolve("@deepseek-ai/dsh/package.json");
      } catch {
        return null;
      }
    })
    .find(Boolean);
  if (!manifest) return null;
  const sibling = createRequire(manifest);
  const paths = {};
  for (const [key, name] of Object.entries(names)) {
    try {
      paths[key] = sibling.resolve(name);
    } catch {
      return null;
    }
  }
  return paths;
}

test("the official v0→v1→v2 chain refuses that row, and repair makes it pass (#7824)", async (t) => {
  const paths = officialChainPaths();
  if (!paths) {
    t.skip("official session format packages not resolvable");
    return;
  }
  const v0 = await import(paths.v0);
  const v1to2 = await import(paths.v1to2);
  // The migration's stream accumulator wants real chunk payloads; the unit test
  // above only cares about seqs, so swap the payload here.
  const chainRows = END_SEED_SWEPT.map((row) =>
    row.type === "assistant/chunk"
      ? { ...row, data: { ...row.data, chunk: { type: "text-delta", index: 0, text: "x" } } }
      : row,
  );
  const runChain = (rows) => {
    const stage1 = v0.sessionFormatV0ToV1.createStage({
      sourceHeader: { type: "session", version: 0, id: "session-end-seed", createdAt: 1, cwd: "/tmp/end-seed-cwd", delegationDepth: 0 },
      sourceInheritedEventCount: 0,
    });
    const v1rows = [];
    const sink = { emitEvent: (event) => v1rows.push(event), emitRun() {}, emitSystem() {} };
    for (const row of JSON.parse(JSON.stringify(rows))) stage1.transformEvent(row, sink);
    const stage2 = v1to2.sessionFormatV1ToV2.createStage({
      sourceHeader: { version: 1, id: "session-end-seed", createdAt: 1, cwd: "/tmp/end-seed-cwd", isSeeded: false, delegationDepth: 0 },
      sourceInheritedEventCount: 0,
    });
    for (const row of v1rows) stage2.transformEvent(JSON.parse(JSON.stringify(row)), { emitEvent() {}, emitRun() {}, emitSystem() {} });
  };
  assert.throws(() => runChain(chainRows), /not one complete ordered attempt/);
  const { value } = applyMigrationFixes(chainRows, { converters: true });
  assert.doesNotThrow(() => runChain(value));
});

/**
 * Every `pluginSourceValue` shape we can name, with the verdict the released
 * stage gives it. The gate is byte-identical in 0.2.0-rc.2 and 0.2.1-rc.2 and
 * sits two lines earlier in 0.1.7-rc.2, so one table covers all three.
 */
const PLUGIN_SOURCE_SHAPES = [
  ["no form + summary", { summary: "s" }, true],
  ["relay + summary", { form: "relay", summary: "s" }, false],
  ["notice + summary", { form: "notice", summary: "s" }, true],
  ["notice without a summary", { form: "notice" }, false],
  ["snapshot + sections", { form: "snapshot", sections: [{ name: "n", text: "t" }] }, true],
  ["relay + sections", { form: "relay", sections: [{ name: "n", text: "t" }] }, false],
  ["snapshot without sections", { form: "snapshot" }, false],
  ["unknown form + summary", { form: "bogus", summary: "s" }, false],
  ["unknown form alone", { form: "bogus" }, false],
  ["relay + both members", { form: "relay", summary: "s", sections: [{ name: "n", text: "t" }] }, false],
  ["notice + both members", { form: "notice", summary: "s", sections: [{ name: "n", text: "t" }] }, false],
  ["notice + a non-string summary", { form: "notice", summary: 5 }, false],
  ["sections that are not an array", { form: "snapshot", sections: "x" }, false],
  ["empty summary under notice", { form: "notice", summary: "" }, true],
];

test("the plugin-source predicate matches the released gate shape for shape", async (t) => {
  const paths = officialChainPaths();
  if (!paths) {
    t.skip("official session format packages not resolvable");
    return;
  }
  const v0 = await import(paths.v0);
  const sourceHeader = { type: "session", version: 0, id: "session-source-shape", createdAt: 1, cwd: "/tmp/source-shape", delegationDepth: 0 };
  const rowsFor = (source) => [
    ev("turn/start", 0, { turn: 1 }),
    ev("user/message", 1, { id: "u1", role: "user", content: [{ type: "text", text: "hi" }], source }),
    ev("turn/end", 2, { turn: 1, reason: { kind: "completed" } }),
  ];
  const gateAccepts = (rows) => {
    const stage = v0.sessionFormatV0ToV1.createStage({ sourceHeader, sourceInheritedEventCount: 0 });
    const sink = { emitEvent() {}, emitRun() {}, emitSystem() {} };
    try {
      for (const row of JSON.parse(JSON.stringify(rows))) stage.transformEvent(row, sink);
      return true;
    } catch {
      return false;
    }
  };
  for (const [label, members, accepted] of PLUGIN_SOURCE_SHAPES) {
    const rows = rowsFor({ kind: "plugin", plugin: "dsh-chat-import", ...members });
    assert.equal(gateAccepts(rows), accepted, label + ": the released gate moved");
    // Report exactly the rows the gate refuses: a hit on an accepted row makes
    // repair rewrite a healthy session.
    assert.equal(pluginSourceFormHits(rows).length > 0, !accepted, label + ": our verdict must match the gate");
    const { value } = applyMigrationFixes(rows, { converters: true });
    assert.ok(gateAccepts(value), label + ": the repaired row must load");
  }
});

test("a v0 refusal stays silent on generations its converter never sees", async () => {
  // The shape every v3 session carries: the system-prompt snapshot source.
  const snapshot = ev("user/message", 1, {
    id: "u1",
    role: "user",
    source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt", form: "snapshot", sections: [{ name: "sandbox:policy", text: "workspace-write" }] },
    content: [{ type: "text", text: "go" }],
  }, { surfaceOp: "append" });
  assert.deepEqual(migrationRefusalIssues([snapshot], 3), []);
  assert.deepEqual(migrationRefusalIssues([snapshot], 0), []);

  const retired = ev("user/message", 1, {
    id: "u1",
    role: "user",
    source: { kind: "instruction-hint", plugin: "anchored-tool-bootstrap" },
    content: [{ type: "text", text: "go" }],
  }, { surfaceOp: "append" });
  // The v0 gate has no kind whitelist and accepts it; only v2→v3 retires it.
  assert.deepEqual(migrationRefusalIssues([retired], 3), []);
  assert.deepEqual(migrationRefusalIssues([retired], 2).map((issue) => issue.code), ["v0-retired-source-kind"]);

  const preset = ev("permission/preset", 0, { preset: "workspace-write", origin: "default" });
  assert.deepEqual(migrationRefusalIssues([preset], 0).map((issue) => issue.code), ["v0-preset-extra-member"]);
  for (const version of [1, 2, 3, 4]) assert.deepEqual(migrationRefusalIssues([preset], version), []);
});

test("a v3 session with the system-prompt snapshot source needs no repair", async (t) => {
  // Without the runtime a v3 artifact is `foreign-version` and the decode
  // returns before any detector runs, so this shape is only observable there.
  if (!MIGRATES_V0_ON_LOAD) {
    t.skip("no session format runtime installed");
    return;
  }
  const v3 = { version: 3, id: "session-v3-snapshot", createdAt: 1, cwd: "/tmp/v3-snapshot", isSeeded: false, delegationDepth: 0 };
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("step/start", 1, { turn: 1, step: 1 }),
    ev("user/message", 2, {
      id: "u1",
      role: "user",
      source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt", form: "snapshot", sections: [{ name: "sandbox:policy", text: "workspace-write" }] },
      content: [{ type: "text", text: "go" }],
    }, { surfaceOp: "append" }),
    ev("step/end", 3, { turn: 1, step: 1 }),
    ev("turn/end", 4, { turn: 1, reason: { kind: "completed" } }),
  ];
  const decoded = decodeSessionBuffer(await encodeSession({ header: v3, events, packChunks: false }));
  assert.equal(decoded.header.version, 3);
  assert.deepEqual(decoded.issues.map((issue) => issue.code), []);
  assert.equal(decoded.health, "ok");
  assert.equal(planRepair(decoded).mustWrite, false);
});
