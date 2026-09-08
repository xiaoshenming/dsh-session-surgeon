/**
 * Detect the actually-installed DeepSeek Harness session runtime.
 * Surgeon stays zero-dependency: if @deepseek-ai/dsh-session is not
 * resolvable, callers use conservative fallbacks.
 */
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export function dshRequires() {
  const requires = [createRequire(import.meta.url)];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, process.platform === "win32" ? "dsh.cmd" : "dsh");
    if (!existsSync(candidate)) continue;
    try {
      requires.push(createRequire(realpathSync(candidate)));
    } catch {
      // Ignore stale or non-file PATH entries.
    }
  }
  return requires;
}

async function loadSessionModule() {
  for (const requireFrom of dshRequires()) {
    try {
      const root = requireFrom.resolve("@deepseek-ai/dsh-session");
      const loaded = await import(pathToFileURL(root).href);
      return { root, loaded };
    } catch {
      // Try the next resolver.
    }
  }
  return null;
}

const session = await loadSessionModule();

/** True when this machine's harness expands [start,end] sourceEventSeqs on read. */
export const SUPPORTS_NATIVE_SEQ_RANGES = typeof session?.loaded?.decodeSeqRanges === "function";

/**
 * Logical format version the installed harness writes. Historical generations
 * below this are migrated on load (0.1.3+); versions above are foreign.
 * Standalone fallback is v0 (0.1.2-rc.1 and older).
 */
const rawFormatVersion = session?.loaded?.SESSION_FORMAT_VERSION;
export const SESSION_FORMAT_VERSION =
  Number.isSafeInteger(rawFormatVersion) && rawFormatVersion >= 0 ? rawFormatVersion : 0;

/** True when v0→v1 migration will refuse duplicate advertised tool-call ids. */
export const MIGRATION_REFUSES_DUPLICATE_TOOL_CALL_IDS = SESSION_FORMAT_VERSION >= 1;

export const SESSION_MODULE_PATH = session?.root ?? null;

/** Catalog path used by known-types.mjs (types/known-event-types.js). */
export function catalogModulePath(sessionRoot) {
  return join(dirname(sessionRoot), "types", "known-event-types.js");
}
