import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeSession,
  atomicWrite,
  backupThenWrite,
  fsyncBestEffort,
} from "../src/encode.mjs";

const header = {
  version: 0,
  id: "session-encode",
  createdAt: 1,
  delegationDepth: 0,
};

const events = [
  { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
  { type: "turn/end", seq: 1, time: 2, data: { turn: 1, reason: { kind: "completed" } } },
];

test("fsyncBestEffort swallows EPERM / ENOTSUP / EINVAL", async () => {
  for (const code of ["EPERM", "ENOTSUP", "EINVAL"]) {
    const error = Object.assign(new Error(code), { code });
    await fsyncBestEffort({
      sync: async () => {
        throw error;
      },
    });
  }
});

test("fsyncBestEffort rethrows other I/O errors", async () => {
  const error = Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
  await assert.rejects(
    () =>
      fsyncBestEffort({
        sync: async () => {
          throw error;
        },
      }),
    /EIO/,
  );
});

test("backupThenWrite still replaces dest after a successful copy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surgeon-encode-"));
  const file = join(dir, "session.jsonl.zstd");
  const first = await encodeSession({ header, events, packChunks: false });
  const second = await encodeSession({
    header: { ...header, id: "session-encode-2" },
    events,
    packChunks: false,
  });
  await atomicWrite(file, first);
  await backupThenWrite(file, second, new Date("2026-08-28T07:00:00.000Z"));
  const after = await readFile(file);
  assert.notEqual(Buffer.compare(after, first), 0);
  assert.equal(Buffer.compare(after, second), 0);
});
