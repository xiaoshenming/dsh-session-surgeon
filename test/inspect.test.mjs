import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectEntry, indexRoot, pickSession } from "../src/inspect.mjs";
import { listSessionFiles } from "../src/find.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/synthetic");

async function stagedRoot() {
  const root = await mkdtemp(join(tmpdir(), "surgeon-inspect-"));
  const dir = join(root, "--tmp--", "session-synthetic-healthy-packed");
  await mkdir(dir, { recursive: true });
  await cp(join(FIX, "healthy-packed.session.jsonl.zstd"), join(dir, "session.jsonl.zstd"));
  const orphan = join(root, "--tmp--", "session-synthetic-orphan-tmp");
  await mkdir(orphan, { recursive: true });
  await cp(join(FIX, "orphan-tmp/session.jsonl.zstd"), join(orphan, "session.jsonl.zstd"));
  await cp(join(FIX, "orphan-tmp/session.jsonl.zstd.tmp"), join(orphan, "session.jsonl.zstd.tmp"));
  return root;
}

test("inspect healthy session reports ok and no user bodies", async () => {
  const root = await stagedRoot();
  const entries = await listSessionFiles(root);
  const healthy = entries.find((e) => e.sessionDir.includes("healthy"));
  const report = await inspectEntry(healthy);
  assert.equal(report.health, "ok");
  assert.ok(report.turns.count >= 1);
  assert.equal(JSON.stringify(report).includes("Say hello"), false);
});

test("index lists orphan-tmp flag", async () => {
  const root = await stagedRoot();
  const report = await indexRoot(root);
  const orphan = report.sessions.find((s) => String(s.id).includes("orphan"));
  assert.ok(orphan);
  assert.ok(orphan.flags.includes("orphan-tmp"));
});

test("pickSession unique prefix", async () => {
  const root = await stagedRoot();
  const entries = await listSessionFiles(root);
  const hit = pickSession(entries, "session-synthetic-healthy");
  assert.ok(hit.sessionDir.includes("healthy"));
});

test("pickSession accepts a bare id or a session- prefix", () => {
  const entries = [
    { sessionDir: "session-abc", header: { id: "session-abc" }, dir: "/tmp/a" },
    { sessionDir: "def", header: { id: "def" }, dir: "/tmp/b" },
  ];
  assert.equal(pickSession(entries, "abc").sessionDir, "session-abc");
  assert.equal(pickSession(entries, "session-def").sessionDir, "def");
});
