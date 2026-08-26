import { defaultSessionRoot, scanAll, scanHeader } from "../src/scan.mjs";
import { inspectById, pickSession } from "../src/inspect.mjs";
import { repairFile } from "../src/repair.mjs";
import { listSessionFiles } from "../src/find.mjs";
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
        root: { type: "string", description: "Session root. Defaults to ~/.dsh/sessions." },
      },
      output: jsonOutput,
      async execute(args) {
        const root = args.root || defaultSessionRoot();
        return scanAll(root);
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
        root: { type: "string", description: "Session root. Defaults to ~/.dsh/sessions." },
      },
      output: jsonOutput,
      async execute(args) {
        return inspectById(args.root || defaultSessionRoot(), args.id);
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
        root: { type: "string", description: "Session root. Defaults to ~/.dsh/sessions." },
        apply: { type: "boolean", description: "Write the repaired file. Default false." },
      },
      output: jsonOutput,
      async execute(args) {
        const file = await resolveFile(args.root || defaultSessionRoot(), args.id);
        return repairFile(file, { dryRun: args.apply !== true });
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
