import { defaultSessionRoot, scanAll, scanHeader } from "../src/scan.mjs";
import { inspectById, pickSession } from "../src/inspect.mjs";
import { repairFile } from "../src/repair.mjs";
import { listSessionFiles } from "../src/find.mjs";
import { sessionRuntimeInfo } from "../src/runtime.mjs";
import { makeRoutes } from "./routes.mjs";

export const name = "session-surgeon";
export const inject = ["tools", "webServer"];

function renderJson(_args, value) {
  const text = JSON.stringify(value, null, 2);
  return [{ type: "text", text: text.length > 8000 ? text.slice(0, 8000) + "\n…[truncated]" : text }];
}

const jsonOutput = {
  schema: { type: "json" },
  render: renderJson,
};

/**
 * Detach a report into lossless JSON.
 *
 * The harness snapshots every tool value with `walkJsonValue`
 * (`@deepseek-ai/dsh-util-values`) and rejects a value that holds `undefined`,
 * a non-finite number, `-0`, a non-plain object or a cycle — as
 * `returned invalid output: value is not lossless JSON`, discarding the whole
 * report. A single absent optional field (a healthy log has no `tornStart` and
 * no `error`) therefore used to take down every one of these tools.
 *
 * Normalizing at the boundary is the guarantee: `undefined` members are omitted
 * (JSON has no `undefined`), and an array hole becomes `null` because a hole is
 * not representable either — `Array.from`, not `map`, because `map` skips holes
 * and the harness refuses a value that still holds one.
 */
export function toLosslessJson(value, seen = new WeakSet()) {
  if (value === null) return null;
  const type = typeof value;
  if (type === "string" || type === "boolean") return value;
  if (type === "number") {
    if (!Number.isFinite(value)) return null;
    return Object.is(value, -0) ? 0 : value;
  }
  // undefined / function / symbol / bigint are not JSON and are dropped.
  if (type !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      // `Array.from` visits holes; `map` skips them, and a hole is not JSON
      // either, so a hole has to become `null` like any other absent member.
      return Array.from(value, (item) => {
        const normalized = toLosslessJson(item, seen);
        return normalized === undefined ? null : normalized;
      });
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const normalized = toLosslessJson(item, seen);
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * Every registered tool returns lossless JSON with this machine's install facts
 * attached, so a runtime that could not be resolved is visible in the report
 * instead of silently turning every session into a `foreign-version` verdict.
 */
function toolOutput(value) {
  const base = value && typeof value === "object" && !Array.isArray(value) ? value : { value };
  return toLosslessJson({ ...base, runtime: sessionRuntimeInfo() });
}

async function resolveFile(root, id) {
  const entries = await listSessionFiles(root);
  const scanned = [];
  for (const entry of entries) scanned.push(await scanHeader(entry));
  const entry = pickSession(scanned, id);
  if (!entry.file) throw new Error("no canonical session file");
  return entry.file;
}

async function loadDefineTool() {
  try {
    const mod = await import("@deepseek-ai/dsh-tools");
    if (typeof mod.defineTool === "function") return mod.defineTool;
  } catch {
    // link: installs sit outside the dsh node_modules tree.
  }
  try {
    const { createRequire } = await import("node:module");
    const { dirname, join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const req = createRequire(import.meta.url);
    const search = [
      process.cwd(),
      join(dirname(process.execPath), "..", "lib", "node_modules", "@deepseek-ai", "dsh"),
    ];
    const fromDsh = req.resolve("@deepseek-ai/dsh-tools", { paths: search });
    const mod = await import(pathToFileURL(fromDsh).href);
    if (typeof mod.defineTool === "function") return mod.defineTool;
  } catch {
    return null;
  }
  return null;
}

async function registerTools(ctx) {
  const defineTool = await loadDefineTool();
  if (!defineTool) {
    console.warn("[dsh-session-surgeon] @deepseek-ai/dsh-tools not available, skip tool registration");
    return;
  }
  if (!ctx?.tools?.register) {
    console.warn("[dsh-session-surgeon] ctx.tools.register missing, skip tool registration");
    return;
  }

  ctx.tools.register(
    defineTool({
      name: "session_scan",
      description:
        "List DeepSeek Harness sessions under a root and report header-level health (seq/zstd issues need session_inspect).",
      parameters: {
        root: { type: "string", description: "Session root. Defaults to $DSH_SESSION_ROOT, else $DSH_HOME/sessions, else ~/.dsh/sessions." },
      },
      output: jsonOutput,
      async execute(args) {
        const root = args.root || defaultSessionRoot();
        return toolOutput(await scanAll(root));
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "session_inspect",
      description:
        "Decode every zstd frame of one session, expand packed rows, and report seq gaps / torn tails / missing message ids / dangling tool/call (no matching tool/result). Does not include user message bodies. Does not invent missing tool results.",
      parameters: {
        id: { type: "string", required: true, description: "Session id or unique prefix." },
        root: { type: "string", description: "Session root. Defaults to $DSH_SESSION_ROOT, else $DSH_HOME/sessions, else ~/.dsh/sessions." },
      },
      output: jsonOutput,
      async execute(args) {
        return toolOutput(await inspectById(args.root || defaultSessionRoot(), args.id));
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "session_repair",
      description:
        "Plan or apply a repair for a session that the official loader refuses. Default is dry-run; set apply=true to write (creates .bak.<utc> first).",
      parameters: {
        id: { type: "string", required: true, description: "Session id or unique prefix." },
        root: { type: "string", description: "Session root. Defaults to $DSH_SESSION_ROOT, else $DSH_HOME/sessions, else ~/.dsh/sessions." },
        apply: { type: "boolean", description: "Write the repaired file. Default false." },
      },
      output: jsonOutput,
      async execute(args) {
        const file = await resolveFile(args.root || defaultSessionRoot(), args.id);
        return toolOutput(await repairFile(file, { dryRun: args.apply !== true }));
      },
    }),
  );
}

function registerRoutes(ctx) {
  if (typeof ctx?.webServer?.register !== "function") return;
  const routes = makeRoutes();
  const run = () => {
    const disposers = routes.map((route) => ctx.webServer.register(route));
    return () => {
      for (const dispose of disposers) if (typeof dispose === "function") dispose();
    };
  };
  if (typeof ctx.effect === "function") ctx.effect(run, "session-surgeon: routes");
  else run();
}

export function apply(ctx) {
  registerRoutes(ctx);
  return registerTools(ctx);
}

export { settingsCopy } from "./settings-card.mjs";
