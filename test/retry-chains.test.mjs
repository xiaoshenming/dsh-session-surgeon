import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { repairRetryChains, retryChainHits } from "../src/retry-chains.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEADER = { version: 4, id: "session-retry", createdAt: 1, cwd: "/tmp/surgeon", isSeeded: false, delegationDepth: 0 };
const POLICY = JSON.stringify(["normal", 5, ["TRANSPORT"], 500, 10000, 0.1]);
const OTHER_POLICY = JSON.stringify(["normal", 3, ["TIMEOUT"], 250, 5000, 0.2]);

/** A v4 session whose step carries one `llm/retry` chain per id list. */
function retrySession(chains, { retryOf = () => 1 } = {}) {
  const rows = [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    { type: "step/start", seq: 1, time: 2, data: { turn: 1, step: 1 } },
    {
      type: "request/header",
      seq: 2,
      time: 3,
      data: { reason: "initial", header: { config: { provider: "deepseek-account", model: "deepseek-flash" } } },
    },
  ];
  let seq = 3;
  for (const [policyKey, ids] of chains) {
    ids.forEach((retryId, index) => {
      const retry = retryOf(retryId, index);
      rows.push({ type: "llm/retry", seq: seq++, time: 10 + seq, data: { retryId, turn: 1, step: 1, provider: "deepseek-account", mode: "normal", policyKey, retry, maxRetries: 5, delayMs: 100 } });
      rows.push({ type: "llm/retry-started", seq: seq++, time: 10 + seq, data: { retryId, turn: 1, step: 1, retry } });
    });
  }
  rows.push({ type: "step/end", seq: seq++, time: 10 + seq, data: { turn: 1, step: 1 } });
  rows.push({ type: "turn/end", seq: seq++, time: 10 + seq, data: { turn: 1, reason: { kind: "completed" } } });
  return rows.map((event, i) => ({ ...event, seq: i }));
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
  return { v3to4, Session: session.Session, knownTypes: session.KNOWN_SESSION_EVENT_TYPES };
}

function gateRefusal(reader, events) {
  try {
    reader.v3to4.assertReleasedV4Relationships({ events, header: HEADER, inheritedEventCount: 0 }, reader.knownTypes);
  } catch (error) {
    return error.message;
  }
  try {
    reader.Session.fromRestore(HEADER.id, events, HEADER, 0, "detached", []);
  } catch (error) {
    return error.message;
  }
  return undefined;
}

test("a chain that already sequences and reuses one id is left alone", () => {
  const events = retrySession([[POLICY, ["chain-a", "chain-a", "chain-a"]]], { retryOf: (_id, i) => i + 1 });
  assert.deepEqual(retryChainHits(events), { seqs: [], refusals: [] });
  const repaired = repairRetryChains(events);
  assert.equal(repaired.fixed, 0);
  assert.deepEqual(repaired.value, events);
});

test("retry=1 with a fresh id per attempt is detected and renumbered (#9163)", () => {
  const events = retrySession([[POLICY, ["id-1", "id-2", "id-3"]]]);
  const hits = retryChainHits(events);
  assert.equal(hits.refusals.length, 0);
  assert.ok(hits.seqs.length >= 3, "every scheduled attempt is reported");
  const repaired = repairRetryChains(events);
  // The chain's first attempt already reads (id-1, 1), so only the two later
  // retries and their two started rows change.
  assert.equal(repaired.fixed, 4, "only rows that actually change are rewritten");
  const retries = repaired.value.filter((e) => e.type === "llm/retry");
  assert.deepEqual(retries.map((e) => e.data.retry), [1, 2, 3]);
  assert.deepEqual([...new Set(retries.map((e) => e.data.retryId))], ["id-1"], "one id per chain");
  const started = repaired.value.filter((e) => e.type === "llm/retry-started");
  assert.deepEqual(started.map((e) => e.data.retry), [1, 2, 3], "the started rows follow their attempt");
  assert.ok(repaired.value.every((e, i) => e.seq === i));
});

test("interleaved chains are sequenced independently", () => {
  const events = retrySession([
    [POLICY, ["a-1", "a-2"]],
    [OTHER_POLICY, ["b-1", "b-2"]],
  ]);
  const repaired = repairRetryChains(events);
  assert.equal(repaired.refusals.length, 0);
  const byPolicy = (key) => repaired.value.filter((e) => e.type === "llm/retry" && e.data.policyKey === key);
  assert.deepEqual(byPolicy(POLICY).map((e) => e.data.retry), [1, 2]);
  assert.deepEqual(byPolicy(OTHER_POLICY).map((e) => e.data.retry), [1, 2]);
  assert.deepEqual([...new Set(byPolicy(POLICY).map((e) => e.data.retryId))], ["a-1"]);
});

test("an unrecoverable chain refuses instead of guessing", () => {
  const events = retrySession([[POLICY, ["id-1", "id-2"]]]);
  // A started row that pairs no scheduled attempt has no answer to copy.
  events.push({ type: "llm/retry-started", seq: events.length, time: 99, data: { retryId: "id-9", turn: 1, step: 1, retry: 1 } });
  const repaired = repairRetryChains(events);
  assert.equal(repaired.fixed, 0);
  assert.deepEqual(repaired.value, events, "nothing is written when the answer is missing");
  assert.match(repaired.refusals.join("; "), /pairs no earlier scheduled attempt/);
  assert.ok(retryChainHits(events).refusals.length > 0);
});

test("the repaired chain is what the released reader demands (#9163)", async (t) => {
  const reader = await officialReader();
  if (!reader) {
    t.skip("official reader not resolvable");
    return;
  }
  const broken = retrySession([[POLICY, ["id-1", "id-2", "id-3"]]]);
  assert.match(gateRefusal(reader, broken) ?? "", /llm\/retry skips its policy attempt sequence/);
  const repaired = repairRetryChains(broken);
  assert.equal(gateRefusal(reader, repaired.value), undefined, "both read-time gates accept the repaired log");
  // The healthy shape has to pass untouched, or the repair would fire on good logs.
  const healthy = retrySession([[POLICY, ["chain-a", "chain-a", "chain-a"]]], { retryOf: (_id, i) => i + 1 });
  assert.equal(gateRefusal(reader, healthy), undefined);
  assert.equal(repairRetryChains(healthy).fixed, 0);
});
