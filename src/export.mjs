import { writeFile } from "node:fs/promises";
import { toHeaderLine } from "./header.mjs";
import { redactValue } from "./redact.mjs";

function jsonlOf(header, events) {
  const lines = [JSON.stringify(toHeaderLine(header))];
  for (const event of events) lines.push(JSON.stringify(event));
  return lines.join("\n") + "\n";
}

/**
 * Export a decoded session as JSONL text.
 * Redaction is on by default; pass { redact: false } explicitly to keep secrets.
 */
export function exportSession(decoded, { redact = true } = {}) {
  if (!decoded.header) throw new Error("cannot export: header missing");
  const header = redact ? redactValue(decoded.header) : decoded.header;
  const events = redact ? decoded.events.map((event) => redactValue(event)) : decoded.events;
  return { header, events, text: jsonlOf(header, events) };
}

export async function writeExport(text, outPath) {
  if (outPath) {
    await writeFile(outPath, text, "utf8");
    return { out: outPath, bytes: Buffer.byteLength(text) };
  }
  return { text };
}
