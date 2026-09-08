import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { SESSION_FORMAT_VERSION } from "./runtime.mjs";
import { isGenerationTmpName, parseGenerationFilename, pickCanonicalGeneration } from "./generations.mjs";

/** Session root: $DSH_SESSION_ROOT or ~/.dsh/sessions. */
export function defaultSessionRoot() {
  return process.env.DSH_SESSION_ROOT ?? join(homedir(), ".dsh", "sessions");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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
