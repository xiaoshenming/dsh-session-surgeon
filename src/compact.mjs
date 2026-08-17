import { readFile } from "node:fs/promises";
import { decodeSessionBuffer, eventsSeqOk } from "./decode.mjs";
import { backupThenWrite, encodeSession } from "./encode.mjs";

function completeTurnStarts(events) {
  const starts = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === "turn/start") starts.push({ index: i, turn: events[i].data?.turn });
  }
  const complete = [];
  for (const start of starts) {
    const end = events.findIndex(
      (event, i) => i > start.index && event.type === "turn/end" && event.data?.turn === start.turn,
    );
    if (end >= 0) complete.push({ ...start, end });
  }
  return complete;
}

function renumber(events) {
  return events.map((event, i) => ({ ...event, seq: i }));
}

export function planCompact(decoded, { keepLastTurns } = {}) {
  if (!Number.isSafeInteger(keepLastTurns) || keepLastTurns < 1) {
    throw new RangeError("keepLastTurns must be an integer >= 1");
  }
  if (!decoded.header) {
    return { events: [], header: null, mustWrite: false, refuse: "header cannot be decoded", droppedTurns: 0 };
  }
  if ((decoded.failedFrames ?? 0) > 0) {
    return { events: decoded.events.slice(), header: decoded.header, mustWrite: false, refuse: "middle frame failed decompression", droppedTurns: 0 };
  }
  const headerCode = decoded.headerClass?.code ?? "header-ok";
  if (headerCode !== "header-ok") {
    return { events: decoded.events.slice(), header: decoded.header, mustWrite: false, refuse: `cannot compact: ${headerCode}`, droppedTurns: 0 };
  }
  const complete = completeTurnStarts(decoded.events);
  if (complete.length <= keepLastTurns) {
    return {
      events: decoded.events.slice(),
      header: { ...decoded.header, seedLength: decoded.header.seedLength ?? 0 },
      mustWrite: false,
      refuse: undefined,
      droppedTurns: 0,
      keptTurns: complete.length,
    };
  }
  const keep = complete.slice(-keepLastTurns);
  const from = keep[0].index;
  const lastEnd = keep[keep.length - 1].end;
  const slice = decoded.events.slice(from, lastEnd + 1);
  const events = renumber(slice);
  return {
    events,
    header: { ...decoded.header, seedLength: 0 },
    mustWrite: true,
    refuse: undefined,
    droppedTurns: complete.length - keep.length,
    keptTurns: keep.length,
  };
}

export async function applyCompact({ file, decoded, keepLastTurns, dryRun = true } = {}) {
  const src = decoded ?? decodeSessionBuffer(await readFile(file));
  const plan = planCompact(src, { keepLastTurns });
  if (plan.refuse) return { dryRun, wrote: false, plan };
  if (dryRun || !plan.mustWrite) return { dryRun: true, wrote: false, plan };
  if (!eventsSeqOk(plan.events)) throw new Error("compact produced non-continuous seq");
  const buf = await encodeSession({ header: plan.header, events: plan.events });
  await backupThenWrite(file, buf);
  const after = decodeSessionBuffer(await readFile(file));
  if (!eventsSeqOk(after.events)) {
    throw new Error("post-compact seq is not continuous; original preserved in .bak.*");
  }
  return { dryRun: false, wrote: true, backup: true, plan, afterHealth: after.health };
}
