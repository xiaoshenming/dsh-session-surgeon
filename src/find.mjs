import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { SESSION_FORMAT_VERSION } from "./runtime.mjs";
import { isGenerationTmpName, parseGenerationFilename, pickCanonicalGeneration } from "./generations.mjs";

/**
 * Session root in the same order the host resolves it:
 * $DSH_SESSION_ROOT, then $DSH_HOME/sessions, then ~/.dsh/sessions.
 *
 * A host started with a separate DSH_HOME (e.g. the documented dev setup
 * `DSH_HOME=~/.dsh-surgeon-dev`) keeps its sessions there, so resolving only
 * `~/.dsh` lists nothing and looks like "no sessions exist".
 */
export function defaultSessionRoot() {
  const explicit = process.env.DSH_SESSION_ROOT;
  if (explicit) return resolve(explicit);
  const home = process.env.DSH_HOME;
  if (home) return resolve(home, "sessions");
  return join(homedir(), ".dsh", "sessions");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Markers the official harness leaves in a DSH_HOME (seen in the wild). */
const DSH_HOME_MARKERS = [
  "profiles",
  ".anonymous-user-id",
  ".credentials.yaml",
  "settings.yaml",
  "settings.yaml.imported",
];

async function isDshHome(dir) {
  for (const marker of DSH_HOME_MARKERS) {
    if (await exists(join(dir, marker))) return true;
  }
  return false;
}

/** Sessions under a root: one level of project dirs holding `session-*` dirs. */
export async function sessionCount(root) {
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    let entries;
    try {
      entries = await readdir(join(root, project.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of entries) {
      if (session.isDirectory() && session.name.startsWith("session-")) count += 1;
    }
  }
  return count;
}

/**
 * Every root this machine plausibly keeps sessions in, host order first:
 * $DSH_SESSION_ROOT, $DSH_HOME/sessions, ~/.dsh/sessions, then any sibling
 * directory under $HOME that looks like a DSH home (a marker file plus a
 * sessions dir) or is itself a sessions dir. Several DSH_HOME libraries side
 * by side are normal, and a tool that only guesses one of them reads as
 * "no sessions at all" — so discovery is by home *shape*, not by name.
 */
export async function candidateSessionRoots() {
  const out = [];
  const seen = new Set();
  const add = async (root, label) => {
    if (!root) return;
    const resolved = resolve(root);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    const found = await exists(resolved);
    out.push({ root: resolved, label, exists: found, sessions: found ? await sessionCount(resolved) : 0 });
  };

  await add(process.env.DSH_SESSION_ROOT, "DSH_SESSION_ROOT");
  if (process.env.DSH_HOME) await add(join(process.env.DSH_HOME, "sessions"), "DSH_HOME");
  await add(join(homedir(), ".dsh", "sessions"), "~/.dsh");

  const home = homedir();
  let entries = [];
  try {
    entries = await readdir(home, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const discovered = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".dsh") continue;
    const dir = join(home, entry.name);
    if (await isDshHome(dir)) {
      discovered.push({ root: join(dir, "sessions"), label: entry.name });
      continue;
    }
    // A bare sessions directory outside a home (someone moved the logs).
    if (entry.name === "sessions" || entry.name.toLowerCase().includes("dsh")) {
      if ((await sessionCount(dir)) > 0) discovered.push({ root: dir, label: entry.name });
    }
  }
  discovered.sort((a, b) => a.label.localeCompare(b.label));
  for (const sibling of discovered) await add(sibling.root, sibling.label);

  return out;
}

/**
 * Two-level walk: root/<project>/<session>/{session.jsonl.zstd|session.vN.jsonl.zstd|plaintext}.
 * Sibling `.tmp` names are listed; they are never treated as the canonical log.
 * When several generations exist, pick the highest the installed runtime can read.
 */
export async function listSessionFiles(root) {
  const out = [];
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read session root ${root}: ${message}`);
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectDir = join(root, project.name);
    let sessions;
    try {
      sessions = await readdir(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const dir = join(projectDir, session.name);
      let names;
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }
      const gens = [];
      const tmpFiles = [];
      for (const name of names) {
        if (isGenerationTmpName(name) && (await exists(join(dir, name)))) {
          tmpFiles.push(name);
          continue;
        }
        const parsed = parseGenerationFilename(name);
        if (!parsed) continue;
        if (await exists(join(dir, name))) gens.push(parsed);
      }
      const canonical = pickCanonicalGeneration(gens, SESSION_FORMAT_VERSION);
      if (!canonical && tmpFiles.length === 0) continue;
      out.push({
        project: project.name,
        sessionDir: session.name,
        dir,
        file: canonical ? join(dir, canonical.filename) : null,
        kind: canonical ? (canonical.compression === "zstd" ? "zstd" : "jsonl") : null,
        generation: canonical?.version,
        generations: gens.map((g) => g.version),
        tmpFiles,
      });
    }
  }
  return out;
}
