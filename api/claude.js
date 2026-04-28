// POST /api/claude
// Authenticated proxy to Anthropic's Messages API. Requires a valid session
// JWT — without this, the endpoint was an open LLM relay billable to our key.

import { rateLimit, hardenResponse, fail, failUpstream, json, requestId } from "./_lib/security.js";
import { requireAuth } from "./_lib/auth.js";
import { checkSpendCap, recordUsage } from "./_lib/claude-spend.js";

const MODEL = "claude-sonnet-4-6";
const MAX_INPUT_CHARS = 24_000;

// Anthropic responses can take 15-30s for analytical prompts. The default
// Vercel function timeout is 10s, which surfaces in the browser as a generic
// "Failed to fetch" once the gateway terminates the request.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  hardenResponse(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  const rl = await rateLimit(req, "claude", 10);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return fail(res, 429, "Rate limit exceeded."); }

  const session = await requireAuth(req, res);
  if (!session) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail(res, 500, "ANTHROPIC_API_KEY not set.");

  let body = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
    if (!body || typeof body !== "object") throw new Error();
  } catch { return fail(res, 400, "Invalid JSON body."); }

  const { messages, system } = body;
  if (!Array.isArray(messages) || !messages.length) return fail(res, 400, "messages[] is required.");

  // Cap input size before we burn an upstream call. Each message's content
  // can itself be a string or an array of parts; collapse to a length sum.
  let charBudget = 0;
  for (const m of messages) {
    if (typeof m.content === "string") charBudget += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const part of m.content) charBudget += String(part?.text || "").length;
    }
  }
  if (typeof system === "string") charBudget += system.length;
  if (charBudget > MAX_INPUT_CHARS) return fail(res, 413, "Prompt exceeds maximum length.");

  // Spend gate. Reads claude_budget + claude_usage from migration 012; fails
  // open if the migration isn't applied (logged server-side) so the feature
  // still works in dev environments without the table.
  const spend = await checkSpendCap(session);
  if (!spend.ok) {
    if (spend.retryAfter) res.setHeader("Retry-After", String(spend.retryAfter));
    return fail(res, 429, spend.error);
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages }),
    });
    const data = await response.json();
    if (!response.ok) return json(res, response.status, { error: data.error?.message || "Upstream error." });

    // Record usage on success. Never block the response on the audit row.
    recordUsage({ session, model: MODEL, usage: data.usage, requestId: requestId(req) }).catch(() => { /* swallow */ });

    return json(res, 200, { content: data.content?.[0]?.text || "" });
  } catch (err) {
    return failUpstream(res, session, 500, "Upstream request failed.", err);
  }
}
