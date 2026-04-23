// Resolves notification recipients for a given event_type.
//
// Precedence:
//   1. If a notification_rules row exists and is enabled → use its to/cc.
//   2. If the row is disabled → return enabled:false and the caller skips.
//   3. If the row is missing or has empty TO → fall back to the legacy
//      env var (EXEC_EMAIL, ALERT_TO_EMAILS) so existing deploys don't
//      silently stop sending when migration 003 hasn't landed yet.
//
// Usage:
//   import { resolveRecipients } from "../_lib/notifications.js";
//   const { enabled, to, cc } = await resolveRecipients("task.late");
//   if (!enabled || !to.length) return;

const SB_URL = () => (process.env.SUPABASE_URL || "").replace(/\/$/, "") + "/rest/v1";
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY;

function envList(name) {
  return (process.env[name] || "")
    .split(",").map(s => s.trim()).filter(Boolean);
}

export async function resolveRecipients(eventType, opts = {}) {
  const envFallbackTo = opts.envFallbackTo || "EXEC_EMAIL";
  const envFallbackCc = opts.envFallbackCc || null;

  let rule = null;
  try {
    const res = await fetch(
      SB_URL() + "/notification_rules?event_type=eq." + encodeURIComponent(eventType) + "&select=*",
      { headers: { apikey: SB_KEY(), Authorization: "Bearer " + SB_KEY() } }
    );
    if (res.ok) {
      const rows = await res.json();
      rule = rows[0] || null;
    }
  } catch {
    // Table may not exist yet (migration 003 not applied). Fall through to env.
  }

  if (rule && rule.enabled === false) {
    return { enabled: false, to: [], cc: [], source: "rule_disabled" };
  }

  const ruleTo = rule?.to_recipients || [];
  const ruleCc = rule?.cc_recipients || [];

  const to = ruleTo.length ? ruleTo : envList(envFallbackTo);
  const cc = ruleCc.length ? ruleCc : (envFallbackCc ? envList(envFallbackCc) : []);

  return {
    enabled: true,
    to, cc,
    source: rule ? (ruleTo.length ? "rule" : "rule_plus_env_fallback") : "env_only",
  };
}
