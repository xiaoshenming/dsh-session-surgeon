import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { toLosslessJson } from "../plugin/index.mjs";
import { inspectEntry } from "../src/inspect.mjs";
import { KNOWN_SESSION_EVENT_TYPES, KNOWN_SESSION_EVENT_TYPES_SOURCE } from "../src/known-types.mjs";
import { resolveInstalledPackage, SESSION_MODULE_PATH } from "../src/runtime.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

/** The harness's own JSON predicate, when the installed tree exposes it. */
async function harnessJson() {
  const pnpm = join(ROOT, "node_modules", ".pnpm");
  let dirs = [];
  try {
    dirs = readdirSync(pnpm).filter((name) => name.startsWith("@deepseek-ai+dsh-util-values@"));
  } catch {
    return null;
  }
  const dir = dirs.sort().at(-1);
  if (dir === undefined) return null;
  return import(pathToFileURL(join(pnpm, dir, "node_modules", "@deepseek-ai", "dsh-util-values", "lib", "index.js")).href);
}

test("the boundary drops what JSON cannot carry and keeps what it can", () => {
  const hole = [1, , 3];
  assert.deepEqual(toLosslessJson(hole), [1, null, 3]);
  assert.equal(1 in toLosslessJson(hole), true, "a hole becomes a real null member");
  assert.equal(toLosslessJson(-0), 0);
  assert.equal(toLosslessJson(Infinity), null);
  assert.equal(toLosslessJson(NaN), null);
  assert.deepEqual(toLosslessJson({ keep: 1, drop: undefined }), { keep: 1 });
  assert.equal("drop" in toLosslessJson({ keep: 1, drop: undefined }), false);
  assert.deepEqual(toLosslessJson([undefined, 1]), [null, 1]);
  const cycle = { name: "x" };
  cycle.self = cycle;
  assert.deepEqual(toLosslessJson(cycle), { name: "x" }, "a cycle is dropped, not followed");
});

test("a report carrying the pre-fix undefined member passes the harness predicate", async (t) => {
  const util = await harnessJson();
  if (!util) {
    t.skip("official dsh-util-values not resolvable");
    return;
  }
  // The shape every healthy session used to carry: `error` present as undefined.
  const report = { root: "/tmp", count: 1, sessions: [{ sessionDir: "s", health: "ok", error: undefined }] };
  assert.equal(util.snapshotJsonValue(report), undefined, "the harness refuses the raw shape");
  assert.notEqual(util.snapshotJsonValue(toLosslessJson(report)), undefined);
  for (const value of [[1, , 3], { list: [1, , 3] }, -0, Infinity, NaN]) {
    assert.notEqual(util.snapshotJsonValue(toLosslessJson(value)), undefined, JSON.stringify(value));
  }
});

test("inspectEntry survives an entry it cannot decode", async () => {
  const root = await mkdtemp(join(tmpdir(), "surgeon-lossless-"));
  try {
    const dir = join(root, "--tmp--", "session-raw");
    await mkdir(dir, { recursive: true });
    const file = join(dir, "session.jsonl");
    await writeFile(file, '{"type":"turn/start","seq":0}\n');
    const report = await inspectEntry({ project: "--tmp--", sessionDir: "session-raw", dir, file, kind: "jsonl", generation: 0, tmpFiles: [] });
    assert.equal(report.health, "raw-jsonl");
    assert.equal("events" in report, false, "an absent member is omitted, never undefined");
    assert.deepEqual(report.turnStepImbalances ?? [], [], "callers iterate this as an array");
    assert.equal(JSON.stringify(report).includes("undefined"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the event catalog comes from the same install the runtime resolved", async (t) => {
  if (SESSION_MODULE_PATH === null) {
    t.skip("no installed runtime to compare against");
    return;
  }
  const sessionRoot = resolveInstalledPackage("@deepseek-ai/dsh-session");
  assert.equal(sessionRoot, SESSION_MODULE_PATH, "one resolver, not two");
  assert.notEqual(KNOWN_SESSION_EVENT_TYPES_SOURCE, "fallback", "resolving the runtime must also load its catalog");
  assert.ok(KNOWN_SESSION_EVENT_TYPES.size > 48, "the installed catalog is larger than the fallback vocabulary");
});
