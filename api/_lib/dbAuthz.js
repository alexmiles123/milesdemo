// Per-table authorization policy for the /api/db catch-all proxy.
//
// Before this module existed, the proxy gated only on "are you logged in?",
// which meant a `viewer` could PATCH integrations or DELETE tasks just by
// constructing the right URL. Now every table declares which HTTP methods
// each role may use, plus an optional per-row filter for `csm` users that
// confines mutations to rows they own.
//
// Three roles, in order of privilege:
//   admin   — every table, every method (audit_log writes are still blocked
//             upstream by the trigger in migrations/002).
//   csm     — read everything the dashboard needs; write only their own data.
//   viewer  — read-only access to dashboard tables; no writes anywhere.
//
// `csmFilter` names the column the row-level check binds to. The proxy
// rejects writes from a csm-role caller unless the request body sets
// csmFilter = session.csm_id (or the existing row matches via PostgREST
// query string for PATCH/DELETE).

const READ_METHODS  = new Set(["GET"]);
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

// Compact policy table. "rw" → read+write, "r" → read-only, "-" → no access.
// csmFilter (optional) is the column that must equal session.csm_id for
// writes by a csm-role user.
const POLICY = {
  csms:                   { admin: "rw", csm: "r",  viewer: "r" },
  csm_roles:              { admin: "rw", csm: "r",  viewer: "r" },
  csm_assignments:        { admin: "rw", csm: "rw", viewer: "r", csmFilter: "csm_id" },
  projects:               { admin: "rw", csm: "rw", viewer: "r", csmFilter: "csm_id" },
  tasks:                  { admin: "rw", csm: "rw", viewer: "r" }, // filtered via project_id at app layer
  capacity_entries:       { admin: "rw", csm: "rw", viewer: "r", csmFilter: "csm_id" },
  project_commitments:    { admin: "rw", csm: "rw", viewer: "r", csmFilter: "csm_id" },
  customers:              { admin: "rw", csm: "r",  viewer: "r" },
  customer_interactions:  { admin: "rw", csm: "rw", viewer: "r", csmFilter: "csm_id" },
  integrations:           { admin: "rw", csm: "r",  viewer: "r" },
  sync_runs:              { admin: "rw", csm: "r",  viewer: "r" },
  notification_rules:     { admin: "rw", csm: "r",  viewer: "r" },
  audit_log:              { admin: "r",  csm: "-",  viewer: "-" },
  vw_portfolio:           { admin: "r",  csm: "r",  viewer: "r" },
  vw_csm_scorecard:       { admin: "r",  csm: "r",  viewer: "r" },
  vw_integrations_public: { admin: "r",  csm: "r",  viewer: "r" },
};

function permissions(table, role) {
  const entry = POLICY[table];
  if (!entry) return { read: false, write: false, csmFilter: null };
  const flag = entry[role] || "-";
  return {
    read:      flag === "r" || flag === "rw",
    write:     flag === "rw",
    csmFilter: entry.csmFilter || null,
  };
}

// Returns either { ok: true } if the request is authorized, or
// { ok: false, status, message } describing the rejection.
//
// `bodyParsed` is the JSON-parsed write payload (null on GET/DELETE).
// `usp` is the URLSearchParams the proxy will forward to PostgREST. We may
// mutate it: for `csm`-role mutations we inject a server-side filter so the
// row count actually touched matches the policy, even if the client tried
// to omit it.
export function authorizeRequest({ table, method, role, csmId, bodyParsed, usp }) {
  const perms = permissions(table, role);
  const isRead = READ_METHODS.has(method);
  const isWrite = WRITE_METHODS.has(method);

  if (isRead && !perms.read) {
    return { ok: false, status: 403, message: `Role '${role}' may not read '${table}'.` };
  }
  if (isWrite && !perms.write) {
    return { ok: false, status: 403, message: `Role '${role}' may not modify '${table}'.` };
  }

  // Per-row enforcement only applies to csm-role writes on tables that have
  // an owning csm_id column. admin and viewer either get full access or are
  // already blocked above.
  if (role === "csm" && isWrite && perms.csmFilter) {
    if (!csmId) {
      return { ok: false, status: 403, message: "Your account is not linked to a CSM record." };
    }
    const col = perms.csmFilter;

    // For POST (create) and PUT (replace) the row(s) being written must
    // declare csm_id = session.csm_id. Reject mismatches up front rather
    // than letting PostgREST happily insert an "owned by someone else" row.
    if (method === "POST" || method === "PUT") {
      const rows = Array.isArray(bodyParsed) ? bodyParsed : [bodyParsed];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const rowOwner = row[col];
        if (rowOwner == null) {
          // Not specified — fill it in for them so a malformed client can't
          // accidentally insert an unowned row, which would be invisible to
          // any future csm-scoped read.
          row[col] = csmId;
          continue;
        }
        if (String(rowOwner) !== String(csmId)) {
          return { ok: false, status: 403, message: `You may only ${method === "POST" ? "create" : "replace"} rows owned by your CSM record.` };
        }
      }
    }

    // For PATCH and DELETE the rows are selected via the query string.
    // PostgREST applies all filters with AND, so adding csm_id=eq.<self>
    // narrows the rows the request can touch — even if the original
    // filter was wide open like `id=eq.<x>`.
    if (method === "PATCH" || method === "DELETE") {
      // Strip any caller-provided filter on the owner column so they can't
      // pre-empt our scoping with `csm_id=eq.<otherUuid>`.
      for (const key of Array.from(usp.keys())) {
        if (key === col) usp.delete(key);
      }
      usp.append(col, "eq." + csmId);

      // PATCH: also forbid changing the owner column to someone else.
      if (method === "PATCH" && bodyParsed && typeof bodyParsed === "object") {
        if (col in bodyParsed && String(bodyParsed[col]) !== String(csmId)) {
          return { ok: false, status: 403, message: "You may not reassign rows to a different CSM." };
        }
      }
    }
  }

  return { ok: true };
}

export function tableHasPolicy(table) {
  return Object.prototype.hasOwnProperty.call(POLICY, table);
}
