import { PHASE_ORDER } from "../lib/theme.js";

export const PROJECT_IMPORT_SPEC = {
  table: "projects",
  auditAction: "project.import",
  templateName: "projects-import-template.xlsx",
  templateSample: [
    ["Acme Implementation", "Acme Corp", "Alex Miles", "Kickoff", "On Track", 120000, 0, "2026-09-30"],
    ["Globex Rollout", "Globex", "Morgan Wu", "Discovery", "At Risk", 80000, 25, "2026-07-15"],
  ],
  defaults: { stage: "Kickoff", health: "green", completion_pct: 0, arr: 0 },
  columns: [
    { key: "name", aliases: ["name", "project name", "project"], required: true },
    { key: "customer", aliases: ["customer", "account", "customer name"] },
    {
      key: "csm_id",
      aliases: ["csm", "owner", "csm name"],
      lookup: (val, ctx) => {
        const csm = ctx.csms.find(c => c.name.toLowerCase() === val.toLowerCase());
        return csm ? csm.id : null;
      },
      requiredMsg: "CSM name not found — create the CSM first",
    },
    { key: "stage", aliases: ["stage", "phase"], parse: "enum", values: PHASE_ORDER },
    { key: "health", aliases: ["health", "status"], parse: "healthEnum" },
    { key: "arr", aliases: ["arr", "annual recurring revenue", "revenue"], parse: "number" },
    { key: "completion_pct", aliases: ["completion %", "completion_pct", "completion", "done %"], parse: "number" },
    { key: "target_date", aliases: ["target date", "target", "go-live", "target go-live"], parse: "date" },
    { key: "notes", aliases: ["notes"] },
  ],
  // Resolve customer text → customer_id from the import context. Unknown
  // customers are passed through with customer_id=null so the row still
  // imports; the user can backfill the FK later from the Customers tab.
  transformRow: (r, ctx) => {
    const out = { ...r, start_date: new Date().toISOString().slice(0, 10) };
    if (r.customer && ctx?.customers) {
      const match = ctx.customers.find(c => (c.name || "").toLowerCase() === r.customer.toLowerCase());
      if (match) out.customer_id = match.id;
    }
    return out;
  },
};

// Task import is scoped to one project — the row's project_id is injected
// via transformRow from ctx.project, so the spreadsheet never has to carry it.
const PRIORITY_OPTIONS = ["critical", "high", "medium", "low"];
const STATUS_OPTIONS   = ["complete", "upcoming", "late"];

export const TASK_IMPORT_SPEC = {
  table: "tasks",
  auditAction: "task.import",
  templateName: "tasks-import-template.xlsx",
  templateSample: [
    ["Kickoff meeting",       "Kickoff",        "high",   "upcoming", "2026-05-01", "Jordan Lee", 4, "Introduce the team"],
    ["Environment access",    "Discovery",      "medium", "upcoming", "2026-05-10", "IT Ops",     2, ""],
    ["Data migration script", "Implementation", "high",   "upcoming", "2026-06-05", "Alex Miles", 8, "Pulls from legacy DB"],
    ["UAT sign-off",          "Testing & QA",   "critical","upcoming","2026-07-01", "Customer",   3, "Blocks go-live"],
  ],
  defaults: { phase: "Kickoff", priority: "medium", status: "upcoming" },
  columns: [
    { key: "name",            aliases: ["task", "name", "task name"], required: true },
    { key: "phase",           aliases: ["phase", "milestone", "stage"], parse: "enum", values: PHASE_ORDER },
    { key: "priority",        aliases: ["priority"], parse: "enum", values: PRIORITY_OPTIONS },
    { key: "status",          aliases: ["status"], parse: "enum", values: STATUS_OPTIONS },
    { key: "proj_date",       aliases: ["due date", "target date", "projected date", "proj_date"], parse: "date" },
    { key: "assignee_name",   aliases: ["assignee", "owner", "assigned to"] },
    { key: "estimated_hours", aliases: ["estimated hours", "hours", "est hours", "estimated_hours"], parse: "number" },
    { key: "notes",           aliases: ["notes", "description"] },
  ],
  transformRow: (r, ctx) => ({ ...r, project_id: ctx.project.id }),
};
