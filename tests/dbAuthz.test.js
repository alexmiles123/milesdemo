import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeRequest } from "../api/_lib/dbAuthz.js";

const SELF = "00000000-0000-0000-0000-00000000aaaa";
const OTHER = "00000000-0000-0000-0000-00000000bbbb";

function newUsp(initial = "") {
  return new URLSearchParams(initial);
}

test("admin: full read + write on every policy table", () => {
  for (const tbl of ["projects", "audit_log", "integrations", "tasks"]) {
    const r = authorizeRequest({
      table: tbl, method: "GET", role: "admin", csmId: null, bodyParsed: null, usp: newUsp(),
    });
    assert.ok(r.ok, `admin should read ${tbl}: ${r.message}`);
  }
  // admin write on projects
  const w = authorizeRequest({
    table: "projects", method: "POST", role: "admin", csmId: null,
    bodyParsed: { name: "X", csm_id: OTHER }, usp: newUsp(),
  });
  assert.ok(w.ok);
});

test("admin: cannot mutate audit_log (read-only by policy)", () => {
  const r = authorizeRequest({
    table: "audit_log", method: "POST", role: "admin", csmId: null, bodyParsed: { x: 1 }, usp: newUsp(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("viewer: GET allowed, write rejected", () => {
  const ok = authorizeRequest({ table: "projects", method: "GET", role: "viewer", csmId: null, bodyParsed: null, usp: newUsp() });
  assert.ok(ok.ok);
  const bad = authorizeRequest({ table: "projects", method: "PATCH", role: "viewer", csmId: null, bodyParsed: { name: "X" }, usp: newUsp("id=eq.1") });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 403);
});

test("csm POST: auto-fills csm_id when omitted", () => {
  const body = { name: "Acme" };
  const r = authorizeRequest({ table: "projects", method: "POST", role: "csm", csmId: SELF, bodyParsed: body, usp: newUsp() });
  assert.ok(r.ok);
  assert.equal(body.csm_id, SELF);
});

test("csm POST: rejects mismatched csm_id", () => {
  const r = authorizeRequest({
    table: "projects", method: "POST", role: "csm", csmId: SELF,
    bodyParsed: { name: "Acme", csm_id: OTHER }, usp: newUsp(),
  });
  assert.equal(r.ok, false);
});

test("csm PATCH: forces csm_id filter and forbids reassign", () => {
  const usp = newUsp("id=eq.99&csm_id=eq." + OTHER);
  const r = authorizeRequest({
    table: "projects", method: "PATCH", role: "csm", csmId: SELF,
    bodyParsed: { name: "Renamed" }, usp,
  });
  assert.ok(r.ok);
  // The caller-provided csm_id filter must be replaced with our scoping one.
  const csmFilters = usp.getAll("csm_id");
  assert.deepEqual(csmFilters, ["eq." + SELF]);

  // Attempting to reassign csm_id in body is rejected.
  const r2 = authorizeRequest({
    table: "projects", method: "PATCH", role: "csm", csmId: SELF,
    bodyParsed: { csm_id: OTHER }, usp: newUsp("id=eq.99"),
  });
  assert.equal(r2.ok, false);
});

test("csm DELETE: scoped to csm_id even when caller omits filter", () => {
  const usp = newUsp("id=eq.42");
  const r = authorizeRequest({
    table: "customer_interactions", method: "DELETE", role: "csm", csmId: SELF,
    bodyParsed: null, usp,
  });
  assert.ok(r.ok);
  assert.equal(usp.get("csm_id"), "eq." + SELF);
});

test("csm without csm_id link: writes rejected", () => {
  const r = authorizeRequest({
    table: "projects", method: "POST", role: "csm", csmId: null,
    bodyParsed: { name: "X" }, usp: newUsp(),
  });
  assert.equal(r.ok, false);
});

test("unknown table: rejected by default-deny", () => {
  const r = authorizeRequest({
    table: "definitely_not_a_table", method: "GET", role: "admin",
    csmId: null, bodyParsed: null, usp: newUsp(),
  });
  assert.equal(r.ok, false);
});
