import { readFile } from "node:fs/promises";
import { decodeSessionBuffer } from "./decode.mjs";
import { interruptedTurnClosers } from "./closers.mjs";
import { listSessionFiles, scanHeader } from "./scan.mjs";

function lastGoal(events) {
  let goal = null;
  for (const event of events) {
    if (event.type !== "goal/change") continue;
    const g = event.data?.goal;
    if (g && typeof g.id === "string") {
      goal = { id: g.id, phase: g.phase ?? null, objective: g.objective };
    }
  }
  return goal;
}

function turnStats(events) {
  let count = 0;
  let lastReason = null;
  let open = false;
  for (const event of events) {
    if (event.type === "turn/start") {
      open = true;
    } else if (event.type === "turn/end") {
      open = false;
      count += 1;
      lastReason = event.data?.reason ?? null;
    }
  }
  return { count, lastReason, open };
}

function typeHistogram(events) {
  const types = {};
  for (const event of events) {
    const type = event.type ?? "?";
    types[type] = (types[type] ?? 0) + 1;
  }
  return types;
}

/** Full inspect of one listed session entry. Never includes user message bodies. */
export async function inspectEntry(entry) {
  if (entry.kind !== "zstd" || !entry.file) {
    return {
      ...entry,
      health: entry.kind === "jsonl" ? "raw-jsonl" : "orphan-tmp",
      issues: [{ code: "unsupported", message: "inspect supports session.jsonl.zstd only" }],
      events: undefined,
    };
  }
  const buf = await readFile(entry.file);
  const decoded = decodeSessionBuffer(buf);
  const turns = turnStats(decoded.events);
  const closers = interruptedTurnClosers(decoded.events);
  const flags = [...(entry.tmpFiles?.length ? ["orphan-tmp"] : [])];
  if (decoded.tornStart !== undefined) flags.push("torn-tail");
  if (closers.length) flags.push("open-tail");
  if (decoded.packedRows) flags.push("packed-expanded");
  return {
    project: entry.project,
    sessionDir: entry.sessionDir,
    dir: entry.dir,
    file: entry.file,
    kind: entry.kind,
    bytes: buf.length,
    header: decoded.header,
    health: decoded.health,
    issues: decoded.issues,
    frames: decoded.frames.length,
    failedFrames: decoded.failedFrames,
    torn: decoded.tornStart !== undefined,
    tornStart: decoded.tornStart,
    logicalLines: decoded.logicalLines,
    logicalEvents: decoded.events.length,
    lastSeq: decoded.lastSeq,
    packedRows: decoded.packedRows,
    badLines: decoded.issues.filter((i) => i.code === "unparsable-line").length,
    types: typeHistogram(decoded.events),
    turns,
    goal: lastGoal(decoded.events),
    parent: decoded.header?.parentSession ?? null,
    depth: decoded.header?.delegationDepth ?? null,
    preset: decoded.header?.agentPreset ?? null,
    wouldClose: closers.length > 0,
    flags,
    unknownTypes: decoded.unknownTypes,
  };
}

export async function inspectById(root, id) {
  const entries = await listSessionFiles(root);
  const scanned = [];
  for (const entry of entries) scanned.push(await scanHeader(entry));
  const entry = pickSession(scanned, id);
  return inspectEntry(entry);
}

export async function indexRoot(root) {
  const entries = await listSessionFiles(root);
  const rows = [];
  for (const entry of entries) {
    const headerScan = await scanHeader(entry);
    if (entry.kind !== "zstd" || !entry.file) {
      rows.push({
        id: headerScan.header?.id ?? entry.sessionDir,
        project: entry.project,
        parent: headerScan.header?.parentSession ?? null,
        depth: headerScan.header?.delegationDepth ?? null,
        preset: headerScan.header?.agentPreset ?? null,
        turns: null,
        goal: null,
        lastTurnReason: null,
        health: headerScan.health,
        flags: headerScan.flags ?? [],
      });
      continue;
    }
    const report = await inspectEntry(entry);
    rows.push({
      id: report.header?.id ?? entry.sessionDir,
      project: entry.project,
      parent: report.parent,
      depth: report.depth,
      preset: report.preset,
      turns: report.turns?.count ?? 0,
      goal: report.goal ? { id: report.goal.id, phase: report.goal.phase } : null,
      lastTurnReason: report.turns?.lastReason ?? null,
      health: report.health,
      flags: report.flags,
    });
  }
  return { root, count: rows.length, sessions: rows };
}

/** Match sessionDir, header.id, or a unique prefix. */
export function pickSession(entries, id) {
  const exact = entries.filter(
    (e) => e.sessionDir === id || e.header?.id === id || e.header?.id === `session-${id}`,
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw Object.assign(new Error(`ambiguous session id ${id}: ${exact.map((h) => h.dir).join(", ")}`), { code: "ambiguous" });
  }
  const prefix = entries.filter(
    (e) =>
      e.sessionDir.startsWith(id) ||
      e.header?.id?.startsWith(id) ||
      e.header?.id?.startsWith(`session-${id}`),
  );
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1) {
    throw Object.assign(new Error(`ambiguous session id ${id}: ${prefix.map((h) => h.dir).join(", ")}`), { code: "ambiguous" });
  }
  throw Object.assign(new Error(`session not found: ${id}`), { code: "not-found" });
}
