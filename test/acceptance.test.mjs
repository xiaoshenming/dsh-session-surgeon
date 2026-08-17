import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanZstdFrames } from "../src/zstd-frames.mjs";
import { listSessionFiles } from "../src/find.mjs";
import { planRepair } from "../src/repair.mjs";
import { decodeSessionBuffer } from "../src/decode.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin/dsh-session-surgeon.mjs");
const FIX = join(ROOT, "fixtures/synthetic");

function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
}

test("reserved frame-header bit throws", () => {
  const buf = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x18]);
  assert.throws(() => scanZstdFrames(buf), /reserved frame-header bit/);
});

test("invalid magic in the middle of a concat throws", async () => {
  const { compressFrame } = await import("../src/zstd-frames.mjs");
  const a = await compressFrame("A\n");
  const junk = Buffer.from([0x00, 0x11, 0x22, 0x33]);
  assert.throws(() => scanZstdFrames(Buffer.concat([a, junk])), /invalid frame magic/);
});

test("orphan tmp is listed but never chosen as the canonical file", async () => {
  const root = await mkdtemp(join(tmpdir(), "surgeon-orphan-"));
  const dir = join(root, "--tmp--", "session-synthetic-orphan-tmp");
  await mkdir(dir, { recursive: true });
  await cp(join(FIX, "orphan-tmp/session.jsonl.zstd"), join(dir, "session.jsonl.zstd"));
  await cp(join(FIX, "orphan-tmp/session.jsonl.zstd.tmp"), join(dir, "session.jsonl.zstd.tmp"));
  const entries = await listSessionFiles(root);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].file.endsWith("session.jsonl.zstd"));
  assert.ok(!entries[0].file.endsWith(".tmp"));
  assert.ok(entries[0].tmpFiles.includes("session.jsonl.zstd.tmp"));
});

test("CLI index and export --format paths work on fixtures", async () => {
  const root = await mkdtemp(join(tmpdir(), "surgeon-cli2-"));
  const dir = join(root, "--tmp--", "session-synthetic-healthy-packed");
  await mkdir(dir, { recursive: true });
  await cp(join(FIX, "healthy-packed.session.jsonl.zstd"), join(dir, "session.jsonl.zstd"));
  const index = run(["index", root, "--format", "text"]);
  assert.equal(index.status, 0, index.stderr);
  assert.match(index.stdout, /session-…cked|healthy|ok/);
  const exported = run(["export", "session-synthetic-healthy-packed", root]);
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(exported.stdout, /"type":"session"/);
});

test("healthy packed planRepair mustWrite is false", async () => {
  const decoded = decodeSessionBuffer(await readFile(join(FIX, "healthy-packed.session.jsonl.zstd")));
  assert.equal(planRepair(decoded).mustWrite, false);
});
