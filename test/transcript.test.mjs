import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { buildTranscript } from "../src/transcript.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/synthetic");

test("buildTranscript keeps user/assistant text and skips chunks", async () => {
  const decoded = decodeSessionBuffer(await readFile(join(FIX, "healthy-packed.session.jsonl.zstd")));
  const out = buildTranscript(decoded.events);
  assert.equal(out.count, 2);
  assert.deepEqual(out.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(out.messages[0].text, "Say hello.");
  assert.equal(out.messages[1].text, "Hello world.");
  assert.equal(JSON.stringify(out).includes("assistant/chunk"), false);
});

test("buildTranscript redacts secrets in message text", () => {
  const out = buildTranscript([
    { type: "user/message", seq: 1, data: { content: [{ type: "text", text: "key sk-abcdefghijklmnop" }] } },
    { type: "assistant/message", seq: 2, data: { message: { content: [{ type: "text", text: "ok" }] } } },
    { type: "session/title", seq: 3, data: { title: "hello" } },
  ]);
  assert.equal(out.title, "hello");
  assert.match(out.messages[0].text, /sk-REDACTED/);
  assert.equal(out.messages[0].text.includes("abcdefghijklmnop"), false);
});

test("buildTranscript keeps human users and drops plugin injections", () => {
  const out = buildTranscript([
    { type: "user/message", seq: 1, data: { source: { kind: "user" }, content: [{ type: "text", text: "hello there" }] } },
    { type: "user/message", seq: 2, data: { source: { kind: "plugin" }, content: [{ type: "text", text: "Current runtime context" }] } },
    { type: "assistant/message", seq: 3, data: { message: { content: [{ type: "text", text: "hi" }, { type: "tool-call", name: "bash" }] } } },
    { type: "assistant/message", seq: 4, data: { message: { content: [{ type: "tool-call", name: "bash" }] } } },
  ]);
  assert.deepEqual(out.messages.map((m) => m.text), ["hello there", "hi"]);
});
