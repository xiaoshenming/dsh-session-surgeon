import { copyFile, open, rename } from "node:fs/promises";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { compressFrame } from "./zstd-frames.mjs";
import { toHeaderLine } from "./header.mjs";
import { packChunkRuns } from "./packed.mjs";

/** ISO-8601 UTC with `:` / `.` folded to `-`, e.g. 2026-08-17T06-15-00-000Z. */
export function bakUtcStamp(date = new Date()) {
  return date.toISOString().replaceAll(/[:.]/g, "-");
}

function asBuffer(bytes) {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

function jsonlBatch(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

async function frameOf(text) {
  return asBuffer(await compressFrame(text));
}

/**
 * Encode a session as concatenated checksummed zstd frames.
 * Frame 0 is the header line only. Later frames are packed storage
 * records batched by `eventsPerFrame` (not the official 200ms window).
 */
export async function encodeSession({
  header,
  events,
  packChunks = true,
  eventsPerFrame = 32,
} = {}) {
  if (!Array.isArray(events)) {
    throw new TypeError("events must be an array");
  }
  if (!Number.isSafeInteger(eventsPerFrame) || eventsPerFrame < 1) {
    throw new RangeError("eventsPerFrame must be a positive safe integer");
  }

  const frames = [await frameOf(`${JSON.stringify(toHeaderLine(header))}\n`)];
  const records = packChunks ? packChunkRuns(events) : events;
  for (let i = 0; i < records.length; i += eventsPerFrame) {
    frames.push(await frameOf(jsonlBatch(records.slice(i, i + eventsPerFrame))));
  }
  return Buffer.concat(frames);
}

/**
 * fsync a handle. Windows (and some network FS) reject fsync on a
 * read-only handle with EPERM — that used to abort `--apply` after
 * the `.bak.<utc>` copy already succeeded (#4178 / #1452).
 */
export async function fsyncBestEffort(handle) {
  try {
    await handle.sync();
  } catch (error) {
    const code = error?.code;
    if (code === "EPERM" || code === "ENOTSUP" || code === "EINVAL") {
      return;
    }
    throw error;
  }
}

/** Write `dest.tmp`, fsync, then rename over `dest`. */
export async function atomicWrite(dest, buf) {
  const tmp = `${dest}.tmp`;
  const handle = await open(
    tmp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC,
    0o600,
  );
  try {
    await handle.writeFile(buf);
    await fsyncBestEffort(handle);
  } finally {
    await handle.close();
  }
  await rename(tmp, dest);
}

/** Copy `dest` to `dest.bak.<utc>`, then atomically replace `dest`. */
export async function backupThenWrite(dest, buf, now = new Date()) {
  const stamp = bakUtcStamp(now);
  let bak = `${dest}.bak.${stamp}`;
  try {
    const handle = await open(bak, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await handle.close();
  } catch {
    bak = `${dest}.bak.${stamp}.${randomBytes(3).toString("hex")}`;
  }
  await copyFile(dest, bak);
  // Prefer a writable handle: Windows FileHandle.sync() on O_RDONLY is EPERM.
  try {
    const copied = await open(bak, constants.O_RDWR);
    try {
      await fsyncBestEffort(copied);
    } finally {
      await copied.close();
    }
  } catch (error) {
    const code = error?.code;
    if (code !== "EPERM" && code !== "EACCES") {
      throw error;
    }
  }
  await atomicWrite(dest, buf);
}
