/**
 * Lossless packing for consecutive assistant/chunk delta runs.
 * Port of @deepseek-ai/dsh-session chunk-rows (0.1.0-rc.6).
 * Storage tags are not session events; malformed rows throw.
 */

/** Format constant: both layouts decode identically. */
export const MIN_RUN = 3;

const ROW_TAGS = new Set(["text-chunks", "reasoning-chunks", "tool-call-chunks"]);

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/** Exact-key check: `value` has every key in `keys` and nothing else. */
function hasExactKeys(value, keys) {
  return Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}

/**
 * Classify an event for packing. Returns the delta kind only when the entire
 * shape is whitelisted; otherwise undefined (store verbatim).
 */
function classify(event) {
  if (event.type !== "assistant/chunk") return undefined;
  if (!hasExactKeys(event, ["type", "seq", "time", "data"])) return undefined;
  if (!Number.isSafeInteger(event.seq) || event.seq < 0 || !Number.isSafeInteger(event.time)) {
    return undefined;
  }
  const data = event.data;
  if (!isRecord(data) || !hasExactKeys(data, ["turn", "step", "chunk"])) return undefined;
  if (typeof data.turn !== "number" || typeof data.step !== "number") return undefined;
  const chunk = data.chunk;
  if (!isRecord(chunk) || typeof chunk.index !== "number") return undefined;
  switch (chunk.type) {
    case "text-delta":
    case "reasoning-delta":
      return hasExactKeys(chunk, ["type", "index", "text"]) && typeof chunk.text === "string"
        ? chunk.type
        : undefined;
    case "tool-call-delta": {
      const shapeOk = hasExactKeys(chunk, ["type", "index", "id", "argumentsDelta"])
        || (hasExactKeys(chunk, ["type", "index", "id", "name", "argumentsDelta"])
          && typeof chunk.name === "string");
      return shapeOk && typeof chunk.id === "string" && typeof chunk.argumentsDelta === "string"
        ? chunk.type
        : undefined;
    }
    default:
      return undefined;
  }
}

function toolCallOf(event) {
  return event.data.chunk;
}

function indexOf(event) {
  return event.data.chunk.index;
}

/** Whether `next` extends a run ending in `prev` (same kind already checked). */
function continues(prev, next, kind) {
  if (next.seq !== prev.seq + 1) return false;
  // Two safe-integer times can sit further apart than a double subtracts exactly.
  if (!Number.isSafeInteger(next.time - prev.time)) return false;
  if (next.data.turn !== prev.data.turn || next.data.step !== prev.data.step) return false;
  if (indexOf(next) !== indexOf(prev)) return false;
  if (kind !== "tool-call-delta") return true;
  const a = toolCallOf(prev);
  const b = toolCallOf(next);
  return a.id === b.id
    && Object.hasOwn(a, "name") === Object.hasOwn(b, "name")
    && a.name === b.name;
}

/** Build the row for a completed run (`run.length >= MIN_RUN`). */
function buildRow(kind, run) {
  const first = run[0];
  const base = {
    turn: first.data.turn,
    step: first.data.step,
    index: indexOf(first),
    dt: run.slice(1).map((event, i) => event.time - run[i].time),
  };
  const envelope = { seq0: first.seq, time0: first.time };
  if (kind === "tool-call-delta") {
    const call = toolCallOf(first);
    return {
      type: "tool-call-chunks",
      ...envelope,
      data: {
        ...base,
        id: call.id,
        ...Object.hasOwn(call, "name") ? { name: call.name } : {},
        args: run.map((event) => event.data.chunk.argumentsDelta),
      },
    };
  }
  const data = { ...base, texts: run.map((event) => event.data.chunk.text) };
  return kind === "text-delta"
    ? { type: "text-chunks", ...envelope, data }
    : { type: "reasoning-chunks", ...envelope, data };
}

/**
 * Pack an event batch for storage. Runs of at least MIN_RUN consecutive
 * same-kind, same-block delta chunks become one row; everything else is verbatim.
 */
export function packChunkRuns(events) {
  const out = [];
  let kind;
  let run = [];
  const flush = () => {
    if (kind !== undefined && run.length >= MIN_RUN) out.push(buildRow(kind, run));
    else out.push(...run);
    kind = undefined;
    run = [];
  };
  for (const event of events) {
    const k = classify(event);
    if (k === undefined) {
      flush();
      out.push(event);
      continue;
    }
    const last = run[run.length - 1];
    if (k === kind && last !== undefined && continues(last, event, k)) {
      run.push(event);
      continue;
    }
    flush();
    kind = k;
    run = [event];
  }
  flush();
  return out;
}

