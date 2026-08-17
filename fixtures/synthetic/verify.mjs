/**
 * Self-checks for synthetic fixtures. Kept out of build.mjs so each file stays under 300 lines.
 */
import { constants, zstdDecompress, zstdDecompressSync } from "node:zlib";
import { promisify } from "node:util";

const decompressAsync = promisify(zstdDecompress);
const ZSTD_MAGIC = 4_247_762_216;

export function assert(cond, message) {
  if (!cond) throw new Error(message);
}

export function assertHeader(value, label) {
  assert(value?.type === "session", `${label}: header type`);
  assert(value.version === 0 && typeof value.id === "string", `${label}: version/id`);
  assert(Number.isSafeInteger(value.createdAt) && value.createdAt >= 0, `${label}: createdAt`);
  assert(!Object.is(value.createdAt, -0), `${label}: createdAt -0`);
  assert(Number.isSafeInteger(value.delegationDepth) && value.delegationDepth >= 0, `${label}: depth`);
  assert(!Object.hasOwn(value, "sandboxMode") && !Object.hasOwn(value, "approvalPolicy"), `${label}: retired`);
}

/** Official-shaped scan: last incomplete frame → {frames, tornStart}, no throw. */
export function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid magic at ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error("reserved frame-header bit");
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const headerRest = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < headerRest) return { frames, tornStart: start };
    offset += headerRest;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error("reserved block type");
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

export function decodeLines(frame) {
  return zstdDecompressSync(frame).toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export function expand(row) {
  if (row.type !== "text-chunks") return [row];
  const { texts, dt, turn, step, index } = row.data;
  let time = row.time0;
  return texts.map((text, k) => {
    if (k > 0) time += dt[k - 1];
    return {
      type: "assistant/chunk",
      seq: row.seq0 + k,
      time,
      data: { turn, step, chunk: { type: "text-delta", index, text } },
    };
  });
}

export function verifyHealthy(file) {
  const scanned = scanZstdFrames(file.bytes);
  assert(scanned.frames.length === 2 && scanned.tornStart === undefined, "healthy: 2 complete frames");
  const headerLine = zstdDecompressSync(file.frames[0]).toString("utf8");
  assert(headerLine.indexOf("\n") === headerLine.length - 1, "healthy: header-only frame");
  assertHeader(JSON.parse(headerLine.trim()), "healthy");
  const rows = decodeLines(file.frames[1]);
  const packed = rows.find((row) => row.type === "text-chunks");
  assert(packed?.data.texts.length >= 3, "healthy: packed text-chunks");
  const expanded = rows.flatMap(expand);
  assert(expanded.every((event, i) => event.seq === i), "healthy: expanded seq");
  assert(expanded[0].type === "turn/start" && expanded.at(-1)?.type === "turn/end", "healthy: turn bounds");
}

export async function verifyTorn(file, lastFull) {
  const scanned = scanZstdFrames(file.bytes);
  assert(scanned.frames.length === 2, "torn: two complete frames before tail");
  assert(scanned.tornStart === scanned.frames[1].end, "torn: last frame structurally incomplete");
  const tail = file.bytes.subarray(scanned.tornStart);
  assert(lastFull.length - tail.length === 4, "torn: dropped last-frame checksum");
  const recovered = await decompressAsync(tail, { finishFlush: constants.ZSTD_e_flush });
  assert(recovered.includes("assistant/chunk"), "torn: flush recovers a complete line");
}

export function verifyGap(file, events) {
  assertHeader(decodeLines(file.frames[0])[0], "gap");
  const firstGap = events.findIndex((event, i) => event.seq !== i);
  assert(firstGap === 6 && events[5].type === "turn/end", "gap: hole after turn1 end");
  assert(events.slice(firstGap).some((event) => event.type === "turn/end"), "gap: later turn/end");
}

export function verifyLone(file) {
  const user = decodeLines(file.frames[1]).find((row) => row.type === "user/message");
  const text = user.data.content[0].text;
  const i = text.indexOf(String.fromCharCode(0xd800));
  const next = text.charCodeAt(i + 1);
  assert(i >= 0, "lone: persisted U+D800");
  assert(Number.isNaN(next) || next < 0xdc00 || next > 0xdfff, "lone: isolated, not a pair");
}

export function verifyOrphan(file) {
  assertHeader(decodeLines(file.frames[0])[0], "orphan");
  const events = decodeLines(file.frames[1]);
  assert(events.every((event, i) => event.seq === i) && events.at(-1)?.type === "turn/end", "orphan: closed");
}
