import { test, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

before(() => {
  process.env.APP_JWT_SECRET = crypto.randomBytes(32).toString("base64");
});

const authPromise = import("../api/_lib/auth.js");

function fakeReq({ method = "GET", cookie = "", csrfHeader = "", auth = "" } = {}) {
  return {
    method,
    headers: {
      cookie,
      ...(csrfHeader ? { "x-csrf-token": csrfHeader } : {}),
      ...(auth ? { authorization: auth } : {}),
    },
  };
}

test("signSession + verifySession round-trip", async () => {
  const { signSession, verifySession } = await authPromise;
  const token = await signSession({ user: "alex", role: "admin" });
  const claims = await verifySession(token, "access");
  assert.equal(claims.user, "alex");
  assert.equal(claims.role, "admin");
  assert.equal(claims.typ, "access");
});

test("verifySession rejects refresh token when access is expected", async () => {
  const { signRefresh, verifySession } = await authPromise;
  const token = await signRefresh({ user: "alex", role: "admin" });
  assert.equal(await verifySession(token, "access"), null);
  // Same token does verify when refresh is expected.
  const claims = await verifySession(token, "refresh");
  assert.equal(claims?.typ, "refresh");
});

test("checkCsrf: GET without csrf passes (safe method)", async () => {
  const { checkCsrf } = await authPromise;
  assert.equal(checkCsrf(fakeReq({ method: "GET" })), true);
});

test("checkCsrf: POST without cookie auth passes (bearer caller)", async () => {
  const { checkCsrf } = await authPromise;
  assert.equal(checkCsrf(fakeReq({ method: "POST", auth: "Bearer x" })), true);
});

test("checkCsrf: POST with cookie auth requires matching header", async () => {
  const { checkCsrf } = await authPromise;
  // Cookie set, header missing → fail.
  assert.equal(checkCsrf(fakeReq({
    method: "POST",
    cookie: "monument.session=abc; monument.csrf=xyz",
  })), false);
  // Cookie + matching header → pass.
  assert.equal(checkCsrf(fakeReq({
    method: "POST",
    cookie: "monument.session=abc; monument.csrf=xyz",
    csrfHeader: "xyz",
  })), true);
  // Cookie + mismatched header → fail.
  assert.equal(checkCsrf(fakeReq({
    method: "POST",
    cookie: "monument.session=abc; monument.csrf=xyz",
    csrfHeader: "different",
  })), false);
});

test("readCookie: parses values", async () => {
  const { readCookie } = await authPromise;
  const req = fakeReq({ cookie: "a=1; b=hello%20world; c=" });
  assert.equal(readCookie(req, "a"), "1");
  assert.equal(readCookie(req, "b"), "hello world");
  assert.equal(readCookie(req, "missing"), null);
});

test("issueSessionCookies: sets HttpOnly Secure access + readable csrf", async () => {
  const { issueSessionCookies } = await authPromise;
  const setCalls = [];
  const res = {
    getHeader: () => undefined,
    setHeader: (_n, v) => { setCalls.push(v); },
  };
  const csrf = issueSessionCookies(res, { accessToken: "AAA", refreshToken: "RRR" });
  assert.ok(csrf && csrf.length >= 32);
  // Flatten everything we appended.
  const flat = setCalls.flat().join("\n");
  assert.match(flat, /monument\.session=AAA/);
  assert.match(flat, /HttpOnly/);
  assert.match(flat, /Secure/);
  assert.match(flat, /SameSite=Strict/);
  assert.match(flat, /monument\.refresh=RRR/);
  assert.match(flat, /monument\.csrf=/);
});
