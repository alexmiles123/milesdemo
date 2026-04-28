// Server-side input validation for the db proxy.
//
// The browser already runs src/lib/validation.js for fast feedback, but
// every public-facing API treats client validation as advisory. These
// validators run on the server and reject malformed payloads before they
// reach Supabase. Goals are pragmatic, not exhaustive:
//   • cap string lengths (defense against payload-bloat DoS)
//   • coerce/check numeric ranges (catches "abc" being sent as ARR)
//   • enforce enum membership for stage/health/priority/role (the DB
//     CHECK constraints catch these too, but failing here keeps the
//     error message clean and avoids burning a Supabase round-trip)
//
// Per-table validators take a row object and return either { ok: true }
// or { ok: false, error: "<message>" }. PATCH requests go through the
// same validator — only fields present on the row are checked, so
// partial updates work without reposting the whole record.
//
// Tables not in TABLE_VALIDATORS are accepted as-is. That's deliberate —
// we'd rather miss validation on a low-value table than block writes the
// frontend already needs to make.

const STAGES = new Set(["Kickoff", "Discovery", "Implementation", "Testing & QA", "Go-Live Prep", "Go-Live"]);
const HEALTHS = new Set(["green", "yellow", "red"]);
const PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const ASSIGNMENT_ROLES = new Set(["primary", "secondary", "observer"]);
const CSM_ROLE_KEYS = new Set(["admin", "csm", "user"]);
const TASK_STATUS = new Set(["upcoming", "in_progress", "blocked", "complete", "skipped"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_NAME = 200;
const MAX_DESC = 2000;
const MAX_NOTES = 4000;
const MAX_URL = 500;

function bad(error) { return { ok: false, error }; }
function ok() { return { ok: true }; }

function checkString(v, field, max) {
  if (v == null) return null;
  if (typeof v !== "string") return bad(field + " must be a string.");
  if (v.length > max) return bad(field + " is too long (max " + max + ").");
  return null;
}

function checkNumber(v, field, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n) || !Number.isFinite(n)) return bad(field + " must be a number.");
  if (integer && !Number.isInteger(n)) return bad(field + " must be an integer.");
  if (n < min) return bad(field + " must be at least " + min + ".");
  if (n > max) return bad(field + " must be at most " + max + ".");
  return null;
}

function checkDate(v, field) {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return bad(field + " must be an ISO date string.");
  if (Number.isNaN(new Date(v).getTime())) return bad(field + " is not a valid date.");
  return null;
}

function checkEnum(v, field, set) {
  if (v == null || v === "") return null;
  if (!set.has(v)) return bad(field + " has an invalid value.");
  return null;
}

const csms = (row) => {
  return checkString(row.name, "name", MAX_NAME)
      || (row.name != null && !String(row.name).trim() ? bad("name is required.") : null)
      || (row.email != null && row.email !== "" && !EMAIL_RE.test(String(row.email)) ? bad("Invalid email address.") : null)
      || checkString(row.email, "email", MAX_NAME)
      || checkString(row.role, "role", 60)
      || ok();
};

const csm_roles = (row) => {
  return checkString(row.role_key, "role_key", 60)
      || (row.role_key != null && !CSM_ROLE_KEYS.has(row.role_key) && !/^[a-z_]{1,60}$/.test(row.role_key) ? bad("role_key has an invalid value.") : null)
      || checkString(row.label, "label", MAX_NAME)
      || ok();
};

const csm_assignments = (row) => {
  return checkEnum(row.role, "role", ASSIGNMENT_ROLES)
      || checkNumber(row.allocation_pct, "allocation_pct", { min: 0, max: 100 })
      || checkDate(row.start_date, "start_date")
      || checkDate(row.end_date, "end_date")
      || (row.start_date && row.end_date && row.end_date < row.start_date ? bad("end_date is before start_date.") : null)
      || ok();
};

const projects = (row) => {
  return checkString(row.name, "name", MAX_NAME)
      || (row.name != null && !String(row.name).trim() ? bad("name is required.") : null)
      || checkEnum(row.stage, "stage", STAGES)
      || checkEnum(row.health, "health", HEALTHS)
      || checkNumber(row.arr, "arr", { min: 0, max: 1e12 })
      || checkNumber(row.completion_pct, "completion_pct", { min: 0, max: 100 })
      || checkDate(row.target_date, "target_date")
      || checkDate(row.start_date, "start_date")
      || checkString(row.notes, "notes", MAX_NOTES)
      || ok();
};

const tasks = (row) => {
  return checkString(row.name, "name", MAX_NAME)
      || (row.name != null && !String(row.name).trim() ? bad("name is required.") : null)
      || checkEnum(row.priority, "priority", PRIORITIES)
      || checkEnum(row.status, "status", TASK_STATUS)
      || checkDate(row.proj_date, "proj_date")
      || checkNumber(row.estimated_hours, "estimated_hours", { min: 0, max: 1e6 })
      || checkString(row.notes, "notes", MAX_NOTES)
      || ok();
};

const customers = (row) => {
  return checkString(row.name, "name", MAX_NAME)
      || (row.name != null && !String(row.name).trim() ? bad("name is required.") : null)
      || checkString(row.notes, "notes", MAX_NOTES)
      || ok();
};

const customer_interactions = (row) => {
  return checkString(row.subject, "subject", MAX_NAME)
      || checkString(row.body, "body", MAX_DESC)
      || checkDate(row.occurred_at, "occurred_at")
      || ok();
};

const capacity_entries = (row) => {
  return checkNumber(row.hours, "hours", { min: 0, max: 24 * 31 })
      || checkDate(row.entry_date, "entry_date")
      || ok();
};

const project_commitments = (row) => {
  return checkNumber(row.committed_hours, "committed_hours", { min: 0, max: 24 * 366 })
      || checkDate(row.start_date, "start_date")
      || checkDate(row.end_date, "end_date")
      || (row.start_date && row.end_date && row.end_date < row.start_date ? bad("end_date is before start_date.") : null)
      || ok();
};

const integrations = (row) => {
  return checkString(row.name, "name", MAX_NAME)
      || checkString(row.kind, "kind", 60)
      || checkString(row.base_url, "base_url", MAX_URL)
      || ok();
};

const notification_rules = (row) => {
  return checkString(row.name, "name", MAX_NAME)
      || checkString(row.event, "event", 80)
      || ok();
};

const TABLE_VALIDATORS = {
  csms, csm_roles, csm_assignments,
  projects, tasks,
  customers, customer_interactions,
  capacity_entries, project_commitments,
  integrations, notification_rules,
};

const MAX_PAYLOAD_BYTES = 256 * 1024;

export function validateWrite(table, body) {
  const fn = TABLE_VALIDATORS[table];
  if (!fn) return ok();
  if (body == null) return ok();

  // PostgREST accepts either an object or an array of objects.
  const rows = Array.isArray(body) ? body : [body];
  if (rows.length > 500) return bad("Too many rows in a single request (max 500).");

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r == null || typeof r !== "object") return bad("Row " + i + " is not an object.");
    const result = fn(r);
    if (result && result.ok === false) {
      return bad(rows.length > 1 ? "Row " + i + ": " + result.error : result.error);
    }
  }
  return ok();
}

export function checkPayloadSize(rawText) {
  if (typeof rawText === "string" && rawText.length > MAX_PAYLOAD_BYTES) {
    return bad("Request body too large.");
  }
  return ok();
}
