// Session management for the Monument frontend.
//
// The access JWT lives in an HttpOnly cookie that JavaScript cannot read,
// so we never touch localStorage for auth. Three things travel with every
// authed request:
//   • monument.session  — HttpOnly access cookie (browser sends automatically
//                         when fetch is called with credentials: "include")
//   • monument.refresh  — HttpOnly refresh cookie (only sent to /api/auth/*)
//   • monument.csrf     — readable cookie; we echo its value as X-CSRF-Token
//                         on every state-changing request
//
// The session info we need for UI gating (user, role, must_reset) comes from
// /api/auth/me rather than client-side JWT decoding.

const STORAGE_KEY = "monument.session";   // legacy bearer fallback (cleared on first cookie login)
const SESSION_INFO_KEY = "monument.session.info"; // { user, role, must_reset } cached for fast first paint

function readCookieValue(name) {
  if (typeof document === "undefined") return null;
  const target = name + "=";
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(target)) {
      try { return decodeURIComponent(part.slice(target.length)); } catch { return part.slice(target.length); }
    }
  }
  return null;
}

export function getCsrfToken() {
  return readCookieValue("monument.csrf");
}

// Bearer token may still exist in localStorage from a pre-cookie session.
// New logins clear it. Kept around so the same tab keeps working through
// the deploy that introduces cookie auth.
export function getLegacyToken() {
  try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
}
function clearLegacyToken() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

function cacheSessionInfo(info) {
  try { localStorage.setItem(SESSION_INFO_KEY, JSON.stringify(info)); } catch { /* ignore */ }
}
function clearSessionInfo() {
  try { localStorage.removeItem(SESSION_INFO_KEY); } catch { /* ignore */ }
}
export function getCachedSession() {
  try {
    const raw = localStorage.getItem(SESSION_INFO_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Wraps fetch with credentials and CSRF. Use this everywhere instead of the
// raw global fetch so cookies and CSRF are handled consistently.
export async function authedFetch(url, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  const method = (init.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const csrf = getCsrfToken();
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  // Legacy bearer fallback — only attached if a stored token still exists
  // and we don't have a cookie session yet.
  const legacy = getLegacyToken();
  if (legacy && !getCsrfToken()) headers.set("Authorization", "Bearer " + legacy);
  return fetch(url, { ...init, headers, credentials: "include" });
}

export async function login(username, password) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const body = await res.json();
  // Cookies are set by the server; nothing to stash here. We do drop any
  // legacy bearer token so subsequent calls use the cookie path.
  clearLegacyToken();
  cacheSessionInfo({ user: body.user, role: body.role, must_reset: body.must_reset });
  return body;
}

export async function refreshSession() {
  const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (body) cacheSessionInfo({ user: body.user, role: body.role, must_reset: body.must_reset });
  return body;
}

export async function fetchMe() {
  const res = await authedFetch("/api/auth/me");
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (body) cacheSessionInfo({ user: body.user, role: body.role, must_reset: body.must_reset });
  return body;
}

export async function logout() {
  try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } catch { /* ignore */ }
  clearLegacyToken();
  clearSessionInfo();
}

// ─── Backward-compat shims ────────────────────────────────────────────────
// Older code in App.jsx still calls getToken / clearToken / getSession /
// getRole. We keep the names so the diff stays focused — getToken returns
// the legacy bearer if present so the bearer fallback still works for any
// code path that hasn't migrated to authedFetch yet. getSession reads the
// cached /me payload instead of decoding the (now HttpOnly) JWT.

export function getToken() { return getLegacyToken(); }
export function clearToken() { clearLegacyToken(); clearSessionInfo(); }
export function getSession() { return getCachedSession(); }
export function getRole() { return getCachedSession()?.role || null; }
