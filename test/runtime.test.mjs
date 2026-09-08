import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTS_NATIVE_SEQ_RANGES, SESSION_MODULE_PATH } from "../src/runtime.mjs";
import { KNOWN_SESSION_EVENT_TYPES } from "../src/known-types.mjs";

test("installed 0.1.2-rc.1 session runtime exposes decodeSeqRanges", async (t) => {
  if (!SESSION_MODULE_PATH) {
    t.skip("official dsh-session not resolvable");
    return;
  }
  const mod = await import(SESSION_MODULE_PATH);
  assert.equal(typeof mod.decodeSeqRanges, "function");
  assert.equal(SUPPORTS_NATIVE_SEQ_RANGES, true);
  assert.ok(KNOWN_SESSION_EVENT_TYPES.has("model/selection"));
  assert.deepEqual(mod.decodeSeqRanges([[0, 2], 5]), [0, 1, 2, 5]);
  assert.equal(mod.SESSION_FORMAT_VERSION, 0);
});
