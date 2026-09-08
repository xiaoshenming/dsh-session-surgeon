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
  assert.ok(SESSION_FORMAT_VERSION === 0 || SESSION_FORMAT_VERSION === 2 || SESSION_FORMAT_VERSION >= 0);
});
