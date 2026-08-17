import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("plugin/index.mjs imports without throwing", async () => {
  const mod = await import("../plugin/index.mjs");
  assert.equal(mod.name, "session-surgeon");
  assert.deepEqual(mod.inject, ["tools"]);
  assert.equal(typeof mod.apply, "function");
});

test("package.json keeps @deepseek-ai/* out of dependencies", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.ok(pkg.peerDependencies["@deepseek-ai/dsh-tools"]);
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  assert.ok(pkg.exports["."].includes("plugin/index.mjs"));
  assert.equal(pkg.exports["./client"], "./plugin/client.js");
});

test("client bundle registers and exposes settingsCopy through its factory", async () => {
  const source = await readFile(join(ROOT, "plugin/client.js"), "utf8");
  let handoff;
  const context = {
    window: {
      __ModuleLoader__: {
        load(value) {
          handoff = value;
        },
      },
    },
  };

  vm.runInNewContext(source, context, { filename: "plugin/client.js" });
  assert.equal(handoff.id, "dsh-session-surgeon");

  const mod = handoff.factory(() => {
    throw new Error("client bundle must not import undeclared modules");
  });
  assert.equal(mod.name, "session-surgeon");
  assert.deepEqual(Array.from(mod.inject), ["sessions"]);
  assert.equal(typeof mod.apply, "function");

  const copy = mod.settingsCopy();
  assert.match(copy.title, /Session surgeon/);
  assert.match(copy.body, /会话医生/);
  assert.match(copy.body, /session_scan/);
});

test("apply registers the three session tools when dsh-tools is resolvable", async () => {
  const registered = [];
  const routes = [];
  const ctx = {
    tools: { register(def) { registered.push(def.name); } },
    webServer: { register(route) { routes.push(route.path); return () => {}; } },
  };
  const { apply } = await import("../plugin/index.mjs");
  await apply(ctx);
  if (registered.length === 0) return;
  assert.deepEqual(registered, ["session_scan", "session_inspect", "session_repair"]);
  assert.ok(routes.some((path) => path.endsWith("/scan")));
});

test("cordis.patch.yml inserts session-surgeon", async () => {
  const yml = await readFile(join(ROOT, "cordis.patch.yml"), "utf8");
  assert.match(yml, /id:\s*session-surgeon/);
  assert.match(yml, /name:\s*dsh-session-surgeon/);
});
