import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dshRequires } from "../src/runtime.mjs";

const PROBES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/probes");
const RUNNER = join(PROBES, "run.mjs");

test("the dangling-tool-call probe fixture keeps its documented shape", async () => {
  const fixture = JSON.parse(await readFile(join(PROBES, "dangling-tool-call.json"), "utf8"));
  const types = fixture.events.map((event) => event.type);
  assert.deepEqual(types, [
    "turn/start",
    "step/start",
    "assistant/message",
    "tool/call",
    "step/end",
    "turn/end",
  ]);
  assert.deepEqual(fixture.events.map((event) => event.seq), [0, 1, 2, 3, 4, 5]);
  assert.equal(fixture.events.some((event) => event.type === "tool/result"), false);
  const call = fixture.events.find((event) => event.type === "tool/call");
  assert.equal(call.data.callId, "c1");
});

test("the probe runner covers the five documented entry points", async () => {
  const source = await readFile(RUNNER, "utf8");
  assert.ok(source.includes("restoreReleasedV2Artifact"));
  assert.ok(source.includes("restoreReleasedV4Artifact"));
  assert.ok(source.includes("sessionFormatV0ToV1"));
  assert.ok(source.includes("createSessionFormatV3ToV4"));
  assert.ok(source.includes("readStoredLog"));
  assert.ok(source.includes('option("persistence"'));
  // One private parse per entry point: the official validators rewrite their input.
  assert.ok(source.includes("JSON.parse(JSON.stringify(fixture.events))"));
});

/** Paths to the four official packages, or null when this machine has no runtime. */
function officialProbePaths() {
  const names = {
    v0: "@deepseek-ai/dsh-session-format-v0-to-v1",
    "v1-to-v2": "@deepseek-ai/dsh-session-format-v1-to-v2",
    "v3-to-v4": "@deepseek-ai/dsh-session-format-v3-to-v4",
    persistence: "@deepseek-ai/dsh-session-persistence-jsonl",
  };
  const manifest = dshRequires()
    .map((requireFrom) => {
      try {
        return requireFrom.resolve("@deepseek-ai/dsh/package.json");
      } catch {
        return null;
      }
    })
    .find(Boolean);
  if (!manifest) return null;
  const sibling = createRequire(manifest);
  const paths = {};
  for (const [flag, name] of Object.entries(names)) {
    try {
      paths[flag] = sibling.resolve(name);
    } catch {
      return null;
    }
  }
  return paths;
}

test("the probe reproduces the five-row split on the installed runtime", (t) => {
  const paths = officialProbePaths();
  if (!paths) {
    t.skip("official session format packages not resolvable");
    return;
  }
  const args = [RUNNER];
  for (const [flag, path] of Object.entries(paths)) args.push("--" + flag, path);
  const run = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /split reproduced/);
  assert.match(run.stdout, /read a stored v4 log\s+refused -> SessionPersistenceCorruptionError/);
});
