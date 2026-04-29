import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWrite, checkPayloadSize } from "../api/_lib/validators.js";

test("projects: rejects empty name", () => {
  const r = validateWrite("projects", { name: "" });
  assert.equal(r.ok, false);
  assert.match(r.error, /name is required/);
});

test("projects: rejects out-of-range completion_pct", () => {
  const r = validateWrite("projects", { name: "Acme", completion_pct: 150 });
  assert.equal(r.ok, false);
  assert.match(r.error, /completion_pct/);
});

test("projects: accepts a well-formed row", () => {
  const r = validateWrite("projects", {
    name: "Acme onboarding", stage: "Design", health: "green",
    arr: 100000, completion_pct: 25, target_date: "2026-06-01",
  });
  assert.equal(r.ok, true);
});

test("tasks: rejects invalid priority", () => {
  const r = validateWrite("tasks", { name: "X", priority: "URGENT" });
  assert.equal(r.ok, false);
});

test("csms: rejects malformed email", () => {
  const r = validateWrite("csms", { name: "Pat", email: "not-an-email" });
  assert.equal(r.ok, false);
});

test("csms: accepts blank email (optional)", () => {
  const r = validateWrite("csms", { name: "Pat", email: "" });
  assert.equal(r.ok, true);
});

test("array payloads: surfaces row index on error", () => {
  const r = validateWrite("projects", [
    { name: "Acme", completion_pct: 50 },
    { name: "" },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /Row 1:/);
});

test("array payloads: cap of 500 rows", () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({ name: "p" + i }));
  const r = validateWrite("projects", rows);
  assert.equal(r.ok, false);
  assert.match(r.error, /Too many rows/);
});

test("unknown table: passes through", () => {
  const r = validateWrite("not_a_real_table", { whatever: 1 });
  assert.equal(r.ok, true);
});

test("checkPayloadSize: rejects oversized body", () => {
  const big = "x".repeat(300_000);
  const r = checkPayloadSize(big);
  assert.equal(r.ok, false);
});

test("checkPayloadSize: accepts normal body", () => {
  const r = checkPayloadSize("{\"name\":\"Acme\"}");
  assert.equal(r.ok, true);
});
