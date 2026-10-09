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

/** Members that name other events by seq, and the shape of the value each holds.
 *  Measured over a real store: `surfaceOp`/`sourceEventSeqs` sit on the event,
 *  the rest inside `data`; `throughSeq` (delivery) and `sourceEventSeq`
 *  (command/done) are singular. */
const SEQ_ARRAY_MEMBERS = ["sourceEventSeqs", "shadowedSeqs", "messageSeqs"];
const SEQ_SCALAR_MEMBERS = ["protectedHead", "headerSeq", "throughSeq", "sourceEventSeq"];
const SEQ_RANGE_MEMBERS = ["shadowedRange"];
const SEQ_OP_MEMBERS = ["surfaceOp"];

function shiftSeq(value, from, outside, path) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return value;
  if (value < from) {
    outside.push(`${path} = ${value}`);
    return value;
  }
  return value - from;
}

/**
 * Shift every seq-valued member of `node` by `from`, the number of events the
 * cut drops. The slice is a contiguous suffix, so a reference inside it maps
 * exactly; one that points at a dropped event has no answer and is collected in
 * `outside` for the caller to refuse on.
 */
function shiftReferences(node, from, outside, path = "event") {
  if (Array.isArray(node)) return node.map((item, i) => shiftReferences(item, from, outside, `${path}[${i}]`));
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    const at = `${path}.${key}`;
    if (SEQ_ARRAY_MEMBERS.includes(key) && Array.isArray(value)) {
      out[key] = value.map((item, i) => shiftSeq(item, from, outside, `${at}[${i}]`));
    } else if (SEQ_SCALAR_MEMBERS.includes(key) && typeof value === "number") {
      out[key] = shiftSeq(value, from, outside, at);
    } else if (SEQ_RANGE_MEMBERS.includes(key) && value && typeof value === "object") {
      const range = { ...value };
      if (typeof range.start === "number") range.start = shiftSeq(range.start, from, outside, `${at}.start`);
      if (typeof range.end === "number") range.end = shiftSeq(range.end, from, outside, `${at}.end`);
      out[key] = range;
    } else if (SEQ_OP_MEMBERS.includes(key) && value && typeof value === "object") {
      const op = { ...value };
      for (const bound of ["startSeq", "endSeq"]) {
        if (typeof op[bound] === "number") op[bound] = shiftSeq(op[bound], from, outside, `${at}.${bound}`);
      }
      out[key] = op;
    } else {
      out[key] = shiftReferences(value, from, outside, at);
    }
  }
  return out;
}

/**
 * Renumber seqs from 0 and renumber turns/steps from 1, which is what the
 * released fold expects: `turn/start` must carry exactly the next turn number
 * and `step/start` the next step number of its turn. Returns the events a
 * caller must refuse on, if any, rather than writing a stale pair.
 */
