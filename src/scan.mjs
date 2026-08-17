import { readFile, stat } from "node:fs/promises";
import { classifyHeader } from "./header.mjs";
import { decodeFrames } from "./zstd-frames.mjs";
import { isExactHeaderRecord } from "./scanner.mjs";
import { defaultSessionRoot, listSessionFiles } from "./find.mjs";

export { defaultSessionRoot, listSessionFiles };

function firstLine(text) {
  return String(text).split("\n").find(Boolean) ?? "";
}

/**
 * Header-only listing of one session artifact.
 * Full inspect lives in src/inspect.mjs.
 */
export async function scanHeader(entry) {
  const orphanTmp = Array.isArray(entry.tmpFiles) && entry.tmpFiles.length > 0;
  const flags = orphanTmp ? ["orphan-tmp"] : [];
  if (!entry.file || !entry.kind) {
    return {
      ...entry,
      bytes: 0,
      mtimeMs: 0,
      health: "orphan-tmp",
      orphanTmp: true,
      flags,
      note: "tmp present but no canonical session log",
    };
  }
  const st = await stat(entry.file);
  const base = { ...entry, bytes: st.size, mtimeMs: st.mtimeMs, orphanTmp, flags };

  if (entry.kind !== "zstd") {
    return { ...base, health: "raw-jsonl", note: "uncompressed log" };
  }

  const buf = await readFile(entry.file);
  let frames;
  try {
    frames = decodeFrames(buf);
  } catch (error) {
    return {
      ...base,
      frames: 0,
      health: "header-frame-corrupt",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (frames.length === 0) {
    return { ...base, frames: 0, health: "no-zstd-frame" };
  }
  const headerFrame = frames[0];
  if (!headerFrame.ok || headerFrame.torn || !isExactHeaderRecord(headerFrame.text ?? "")) {
    return {
      ...base,
      frames: frames.length,
      health: "header-frame-corrupt",
      error: headerFrame.error ?? "corrupt Zstandard session log: first frame is not exactly one header line",
    };
  }
  const classified = classifyHeader(firstLine(headerFrame.text));
  const failed = frames.filter((f) => !f.ok && !f.torn).length;
  const torn = frames.some((f) => f.torn);
  let health = classified.ok ? (failed ? "failed-middle-frame" : "header-ok") : classified.code;
  if (torn && classified.ok && health === "header-ok") flags.push("torn-tail");
  return {
    ...base,
    frames: frames.length,
    failedFrames: failed,
    health,
    header: classified.header,
    error: classified.ok ? undefined : classified.error,
    flags,
  };
}

export async function scanAll(root) {
  const entries = await listSessionFiles(root);
  const sessions = [];
  for (const entry of entries) sessions.push(await scanHeader(entry));
  return { root, count: sessions.length, sessions };
}
