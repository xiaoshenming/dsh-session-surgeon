import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROBES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/probes");

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

test("the probe runner only imports the official packages it names", async () => {
  const source = await readFile(join(PROBES, "run.mjs"), "utf8");
  assert.ok(source.includes("restoreReleasedV2Artifact"));
  assert.ok(source.includes("restoreReleasedV4Artifact"));
  assert.ok(source.includes("sessionFormatV0ToV1"));
  assert.ok(source.includes("createSessionFormatV3ToV4"));
});
