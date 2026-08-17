import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
});

test("cordis.patch.yml inserts session-surgeon", async () => {
  const yml = await readFile(join(ROOT, "cordis.patch.yml"), "utf8");
  assert.match(yml, /id:\s*session-surgeon/);
  assert.match(yml, /name:\s*dsh-session-surgeon/);
});
