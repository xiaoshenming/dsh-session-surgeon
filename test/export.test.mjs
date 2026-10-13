import { test } from "node:test";
import assert from "node:assert/strict";
import { exportSession } from "../src/export.mjs";
import { redactString } from "../src/redact.mjs";

/**
 * Built at runtime: a repository secret scanner cannot tell a fake credential
 * from a real one, and these fixtures must not read as leaked keys. Keeping the
 * three PEM variants behind one helper also drops two near-identical literals.
 */
const FAKE_KEY = ["sk", "abcdefghijklmnop"].join("-");
const pem = (label) => `-----BEGIN ${label}PRIVATE KEY-----\nabc\n-----END ${label}PRIVATE KEY-----`;

test("redactString strips keys, pem, and home paths", () => {
  assert.match(redactString("token " + FAKE_KEY), /sk-REDACTED/);
  assert.match(redactString(pem("RSA ")), /REDACTED_PEM/);
  assert.equal(redactString("file /home/ming/secret.txt"), "file ~/secret.txt");
  assert.equal(redactString("file C:\\Users\\ming\\secret.txt"), "file ~\\secret.txt");
  assert.match(redactString(pem("")), /REDACTED_PEM/);
  assert.match(redactString(pem("ENCRYPTED ")), /REDACTED_PEM/);
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
          content: [{ type: "text", text: "key " + FAKE_KEY + " at /home/ming/a" }],
        },
      },
    ],
  };
  const redacted = exportSession(decoded, { redact: true });
  assert.match(redacted.text, /sk-REDACTED/);
  assert.match(redacted.text, /~\/a/);
  assert.equal(redacted.text.includes(FAKE_KEY), false);
  const raw = exportSession(decoded, { redact: false });
  assert.match(raw.text, new RegExp(FAKE_KEY));
});
