import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeSessionBuffer, eventsSeqOk } from "../src/decode.mjs";
import { encodeSession } from "../src/encode.mjs";
import { planRepair } from "../src/repair.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/synthetic");

test("healthy-packed expands packed rows and is seq-continuous", async () => {
  const decoded = decodeSessionBuffer(await readFile(join(FIX, "healthy-packed.session.jsonl.zstd")));
  assert.equal(decoded.health, "ok");
  assert.ok(decoded.packedRows >= 1);
  assert.ok(eventsSeqOk(decoded.events));
  assert.equal(decoded.events.at(-1)?.type, "turn/end");
});

test("torn-tail is reported and prefix is kept", async () => {
  const decoded = decodeSessionBuffer(await readFile(join(FIX, "torn-tail.session.jsonl.zstd")));
  assert.ok(["torn-tail", "ok"].includes(decoded.health) || decoded.tornStart !== undefined);
  assert.ok(decoded.tornStart !== undefined);
  assert.ok(decoded.events.length >= 1);
  assert.equal(decoded.events[0].type, "turn/start");
});

test("seq-gap-committed stops before the hole", async () => {
  const decoded = decodeSessionBuffer(await readFile(join(FIX, "seq-gap-committed.session.jsonl.zstd")));
  assert.equal(decoded.health, "seq-gap-committed");
  assert.ok(decoded.issues.some((i) => i.code === "seq-gap-committed"));
  assert.ok(decoded.events.every((event, i) => event.seq === i));
  assert.equal(decoded.events.at(-1)?.type, "turn/end");
  assert.ok(!decoded.events.some((e) => e.data?.turn === 2 && e.type === "turn/end"));
});

test("lone-surrogate names the seq and type that carry it", async () => {
  const decoded = decodeSessionBuffer(await readFile(join(FIX, "lone-surrogate.session.jsonl.zstd")));
  assert.equal(decoded.health, "lone-surrogate");
  const issue = decoded.issues.find((i) => i.code === "lone-surrogate");
  assert.deepEqual(issue.seqs, [1]);
  assert.match(issue.message, /seq 1 \(user\/message\)/);
});

test("a lone surrogate in the header is reported, never silently rewritten", async () => {
  const healthy = decodeSessionBuffer(await readFile(join(FIX, "healthy-packed.session.jsonl.zstd")));
  const buf = await encodeSession({
    header: { ...healthy.header, cwd: healthy.header.cwd + "\uDC3E" },
    events: healthy.events,
  });
  const decoded = decodeSessionBuffer(buf);
  assert.equal(decoded.health, "lone-surrogate");
  const issue = decoded.issues.find((i) => i.code === "lone-surrogate");
  assert.equal(issue.seqs, undefined, "a header hit carries no event seq");
  assert.match(issue.message, /the header/);
  assert.match(issue.message, /only reported/);
  // Rewriting `cwd` would move the log out of the directory that names it.
  const plan = planRepair(decoded);
  assert.equal(plan.mustWrite, false);
  assert.deepEqual(plan.actions.map((a) => a.code), []);
});
