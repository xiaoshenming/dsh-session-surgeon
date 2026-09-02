import { decodeFrames, scanZstdFrames } from "./zstd-frames.mjs";
import { classifyHeader } from "./header.mjs";
import { countLoneSurrogates } from "./redact.mjs";
import { SessionLogScanner, isExactHeaderRecord } from "./scanner.mjs";
import { hasCompressedSeqRanges } from "./provenance.mjs";
import { forwardEventShims } from "./forward-events.mjs";
import { danglingToolCalls, emptyToolCallIds, missingMessageIds } from "./integrity.mjs";
export { danglingToolCalls, emptyToolCallIds, missingMessageIds } from "./integrity.mjs";

const HEALTH_RANK = [
  "header-frame-corrupt",
  "header-parse-error",
  "foreign-version",
  "retired-fields",
  "newer-format-ranges",
  "failed-middle-frame",
  "seq-gap-committed",
  "unparsable-line",
  "seq-gap-tail",
  "message-missing-id",
  "lone-surrogate",
  "torn-tail",
  "packed-overlap-suffix",
  "unknown-type",
  "empty-tool-call-id",
  "dangling-tool-call",
  "ok",
];

function rank(code) {
  const i = HEALTH_RANK.indexOf(code);
  return i === -1 ? HEALTH_RANK.length : i;
}

function worse(current, next) {
  return rank(next) < rank(current) ? next : current;
}

function emptyResult({ headerClass, frames, tornStart, issues, failedFrames, health, unknownTypes }) {
  return {
    header: headerClass.header ?? null,
    headerClass,
    frames,
    tornStart,
    events: [],
    overflow: [],
    issues,
    logicalLines: 0,
    packedRows: 0,
    packedOverlapKept: 0,
    overflowEvents: 0,
    failedFrames,
    unknownTypes,
    lastSeq: -1,
    health,
  };
}

/**
 * Decode a session.jsonl.zstd buffer into the committed event prefix.
 * Complete frames are concatenated into one SessionLogScanner (official path).
 */
