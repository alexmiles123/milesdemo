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
