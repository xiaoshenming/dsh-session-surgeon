import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin/dsh-session-surgeon.mjs");
const FIX = join(ROOT, "fixtures/synthetic");

function run(args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "surgeon-cli-"));
  for (const [id, src] of [
    ["session-synthetic-healthy-packed", "healthy-packed.session.jsonl.zstd"],
    ["session-synthetic-torn-tail", "torn-tail.session.jsonl.zstd"],
  ]) {
    const dir = join(root, "--tmp--", id);
    await mkdir(dir, { recursive: true });
    await cp(join(FIX, src), join(dir, "session.jsonl.zstd"));
  }
  return root;
}

test("help exits 0", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /dsh-session-surgeon/);
});

test("inspect without id exits 2", () => {
  const r = run(["inspect"]);
  assert.equal(r.status, 2);
});

test("scan + inspect fixture root", async () => {
  const root = await fixtureRoot();
  const scan = run(["scan", root]);
  assert.equal(scan.status, 0, scan.stderr);
  const body = JSON.parse(scan.stdout);
  assert.ok(body.count >= 2);
  const inspect = run(["inspect", "session-synthetic-healthy-packed", root]);
  assert.equal(inspect.status, 0, inspect.stderr);
  const report = JSON.parse(inspect.stdout);
  assert.equal(report.health, "ok");
});

test("unknown id exits 1", async () => {
  const root = await fixtureRoot();
  const r = run(["inspect", "does-not-exist", root]);
  assert.equal(r.status, 1);
});

test("compact with bad N exits 2", async () => {
  const root = await fixtureRoot();
  const r = run(["compact", "session-synthetic-healthy-packed", root, "--keep-last-turns", "0"]);
  assert.equal(r.status, 2);
});

test("compact previews and applies a fixture", async () => {
  const root = await fixtureRoot();
  const id = "session-synthetic-healthy-packed";
  const file = join(root, "--tmp--", id, "session.jsonl.zstd");
  const before = await readFile(file);

  const preview = run(["compact", id, root, "--keep-last-turns", "1", "--format", "text"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /dry-run \(no write\)/);
  assert.ok(!preview.stdout.includes("undefined"), preview.stdout);
  assert.deepEqual(await readFile(file), before, "preview must not write");

  const applied = run(["compact", id, root, "--keep-last-turns", "1", "--apply", "--format", "text"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /applied|no write/);
  const after = await readFile(file);
  if (Buffer.compare(before, after) !== 0) {
    assert.match(applied.stdout, /applied/);
  }
});

test("repair without --apply does not change bytes", async () => {
  const root = await fixtureRoot();
  const file = join(root, "--tmp--", "session-synthetic-torn-tail", "session.jsonl.zstd");
  const before = await readFile(file);
  const r = run(["repair", "session-synthetic-torn-tail", root]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await readFile(file), before);
});
