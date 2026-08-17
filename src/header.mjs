/**
 * Session header (de)serialization aligned with
 * @deepseek-ai/dsh-session-persistence-jsonl@0.1.0-rc.6
 * (isHeaderLine / fromHeaderLine / toHeaderLine / refuseForeignFormatVersion /
 * parseHeaderRecord / parseHeaderMeta). Zero runtime deps — do not import
 * @deepseek-ai/*.
 */

/** On-disk format version this build reads. Any other number is foreign. */
export const SESSION_FORMAT_VERSION = 0;

const RETIRED_ERROR = "session header uses retired policy baseline fields";
const NOT_HEADER_ERROR = "corrupt session log: first line is not a session header";
const BAD_JSON_ERROR = "corrupt session log: header line is not valid JSON";
const EMPTY_ERROR = "empty or header-less session log";

/**
 * Official sessionFormatVersionRefusal: never call this corrupt.
 * Newer logs ask the user to upgrade; older logs have no upgrade path.
 */
function sessionFormatVersionRefusal(id, version) {
  if (version > SESSION_FORMAT_VERSION) {
    return (
      "session \"" +
      id +
      "\" uses log format v" +
      version +
      ", but this harness reads only v" +
      SESSION_FORMAT_VERSION +
      ": the log was written by a newer harness — upgrade the harness to open it"
    );
  }
  return (
    "session \"" +
    id +
    "\" uses log format v" +
    version +
    ", older than the supported v" +
    SESSION_FORMAT_VERSION +
    ", and this build ships no upgrade path for it"
  );
}

function hasRetiredFields(line) {
  return Object.hasOwn(line, "sandboxMode") || Object.hasOwn(line, "approvalPolicy");
}

function asUtf8Buffer(value) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof Uint8Array) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

/** Type guard: a parsed first line is a well-formed session header. */
export function isHeaderLine(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    value.type === "session" &&
    typeof value.version === "number" &&
    typeof value.id === "string" &&
    typeof value.createdAt === "number" &&
    Number.isSafeInteger(value.createdAt) &&
    value.createdAt >= 0 &&
    !Object.is(value.createdAt, -0) &&
    typeof value.delegationDepth === "number" &&
    Number.isSafeInteger(value.delegationDepth) &&
    value.delegationDepth >= 0 &&
    !Object.is(value.delegationDepth, -0) &&
    (value.origin === void 0 || value.origin === "subagent") &&
    (value.agentPreset === void 0 || typeof value.agentPreset === "string")
  );
}

/**
 * Parse a shape-checked header line into a SessionHeader.
 * Absent optional fields are omitted. Retired policy fields throw.
 */
export function fromHeaderLine(line) {
  if (hasRetiredFields(line)) throw new Error(RETIRED_ERROR);
  return {
    version: line.version,
    id: line.id,
    createdAt: line.createdAt,
    ...(line.cwd !== void 0 ? { cwd: line.cwd } : {}),
    ...(line.parentSession !== void 0 ? { parentSession: line.parentSession } : {}),
    ...(line.seedLength !== void 0 ? { seedLength: line.seedLength } : {}),
    ...(line.origin !== void 0 ? { origin: line.origin } : {}),
    delegationDepth: line.delegationDepth,
    ...(line.agentPreset !== void 0 ? { agentPreset: line.agentPreset } : {}),
  };
}

/** Build the type: "session" line object. Absent optionals are omitted. */
export function toHeaderLine(header) {
  return {
    type: "session",
    version: header.version,
    id: header.id,
    createdAt: header.createdAt,
    ...(header.cwd !== void 0 ? { cwd: header.cwd } : {}),
    ...(header.parentSession !== void 0 ? { parentSession: header.parentSession } : {}),
    ...(header.seedLength !== void 0 ? { seedLength: header.seedLength } : {}),
    ...(header.origin !== void 0 ? { origin: header.origin } : {}),
    delegationDepth: header.delegationDepth ?? 0,
    ...(header.agentPreset !== void 0 ? { agentPreset: header.agentPreset } : {}),
  };
}

/**
 * Refuse a foreign format version BEFORE today's shape checks: a future
 * format need not satisfy v0 structure, and the user must see upgrade,
 * never corrupt session log.
 */
function refuseForeignFormatVersion(parsed) {
  if (typeof parsed !== "object" || parsed === null) return;
  const { version, id } = parsed;
  if (typeof version !== "number" || version === SESSION_FORMAT_VERSION) return;
  const error = new Error(sessionFormatVersionRefusal(typeof id === "string" ? id : String(id), version));
  error.code = "foreign-version";
  throw error;
}

function firstLineOf(buf) {
  const nl = buf.indexOf(10);
  return (nl === -1 ? buf : buf.subarray(0, nl)).toString("utf8");
}

function classifyParsed(parsed) {
  if (typeof parsed === "object" && parsed !== null) {
    const { version, id } = parsed;
    if (typeof version === "number" && version !== SESSION_FORMAT_VERSION) {
      return {
        ok: false,
        code: "foreign-version",
        error: sessionFormatVersionRefusal(typeof id === "string" ? id : String(id), version),
      };
    }
  }
  if (typeof parsed !== "object" || parsed === null || parsed.type !== "session") {
    return { ok: false, code: "not-header", error: NOT_HEADER_ERROR };
  }
  if (!isHeaderLine(parsed)) {
    return { ok: false, code: "header-parse-error", error: NOT_HEADER_ERROR };
  }
  if (hasRetiredFields(parsed)) {
    return { ok: false, code: "retired-fields", error: RETIRED_ERROR };
  }
  return { ok: true, code: "header-ok", header: fromHeaderLine(parsed) };
}

/**
 * Parse one complete header record (exactly one JSONL line + trailing 0x0a).
 * Accepts a Buffer, Uint8Array, or UTF-8 string. Throws with official messages.
 */
export function parseHeaderRecord(record) {
  const buf = asUtf8Buffer(record);
  if (!buf) throw new TypeError("header record must be a string or Uint8Array");
  if (buf.length === 0 || buf.at(-1) !== 10 || buf.indexOf(10) !== buf.length - 1) {
    throw new Error(EMPTY_ERROR);
  }
  let parsed;
  try {
    parsed = JSON.parse(buf.subarray(0, -1).toString("utf8"));
  } catch {
    throw new Error(BAD_JSON_ERROR);
  }
  refuseForeignFormatVersion(parsed);
  if (!isHeaderLine(parsed)) throw new Error(NOT_HEADER_ERROR);
  return fromHeaderLine(parsed);
}

/**
 * Diagnose a header candidate without throwing.
 * Input: parsed object, first-line string, or bytes (first line is used).
 * @returns {{ok:boolean, code:string, header?:object, error?:string}}
 */
export function classifyHeader(input) {
  const buf = asUtf8Buffer(input);
  if (buf) {
    if (buf.length === 0) return { ok: false, code: "header-parse-error", error: EMPTY_ERROR };
    const line = firstLineOf(buf);
    if (line.length === 0) return { ok: false, code: "header-parse-error", error: EMPTY_ERROR };
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { ok: false, code: "header-parse-error", error: BAD_JSON_ERROR };
    }
    return classifyParsed(parsed);
  }
  return classifyParsed(input);
}
