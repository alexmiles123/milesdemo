// Lightweight client-side validators. All network writes MUST still be
// validated server-side — these exist only to give users fast feedback.

const STAGES = ["Kickoff","Discovery","Implementation","Testing & QA","Go-Live Prep","Go-Live"];
const HEALTHS = ["green","yellow","red"];
const PRIORITIES = ["critical","high","medium","low"];
const ASSIGNMENT_ROLES = ["primary","secondary","observer"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function push(errs, field, msg) { errs[field] = msg; }

export function validateCsm(v) {
  const e = {};
  if (!v.name || !v.name.trim()) push(e,"name","Name is required.");
  else if (v.name.length > 120) push(e,"name","Name is too long (max 120).");
  if (v.email && !EMAIL_RE.test(v.email)) push(e,"email","Invalid email address.");
  if (v.role && v.role.length > 60) push(e,"role","Role is too long.");
  return e;
}

export function validateProject(v) {
  const e = {};
  if (!v.name || !v.name.trim()) push(e,"name","Project name is required.");
  else if (v.name.length > 160) push(e,"name","Name is too long.");
  if (v.stage && !STAGES.includes(v.stage)) push(e,"stage","Invalid stage.");
  if (v.health && !HEALTHS.includes(v.health)) push(e,"health","Invalid health.");
  const arr = v.arr === "" || v.arr == null ? 0 : Number(v.arr);
  if (Number.isNaN(arr) || arr < 0) push(e,"arr","ARR must be a non-negative number.");
  const pct = v.completion_pct === "" || v.completion_pct == null ? 0 : Number(v.completion_pct);
  if (Number.isNaN(pct) || pct < 0 || pct > 100) push(e,"completion_pct","Completion must be 0-100.");
  if (v.target_date && Number.isNaN(new Date(v.target_date).getTime())) push(e,"target_date","Invalid date.");
  return e;
}

export function validateAssignment(v) {
  const e = {};
  if (!v.csm_id) push(e,"csm_id","Pick a CSM.");
  if (!v.project_id) push(e,"project_id","Pick an account.");
  if (v.role && !ASSIGNMENT_ROLES.includes(v.role)) push(e,"role","Invalid role.");
  const alloc = v.allocation_pct == null || v.allocation_pct === "" ? 100 : Number(v.allocation_pct);
  if (Number.isNaN(alloc) || alloc < 0 || alloc > 100) push(e,"allocation_pct","Allocation must be 0-100.");
  if (v.start_date && v.end_date && v.end_date < v.start_date) push(e,"end_date","End date is before start date.");
  return e;
}

export function validateTask(v) {
  const e = {};
  if (!v.name || !v.name.trim()) push(e,"name","Task name is required.");
  if (v.priority && !PRIORITIES.includes(v.priority)) push(e,"priority","Invalid priority.");
  if (v.proj_date && Number.isNaN(new Date(v.proj_date).getTime())) push(e,"proj_date","Invalid date.");
  return e;
}

export const hasErrors = (e) => e && Object.keys(e).length > 0;

// Defensive HTML escape for anything we render from server-provided strings
// inside innerHTML-style contexts. React handles this for us in JSX but keep
// the helper for rare exceptions (e.g. piping into contentEditable).
export function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll("\"","&quot;").replaceAll("'","&#39;");
}
