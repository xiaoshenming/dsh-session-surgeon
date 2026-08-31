import { decodeStorageRecord } from "./packed.mjs";
import { isIgnorable, isKnownEventType } from "./known-types.mjs";

/**
 * Incremental JSONL event scanner aligned with official SessionLogScanner.
 * Empty lines are unparsable committed records. A complete frame that does
 * not end on a newline is a torn JSONL record inside a complete frame.
 *
 * After the first seq defect, later rows are kept in `overflow` (not
 * discarded) so repair can recognize a live writer that continued after
 * synthetic crash-recovery closers (#1586 / #1497).
 *
 * Packed storage rows that start before the cursor but reach it
 * contiguously keep the uncommitted suffix (#5151) only when the
 * overlapping prefix is byte-equal to already-committed events.
 */
function sameCommittedEvent(left, right) {
  if (!left || !right) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export class SessionLogScanner {
  events = [];
  overflow = [];
  issues = [];
  unknownTypes = [];
  packedRows = 0;
  packedOverlapKept = 0;
  eventLine = 0;
  inputBytes = 0;
  committedBytes = 0;
  fragments = [];
  fragmentBytes = 0;
  issue = null;
  finished = false;

  constructor(headerRecord) {
    this.inputBytes = headerRecord.length;
    this.committedBytes = headerRecord.length;
  }

  write(chunk) {
    if (this.finished) throw new Error("cannot write to a finished session log scanner");
    const chunkStart = this.inputBytes;
    this.inputBytes += chunk.length;
    let lineStart = 0;
    for (let newline = chunk.indexOf(10); newline !== -1; newline = chunk.indexOf(10, lineStart)) {
      const fragment = chunk.subarray(lineStart, newline);
      let line = fragment;
      if (this.fragments.length > 0) {
        if (fragment.length > 0) this.fragments.push(fragment);
        line = Buffer.concat(this.fragments, this.fragmentBytes + fragment.length);
        this.fragments = [];
        this.fragmentBytes = 0;
      }
      this.consumeEventLine(line, chunkStart + newline + 1);
      lineStart = newline + 1;
    }
    if (lineStart < chunk.length) {
      const fragment = Buffer.from(chunk.subarray(lineStart));
      this.fragments.push(fragment);
      this.fragmentBytes += fragment.length;
    }
  }

  consumeEventLine(line, endByte) {
    this.eventLine += 1;
    let decoded;
    let parsed;
    try {
      parsed = JSON.parse(line.toString("utf8"));
      decoded = decodeStorageRecord(parsed);
    } catch (error) {
      const next = {
        code: "unparsable-line",
        message:
          error instanceof Error && /malformed/.test(error.message)
            ? error.message
            : `unparsable committed event at line ${this.eventLine}`,
        line: this.eventLine,
      };
      this.issue ??= next;
      this.issues.push(next);
      return;
    }
    if (parsed && (parsed.type === "text-chunks" || parsed.type === "reasoning-chunks" || parsed.type === "tool-call-chunks")) {
      this.packedRows += 1;
    }
    if (this.issue !== null) {
      if (decoded.some((event) => event.type === "turn/end")) {
        if (this.issue.code === "seq-gap-tail") this.issue.code = "seq-gap-committed";
        this.issues.push({
          code: this.issue.code,
          message: `${this.issue.code} followed by turn/end at line ${this.eventLine}`,
          line: this.eventLine,
        });
      }
      for (const event of decoded) this.overflow.push(event);
      return;
    }
    const rowStart = this.events.length;
    const expected = this.events.length;
    const firstSeq = decoded[0]?.seq;
    const lastSeq = decoded.at(-1)?.seq;
    const skip = Number.isSafeInteger(firstSeq) ? expected - firstSeq : -1;
    const packedOverlap =
      decoded.length > 1 &&
      Number.isSafeInteger(firstSeq) &&
      Number.isSafeInteger(lastSeq) &&
      firstSeq < expected &&
      lastSeq >= expected &&
      skip > 0 &&
      skip < decoded.length &&
      decoded.every((event, i) => event.seq === firstSeq + i) &&
      decoded.slice(0, skip).every((event, i) => sameCommittedEvent(this.events[firstSeq + i], event));

    if (packedOverlap) {
      decoded = decoded.slice(skip);
    }

    for (const event of decoded) {
      if (event.seq !== this.events.length) {
        const expectedNow = this.events.length;
        this.events.length = rowStart;
        const committed = decoded.some((candidate) => candidate.type === "turn/end");
        this.issue = {
          code: committed ? "seq-gap-committed" : "seq-gap-tail",
          message: `seq gap in committed region at line ${this.eventLine} (expected ${expectedNow}, got ${event.seq})`,
          line: this.eventLine,
        };
        this.issues.push(this.issue);
        for (const item of decoded) this.overflow.push(item);
        if (committed) {
          this.issues.push({
            code: "seq-gap-committed",
            message: `seq-gap-committed followed by turn/end at line ${this.eventLine}`,
            line: this.eventLine,
          });
        }
        return;
      }
      this.events.push(event);
      if (!isKnownEventType(event) && !isIgnorable(event) && typeof event.type === "string") {
        if (!this.unknownTypes.includes(event.type)) this.unknownTypes.push(event.type);
      }
    }
    if (packedOverlap) {
      this.packedOverlapKept += decoded.length;
      this.issues.push({
        code: "packed-overlap-suffix",
        message: `packed row at line ${this.eventLine} overlapped already-committed seqs; kept ${decoded.length} event(s) from seq ${expected}`,
        line: this.eventLine,
      });
    }
    this.committedBytes = endByte;
  }

  checkpoint() {
    return {
      inputBytes: this.inputBytes,
      committedBytes: this.committedBytes,
      eventCount: this.events.length,
      overflowCount: this.overflow.length,
    };
  }

  finish() {
    this.finished = true;
    return {
      events: this.events,
      overflow: this.overflow,
      issues: this.issues,
      unknownTypes: this.unknownTypes,
      packedRows: this.packedRows,
      packedOverlapKept: this.packedOverlapKept,
      logicalLines: this.eventLine,
      leftover: this.fragmentBytes > 0,
    };
  }
}

/** Official header-frame contract: exactly one newline-terminated record. */
export function isExactHeaderRecord(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  const buf = Buffer.from(text, "utf8");
  return buf.at(-1) === 10 && buf.indexOf(10) === buf.length - 1;
}
