import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSessionRoot } from "../src/find.mjs";
import { makeRoutes } from "../plugin/routes.mjs";

async function withEnv(env, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("session root follows DSH_SESSION_ROOT, then DSH_HOME, then ~/.dsh", async () => {
  await withEnv({ DSH_SESSION_ROOT: undefined, DSH_HOME: undefined }, () => {
    assert.equal(defaultSessionRoot(), join(homedir(), ".dsh", "sessions"));
  });
  await withEnv({ DSH_SESSION_ROOT: undefined, DSH_HOME: "/tmp/surgeon-dev-home" }, () => {
    assert.equal(defaultSessionRoot(), "/tmp/surgeon-dev-home/sessions");
  });
  await withEnv({ DSH_SESSION_ROOT: "/tmp/explicit-sessions", DSH_HOME: "/tmp/surgeon-dev-home" }, () => {
    assert.equal(defaultSessionRoot(), "/tmp/explicit-sessions");
  });
});

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
  constructor({ method = "GET", url = "/", remoteAddress = "127.0.0.1" } = {}) {
    super();
    this.method = method;
    this.url = url;
    this.socket = { remoteAddress };
  }
}

async function scanViaRoute() {
  const route = makeRoutes().find((r) => r.path.endsWith("/scan"));
  const req = new FakeReq({ url: "/api/session-surgeon/scan" });
  const res = new FakeRes();
  await route.handler(req, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

test("scan on a missing root answers with the root and the reason, not a bare 500", async () => {
  const missing = join(await mkdtemp(join(tmpdir(), "surgeon-missing-")), "nope");
  await withEnv({ DSH_SESSION_ROOT: missing }, async () => {
    const out = await scanViaRoute();
    assert.equal(out.status, 200);
    assert.equal(out.json.root, missing);
    assert.equal(out.json.count, 0);
    assert.deepEqual(out.json.sessions, []);
    assert.match(out.json.error, /cannot read session root/);
  });
});
