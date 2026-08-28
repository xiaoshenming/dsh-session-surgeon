import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { decodeSessionBuffer, eventsSeqOk, missingMessageIds } from "./decode.mjs";
import { backupThenWrite, encodeSession } from "./encode.mjs";
import { interruptedTurnClosers } from "./closers.mjs";
import { replaceLoneSurrogatesIn } from "./redact.mjs";
import { stitchLiveWriterTail } from "./stitch.mjs";

const DEFAULT_STEPS = {
  tornTail: true,
  overlap: true,
  committedGap: true,
  dropDirtyTail: true,
  liveWriter: true,
  loneSurrogate: true,
  messageId: true,
  closers: true,
};

function lastTurnEndIndex(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "turn/end") return i;
  }
  return -1;
}

function firstGapIndex(events) {
  for (let i = 0; i < events.length; i++) {
    if (events[i].seq !== i) return i;
  }
  return -1;
}

/** Fill a non-empty id into user/message, assistant/message and tool/result
 *  events that the official replay boundary would refuse. Never drops events. */
function fillMissingMessageIds(events) {
  const seqs = missingMessageIds(events);
  if (seqs.length === 0) return { value: events, fixed: 0 };
  const value = events.map((event) => {
    const type = event.type;
    if (type !== "user/message" && type !== "assistant/message" && type !== "tool/result") return event;
    const data = event.data;
    const record = data && typeof data === "object" ? data : undefined;
    const message = type === "user/message" ? record : record?.message;
    if (!message || typeof message !== "object" || (typeof message.id === "string" && message.id !== "")) {
      return event;
    }
    const patched = { ...message, id: randomUUID() };
    if (type === "user/message") {
      return { ...event, data: { ...record, ...patched } };
    }
    return { ...event, data: { ...record, message: patched } };
  });
  return { value, fixed: seqs.length };
}

/**
 * Plan a repair against an already-decoded buffer.
 * Never invents missing seqs in the committed middle.
 */
