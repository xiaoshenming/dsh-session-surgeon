import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/synthetic/healthy-packed.session.jsonl.zstd");
import { EventEmitter } from "node:events";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { candidateSessionRoots, defaultSessionRoot } from "../src/find.mjs";
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

test("candidate roots put the host roots first and dedupe", async () => {
  await withEnv({ DSH_SESSION_ROOT: undefined, DSH_HOME: undefined }, async () => {
    const candidates = await candidateSessionRoots();
    assert.equal(candidates[0].root, join(homedir(), ".dsh", "sessions"));
    assert.equal(new Set(candidates.map((c) => c.root)).size, candidates.length);
    assert.ok(candidates.every((c) => typeof c.exists === "boolean"));
    assert.ok(candidates.every((c) => typeof c.sessions === "number"));
  });
  await withEnv({ DSH_SESSION_ROOT: undefined, DSH_HOME: join(homedir(), ".dsh") }, async () => {
    const candidates = await candidateSessionRoots();
    // ~/.dsh/sessions arrives once, as the DSH_HOME candidate, not twice.
    const hits = candidates.filter((c) => c.root === join(homedir(), ".dsh", "sessions"));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].label, "DSH_HOME");
  });
  await withEnv({ DSH_SESSION_ROOT: "/tmp/explicit-sessions", DSH_HOME: undefined }, async () => {
    const candidates = await candidateSessionRoots();
    assert.equal(candidates[0].root, "/tmp/explicit-sessions");
    assert.equal(candidates[0].label, "DSH_SESSION_ROOT");
  });
});

test("the roots endpoint lists candidates over loopback GET", async () => {
  const route = makeRoutes().find((r) => r.path.endsWith("/roots"));
  const req = new FakeReq({ url: "/api/session-surgeon/roots" });
  const res = new FakeRes();
  await route.handler(req, res);
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(typeof body.root, "string");
  assert.ok(Array.isArray(body.candidates));
  assert.ok(body.candidates.length >= 1);
});

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

test("discovery is by home shape, not by name, and counts sessions", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "surgeon-home-"));
  const stage = async (rel, id) => {
    const dir = join(fakeHome, rel);
    await mkdir(dir, { recursive: true });
    await cp(FIX, join(dir, "session.jsonl.zstd"));
    return dir;
  };
  await stage(".dsh/sessions/--p--/session-default", "session-default");
  await stage("custom-lib/sessions/--p--/session-inside", "session-inside");   // DSH home, name has no "dsh"
  await mkdir(join(fakeHome, "custom-lib", "profiles"), { recursive: true });  // home marker
  await stage("sessions/--p--/session-bare", "session-bare");                   // bare sessions dir

  await withEnv({ HOME: fakeHome, DSH_SESSION_ROOT: undefined, DSH_HOME: undefined }, async () => {
    const candidates = await candidateSessionRoots();
    const byRoot = new Map(candidates.map((c) => [c.root, c]));
    const defaultRoot = join(fakeHome, ".dsh", "sessions");
    assert.equal(byRoot.get(defaultRoot)?.sessions, 1);
    assert.equal(byRoot.get(join(fakeHome, "custom-lib", "sessions"))?.label, "custom-lib");
    assert.equal(byRoot.get(join(fakeHome, "custom-lib", "sessions"))?.sessions, 1);
    assert.equal(byRoot.get(join(fakeHome, "sessions"))?.sessions, 1);
    assert.equal(new Set(candidates.map((c) => c.root)).size, candidates.length);
  });
});

test("a ~/… root from the picker is expanded and scanned", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "surgeon-tilde-"));
  const dir = join(fakeHome, "sessions", "--p--", "session-tilde");
  await mkdir(dir, { recursive: true });
  await cp(FIX, join(dir, "session.jsonl.zstd"));

  await withEnv({ HOME: fakeHome, DSH_SESSION_ROOT: undefined, DSH_HOME: undefined }, async () => {
    const route = makeRoutes().find((r) => r.path.endsWith("/scan"));
    const req = new FakeReq({ url: "/api/session-surgeon/scan?root=" + encodeURIComponent("~/sessions") });
    const res = new FakeRes();
    await route.handler(req, res);
    const body = JSON.parse(res.body);
    assert.equal(body.root, join(fakeHome, "sessions"));
    assert.equal(body.count, 1);
  });
});
