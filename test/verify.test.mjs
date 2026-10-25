import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeSession } from "../src/encode.mjs";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { loadReader, verifyRoot, formatVerifyText } from "../src/verify.mjs";

const HEADER = { type: "session", version: 4, id: "session-verify", createdAt: 1, cwd: "/tmp/verify", isSeeded: false, delegationDepth: 0 };
const ev = (type, seq, data, extra = {}) => ({ type, seq, time: seq + 1, ...extra, data });

/** One closed turn, optionally followed by a row this harness does not know. */
function events(extra = []) {
  return [
    ev("turn/start", 0, { turn: 1 }),
    ev("step/start", 1, { turn: 1, step: 1 }),
    ev("user/message", 2, { id: "u2", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "hi" }] }, { surfaceOp: "append" }),
    ev("step/end", 3, { turn: 1, step: 1 }),
    ev("turn/end", 4, { turn: 1, reason: { kind: "completed" } }),
    ...extra,
  ];
}

/** <root>/--tmp-verify--/<id>/session.v4.jsonl.zstd, the layout the lister expects. */
async function layout(rows, id = HEADER.id) {
  const root = await mkdtemp(join(tmpdir(), "surgeon-verify-"));
  const dir = join(root, "--tmp-verify--", id);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "session.v4.jsonl.zstd");
  await writeFile(file, await encodeSession({ header: { ...HEADER, id }, events: rows, packChunks: false }));
  return { root, file };
}

test("a session the reader accepts is reported as such", async (t) => {
  if ((await loadReader(tmpdir())) === null) {
    t.skip("no installed reader");
    return;
  }
  const { root } = await layout(events());
  const report = await verifyRoot(root);
  assert.equal(report.reader, "installed");
  assert.equal(report.count, 1);
  assert.equal(report.refused, 0);
  assert.equal(report.sessions[0].reader, "accept");
  assert.equal(report.sessions[0].health, "ok");
  assert.ok(typeof report.readerVersion === "string", "the verdict must name the reader that gave it");
});

test("a session the reader refuses is named, with the reader message and our own health", async (t) => {
  if ((await loadReader(tmpdir())) === null) {
    t.skip("no installed reader");
    return;
  }
  // A row from a newer harness: the installed reader refuses the whole log.
  const { root } = await layout(events([ev("job/registered", 5, { jobId: "j1" })]));
  const report = await verifyRoot(root);
  assert.equal(report.refused, 1);
  const row = report.sessions[0];
  assert.equal(row.reader, "refuse");
  assert.match(row.message, /unknown event type \"job\/registered\"|not marked ignorable/);
  assert.equal(row.health, "unknown-type");
  assert.ok(!row.message.includes("(raw log:"), "the row already names the file");
  assert.match(formatVerifyText(report), /refused by the reader: 1/);
});

test("verifying never rewrites the file it reads", async (t) => {
  if ((await loadReader(tmpdir())) === null) {
    t.skip("no installed reader");
    return;
  }
  const { root, file } = await layout(events());
  const before = await stat(file);
  const bytes = await readFile(file);
  await verifyRoot(root);
  const after = await stat(file);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(await readFile(file), bytes);
});

test("without an installed reader the report says so and still decodes", async () => {
  const { root } = await layout(events());
  // Point the override at a path that cannot be imported: same branch as a host
  // with no harness, without mutating the process environment.
  const previous = process.env.DSH_SURGEON_READER;
  process.env.DSH_SURGEON_READER = join(root, "does-not-exist.js");
  try {
    const report = await verifyRoot(root);
    assert.equal(report.reader, "unavailable");
    assert.equal(report.refused, 0);
    assert.equal(report.sessions[0].reader, "skipped");
    // The decode still runs; without a runtime the format version falls back to
    // 0, so a v4 artifact reads foreign-version rather than ok.
    assert.equal(typeof report.sessions[0].health, "string");
    assert.ok(!("message" in report.sessions[0]), "no reader verdict means no reader message");
    assert.match(formatVerifyText(report), /reader: unavailable/);
  } finally {
    if (previous === undefined) delete process.env.DSH_SURGEON_READER;
    else process.env.DSH_SURGEON_READER = previous;
  }
});