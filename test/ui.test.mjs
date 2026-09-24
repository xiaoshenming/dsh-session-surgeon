import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("sidebar-collapse CSS matches dsh-better-sidebar's body attribute (#4/#5)", async () => {
  const css = await readFile(join(ROOT, "plugin", "ui.css"), "utf8");
  assert.ok(css.includes("body[data-dsh-sidebar-collapsed]"));
  assert.ok(!css.includes("[data-dsh-frame][data-sidebar-collapsed]"));
});

test("every session-scoped panel request names the picked root", async () => {
  const client = await readFile(join(ROOT, "plugin", "client.js"), "utf8");
  for (const endpoint of ["/scan", "/transcript", "/inspect", "/export"]) {
    assert.ok(
      client.includes('withRoot("' + endpoint + '"'),
      endpoint + " must be requested through withRoot()",
    );
  }
  // The two repair entry points POST their root in the body.
  const repairPosts = client.match(/body: JSON\.stringify\(\{ id[^}]*root: state\.root[^}]*\}\)/g) || [];
  assert.equal(repairPosts.length, 2);
  assert.ok(!client.includes('"/inspect?id="'), "raw inspect URL without a root must not come back");
  assert.ok(!client.includes('"/transcript?id="'), "raw transcript URL without a root must not come back");
});
