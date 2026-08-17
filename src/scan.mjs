import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { decodeFrames, parseHeaderLine } from "./zstd-frames.mjs";

export function defaultSessionRoot() {
  return process.env.DSH_SESSION_ROOT ?? join(homedir(), ".dsh", "sessions");
}

export async function listSessionFiles(root) {
  const out = [];
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch (error) {
    throw new Error(`cannot read session root ${root}: ${error instanceof Error ? error.message : error}`);
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectDir = join(root, project.name);
    const sessions = await readdir(projectDir, { withFileTypes: true });
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const dir = join(projectDir, session.name);
      const zstd = join(dir, "session.jsonl.zstd");
      const raw = join(dir, "session.jsonl");
      let kind = null;
      let file = null;
      try {
        await stat(zstd);
        kind = "zstd";
        file = zstd;
      } catch {
        try {
          await stat(raw);
          kind = "jsonl";
          file = raw;
        } catch {
          continue;
        }
      }
      out.push({
        project: project.name,
        sessionDir: session.name,
        dir,
        file,
        kind,
      });
    }
  }
  return out;
}

export async function scanHeader(entry) {
  const st = await stat(entry.file);
  const base = {
    ...entry,
    bytes: st.size,
    mtimeMs: st.mtimeMs,
  };
  if (entry.kind !== "zstd") {
    return { ...base, health: "raw-jsonl", note: "uncompressed log; full inspect not in week 0 header scan" };
  }
  const buf = await readFile(entry.file);
  const frames = decodeFrames(buf);
  if (frames.length === 0) {
    return { ...base, frames: 0, health: "no-zstd-frame" };
  }
  const headerFrame = frames[0];
  if (!headerFrame.ok) {
    return { ...base, frames: frames.length, health: "header-frame-corrupt", error: headerFrame.error };
  }
  const firstLine = headerFrame.text.split("\n").find(Boolean);
  try {
    const header = parseHeaderLine(firstLine);
    const failed = frames.filter((f) => !f.ok).length;
    return {
      ...base,
      frames: frames.length,
      failedFrames: failed,
      health: failed ? "has-failed-frames" : "header-ok",
      header,
    };
  } catch (error) {
    return {
      ...base,
      frames: frames.length,
      health: "header-parse-error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function inspectSession(entry) {
  if (entry.kind !== "zstd") {
    throw new Error("week 0 inspect only supports session.jsonl.zstd");
  }
  const buf = await readFile(entry.file);
  const decoded = decodeFrames(buf);
  const types = {};
  let packed = 0;
  let bad = 0;
  let lastSeq = -1;
  let logicalEvents = 0;
  let header = null;
  const lines = [];
  for (const frame of decoded) {
    if (!frame.ok) continue;
    for (const line of frame.text.split("\n")) if (line) lines.push(line);
  }
  if (lines[0]) {
    try {
      header = parseHeaderLine(lines[0]);
    } catch {
      header = { raw: lines[0].slice(0, 200) };
    }
  }
  for (const line of lines.slice(1)) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      bad += 1;
      continue;
    }
    const type = obj.type ?? "?";
    types[type] = (types[type] ?? 0) + 1;
    if (obj.seq0 != null) packed += 1;
    if (typeof obj.seq === "number") {
      lastSeq = obj.seq;
      logicalEvents += 1;
    } else if (typeof obj.seq0 === "number" && Array.isArray(obj.dt)) {
      lastSeq = obj.seq0 + obj.dt.length;
      logicalEvents += 1 + obj.dt.length;
    }
  }
  return {
    ...entry,
    bytes: buf.length,
    frames: decoded.length,
    failedFrames: decoded.filter((f) => !f.ok).length,
    logicalLines: lines.length,
    logicalEvents,
    lastSeq,
    packedRows: packed,
    badLines: bad,
    header,
    types,
  };
}
