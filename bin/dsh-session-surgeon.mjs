#!/usr/bin/env node
import { defaultSessionRoot, inspectSession, listSessionFiles, scanHeader } from "../src/scan.mjs";

function usage() {
  console.log(`dsh-session-surgeon — repair DeepSeek Harness sessions

Usage:
  dsh-session-surgeon scan [root]
  dsh-session-surgeon inspect <session-id> [root]
  dsh-session-surgeon repair <session-id>   (not implemented)
  dsh-session-surgeon compact <session-id>  (not implemented)
  dsh-session-surgeon export <session-id>   (not implemented)

Default root: ~/.dsh/sessions  (override with DSH_SESSION_ROOT or the last arg)
`);
}

function pick(entries, id) {
  const hits = entries.filter((e) => e.sessionDir === id || e.header?.id === id);
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    throw new Error(`session not found: ${id}`);
  }
  throw new Error(`ambiguous session id ${id}: ${hits.map((h) => h.dir).join(", ")}`);
}

const [cmd = "help", ...rest] = process.argv.slice(2);

if (cmd === "help" || cmd === "-h" || cmd === "--help") {
  usage();
  process.exit(0);
}

if (cmd === "scan") {
  const root = rest[0] ?? defaultSessionRoot();
  const entries = await listSessionFiles(root);
  const rows = [];
  for (const entry of entries) {
    rows.push(await scanHeader(entry));
  }
  console.log(JSON.stringify({ root, count: rows.length, sessions: rows }, null, 2));
  process.exit(0);
}

if (cmd === "inspect") {
  const id = rest[0];
  if (!id) {
    usage();
    process.exit(2);
  }
  const root = rest[1] ?? defaultSessionRoot();
  const entries = await listSessionFiles(root);
  const scanned = [];
  for (const entry of entries) scanned.push(await scanHeader(entry));
  const entry = pick(scanned, id);
  const report = await inspectSession(entry);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (cmd === "repair" || cmd === "compact" || cmd === "export") {
  console.error(`${cmd} is not implemented in week 0. See docs/PLAN.md.`);
  process.exit(2);
}

usage();
process.exit(2);
