#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { defaultSessionRoot, listSessionFiles, scanAll, scanHeader } from "../src/scan.mjs";
import { inspectEntry, indexRoot, pickSession } from "../src/inspect.mjs";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { applyRepair } from "../src/repair.mjs";
import { applyCompact } from "../src/compact.mjs";
import { exportSession, writeExport } from "../src/export.mjs";
import { formatIndexText, formatInspectText, formatRepairText, formatScanText } from "../src/format.mjs";

function usage() {
  console.log(`dsh-session-surgeon — repair DeepSeek Harness sessions that refuse to load
把打不开的 DSH 会话修回来（seq gap / torn zstd / lone surrogate）

Usage:
  dsh-session-surgeon scan [root] [--format json|text]
  dsh-session-surgeon inspect <id> [root] [--format json|text]
  dsh-session-surgeon repair <id> [root] [--dry-run|--apply] [--format json|text]
  dsh-session-surgeon compact <id> [root] --keep-last-turns N [--dry-run|--apply]
  dsh-session-surgeon export <id> [root] [--no-redact] [--out file]
  dsh-session-surgeon index [root] [--format json|text]

Defaults: root=~/.dsh/sessions (or $DSH_SESSION_ROOT); repair/compact are dry-run;
export redacts secrets unless --no-redact.
`);
}

function takeFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

function takeOpt(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value == null || value.startsWith("--")) {
    throw Object.assign(new Error(`${name} requires a value`), { code: "usage" });
  }
  args.splice(i, 2);
  return value;
}

function emit(format, json, text) {
  console.log(format === "text" ? text : JSON.stringify(json, null, 2));
}

async function resolveEntry(root, id) {
  const entries = await listSessionFiles(root);
  const scanned = [];
  for (const entry of entries) scanned.push(await scanHeader(entry));
  return pickSession(scanned, id);
}

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "help";
const rest = argv.slice(1);

if (cmd === "help" || cmd === "-h" || cmd === "--help") {
  usage();
  process.exit(0);
}

try {
  if (cmd === "scan") {
    const format = takeOpt(rest, "--format") ?? "json";
    const root = rest[0] ?? defaultSessionRoot();
    const report = await scanAll(root);
    emit(format, report, formatScanText(report));
    process.exit(0);
  }

  if (cmd === "index") {
    const format = takeOpt(rest, "--format") ?? "json";
    const root = rest[0] ?? defaultSessionRoot();
    const report = await indexRoot(root);
    emit(format, report, formatIndexText(report));
    process.exit(0);
  }

  if (cmd === "inspect") {
    const format = takeOpt(rest, "--format") ?? "json";
    const id = rest[0];
    if (!id) {
      usage();
      process.exit(2);
    }
    const root = rest[1] ?? defaultSessionRoot();
    const entry = await resolveEntry(root, id);
    const report = await inspectEntry(entry);
    emit(format, report, formatInspectText(report));
    process.exit(0);
  }

  if (cmd === "repair") {
    const format = takeOpt(rest, "--format") ?? "json";
    const apply = takeFlag(rest, "--apply");
    takeFlag(rest, "--dry-run");
    const id = rest[0];
    if (!id) {
      usage();
      process.exit(2);
    }
    const root = rest[1] ?? defaultSessionRoot();
    const entry = await resolveEntry(root, id);
    if (!entry.file) throw Object.assign(new Error("no canonical session file"), { code: "not-found" });
    const decoded = decodeSessionBuffer(await readFile(entry.file));
    const result = await applyRepair({ file: entry.file, decoded, dryRun: !apply });
    emit(format, result, formatRepairText(result));
    process.exit(result.plan.refuse ? 1 : 0);
  }

  if (cmd === "compact") {
    const format = takeOpt(rest, "--format") ?? "json";
    const apply = takeFlag(rest, "--apply");
    takeFlag(rest, "--dry-run");
    const keepRaw = takeOpt(rest, "--keep-last-turns");
    const id = rest[0];
    if (!id || keepRaw == null) {
      usage();
      process.exit(2);
    }
    const keepLastTurns = Number(keepRaw);
    if (!Number.isSafeInteger(keepLastTurns) || keepLastTurns < 1) {
      usage();
      process.exit(2);
    }
    const root = rest[1] ?? defaultSessionRoot();
    const entry = await resolveEntry(root, id);
    if (!entry.file) throw Object.assign(new Error("no canonical session file"), { code: "not-found" });
    const decoded = decodeSessionBuffer(await readFile(entry.file));
    const result = await applyCompact({ file: entry.file, decoded, keepLastTurns, dryRun: !apply });
    emit(format, result, formatRepairText(result));
    process.exit(result.plan.refuse ? 1 : 0);
  }

  if (cmd === "export") {
    const noRedact = takeFlag(rest, "--no-redact");
    const out = takeOpt(rest, "--out");
    const id = rest[0];
    if (!id) {
      usage();
      process.exit(2);
    }
    const root = rest[1] ?? defaultSessionRoot();
    const entry = await resolveEntry(root, id);
    if (!entry.file) throw Object.assign(new Error("no canonical session file"), { code: "not-found" });
    const decoded = decodeSessionBuffer(await readFile(entry.file));
    const exported = exportSession(decoded, { redact: !noRedact });
    if (out) {
      const written = await writeExport(exported.text, out);
      console.log(JSON.stringify(written, null, 2));
    } else {
      process.stdout.write(exported.text);
    }
    process.exit(0);
  }

  usage();
  process.exit(2);
} catch (error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(code === "usage" ? 2 : 1);
}
