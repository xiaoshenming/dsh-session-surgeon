import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("check-no-secrets.sh exits 0", () => {
  const r = spawnSync("bash", [join(ROOT, "scripts/check-no-secrets.sh")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});
