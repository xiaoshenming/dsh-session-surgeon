import { inspectById, pickSession } from "../src/inspect.mjs";
import { defaultSessionRoot, scanAll, scanHeader } from "../src/scan.mjs";
import { listSessionFiles } from "../src/find.mjs";
import { repairFile } from "../src/repair.mjs";
import { applyCompact } from "../src/compact.mjs";
import { decodeSessionBuffer } from "../src/decode.mjs";
import { exportSession } from "../src/export.mjs";
import { readFile } from "node:fs/promises";

export const API_PREFIX = "/api/session-surgeon";

function writeJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(text);
}

function isLoopback(req) {
  const raw = req.socket?.remoteAddress ?? "";
  return raw === "127.0.0.1" || raw === "::1" || raw === "::ffff:127.0.0.1";
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function queryOf(req) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  return url.searchParams;
}

async function resolveFile(root, id) {
  const entries = await listSessionFiles(root);
  const scanned = [];
  for (const entry of entries) scanned.push(await scanHeader(entry));
  const entry = pickSession(scanned, id);
  if (!entry.file) throw new Error("no canonical session file");
  return entry;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : undefined;
      const status = code === "not-found" ? 404 : code === "ambiguous" ? 409 : 500;
      writeJson(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function makeRoutes() {
  return [
    {
      kind: "exact",
      path: `${API_PREFIX}/scan`,
      handler: wrap(async (req, res) => {
        if (!isLoopback(req)) return writeJson(res, 403, { error: "loopback-only" });
        if (req.method !== "GET") return writeJson(res, 405, { error: "GET only" });
        const root = queryOf(req).get("root") || defaultSessionRoot();
        writeJson(res, 200, await scanAll(root));
      }),
    },
    {
      kind: "exact",
      path: `${API_PREFIX}/inspect`,
      handler: wrap(async (req, res) => {
        if (!isLoopback(req)) return writeJson(res, 403, { error: "loopback-only" });
        if (req.method !== "GET") return writeJson(res, 405, { error: "GET only" });
        const q = queryOf(req);
        const id = q.get("id");
        if (!id) return writeJson(res, 400, { error: "id required" });
        const root = q.get("root") || defaultSessionRoot();
        writeJson(res, 200, await inspectById(root, id));
      }),
    },
    {
      kind: "exact",
      path: `${API_PREFIX}/repair`,
      handler: wrap(async (req, res) => {
        if (!isLoopback(req)) return writeJson(res, 403, { error: "loopback-only" });
        if (req.method !== "POST") return writeJson(res, 405, { error: "POST only" });
        const body = await readJson(req);
        const id = body.id;
        if (typeof id !== "string" || !id) return writeJson(res, 400, { error: "id required" });
        const root = body.root || defaultSessionRoot();
        const entry = await resolveFile(root, id);
        writeJson(res, 200, await repairFile(entry.file, { dryRun: body.apply !== true }));
      }),
    },
    {
      kind: "exact",
      path: `${API_PREFIX}/compact`,
      handler: wrap(async (req, res) => {
        if (!isLoopback(req)) return writeJson(res, 403, { error: "loopback-only" });
        if (req.method !== "POST") return writeJson(res, 405, { error: "POST only" });
        const body = await readJson(req);
        const id = body.id;
        const keepLastTurns = Number(body.keepLastTurns);
        if (typeof id !== "string" || !id) return writeJson(res, 400, { error: "id required" });
        if (!Number.isSafeInteger(keepLastTurns) || keepLastTurns < 1) {
          return writeJson(res, 400, { error: "keepLastTurns must be an integer >= 1" });
        }
        const root = body.root || defaultSessionRoot();
        const entry = await resolveFile(root, id);
        writeJson(res, 200, await applyCompact({
          file: entry.file,
          keepLastTurns,
          dryRun: body.apply !== true,
        }));
      }),
    },
    {
      kind: "exact",
      path: `${API_PREFIX}/export`,
      handler: wrap(async (req, res) => {
        if (!isLoopback(req)) return writeJson(res, 403, { error: "loopback-only" });
        if (req.method !== "GET") return writeJson(res, 405, { error: "GET only" });
        const q = queryOf(req);
        const id = q.get("id");
        if (!id) return writeJson(res, 400, { error: "id required" });
        const root = q.get("root") || defaultSessionRoot();
        const entry = await resolveFile(root, id);
        const decoded = decodeSessionBuffer(await readFile(entry.file));
        const exported = exportSession(decoded, { redact: q.get("redact") !== "0" });
        writeJson(res, 200, {
          id: decoded.header?.id ?? id,
          bytes: Buffer.byteLength(exported.text),
          redact: q.get("redact") !== "0",
          text: exported.text,
        });
      }),
    },
  ];
}
