import { decodeStorageRecord } from "./packed.mjs";
import { isIgnorable, isKnownEventType } from "./known-types.mjs";

/**
 * Incremental JSONL event scanner aligned with official SessionLogScanner.
 * Empty lines are unparsable committed records. A complete frame that does
 * not end on a newline is a torn JSONL record inside a complete frame.
 */
export class SessionLogScanner {
  events = [];
  issues = [];
  unknownTypes = [];
  packedRows = 0;
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
    if (parsed && typeof parsed.type === "string" && parsed.seq0 != null) this.packedRows += 1;
    if (this.issue !== null) {
      if (decoded.some((event) => event.type === "turn/end")) {
        if (this.issue.code === "seq-gap-tail") this.issue.code = "seq-gap-committed";
        this.issues.push({
          code: this.issue.code,
          message: `${this.issue.code} followed by turn/end at line ${this.eventLine}`,
          line: this.eventLine,
        });
      }
      return;
    }
    const rowStart = this.events.length;
    for (const event of decoded) {
      if (event.seq !== this.events.length) {
        const expected = this.events.length;
        this.events.length = rowStart;
        const committed = decoded.some((candidate) => candidate.type === "turn/end");
        this.issue = {
          code: committed ? "seq-gap-committed" : "seq-gap-tail",
          message: `seq gap in committed region at line ${this.eventLine} (expected ${expected}, got ${event.seq})`,
          line: this.eventLine,
        };
        this.issues.push(this.issue);
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
    this.committedBytes = endByte;
  }

  checkpoint() {
    return {
      inputBytes: this.inputBytes,
      committedBytes: this.committedBytes,
      eventCount: this.events.length,
    };
  }

  finish() {
    this.finished = true;
    return {
      events: this.events,
      issues: this.issues,
      unknownTypes: this.unknownTypes,
      packedRows: this.packedRows,
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
