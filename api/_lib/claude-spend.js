// Claude API spend cap.
//
// Hardens /api/claude against runaway billing. Two checks before each call:
//   • monthly cap across all users
//   • per-user cap for the current calendar month
//
// After a successful call we record actual usage so the next request sees an
// up-to-date balance. If the budget table or usage table doesn't exist yet
// (migration 012 not applied), the gate fails open so the feature still
// works in dev — but a warning lands in the server log so we notice.
//
// Pricing is Sonnet-4-class default rates in USD cents per 1M tokens. If we
// ever swap models, update PRICING here rather than scattering literals.

import { sbGet, sbInsert, sbConfigured } from "./sb.js";

const PRICING = {
  // cents per 1,000,000 tokens
  "claude-sonnet-4-6":   { input: 300,  output: 1500 },
  "claude-opus-4-7":     { input: 1500, output: 7500 },
  "claude-haiku-4-5":    { input: 80,   output: 400 },
  default:               { input: 300,  output: 1500 },
};

let cachedBudget = null;
let cachedAt = 0;
const BUDGET_TTL_MS = 60_000;

export function estimateCostCents(model, inputTokens, outputTokens) {
  const p = PRICING[model] || PRICING.default;
  const ic = (inputTokens  || 0) * p.input  / 1_000_000;
  const oc = (outputTokens || 0) * p.output / 1_000_000;
  return Math.ceil(ic + oc);
}

async function getBudget() {
  const now = Date.now();
  if (cachedBudget && (now - cachedAt) < BUDGET_TTL_MS) return cachedBudget;
  if (!sbConfigured()) return null;
  try {
    const rows = await sbGet("claude_budget", { id: "eq.1", limit: "1" });
    cachedBudget = (rows && rows[0]) || null;
    cachedAt = now;
    return cachedBudget;
  } catch (_) {
    return null;
  }
}

export function invalidateBudgetCache() { cachedBudget = null; cachedAt = 0; }

function monthStartIso() {
  const d = new Date();
  d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function spentThisMonth(actor) {
  if (!sbConfigured()) return { total: 0, perActor: 0 };
  const since = monthStartIso();
  try {
    const rows = await sbGet("claude_usage", {
      occurred_at: "gte." + since,
      select: "actor,cost_usd_cents",
    });
    let total = 0, perActor = 0;
    for (const r of rows || []) {
      total += r.cost_usd_cents || 0;
      if (actor && r.actor === actor) perActor += r.cost_usd_cents || 0;
    }
    return { total, perActor };
  } catch (_) {
    return { total: 0, perActor: 0 };
  }
}

export async function checkSpendCap(session) {
  const budget = await getBudget();
  if (!budget || budget.enabled === false) return { ok: true };
  const actor = String(session?.user || "unknown");
  const { total, perActor } = await spentThisMonth(actor);
  if (budget.monthly_cap_cents != null && total >= budget.monthly_cap_cents) {
    return { ok: false, error: "Monthly Claude API spend cap reached. Contact an admin.", retryAfter: 3600 };
  }
  if (budget.per_user_cap_cents != null && perActor >= budget.per_user_cap_cents) {
    return { ok: false, error: "Your monthly Claude API quota is exhausted.", retryAfter: 3600 };
  }
  return { ok: true };
}

export async function recordUsage({ session, model, usage, requestId }) {
  if (!sbConfigured()) return;
  const inputTokens  = usage?.input_tokens  || 0;
  const outputTokens = usage?.output_tokens || 0;
  const cost = estimateCostCents(model, inputTokens, outputTokens);
  try {
    await sbInsert("claude_usage", {
      actor:          String(session?.user || "unknown").slice(0, 200),
      actor_role:     String(session?.role || "user").slice(0, 60),
      model,
      input_tokens:   inputTokens,
      output_tokens:  outputTokens,
      cost_usd_cents: cost,
      request_id:     requestId || null,
    }, "return=minimal");
  } catch (e) {
    try { console.error("[claude-spend] failed to record usage:", e.message); } catch { /* ignore */ }
  }
}