export function planRepair(decoded, { steps: stepOverrides } = {}) {
  const steps = { ...DEFAULT_STEPS, ...stepOverrides };
  const actions = [];
  const header = decoded.header;
  const headerCode = decoded.headerClass?.code ?? (header ? "header-ok" : "header-frame-corrupt");

  if (!header || headerCode === "header-frame-corrupt" || headerCode === "header-parse-error") {
    return { actions, events: [], header, mustWrite: false, refuse: "header cannot be decoded" };
  }
  if (headerCode === "foreign-version") {
    return { actions, events: [], header, mustWrite: false, refuse: "foreign format version — upgrade the harness" };
  }
  if (headerCode === "retired-fields") {
    return { actions, events: [], header, mustWrite: false, refuse: "header carries retired policy fields" };
  }
  if (decoded.failedFrames > 0) {
    return { actions, events: decoded.events.slice(), header, mustWrite: false, refuse: "middle frame failed decompression" };
  }

  let events = decoded.events.map((event) => event);
  const overflow = Array.isArray(decoded.overflow) ? decoded.overflow : [];
  let stitchedLive = false;

  if (steps.liveWriter) {
    const stitched = stitchLiveWriterTail(events, overflow);
    if (stitched) {
      events = stitched.events;
      stitchedLive = true;
      actions.push({
        code: "live-writer-tail",
        detail:
          "dropped " +
          stitched.droppedClosers +
          " crash-recovery closer(s) and kept " +
          stitched.keptLive +
          " live-writer event(s) from seq " +
          stitched.stitchSeq,
      });
    }
  }

  if (!stitchedLive && decoded.health === "seq-gap-committed" && steps.committedGap) {
    const keepThrough = lastTurnEndIndex(events);
    events = keepThrough >= 0 ? events.slice(0, keepThrough + 1) : events;
    actions.push({
      code: "seq-gap-committed",
      detail: "truncated to last turn/end before the committed gap",
    });
  } else if (!stitchedLive && decoded.health === "seq-gap-tail" && steps.dropDirtyTail) {
    actions.push({
      code: "seq-gap-tail",
      detail: "rewrite committed prefix, dropping the on-disk dirty tail",
    });
  } else if (decoded.health === "unparsable-line" && steps.dropDirtyTail) {
    actions.push({
      code: "unparsable-line",
      detail: "rewrite committed prefix, dropping the on-disk dirty tail",
    });
  }

  if (steps.tornTail && decoded.tornStart !== undefined) {
    actions.push({ code: "torn-tail", detail: "dropped incomplete frame at byte " + decoded.tornStart });
  }

  if (steps.overlap) {
    let cut = -1;
    const seen = new Set();
    for (let i = 0; i < events.length; i++) {
      const seq = events[i].seq;
      if (seen.has(seq) || (i > 0 && seq <= events[i - 1].seq)) {
        cut = i;
        break;
      }
      seen.add(seq);
    }
    if (cut >= 0) {
      events = events.slice(0, cut);
      actions.push({ code: "seq-overlap-replay", detail: "dropped replay tail from index " + cut });
    }
  }

  const gapAt = firstGapIndex(events);
  if (gapAt >= 0) {
    const rest = events.slice(gapAt);
    const hasTurnEnd = rest.some((event) => event.type === "turn/end");
    if (hasTurnEnd && steps.committedGap) {
      const keepThrough = lastTurnEndIndex(events.slice(0, gapAt));
      events = keepThrough >= 0 ? events.slice(0, keepThrough + 1) : [];
      actions.push({ code: "seq-gap-committed", detail: "truncated to last turn/end before gap at " + gapAt });
    } else if (steps.dropDirtyTail) {
      events = events.slice(0, gapAt);
      actions.push({ code: "seq-gap-tail", detail: "dropped dirty tail from index " + gapAt });
    }
  }

  if (steps.loneSurrogate) {
    const swept = replaceLoneSurrogatesIn(events);
    if (swept.replaced > 0) {
      events = swept.value;
      actions.push({ code: "lone-surrogate", detail: "replaced " + swept.replaced + " lone-surrogate string(s)" });
    }
  }

  if (steps.messageId) {
    const filled = fillMissingMessageIds(events);
    if (filled.fixed > 0) {
      events = filled.value;
      actions.push({ code: "message-missing-id", detail: "filled " + filled.fixed + " missing message id(s)" });
    }
  }

  if (steps.closers) {
    const closers = interruptedTurnClosers(events);
    if (closers.length > 0) {
      events = events.concat(closers);
      actions.push({ code: "open-tail", detail: "appended " + closers.length + " synthetic closer(s)" });
    }
  }

  if (!eventsSeqOk(events)) {
    return { actions, events, header, mustWrite: false, refuse: "repair did not produce continuous seq" };
  }

  const mustWrite = actions.length > 0;
  return { actions, events, header, mustWrite, refuse: undefined };
}

export async function applyRepair({ file, decoded, dryRun = true, steps } = {}) {
  const plan = planRepair(decoded ?? decodeSessionBuffer(await readFile(file)), { steps });
  if (plan.refuse) {
    return { dryRun, wrote: false, plan, afterHealth: decoded?.health };
  }
  if (dryRun || !plan.mustWrite) {
    return { dryRun, wrote: false, plan, afterHealth: decoded?.health };
  }
  const buf = await encodeSession({ header: plan.header, events: plan.events });
  await backupThenWrite(file, buf);
  const after = decodeSessionBuffer(await readFile(file));
  if (!eventsSeqOk(after.events)) {
    throw new Error("post-repair seq is not continuous; original preserved in .bak.*");
  }
  return { dryRun: false, wrote: true, backup: true, plan, afterHealth: after.health };
}

export async function repairFile(file, { dryRun = true, steps } = {}) {
  const decoded = decodeSessionBuffer(await readFile(file));
  return applyRepair({ file, decoded, dryRun, steps });
}