function renumber(events) {
  const turnMap = new Map();
  const stepMap = new Map();
  const stepsInTurn = new Map();
  let nextTurn = 0;
  for (const event of events) {
    const data = event.data;
    if (!data || typeof data !== "object") continue;
    if (event.type === "turn/start") {
      nextTurn += 1;
      if (Number.isSafeInteger(data.turn)) turnMap.set(data.turn, nextTurn);
      stepsInTurn.set(nextTurn, 0);
    } else if (event.type === "step/start" && Number.isSafeInteger(data.step)) {
      const turn = turnMap.get(data.turn);
      if (turn === undefined) continue;
      const step = (stepsInTurn.get(turn) ?? 0) + 1;
      stepsInTurn.set(turn, step);
      stepMap.set(`${data.turn}:${data.step}`, step);
    }
  }
  const stale = [];
  const renumbered = events.map((event, i) => {
    const data = event.data;
    const next = { ...event, seq: i };
    if (!data || typeof data !== "object") return next;
    const hasTurn = Number.isSafeInteger(data.turn);
    const hasStep = Number.isSafeInteger(data.step);
    const turn = hasTurn ? turnMap.get(data.turn) : undefined;
    const step = hasStep ? stepMap.get(`${data.turn}:${data.step}`) : undefined;
    if ((hasTurn && turn === undefined) || (hasStep && step === undefined)) {
      stale.push(`${event.type}@${event.seq} (turn ${data.turn}, step ${data.step})`);
      return next;
    }
    if (turn === undefined && step === undefined) return next;
    const patched = { ...data };
    if (turn !== undefined) patched.turn = turn;
    if (step !== undefined) patched.step = step;
    return { ...next, data: patched };
  });
  return { events: renumbered, stale };
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
  if (!eventsSeqOk(decoded.events ?? [])) {
    return {
      events: decoded.events.slice(),
      header: decoded.header,
      mustWrite: false,
      refuse: "cannot compact an unloadable session — repair first, with all writers stopped",
      droppedTurns: 0,
    };
  }
  const health = decoded.health;
  if (health && health !== "ok" && health !== "header-ok" && health !== "dangling-tool-call" && health !== "empty-tool-call-id" && health !== "unknown-type" && health !== "packed-overlap-suffix") {
    return {
      events: decoded.events.slice(),
      header: decoded.header,
      mustWrite: false,
      refuse: `cannot compact: ${health} — repair first, with all writers stopped`,
      droppedTurns: 0,
    };
  }
  const complete = completeTurnStarts(decoded.events);
  if (complete.length <= keepLastTurns) {
    return {
      events: decoded.events.slice(),
      header: decoded.header,
      mustWrite: false,
      refuse: undefined,
      droppedTurns: 0,
      keptTurns: complete.length,
    };
  }
  // `seedLength` is a v0/v1 header field; the current generation marks an
  // inherited prefix with `isSeeded` instead, and its header gate allows no
  // `seedLength` at all. Either way the drop has no defined meaning for an
  // inherited prefix, so refuse rather than guess a header.
  const inherited = decoded.header.isSeeded === true || (decoded.header.seedLength ?? 0) > 0;
  if (inherited) {
    return {
      events: decoded.events.slice(),
      header: decoded.header,
      mustWrite: false,
      refuse: "cannot compact a session with an inherited seed prefix (isSeeded / seedLength) — dropping it has no defined meaning; inspect and repair are unaffected",
      droppedTurns: 0,
      keptTurns: complete.length,
    };
  }
  const keep = complete.slice(-keepLastTurns);
  const from = keep[0].index;
  const lastEnd = keep[keep.length - 1].end;
  const slice = decoded.events.slice(from, lastEnd + 1);
  const outside = [];
  const shifted = slice.map((event) => shiftReferences(event, from, outside));
  if (outside.length > 0) {
    return {
      events: decoded.events.slice(),
      header: decoded.header,
      mustWrite: false,
      refuse:
        "cannot compact: the kept slice still points at dropped events (" +
        outside.slice(0, 3).join("; ") +
        ") — repair and inspect are unaffected",
      droppedTurns: 0,
      keptTurns: complete.length,
    };
  }
  const { events, stale } = renumber(shifted);
  if (stale.length > 0) {
    return {
      events: decoded.events.slice(),
      header: decoded.header,
      mustWrite: false,
      refuse:
        "cannot compact: " + stale.slice(0, 3).join("; ") + " would keep a stale turn/step pair",
      droppedTurns: 0,
      keptTurns: complete.length,
    };
  }
  return {
    events,
    header: decoded.header,
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
  if (dryRun || !plan.mustWrite) return { dryRun, wrote: false, plan };
  if (!eventsSeqOk(plan.events)) throw new Error("compact produced non-continuous seq");
  const buf = await encodeSession({ header: plan.header, events: plan.events });
  await backupThenWrite(file, buf);
  const after = decodeSessionBuffer(await readFile(file));
  if (!eventsSeqOk(after.events)) {
    throw new Error("post-compact seq is not continuous; original preserved in .bak.*");
  }
  return { dryRun: false, wrote: true, backup: true, plan, afterHealth: after.health };
}
