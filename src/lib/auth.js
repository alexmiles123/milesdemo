// Session token storage for the Monument frontend.
//
// The JWT returned by /api/auth/login is kept in localStorage so refreshes
// survive a tab reload. Every API call attaches it as a bearer token. If the
// server rejects the token (expired, revoked, or missing), the app clears
// storage and returns to the login screen.

const KEY = "monument.session";

export function getToken() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setToken(token) {
  try { localStorage.setItem(KEY, token); } catch { /* ignore */ }
}

export function clearToken() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export async function login(username, password) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const body = await res.json();
  if (!body.token) throw new Error("Login succeeded but no token was issued.");
  setToken(body.token);
  return body;
}

export function logout() { clearToken(); }

// Decode the JWT payload **without verifying the signature**. The browser is
// not the security boundary — every API call still goes through requireAuth()
// on the server, which rejects forged tokens. We only need the payload here
// to drive UI gating (role-based tab visibility, etc.) and to show "Signed in
// as alex" in the corner. If the token is missing or malformed, returns null.
export function getSession() {
  const token = getToken();
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "===".slice((payload.length + 3) % 4);
    return JSON.parse(atob(padded));
  } catch { return null; }
}

export function getRole() {
  const s = getSession();
  return s?.role || null;
}