function malformed(tag, why) {
  throw new Error(`malformed ${tag} storage row: ${why}`);
}

function validateRunData(tag, data, payloadKey) {
  if (typeof data.turn !== "number" || typeof data.step !== "number" || typeof data.index !== "number") {
    malformed(tag, "turn/step/index must be numbers");
  }
  const payload = data[payloadKey];
  if (!Array.isArray(payload) || payload.length === 0 || payload.some((entry) => typeof entry !== "string")) {
    malformed(tag, `${payloadKey} must be a non-empty string array`);
  }
  const dt = data.dt;
  if (!Array.isArray(dt) || dt.some((gap) => !Number.isSafeInteger(gap))) {
    malformed(tag, "dt must be an array of safe integers");
  }
  if (dt.length !== payload.length - 1) {
    malformed(tag, `dt length ${dt.length} does not match ${payload.length} members`);
  }
  return payload;
}

function validateRow(value, tag) {
  if (!hasExactKeys(value, ["type", "seq0", "time0", "data"])) {
    malformed(tag, "envelope must be exactly {type, seq0, time0, data}");
  }
  if (!Number.isSafeInteger(value.seq0) || value.seq0 < 0) {
    malformed(tag, "seq0 must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(value.time0)) {
    malformed(tag, "time0 must be a safe integer");
  }
  const data = value.data;
  if (!isRecord(data)) malformed(tag, "data must be an object");
  let payload;
  if (tag === "tool-call-chunks") {
    const withName = hasExactKeys(data, ["turn", "step", "index", "id", "name", "dt", "args"]);
    if (!withName && !hasExactKeys(data, ["turn", "step", "index", "id", "dt", "args"])) {
      malformed(tag, "data must be exactly {turn, step, index, id, name?, dt, args}");
    }
    if (typeof data.id !== "string" || (withName && typeof data.name !== "string")) {
      malformed(tag, "id (and name when present) must be strings");
    }
    payload = validateRunData(tag, data, "args");
  } else {
    if (!hasExactKeys(data, ["turn", "step", "index", "dt", "texts"])) {
      malformed(tag, "data must be exactly {turn, step, index, dt, texts}");
    }
    payload = validateRunData(tag, data, "texts");
  }
  if (!Number.isSafeInteger(value.seq0 + payload.length - 1)) {
    malformed(tag, "member seqs must stay safe integers");
  }
  let time = value.time0;
  for (const gap of data.dt) {
    time += gap;
    if (!Number.isSafeInteger(time)) malformed(tag, "member times must stay safe integers");
  }
  return value;
}

function expandRow(row) {
  const members = row.type === "tool-call-chunks" ? row.data.args : row.data.texts;
  const events = [];
  let time = row.time0;
  for (let k = 0; k < members.length; k++) {
    if (k > 0) time += row.data.dt[k - 1];
    let chunk;
    switch (row.type) {
      case "text-chunks":
        chunk = { type: "text-delta", index: row.data.index, text: members[k] };
        break;
      case "reasoning-chunks":
        chunk = { type: "reasoning-delta", index: row.data.index, text: members[k] };
        break;
      case "tool-call-chunks":
        chunk = {
          type: "tool-call-delta",
          index: row.data.index,
          id: row.data.id,
          ...Object.hasOwn(row.data, "name") ? { name: row.data.name } : {},
          argumentsDelta: members[k],
        };
        break;
      default:
        malformed(row.type, "unknown tag");
    }
    events.push({
      type: "assistant/chunk",
      seq: row.seq0 + k,
      time,
      data: { turn: row.data.turn, step: row.data.step, chunk },
    });
  }
  return events;
}

/**
 * Decode one parsed JSONL line. Chunk-row tags validate and expand (malformed
 * rows throw); every other value passes through as a single unvalidated event.
 */
export function decodeStorageRecord(value) {
  if (!isRecord(value)) return [value];
  const tag = value.type;
  if (!ROW_TAGS.has(tag)) return [value];
  return expandRow(validateRow(value, tag));
}
