import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ZSTD_MAGIC,
  compressFrame,
  decodeCompleteFrame,
  decodeFrames,
  scanZstdFrames,
} from "../src/zstd-frames.mjs";

test("round-trip one checksummed frame", async () => {
  const payload = "hello surgeon\n";
  const frame = await compressFrame(payload);
  assert.equal(frame.readUInt32LE(0), ZSTD_MAGIC);
  const scanned = scanZstdFrames(frame);
  assert.equal(scanned.frames.length, 1);
  assert.equal(scanned.tornStart, undefined);
  assert.equal(decodeCompleteFrame(frame).toString("utf8"), payload);
  const decoded = decodeFrames(frame);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].ok, true);
  assert.equal(decoded[0].text, payload);
});

test("truncated last 8 bytes reports tornStart", async () => {
  const frame = await compressFrame("abc\n");
  const torn = frame.subarray(0, frame.length - 8);
  const scanned = scanZstdFrames(torn);
  assert.ok(scanned.tornStart !== undefined);
  assert.equal(scanned.frames.length, 0);
});

test("scanZstdFrames matches official ranges when the module is present", async (t) => {
  const officialPath =
    "/home/ming/.nvm/versions/node/v22.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js";
  let official;
  try {
    official = await import(officialPath);
  } catch {
    t.skip("official persistence-jsonl not resolvable as a module");
    return;
  }
  if (typeof official.scanZstdFrames !== "function") {
    t.skip("official scanZstdFrames is not exported");
    return;
  }
  const a = await compressFrame("A\n");
  const b = await compressFrame("B\n");
  const buf = Buffer.concat([a, b, Buffer.from([0x28, 0xb5])]);
  assert.deepEqual(scanZstdFrames(buf), official.scanZstdFrames(buf));
});

test("two concatenated frames scan independently", async () => {
  const a = await compressFrame("A\n");
  const b = await compressFrame("B\n");
  const scanned = scanZstdFrames(Buffer.concat([a, b]));
  assert.equal(scanned.frames.length, 2);
});