export function decodeSessionBuffer(buf) {
  const unknownTypes = [];
  let health = "ok";
  let scanned;
  try {
    scanned = scanZstdFrames(buf);
  } catch (error) {
    return emptyResult({
      headerClass: { ok: false, code: "header-frame-corrupt", error: String(error) },
      frames: [],
      tornStart: undefined,
      issues: [{ code: "header-frame-corrupt", message: String(error) }],
      failedFrames: 0,
      health: "header-frame-corrupt",
      unknownTypes,
    });
  }

  const frames = decodeFrames(buf);
  const failedFrames = frames.filter((f) => !f.ok && !f.torn).length;
  const tornStart = scanned.tornStart;

  if (frames.length === 0) {
    return emptyResult({
      headerClass: { ok: false, code: "header-frame-corrupt", error: "no-zstd-frame" },
      frames,
      tornStart,
      issues: [{ code: "header-frame-corrupt", message: "no zstd frame" }],
      failedFrames,
      health: "header-frame-corrupt",
      unknownTypes,
    });
  }

  const headerFrame = frames[0];
  if (!headerFrame.ok || headerFrame.torn || !isExactHeaderRecord(headerFrame.text ?? "")) {
    const issues = [{
      code: "header-frame-corrupt",
      message: headerFrame.error ?? "corrupt Zstandard session log: first frame is not exactly one header line",
      frame: 0,
    }];
    return emptyResult({
      headerClass: { ok: false, code: "header-frame-corrupt", error: issues[0].message },
      frames,
      tornStart,
      issues,
      failedFrames,
      health: "header-frame-corrupt",
      unknownTypes,
    });
  }

  const headerClass = classifyHeader(headerFrame.text);
  if (!headerClass.ok) {
    health = headerClass.code === "foreign-version" || headerClass.code === "retired-fields"
      ? headerClass.code
      : "header-parse-error";
    return emptyResult({
      headerClass,
      frames,
      tornStart,
      issues: [{ code: health, message: headerClass.error ?? health, line: 0, frame: 0 }],
      failedFrames,
      health,
      unknownTypes,
    });
  }

  const scanner = new SessionLogScanner(Buffer.from(headerFrame.text, "utf8"));
  const issues = [];
  let tornText = null;

  for (let fi = 1; fi < frames.length; fi++) {
    const frame = frames[fi];
    if (!frame.ok && !frame.torn) {
      health = worse(health, "failed-middle-frame");
      issues.push({ code: "failed-middle-frame", message: frame.error ?? "frame failed", frame: fi });
      continue;
    }
    if (!frame.ok || frame.text == null) continue;
    if (frame.torn) {
      tornText = frame.text;
      continue;
    }
    scanner.write(Buffer.from(frame.text, "utf8"));
  }

  const complete = scanner.checkpoint();
  if (complete.committedBytes !== complete.inputBytes && scanner.issue == null) {
    const next = {
      code: "unparsable-line",
      message: "complete frame contains a torn JSONL record",
    };
    scanner.issue = next;
    scanner.issues.push(next);
  }
  if (tornText != null) scanner.write(Buffer.from(tornText, "utf8"));

  const finished = scanner.finish();
  issues.push(...finished.issues);
  unknownTypes.push(...finished.unknownTypes);

  for (const issue of finished.issues) {
    if (issue.code === "seq-gap-committed") health = worse(health, "seq-gap-committed");
    else if (issue.code === "seq-gap-tail") health = worse(health, "seq-gap-tail");
    else if (issue.code === "unparsable-line") health = worse(health, "unparsable-line");
    else if (issue.code === "packed-overlap-suffix") health = worse(health, "packed-overlap-suffix");
  }
  if (failedFrames > 0) health = worse(health, "failed-middle-frame");
  if (tornStart !== undefined) {
    health = worse(health, "torn-tail");
    if (!issues.some((i) => i.code === "torn-tail")) {
      issues.push({ code: "torn-tail", message: "incomplete final frame at byte " + tornStart });
    }
  }
  if (countLoneSurrogates({ header: headerClass.header, events: finished.events }) > 0) {
    health = worse(health, "lone-surrogate");
    if (!issues.some((i) => i.code === "lone-surrogate")) {
      issues.push({ code: "lone-surrogate", message: "isolated UTF-16 surrogate in payload" });
    }
  }
  if (hasCompressedSeqRanges(finished.events) || hasCompressedSeqRanges(finished.overflow ?? [])) {
    health = worse(health, "newer-format-ranges");
    if (!issues.some((i) => i.code === "newer-format-ranges")) {
      issues.push({
        code: "newer-format-ranges",
        message:
          "sourceEventSeqs uses compressed [start,end] ranges (still labeled v0); current harness foldSurface rejects this — repair expands ranges into dense integers, not a seq gap",
      });
    }
  }
  if (finished.unknownTypes.length > 0) {
    health = worse(health, "unknown-type");
    if (!issues.some((i) => i.code === "unknown-type")) {
      issues.push({ code: "unknown-type", message: "unknown types: " + finished.unknownTypes.join(", ") });
    }
  }
  const forwardShims = forwardEventShims(finished.events);
  if (forwardShims.length > 0) {
    issues.push({
      code: "forward-event-shim",
      message:
        "validated newer official log-only event(s) can be marked ignorable for this harness: " +
        forwardShims.map((shim) => `${shim.type}@${shim.seq}`).join(", "),
      seqs: forwardShims.map((shim) => shim.seq),
    });
  }
  const emptyIds = emptyToolCallIds(finished.events);
  if (emptyIds.length > 0) {
    health = worse(health, "empty-tool-call-id");
    if (!issues.some((i) => i.code === "empty-tool-call-id")) {
      const seqs = emptyIds.map((d) => d.seq);
      issues.push({
        code: "empty-tool-call-id",
        message:
          "empty tool-call id at seq " +
          seqs.join(", ") +
          " — next model request will 400 (id cannot be empty); inspect only, do not invent an id",
        seqs,
        where: emptyIds.map((d) => d.where),
      });
    }
  }
  const dangling = danglingToolCalls(finished.events);
  if (dangling.length > 0) {
    health = worse(health, "dangling-tool-call");
    if (!issues.some((i) => i.code === "dangling-tool-call")) {
      const seqs = dangling.map((d) => d.seq);
      issues.push({
        code: "dangling-tool-call",
        message: "tool/call without tool/result: " + seqs.join(", ") + " — next model request will 400",
        seqs,
        callIds: dangling.map((d) => d.callId),
      });
    }
  }
  const missingIds = missingMessageIds(finished.events);
  if (missingIds.length > 0) {
    health = worse(health, "message-missing-id");
    if (!issues.some((i) => i.code === "message-missing-id")) {
      issues.push({
        code: "message-missing-id",
        message: "events lack an identified message: " + missingIds.join(", "),
        seqs: missingIds,
      });
    }
  }

  return {
    header: headerClass.header,
    headerClass,
    frames,
    tornStart,
    events: finished.events,
    overflow: finished.overflow ?? [],
    issues,
    logicalLines: finished.logicalLines,
    packedRows: finished.packedRows,
    packedOverlapKept: finished.packedOverlapKept ?? 0,
    failedFrames,
    unknownTypes: finished.unknownTypes,
    lastSeq: finished.events.length === 0 ? -1 : finished.events[finished.events.length - 1].seq,
    overflowEvents: (finished.overflow ?? []).length,
    health,
  };
}

export function eventsSeqOk(events) {
  return events.every((event, i) => event.seq === i);
}
