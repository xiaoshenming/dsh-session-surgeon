import { test } from "node:test";
import assert from "node:assert/strict";
import { exportSession } from "../src/export.mjs";
import { redactString } from "../src/redact.mjs";

test("redactString strips keys, pem, and home paths", () => {
  assert.match(redactString("token sk-abcdefghijklmnop"), /sk-REDACTED/);
  assert.match(
    redactString("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----"),
    /REDACTED_PEM/,
  );
  assert.equal(redactString("file /home/ming/secret.txt"), "file ~/secret.txt");
  assert.match(
    redactString("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"),
    /REDACTED_PEM/,
  );
  assert.match(
    redactString("-----BEGIN ENCRYPTED PRIVATE KEY-----\nabc\n-----END ENCRYPTED PRIVATE KEY-----"),
    /REDACTED_PEM/,
  );
});

test("export redacts by default and keeps text with --no-redact", () => {
  const decoded = {
    header: { version: 0, id: "s", createdAt: 1, cwd: "/home/ming/proj", delegationDepth: 0 },
    events: [
      {
        type: "user/message",
        seq: 0,
        time: 1,
        data: {
          id: "m",
          role: "user",
          source: { kind: "user" },
          content: [{ type: "text", text: "key sk-abcdefghijklmnop at /home/ming/a" }],
        },
      },
    ],
  };
  const redacted = exportSession(decoded, { redact: true });
  assert.match(redacted.text, /sk-REDACTED/);
  assert.match(redacted.text, /~\/a/);
  assert.equal(redacted.text.includes("sk-abcdefghijklmnop"), false);
  const raw = exportSession(decoded, { redact: false });
  assert.match(raw.text, /sk-abcdefghijklmnop/);
});
