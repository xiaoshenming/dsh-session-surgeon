#!/usr/bin/env node
/**
 * Reproduce the "migration stage accepts / restore refuses / reading a stored
 * current-generation log refuses" split for a closed step whose tool/call never
 * got a tool/result (#4549, #7617). See README.md.
 *
 * Usage:
 *   node fixtures/probes/run.mjs
 *   node fixtures/probes/run.mjs --v0 <lib/index.js> --v1-to-v2 <lib/index.js> \
 *     --v3-to-v4 <lib/index.js> --persistence <lib/index.js>
 *
 * Without arguments the bare package names are imported, which works wherever
 * @deepseek-ai/dsh-session-format-* and @deepseek-ai/dsh-session-persistence-jsonl
 * resolve.
 *
 * Every entry point re-parses the fixture: the official `restore.decodeRow()`
 * rewrites the row objects it is handed, so reusing one parsed batch across
 * entry points can silently flip the second verdict (see README.md).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants, zstdCompress } from "node:zlib";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const compress = promisify(zstdCompress);
const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
const ID = "session-probe";
const CWD = "/tmp/probe-cwd";

function option(name, fallback) {
  const flag = "--" + name;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const env = process.env["DSH_" + name.toUpperCase().replace(/-/g, "_")];
  return env || fallback;
}

/** Minimal header a migration stage or a restore is handed. */
const sourceHeader = (version) => ({
  version,
  id: ID,
  createdAt: 1,
  delegationDepth: 0,
  ...(version >= 2 ? { isSeeded: false } : {}),
});
/** Header of a stored log: the file itself carries the cwd. */
const storedHeader = (version) => ({
  type: "session",
  version,
  id: ID,
  createdAt: 1,
  cwd: CWD,
  isSeeded: false,
  delegationDepth: 0,
});

const modules = {
  v0: await import(option("v0", "@deepseek-ai/dsh-session-format-v0-to-v1")),
  v1to2: await import(option("v1-to-v2", "@deepseek-ai/dsh-session-format-v1-to-v2")),
  v3to4: await import(option("v3-to-v4", "@deepseek-ai/dsh-session-format-v3-to-v4")),
  persistence: await import(option("persistence", "@deepseek-ai/dsh-session-persistence-jsonl")),
};

const fixture = JSON.parse(await readFile(join(here, "dangling-tool-call.json"), "utf8"));
/** A private copy per entry point; the official validators mutate their input. */
const fresh = () => JSON.parse(JSON.stringify(fixture.events));
const context = { emitEvent() {}, emitRun() {}, emitSystem() {} };

async function outcome(run) {
  try {
    await run();
    return "accepted";
  } catch (error) {
    return "refused -> " + error.constructor.name + ": " + error.message;
  }
}

const v3to4Stage = () =>
  modules.v3to4.createSessionFormatV3ToV4([]).createStage({
    sourceHeader: sourceHeader(3),
    sourceInheritedEventCount: 0,
  });

/** The rows a stored current-generation log holds: what the v3→v4 stage emits. */
function currentRows() {
  const stage = v3to4Stage();
  const rows = [];
  for (const event of fresh()) stage.transformEvent(event, { emitEvent: (row) => rows.push(row), emitRun() {}, emitSystem() {} });
  return rows;
}

/** Read a real current-generation artifact through the official read path. */
async function readStoredCurrentLog() {
  const root = await mkdtemp(join(tmpdir(), "dsh-probe-read-"));
  try {
    const dir = join(root, "--tmp-probe-cwd--", ID);
    await mkdir(dir, { recursive: true });
    const rows = currentRows();
    const frames = [
      await compress(Buffer.from(JSON.stringify(storedHeader(4)) + "\n"), CHECKSUM),
      await compress(Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + "\n"), CHECKSUM),
    ];
    const path = join(dir, "session.v4.jsonl.zstd");
    await writeFile(path, Buffer.concat(frames));
    const ctx = {
      reflect: { provide() {} },
      on() {},
      effect() {},
      logger: { warn() {}, info() {}, debug() {}, error() {} },
    };
    const persistence = new modules.persistence.default(ctx, { root, compression: "zstd" });
    const log = await persistence.readStoredLog(path, ID);
    return "accepted (" + log.events.length + " events)";
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const results = [
  ["v0->v1 migration stage", await outcome(() => {
    const stage = modules.v0.sessionFormatV0ToV1.createStage({
      sourceHeader: sourceHeader(0),
      sourceInheritedEventCount: 0,
    });
    for (const event of fresh()) stage.transformEvent(event, context);
  })],
  ["v0/v1/v2 restore", await outcome(() => {
    const events = fresh();
    modules.v1to2.restoreReleasedV2Artifact(
      { header: sourceHeader(2), events, inheritedEventCount: 0 },
      new Set(events.map((event) => event.type)),
      2,
    );
  })],
  ["v3->v4 migration stage", await outcome(() => {
    const stage = v3to4Stage();
    for (const event of fresh()) stage.transformEvent(event, context);
  })],
  ["v4 restore (publish)", await outcome(() => {
    const events = fresh();
    modules.v3to4.restoreReleasedV4Artifact(
      { header: sourceHeader(4), events, inheritedEventCount: 0 },
      new Set(events.map((event) => event.type)),
    );
  })],
  ["read a stored v4 log", await outcome(readStoredCurrentLog)],
];

for (const [label, result] of results) console.log(label.padEnd(26), result);

const refused = (result) =>
  result.startsWith("refused") && result.includes("leaves unresolved tool call c1");
const expected = [
  results[0][1] === "accepted",
  refused(results[1][1]),
  results[2][1] === "accepted",
  refused(results[3][1]),
  refused(results[4][1]),
];
if (!expected.every(Boolean)) {
  console.error("\nthe split was not reproduced — see fixtures/probes/README.md for what is expected");
  process.exit(1);
}
console.log("\nsplit reproduced: both stages accept, restore and the stored-log read refuse");
