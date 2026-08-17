import { constants, zstdCompress, zstdDecompress, zstdDecompressSync } from "node:zlib";
import { promisify } from "node:util";

/** Zstandard magic number, little-endian uint32 (`28 B5 2F FD`). */
export const ZSTD_MAGIC = 4247762216;

const zstdCompressAsync = promisify(zstdCompress);
const zstdDecompressAsync = promisify(zstdDecompress);
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
const INCOMPLETE_FRAME_OPTIONS = { finishFlush: constants.ZSTD_e_flush };

/**
 * Locate complete Zstandard frames without decompressing blocks.
 * Invalid complete structure rejects; EOF inside the final frame
 * returns `tornStart` instead of throwing.
 *
 * @param {Buffer} buffer
 * @param {number} [maxFrames]
 * @returns {{ frames: { start: number, end: number }[], tornStart?: number }}
 */
export function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) {
      return { frames, tornStart: start };
    }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) {
      return { frames, tornStart: start };
    }
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) {
      throw new Error(
        `corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`,
      );
    }
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) {
      return { frames, tornStart: start };
    }
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) {
        return { frames, tornStart: start };
      }
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) {
        throw new Error(
          `corrupt Zstandard session log: reserved block type at byte ${offset - 3}`,
        );
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) {
        return { frames, tornStart: start };
      }
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) {
        return { frames, tornStart: start };
      }
      offset += 4;
    }
    frames.push({ start, end: offset });
    if (frames.length === maxFrames) return { frames };
  }
  return { frames };
}

/** Decompress one structurally complete frame and validate its checksum. */
export function decodeCompleteFrame(buf) {
  return zstdDecompressSync(buf);
}

/**
 * Compress one independently decodable, checksummed Zstandard frame.
 * @param {Buffer | string} input
 * @returns {Promise<Buffer>}
 */
export function compressFrame(input) {
  return zstdCompressAsync(input, CHECKSUM_OPTIONS);
}

/**
 * Recover available plaintext from a structurally incomplete final frame.
 * `ZSTD_e_flush` suppresses final-frame and checksum completion.
 * @param {Buffer} input
 * @returns {Promise<Buffer>}
 */
export function decompressPrefix(input) {
  return zstdDecompressAsync(input, INCOMPLETE_FRAME_OPTIONS);
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function recoverTornText(prefix) {
  // Sync equivalent of decompressPrefix (ZSTD_e_flush).
  return zstdDecompressSync(prefix, INCOMPLETE_FRAME_OPTIONS);
}

/**
 * Decode every complete frame and try to salvage a torn tail.
 * Complete-frame decompress failure is `ok: false`, not a throw.
 * A torn prefix is marked `torn: true`.
 *
 * @param {Buffer} buf
 * @returns {{ index: number, start: number, end: number, ok: boolean, text?: string, error?: string, torn?: boolean }[]}
 */
export function decodeFrames(buf) {
  const { frames, tornStart } = scanZstdFrames(buf);
  const out = [];
  for (let i = 0; i < frames.length; i++) {
    const { start, end } = frames[i];
    try {
      const text = decodeCompleteFrame(buf.subarray(start, end)).toString("utf8");
      out.push({ index: i, start, end, ok: true, text });
    } catch (error) {
      out.push({ index: i, start, end, ok: false, error: errorText(error) });
    }
  }
  if (tornStart === undefined) return out;
  const start = tornStart;
  const end = buf.length;
  const index = out.length;
  try {
    const text = recoverTornText(buf.subarray(start, end)).toString("utf8");
    out.push({ index, start, end, ok: true, torn: true, text });
  } catch (error) {
    out.push({ index, start, end, ok: false, torn: true, error: errorText(error) });
  }
  return out;
}

/**
 * Split recovered UTF-8 into non-empty JSONL lines.
 * Incomplete trailing fragments (no newline) are kept if non-empty;
 * callers that need committed records should drop the last line when
 * the text does not end with `\n`.
 * @param {string} text
 */
export function linesFromText(text) {
  const lines = [];
  for (const line of String(text).split("\n")) {
    if (line) lines.push(line);
  }
  return lines;
}

/** Collect non-empty lines from successfully decoded frames, including torn text. */
export function linesFromFrames(frames) {
  const lines = [];
  for (const frame of frames) {
    if (!frame.ok || frame.text == null) continue;
    for (const line of linesFromText(frame.text)) lines.push(line);
  }
  return lines;
}
