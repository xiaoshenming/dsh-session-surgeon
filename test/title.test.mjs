import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { SESSION_FORMAT_VERSION } from "../src/header.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";
import { repairTitleReferences, titleReferenceHits } from "../src/title.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const HEADER = { type: "session", version: 4, id: "session-title", createdAt: 1, cwd: "/tmp/surgeon", isSeeded: false, delegationDepth: 0 };
const ev = (type, seq, data, extra = {}) => ({ type, seq, time: seq + 1, ...extra, data });

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

const human = (seq) => ev("user/message", seq, { id: "u" + seq, role: "user", source: { kind: "user" }, content: [{ type: "text", text: "hi" }] }, { surfaceOp: "append" });
const runtimeContext = (seq) => ev("user/message", seq, { id: "r" + seq, role: "user", source: { kind: "runtime-context", form: "snapshot", sections: [{ name: "p", text: "t" }] }, content: [{ type: "text", text: "hi" }] }, { surfaceOp: "append" });
const title = (seq, source, refs) => ev("session/title", seq, { title: "t", messageSeqs: refs, source });

/** One closed turn carrying two human messages and one injected runtime note. */
function log(row) {
  const events = [
    ev("turn/start", 0, { turn: 1 }),
    ev("step/start", 1, { turn: 1, step: 1 }),
    human(2),
    runtimeContext(3),
    human(4),
    ev("step/end", 5, { turn: 1, step: 1 }),
    ev("turn/end", 6, { turn: 1, reason: { kind: "completed" } }),
  ];
  return row === undefined ? events : events.concat(row);
}

test("a user title's citation list is emptied; a provider title keeps valid refs", () => {
  const user = titleReferenceHits(log(title(7, { kind: "user" }, [2, 4])));
  assert.equal(user.length, 1);
  assert.deepEqual(user[0].repair, [], "a user title must carry an empty list");

  const provider = titleReferenceHits(log(title(7, { kind: "provider", provider: "p" }, [2, 3, 4, 4])));
  assert.equal(provider.length, 1);
  // 3 is a runtime-context row, and 4 repeats: both are not citable.
  assert.deepEqual(provider[0].repair, [2, 4]);
});

test("valid citations, and a non-user title with no citations, are reported without a fix", () => {
  assert.deepEqual(titleReferenceHits(log(title(7, { kind: "provider", provider: "p" }, [2, 4]))), []);
  assert.deepEqual(titleReferenceHits(log(title(7, { kind: "fallback" }, [2]))), []);
  const empty = titleReferenceHits(log(title(7, { kind: "provider", provider: "p" }, [])));
  assert.equal(empty.length, 1);
  assert.equal(empty[0].repair, undefined, "which messages it came from is not in the artifact");
  const gone = titleReferenceHits(log(title(7, { kind: "fallback" }, [3])));
  assert.equal(gone.length, 1);
  assert.equal(gone[0].repair, undefined);
});

test("repair patches only the lists that have one answer, and is idempotent", () => {
  const events = log(title(7, { kind: "user" }, [2]));
  const first = repairTitleReferences(events);
  assert.equal(first.fixed, 1);
  assert.deepEqual(first.value[7].data.messageSeqs, []);
  assert.deepEqual(first.value[6], events[6], "untouched rows keep their identity");
  assert.equal(repairTitleReferences(first.value).fixed, 0);
});

test("decode reports the code and repair makes the log loadable", async (t) => {
  // Without an installed runtime the fallback format version is 0, so a v4
  // artifact is reported foreign-version and no detector ever runs.
  if (SESSION_FORMAT_VERSION < 4) {
    t.skip("no session format runtime installed");
    return;
  }
  const events = log(title(7, { kind: "user" }, [2, 4]));
  const decoded = decodeSessionBuffer(await encodeSession({ header: HEADER, events, packChunks: false }));
  assert.equal(decoded.health, "title-references-invalid");
  assert.deepEqual(decoded.titleHits.map((h) => h.seq), [7]);
  const plan = planRepair(decoded);
  assert.equal(plan.mustWrite, true);
  assert.ok(plan.actions.some((a) => a.code === "title-references-invalid"));
  const again = decodeSessionBuffer(await encodeSession({ header: plan.header, events: plan.events, packChunks: false }));
  assert.equal(again.health, "ok");
  assert.equal(planRepair(again).mustWrite, false);
});

test("the released fold refuses the citations and accepts the repaired ones", async (t) => {
  const v3to4 = await officialFold();
  if (!v3to4) {
    t.skip("the v3-to-v4 format package is not resolvable");
    return;
  }
  const known = new Set(["turn/start", "step/start", "user/message", "step/end", "turn/end", "session/title"]);
  const fold = (list) => v3to4.assertReleasedV4Relationships({ events: JSON.parse(JSON.stringify(list)), header: HEADER, inheritedEventCount: 0 }, known);
  const repairable = [
    [title(7, { kind: "user" }, [2, 4]), /must be empty exactly for a user title/],
    // 3 is a runtime-context row: not citable, so the repair keeps only 2.
    [title(7, { kind: "provider", provider: "p" }, [3, 2]), /must cite distinct earlier human user\/message events/],
  ];
  for (const [row, pattern] of repairable) {
    const events = log(row);
    assert.throws(() => fold(events), pattern, "the released fold must refuse the row we report");
    fold(repairTitleReferences(events).value);
  }

  // Which messages a non-user title came from is not in the artifact, so there
  // is nothing to write and repair must not pretend otherwise.
  for (const refs of [[], [3]]) {
    const events = log(title(7, { kind: "provider", provider: "p" }, refs));
    assert.throws(() => fold(events), /session\/title messageSeqs/);
    assert.throws(() => fold(repairTitleReferences(events).value), /session\/title messageSeqs/);
    assert.equal(repairTitleReferences(events).fixed, 0);
  }

  fold(log(title(7, { kind: "provider", provider: "p" }, [2, 4])));
});
