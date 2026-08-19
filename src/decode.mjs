import { decodeFrames, scanZstdFrames } from "./zstd-frames.mjs";
import { classifyHeader } from "./header.mjs";
import { countLoneSurrogates } from "./redact.mjs";
import { SessionLogScanner, isExactHeaderRecord } from "./scanner.mjs";

const HEALTH_RANK = [
  "header-frame-corrupt",
  "header-parse-error",
  "foreign-version",
  "retired-fields",
  "failed-middle-frame",
  "seq-gap-committed",
  "unparsable-line",
  "seq-gap-tail",
  "message-missing-id",
  "lone-surrogate",
  "torn-tail",
  "unknown-type",
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
    issues,
    logicalLines: 0,
    packedRows: 0,
    failedFrames,
    unknownTypes,
    lastSeq: -1,
    health,
  };
}

/** Official replay boundary: user/message, assistant/message and tool/result
 *  must carry a non-empty message id, or the loader refuses the whole log. */
export function missingMessageIds(events) {
  const seqs = [];
  for (const event of events) {
    const type = event.type;
    if (type !== "user/message" && type !== "assistant/message" && type !== "tool/result") continue;
    const data = event.data;
    const record = data && typeof data === "object" ? data : undefined;
    const message = type === "user/message" ? record : record?.message;
    if (!message || typeof message !== "object" || typeof message.id !== "string" || message.id === "") {
      seqs.push(event.seq);
    }
  }
  return seqs;
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
  if (finished.unknownTypes.length > 0) {
    health = worse(health, "unknown-type");
    if (!issues.some((i) => i.code === "unknown-type")) {
      issues.push({ code: "unknown-type", message: "unknown types: " + finished.unknownTypes.join(", ") });
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
    issues,
    logicalLines: finished.logicalLines,
    packedRows: finished.packedRows,
    failedFrames,
    unknownTypes: finished.unknownTypes,
    lastSeq: finished.events.length === 0 ? -1 : finished.events[finished.events.length - 1].seq,
    health,
  };
}

export function eventsSeqOk(events) {
  return events.every((event, i) => event.seq === i);
}
