import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generationLogFilename,
  parseGenerationFilename,
  pickCanonicalGeneration,
} from "../src/generations.mjs";
import { listSessionFiles } from "../src/find.mjs";
import { SESSION_FORMAT_VERSION } from "../src/runtime.mjs";
import { encodeSession } from "../src/encode.mjs";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { planRepair } from "../src/repair.mjs";

test("generation filenames: v0 untagged, vN tagged, never .v0", () => {
  assert.equal(generationLogFilename(0, "zstd"), "session.jsonl.zstd");
  assert.equal(generationLogFilename(2, "zstd"), "session.v2.jsonl.zstd");
  assert.equal(generationLogFilename(1, "none"), "session.v1.jsonl");
  assert.deepEqual(parseGenerationFilename("session.jsonl.zstd"), {
    version: 0,
    compression: "zstd",
    filename: "session.jsonl.zstd",
  });
  assert.deepEqual(parseGenerationFilename("session.v2.jsonl.zstd"), {
    version: 2,
    compression: "zstd",
    filename: "session.v2.jsonl.zstd",
  });
  assert.equal(parseGenerationFilename("session.v0.jsonl.zstd"), null);
  assert.equal(parseGenerationFilename("session.v02.jsonl.zstd"), null);
  assert.equal(parseGenerationFilename("session.jsonl.zstd.tmp"), null);
});

test("pickCanonicalGeneration prefers the highest readable generation", () => {
  const gens = [
    { version: 0, filename: "session.jsonl.zstd" },
    { version: 2, filename: "session.v2.jsonl.zstd" },
  ];
  assert.equal(pickCanonicalGeneration(gens, 0).version, 0);
  assert.equal(pickCanonicalGeneration(gens, 2).version, 2);
  assert.equal(pickCanonicalGeneration([{ version: 2, filename: "session.v2.jsonl.zstd" }], 0).version, 2);
});

test("listSessionFiles discovers session.vN.jsonl.zstd", async () => {
  const root = await mkdtemp(join(tmpdir(), "surgeon-gen-"));
  const dir = join(root, "--proj--", "session-alpha");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "session.v2.jsonl.zstd"), "not-a-real-zstd");
  const listed = await listSessionFiles(root);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].generation, 2);
  assert.equal(listed[0].kind, "zstd");
  assert.ok(listed[0].file.endsWith("session.v2.jsonl.zstd"));
});

test("v3/v4 headers round-trip and repair stays a no-op", async () => {
  for (const version of [3, 4]) {
    const header = { version, id: "session-v" + version, createdAt: 1, delegationDepth: 0, isSeeded: false };
    const events = [
      { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
      { type: "turn/end", seq: 1, time: 2, data: { turn: 1, reason: { kind: "completed" } } },
    ];
    const buf = await encodeSession({ header, events, packChunks: false });
    const decoded = decodeSessionBuffer(buf);
    if (SESSION_FORMAT_VERSION < version) {
      // Standalone fallback (no installed runtime): a newer generation is
      // reported as foreign, never guessed at.
      assert.equal(decoded.headerClass.code, "foreign-version");
      assert.equal(planRepair(decoded).refuse, "foreign format version — upgrade the harness");
      continue;
    }
    assert.equal(decoded.header.version, version);
    assert.equal(decoded.header.isSeeded, false);
    assert.equal(decoded.health, "ok");
    const plan = planRepair(decoded);
    assert.equal(plan.mustWrite, false);
    assert.equal(plan.refuse, undefined);
  }
});

test("a generation newer than the installed runtime asks for an upgrade, not a repair", () => {
  const plan = planRepair({
    header: null,
    headerClass: { ok: false, code: "foreign-version", error: "format v99 is newer than this harness" },
    events: [],
  });
  assert.equal(plan.mustWrite, false);
  assert.equal(plan.refuse, "foreign format version — upgrade the harness");
});

test("the canonical generation is the newest one the installed runtime knows", () => {
  const gens = [
    { version: 0, filename: "session.jsonl.zstd" },
    { version: 2, filename: "session.v2.jsonl.zstd" },
    { version: 4, filename: "session.v4.jsonl.zstd" },
  ];
  const picked = pickCanonicalGeneration(gens, SESSION_FORMAT_VERSION);
  if (SESSION_FORMAT_VERSION >= 4) assert.equal(picked.version, 4);
  else if (SESSION_FORMAT_VERSION >= 2) assert.equal(picked.version, 2);
  else assert.equal(picked.version, 0);
});

test("a v4 seq gap is repaired without changing the header generation", async () => {
  const header = { version: 4, id: "session-v4-gap", createdAt: 1, delegationDepth: 0, isSeeded: false };
  const events = [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    { type: "turn/end", seq: 1, time: 2, data: { turn: 1, reason: { kind: "completed" } } },
    { type: "turn/start", seq: 3, time: 4, data: { turn: 2 } },
  ];
  const buf = await encodeSession({ header, events, packChunks: false });
  const decoded = decodeSessionBuffer(buf);
  const plan = planRepair(decoded);
  if (SESSION_FORMAT_VERSION < 4) {
    assert.equal(decoded.headerClass.code, "foreign-version");
    assert.equal(plan.refuse, "foreign format version — upgrade the harness");
    return;
  }
  assert.ok(plan.actions.some((a) => a.code === "seq-gap-tail"));
  assert.equal(plan.header.version, 4);
  assert.equal(plan.refuse, undefined);
  const after = decodeSessionBuffer(await encodeSession({ header: plan.header, events: plan.events, packChunks: false }));
  assert.equal(after.header.version, 4);
  assert.equal(after.header.isSeeded, false);
  assert.equal(after.health, "ok");
  assert.deepEqual(after.events.map((e) => e.seq), [0, 1]);
});
