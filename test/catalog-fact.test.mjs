import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { catalogFactHits } from "../src/catalog-fact.mjs";
import { SESSION_MODULE_PATH, dshRequires } from "../src/runtime.mjs";

const CHILD = {
  version: 3,
  id: "session-child",
  createdAt: 1,
  cwd: "/tmp/surgeon",
  isSeeded: false,
  delegationDepth: 1,
  origin: "subagent",
  parentSession: "session-parent",
};

function child(descriptor, { header = CHILD, seqs = [0] } = {}) {
  const events = seqs.map((seq, i) => ({ type: "subagent/descriptor", seq, time: seq + 1, data: descriptor }));
  return { header, events };
}

/** The released stage that owns the catalog gate, resolved like the runtime itself. */
async function loadV3ToV4() {
  for (const requireFrom of dshRequires()) {
    try {
      const { pathToFileURL } = await import("node:url");
      return await import(pathToFileURL(requireFrom.resolve("@deepseek-ai/dsh-session-format-v3-to-v4")).href);
    } catch {
      // Try the next resolver.
    }
  }
  return null;
}

const MATRIX = [  ["v3 continuable + label", { version: 3, provider: "p", mode: "continuable", label: "helper" }, "accepted"],
  ["v3 continuable without label", { version: 3, provider: "p", mode: "continuable" }, "label"],
  ["v3 one-shot without label", { version: 3, provider: "p", mode: "one-shot" }, "accepted"],
  ["v3 one-shot + label", { version: 3, provider: "p", mode: "one-shot", label: "helper" }, "accepted"],
  ["v3 one-shot with a numeric label", { version: 3, provider: "p", mode: "one-shot", label: 7 }, "label"],
  ["v3 mode unknown", { version: 3, provider: "p", mode: "unknown", label: "helper" }, "mode"],
  ["v3 without mode", { version: 3, provider: "p", label: "helper" }, "mode"],
  ["v1 without mode or label", { version: 1, provider: "p" }, "label"],
  ["v1 with a label", { version: 1, provider: "p", label: "helper" }, "accepted"],
  ["v2 continuable + label", { version: 2, provider: "p", mode: "continuable", label: "h" }, "accepted"],
  ["v3 provider is not a string", { version: 3, provider: 7, mode: "one-shot" }, "provider"],
  ["v4 is outside the known set", { version: 4, provider: "p", mode: "continuable", label: "h" }, "accepted"],
];

test("catalogFactHits only speaks for an unseeded subagent child", () => {
  const bad = { version: 3, provider: "p", mode: "unknown", label: "h" };
  assert.deepEqual(catalogFactHits(CHILD, child(bad).events), [{ seq: 0, reason: "mode" }]);
  assert.deepEqual(catalogFactHits({ ...CHILD, origin: undefined }, child(bad).events), [], "a root session never reaches the catalog path");
  assert.deepEqual(catalogFactHits({ ...CHILD, parentSession: undefined }, child(bad).events), []);
  assert.deepEqual(catalogFactHits({ ...CHILD, isSeeded: true }, child(bad).events), [], "the inherited cut is not on disk, so a seeded child is skipped");
});

test("catalogFactHits requires exactly one descriptor row", () => {
  const bad = { version: 3, provider: "p", mode: "unknown", label: "h" };
  assert.deepEqual(catalogFactHits(CHILD, []), []);
  assert.deepEqual(catalogFactHits(CHILD, child(bad, { seqs: [0, 1] }).events), [], "two rows leave the gate no fact to interpret");
});

test("catalogFactHits agrees with the released catalog gate on every shape", async (t) => {
  if (!SESSION_MODULE_PATH) {
    t.skip("official dsh-session not resolvable");
    return;
  }
  const gate = await loadV3ToV4();
  if (!gate) {
    t.skip("the v3-to-v4 format package is not resolvable");
    return;
  }
  for (const [label, descriptor, expected] of MATRIX) {
    const { events } = child(descriptor);
    let real = "accepted";
    try {
      gate.historicalChildCatalogSource({ header: CHILD, events, inheritedEventCount: 0 });
    } catch (error) {
      const message = String(error.message);
      real = /descriptor provider/.test(message) ? "provider" : /descriptor mode/.test(message) ? "mode" : "label";
    }
    const hits = catalogFactHits(CHILD, events);
    assert.equal(hits.length === 0 ? "accepted" : hits[0].reason, expected, label + " (expected)");
    assert.equal(real, expected, label + " (released gate)");
  }
});

test("decode reports the catalog refusal and repair leaves it alone", async (t) => {
  if (!SESSION_MODULE_PATH) {
    t.skip("the bundled fallback reads v0 only, so a v3 child is foreign-version");
    return;
  }
  const { header } = child({});
  const events = [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    { type: "subagent/descriptor", seq: 1, time: 2, data: { version: 3, provider: "p", mode: "unknown", label: "h" } },
  ];
  const decoded = decodeSessionBuffer(await encodeSession({ header, events, packChunks: false }));
  assert.equal(decoded.health, "descriptor-catalog-fact");
  assert.deepEqual(decoded.catalogHits, [{ seq: 1, reason: "mode" }]);
  const issue = decoded.issues.find((i) => i.code === "descriptor-catalog-fact");
  assert.ok(issue, "the refusal is reported");
  assert.deepEqual(issue.seqs, [1]);
});

test("a stored v4 log is not judged by the catalog path", async (t) => {
  if (!SESSION_MODULE_PATH) {
    t.skip("official dsh-session not resolvable");
    return;
  }
  const header = { ...CHILD, version: 4 };
  const events = [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    { type: "subagent/descriptor", seq: 1, time: 2, data: { version: 3, provider: "p", mode: "unknown", label: "h" } },
  ];
  const decoded = decodeSessionBuffer(await encodeSession({ header, events, packChunks: false }));
  assert.deepEqual(decoded.catalogHits, [], "v4 no longer runs the migration that reads mode");
});
