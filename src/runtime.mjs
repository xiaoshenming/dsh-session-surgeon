/**
 * Detect the actually-installed DeepSeek Harness session runtime.
 * Surgeon stays zero-dependency: if @deepseek-ai/dsh-session is not
 * resolvable, callers use conservative fallbacks.
 */
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** The harness package that owns the session runtime, for one install prefix. */
function harnessAnchors(dir) {
  return [
    join(dir, "node_modules", "@deepseek-ai", "dsh", "package.json"),
    // Desktop/Electron keeps the app's node_modules beside the executable.
    join(dir, "..", "lib", "node_modules", "@deepseek-ai", "dsh", "package.json"),
  ];
}

/**
 * Resolution anchors for the installed harness, most specific first.
 *
 * A PATH hit on the `dsh` launcher is not enough: under the npm-global layout
 * (`%APPDATA%/npm/dsh.cmd`) the launcher's own directory has no
 * `@deepseek-ai/dsh-session`, because the harness nests its runtime under
 * `node_modules/@deepseek-ai/dsh/node_modules/`. Resolving from the harness
 * package itself is what actually finds it, so every prefix contributes both
 * the launcher and the harness package as anchors.
 */
export function dshRequires() {
  const requires = [];
  const seen = new Set();
  const add = (anchor) => {
    if (!anchor || seen.has(anchor)) return;
    seen.add(anchor);
    try {
      requires.push(createRequire(anchor));
    } catch {
      // Ignore stale or non-file anchors.
    }
  };
  add(import.meta.url);
  const dirs = (process.env.PATH ?? "").split(delimiter);
  if (process.execPath) {
    // Desktop/Electron hosts run the plugin beside the app's node_modules;
    // PATH may not contain the dsh launcher there (Windows, issue #3).
    const exeDir = dirname(process.execPath);
    dirs.push(exeDir, dirname(exeDir));
  }
  for (const dir of dirs) {
    if (dir === "") continue;
    const candidate = join(dir, process.platform === "win32" ? "dsh.cmd" : "dsh");
    if (existsSync(candidate)) {
      try {
        add(realpathSync(candidate));
      } catch {
        // Ignore stale or non-file PATH entries.
      }
    }
    for (const anchor of harnessAnchors(dir)) add(anchor);
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
      // The session package is nested inside the harness package; re-anchor on
      // the harness itself before giving up on this resolver.
      try {
        const harness = requireFrom.resolve("@deepseek-ai/dsh/package.json");
        const nested = createRequire(harness);
        const root = nested.resolve("@deepseek-ai/dsh-session");
        const loaded = await import(pathToFileURL(root).href);
        return { root, loaded };
      } catch {
        // Try the next resolver.
      }
    }
  }
  return null;
}

const session = await loadSessionModule();

/**
 * True when the installed harness session runtime was found. When false every
 * verdict below rests on the v0 fallback, which is a guess about the caller's
 * machine rather than a measurement of it — reports say so instead of dressing
 * a v4 log up as `foreign-version`.
 */
export const SESSION_RUNTIME_RESOLVED = session !== null;

/** Install facts a report can carry, so a resolution failure is visible. */
export function sessionRuntimeInfo() {
  return {
    resolved: SESSION_RUNTIME_RESOLVED,
    formatVersion: SESSION_FORMAT_VERSION,
    sessionModulePath: SESSION_MODULE_PATH,
    nativeSeqRanges: SUPPORTS_NATIVE_SEQ_RANGES,
  };
}

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

/** The installed runtime's own event catalog, or null when unresolvable. */
export const INSTALLED_CATALOG =
  session?.loaded?.KNOWN_SESSION_EVENT_TYPES instanceof Set
    ? session.loaded.KNOWN_SESSION_EVENT_TYPES
    : null;

/** Catalog path used by known-types.mjs (types/known-event-types.js). */
export function catalogModulePath(sessionRoot) {
  return join(dirname(sessionRoot), "types", "known-event-types.js");
}
