import { test, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

before(() => {
  // 32 bytes of random material as base64. Tests must run after this is set
  // because pii.js reads the env var lazily.
  process.env.PII_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
});

const piiPromise = import("../api/_lib/pii.js");

test("encrypt → decrypt round-trip", async () => {
  const { encryptPii, decryptPii } = await piiPromise;
  const ct = encryptPii("alex@example.com");
  assert.notEqual(ct, "alex@example.com");
  assert.equal(decryptPii(ct), "alex@example.com");
});

test("encrypt produces fresh nonce per call", async () => {
  const { encryptPii } = await piiPromise;
  const a = encryptPii("hello");
  const b = encryptPii("hello");
  assert.notEqual(a, b);
});

test("decrypt rejects tampered ciphertext", async () => {
  const { encryptPii, decryptPii } = await piiPromise;
  const ct = encryptPii("secret");
  // Flip one byte after the nonce/tag prefix.
  const buf = Buffer.from(ct, "base64");
  buf[30] ^= 0x01;
  const tampered = buf.toString("base64");
  assert.throws(() => decryptPii(tampered));
});

test("redactRecord: replaces strings, nulls others, leaves untouched", async () => {
  const { redactRecord } = await piiPromise;
  const { row, touched } = redactRecord(
    { name: "Pat", email: "p@x.com", age: 42, missing: undefined },
    ["email", "age", "missing"],
  );
  assert.equal(row.name, "Pat");
  assert.equal(row.email, "[redacted]");
  assert.equal(row.age, null);
  assert.deepEqual(touched, { email: true, age: true });
});
