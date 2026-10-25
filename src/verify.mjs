/**
 * Ask the released reader what it does with each stored session.
 *
 * Everything else in this tool models the loader's gates. A model is a
 * hypothesis, and it has been wrong before — a shape we did not know read as
 * `ok` while the loader refused the file (see CHANGELOG, `producer-source-invalid`).
 * When the installed harness is resolvable, `verify` stops guessing: it hands
 * every session file to the same entry point the app uses (`readStoredLog` from
 * `@deepseek-ai/dsh-session-persistence-jsonl`) and reports its verdict next to
 * ours.
 *
 * That difference matters most when one bad session poisons a whole feature:
 * session search cold-reads every persisted session and aborts on the first
 * failure (#10815: 8 unreadable sessions out of 170 made every `session_search`
 * call fail while exact reads still worked). "Which of my sessions does the
 * reader refuse" is the question, and this is the answer — our health code says
 * what we think, `reader` says what the loader did.
 *
 * Reading never writes: migration publishes a new generation through a separate
 * path, so `readStoredLog` on an older generation returns the migrated log
 * without touching the file. `verify` also never repairs; it only reports.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { listSessionFiles } from "./find.mjs";
import { decodeSessionBuffer } from "./decode.mjs";
import { resolveInstalledPackage } from "./runtime.mjs";

const PACKAGE = "@deepseek-ai/dsh-session-persistence-jsonl";

/** The log line, without the stack the CLI does not need. */
function firstLine(error) {
  const text = error instanceof Error ? error.message : String(error);
  // The reader appends "(raw log: <path>)"; the row already names the file.
  const line = text
    .split("\n")[0]
    .replace(/\s*\(raw log: [^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > 400 ? line.slice(0, 397) + "..." : line;
}

/**
 * The installed read path, or null when this host cannot resolve it.
 * @returns {Promise<null | ((file: string, id: string) => Promise<{events: unknown[]}>)>}
 */
export async function loadReader(root, override = process.env.DSH_SURGEON_READER) {
  const entry = typeof override === "string" && override !== "" ? override : resolveInstalledPackage(PACKAGE);
  if (entry === null) return null;
  let module;
  try {
    module = await import(pathToFileURL(entry).href);
  } catch {
    return null;
  }
  const Persistence = module.default;
  if (typeof Persistence !== "function") return null;
  const ctx = {
    reflect: { provide() {} },
    on() {},
    effect() {},
    logger: { warn() {}, info() {}, debug() {}, error() {} },
  };
  let persistence;
  try {
    persistence = new Persistence(ctx, { root, compression: "zstd" });
  } catch {
    return null;
  }
  if (typeof persistence.readStoredLog !== "function") return null;
  const read = (file, id) => persistence.readStoredLog(file, id);
  read.path = entry;
  return read;
}

/** The `version` of the package that owns `entry`, when it can be read. */
async function readPackageVersion(entry) {
  const manifest = join(dirname(entry), "..", "package.json");
  try {
    const parsed = JSON.parse(await readFile(manifest, "utf8"));
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * Decode every session under `root` and, when a reader is installed, ask it too.
 * @returns {Promise<{root: string, reader: string, count: number, refused: number, sessions: object[]}>}
 */
export async function verifyRoot(root) {
  const entries = await listSessionFiles(root);
  const read = await loadReader(root);
  const sessions = [];
  let refused = 0;
  for (const entry of entries) {
    const row = {
      id: entry.sessionDir,
      project: entry.project,
      file: entry.file ?? null,
      health: "unreadable",
      reader: "skipped",
    };
    let decoded = null;
    try {
      decoded = decodeSessionBuffer(await readFile(entry.file));
      row.id = decoded.header?.id ?? entry.sessionDir;
      row.health = decoded.health;
    } catch (error) {
      row.health = "decode-failed";
      row.error = firstLine(error);
    }
    if (read !== null && decoded !== null) {
      try {
        const log = await read(entry.file, row.id);
        row.reader = "accept";
        row.events = Array.isArray(log?.events) ? log.events.length : undefined;
      } catch (error) {
        row.reader = "refuse";
        row.message = firstLine(error);
        refused += 1;
      }
    }
    for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
    sessions.push(row);
  }
  // The verdict is only as good as the reader behind it: a session written by a
  // newer harness is refused by an older one for event types it has never seen,
  // so name the copy that answered (and let DSH_SURGEON_READER point elsewhere).
  const manifest = read === null ? null : await readPackageVersion(read.path);
  return {
    root,
    reader: read === null ? "unavailable" : "installed",
    ...(manifest === null ? {} : { readerVersion: manifest }),
    count: sessions.length,
    refused,
    sessions,
  };
}

export function formatVerifyText(report) {
  const lines = [];
  lines.push(`root: ${report.root}`);
  lines.push(
    report.reader === "installed"
      ? `reader: @deepseek-ai/dsh-session-persistence-jsonl ${report.readerVersion ?? "(version unknown)"}`
      : "reader: unavailable — only our own health is shown (install the harness to verify)",
  );
  lines.push(`sessions: ${report.count}, refused by the reader: ${report.refused}`);
  for (const row of report.sessions) {
    const reader = row.reader === "refuse" ? `REFUSED ${row.message}` : row.reader;
    const health = row.health === "ok" ? "" : ` [ours: ${row.health}]`;
    lines.push(`  ${row.reader === "refuse" ? "✗" : "·"} ${row.id}${health} — ${reader}`);
  }
  return lines.join("\n");
}
