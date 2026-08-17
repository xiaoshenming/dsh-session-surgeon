import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const TMP_NAMES = ["session.jsonl.zstd.tmp", "session.jsonl.tmp"];

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
 * Two-level walk: root/<project>/<session>/{session.jsonl.zstd|session.jsonl}.
 * Sibling `.tmp` names are listed; they are never treated as the canonical log.
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
      const zstd = join(dir, "session.jsonl.zstd");
      const raw = join(dir, "session.jsonl");
      let kind = null;
      let file = null;
      if (await exists(zstd)) {
        kind = "zstd";
        file = zstd;
      } else if (await exists(raw)) {
        kind = "jsonl";
        file = raw;
      }
      const tmpFiles = [];
      for (const name of TMP_NAMES) {
        if (await exists(join(dir, name))) tmpFiles.push(name);
      }
      if (!file && tmpFiles.length === 0) continue;
      out.push({
        project: project.name,
        sessionDir: session.name,
        dir,
        file,
        kind,
        tmpFiles,
      });
    }
  }
  return out;
}
