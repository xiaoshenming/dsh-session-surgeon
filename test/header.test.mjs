import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_FORMAT_VERSION,
  classifyHeader,
  fromHeaderLine,
  isHeaderLine,
  parseHeaderRecord,
  toHeaderLine,
} from "../src/header.mjs";

const good = {
  type: "session",
  version: 0,
  id: "session-test",
  createdAt: 1,
  delegationDepth: 0,
};

test("accepts a legal v0 header", () => {
  assert.equal(isHeaderLine(good), true);
  assert.deepEqual(classifyHeader(good), { ok: true, code: "header-ok", header: fromHeaderLine(good) });
  const rec = parseHeaderRecord(Buffer.from(JSON.stringify(good) + "\n"));
  assert.equal(rec.id, "session-test");
  assert.equal(toHeaderLine(rec).type, "session");
  assert.equal(SESSION_FORMAT_VERSION, 0);
});

test("rejects missing delegationDepth", () => {
  const { delegationDepth, ...bad } = good;
  assert.equal(isHeaderLine(bad), false);
  assert.equal(classifyHeader(bad).code, "header-parse-error");
});

test("version 1 is foreign, not corrupt", () => {
  const foreign = { ...good, version: 1 };
  const classified = classifyHeader(foreign);
  assert.equal(classified.ok, false);
  assert.equal(classified.code, "foreign-version");
  assert.match(classified.error, /upgrade the harness/i);
});

test("retired policy fields are refused", () => {
  const retired = { ...good, sandboxMode: "danger-full-access" };
  // isHeaderLine does not look at retired fields; classifyHeader does.
  assert.equal(classifyHeader(retired).code, "retired-fields");
});

test("rejects createdAt -0", () => {
  assert.equal(isHeaderLine({ ...good, createdAt: -0 }), false);
});

test("parseHeaderRecord requires exactly one newline-terminated record", () => {
  const line = JSON.stringify(good);
  assert.throws(() => parseHeaderRecord(line), /empty or header-less/);
  assert.throws(() => parseHeaderRecord(line + "\nextra\n"), /empty or header-less/);
  assert.throws(() => parseHeaderRecord("{\n"), /not valid JSON/);
  const rec = parseHeaderRecord(Buffer.from(line + "\n"));
  assert.equal(rec.id, "session-test");
});

test("classifyHeader uses the official not-header message", () => {
  const classified = classifyHeader({ type: "nope" });
  assert.equal(classified.code, "not-header");
  assert.match(classified.error, /corrupt session log: first line is not a session header/);
});
