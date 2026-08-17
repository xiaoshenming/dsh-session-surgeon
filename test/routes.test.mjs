import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { makeRoutes, API_PREFIX } from "../plugin/routes.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/synthetic");

class FakeRes {
  constructor() {
    this.statusCode = 0;
    this.headers = {};
    this.body = "";
  }
  setHeader(k, v) { this.headers[k] = v; }
  end(text) { this.body = text ?? ""; }
}

class FakeReq extends EventEmitter {
  constructor({ method = "GET", url = "/", remoteAddress = "127.0.0.1", body } = {}) {
    super();
    this.method = method;
    this.url = url;
    this.socket = { remoteAddress };
    this._chunks = body === undefined ? [] : [Buffer.from(body)];
    queueMicrotask(() => {
      for (const chunk of this._chunks) this.emit("data", chunk);
      this.emit("end");
    });
  }
  async *[Symbol.asyncIterator]() {
    for (const chunk of this._chunks) yield chunk;
  }
}

async function invoke(route, reqInit) {
  const req = new FakeReq(reqInit);
  const res = new FakeRes();
  await route.handler(req, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

async function stagedRoot() {
  const root = await mkdtemp(join(tmpdir(), "surgeon-routes-"));
  const dir = join(root, "--tmp--", "session-synthetic-healthy-packed");
  await mkdir(dir, { recursive: true });
  await cp(join(FIX, "healthy-packed.session.jsonl.zstd"), join(dir, "session.jsonl.zstd"));
  return { root, id: "session-synthetic-healthy-packed" };
}

test("makeRoutes exposes the surgeon endpoints", () => {
  const paths = makeRoutes().map((r) => r.path);
  assert.deepEqual(paths, [
    API_PREFIX + "/scan",
    API_PREFIX + "/inspect",
    API_PREFIX + "/repair",
    API_PREFIX + "/compact",
    API_PREFIX + "/export",
    API_PREFIX + "/ui.css",
  ]);
});

test("scan lists staged sessions over loopback GET", async () => {
  const { root } = await stagedRoot();
  const route = makeRoutes().find((r) => r.path.endsWith("/scan"));
  const out = await invoke(route, { url: "/api/session-surgeon/scan?root=" + encodeURIComponent(root) });
  assert.equal(out.status, 200);
  assert.equal(out.json.count, 1);
  assert.ok(out.json.sessions[0].health);
});

test("non-loopback requests are forbidden", async () => {
  const route = makeRoutes().find((r) => r.path.endsWith("/scan"));
  const out = await invoke(route, { url: "/api/session-surgeon/scan", remoteAddress: "10.0.0.8" });
  assert.equal(out.status, 403);
});

test("inspect / repair dry-run / export work on a healthy fixture", async () => {
  const { root, id } = await stagedRoot();
  const routes = Object.fromEntries(makeRoutes().map((r) => [r.path.split("/").at(-1), r]));
  const inspect = await invoke(routes.inspect, {
    url: "/api/session-surgeon/inspect?id=" + id + "&root=" + encodeURIComponent(root),
  });
  assert.equal(inspect.status, 200);
  assert.ok(["ok", "header-ok"].includes(inspect.json.health));

  const repair = await invoke(routes.repair, {
    method: "POST",
    url: "/api/session-surgeon/repair",
    body: JSON.stringify({ id, root, apply: false }),
  });
  assert.equal(repair.status, 200);
  assert.equal(repair.json.wrote, false);

  const exported = await invoke(routes.export, {
    url: "/api/session-surgeon/export?id=" + id + "&root=" + encodeURIComponent(root),
  });
  assert.equal(exported.status, 200);
  assert.match(exported.json.text, /"type":"session"/);
});
