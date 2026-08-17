import { zstdDecompressSync } from "node:zlib";

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export function findFrameStarts(buf) {
  const starts = [];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (
      buf[i] === MAGIC[0] &&
      buf[i + 1] === MAGIC[1] &&
      buf[i + 2] === MAGIC[2] &&
      buf[i + 3] === MAGIC[3]
    ) {
      starts.push(i);
    }
  }
  return starts;
}

export function decodeFrames(buf) {
  const starts = findFrameStarts(buf);
  const frames = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : buf.length;
    const slice = buf.subarray(start, end);
    try {
      const text = zstdDecompressSync(slice).toString("utf8");
      frames.push({ index: i, start, end, ok: true, text });
    } catch (error) {
      frames.push({
        index: i,
        start,
        end,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return frames;
}

export function linesFromFrames(frames) {
  const lines = [];
  for (const frame of frames) {
    if (!frame.ok) continue;
    for (const line of frame.text.split("\n")) {
      if (line) lines.push(line);
    }
  }
  return lines;
}

export function parseHeaderLine(line) {
  const parsed = JSON.parse(line);
  if (!parsed || parsed.type !== "session") {
    throw new Error("first line is not a session header");
  }
  return parsed;
}
