#!/usr/bin/env node
/**
 * Reproduce the "migration stage accepts / restore refuses" split for a closed
 * step whose tool/call never got a tool/result (#4549). See README.md.
 *
 * Usage:
 *   node fixtures/probes/run.mjs
 *   node fixtures/probes/run.mjs --v0 <lib/index.js> --v1-to-v2 <lib/index.js> --v3-to-v4 <lib/index.js>
 *
 * Without arguments the bare package names are imported, which works wherever
 * @deepseek-ai/dsh-session-format-* resolves.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function option(name, fallback) {
  const flag = "--" + name;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const env = process.env["DSH_" + name.toUpperCase().replace(/-/g, "_")];
  return env || fallback;
}

const modules = {
  v0: await import(option("v0", "@deepseek-ai/dsh-session-format-v0-to-v1")),
  v1to2: await import(option("v1-to-v2", "@deepseek-ai/dsh-session-format-v1-to-v2")),
  v3to4: await import(option("v3-to-v4", "@deepseek-ai/dsh-session-format-v3-to-v4")),
};

const fixture = JSON.parse(await readFile(join(here, "dangling-tool-call.json"), "utf8"));
const events = fixture.events;
const known = new Set(events.map((event) => event.type));
const context = { emitEvent() {}, emitRun() {}, emitSystem() {} };

function outcome(run) {
  try {
    run();
    return "accepted";
  } catch (error) {
    return "refused -> " + error.constructor.name + ": " + error.message;
  }
}

const results = [
  ["v0->v1 migration stage", outcome(() => {
    const stage = modules.v0.sessionFormatV0ToV1.createStage({
      sourceHeader: { version: 0, id: "session-probe", createdAt: 1, delegationDepth: 0 },
      sourceInheritedEventCount: 0,
    });
    for (const event of events) stage.transformEvent(event, context);
  })],
  ["v0/v1/v2 restore", outcome(() => {
    modules.v1to2.restoreReleasedV2Artifact({
      header: { version: 2, id: "session-probe", createdAt: 1, delegationDepth: 0, isSeeded: false },
      events,
      inheritedEventCount: 0,
    }, known, 2);
  })],
  ["v3->v4 migration stage", outcome(() => {
    const stage = modules.v3to4.createSessionFormatV3ToV4([]).createStage({
      sourceHeader: { version: 3, id: "session-probe", createdAt: 1, delegationDepth: 0, isSeeded: false },
      sourceInheritedEventCount: 0,
    });
    for (const event of events) stage.transformEvent(event, context);
  })],
  ["v4 restore (publish)", outcome(() => {
    modules.v3to4.restoreReleasedV4Artifact({
      header: { version: 4, id: "session-probe", createdAt: 1, delegationDepth: 0, isSeeded: false },
      events,
      inheritedEventCount: 0,
    }, known);
  })],
];

for (const [label, result] of results) console.log(label.padEnd(26), result);

const expected = [
  results[0][1] === "accepted",
  results[1][1].startsWith("refused") && results[1][1].includes("leaves unresolved tool call c1"),
  results[2][1] === "accepted",
  results[3][1].startsWith("refused") && results[3][1].includes("leaves unresolved tool call c1"),
];
if (!expected.every(Boolean)) {
  console.error("\nthe split was not reproduced — see fixtures/probes/README.md for what is expected");
  process.exit(1);
}
console.log("\nsplit reproduced: stages accept, restores refuse");
