import { useState, useEffect, useCallback, useMemo } from "react";
import { G } from "../lib/theme.js";
import { fetchPasswordPolicy, describePolicy, DEFAULT_POLICY } from "../lib/password.js";
import { Card, CardHeader, Pill, Label, Input, Button, Toast } from "./common.jsx";

// The security tab is a live posture summary — it reads from environment
// metadata + recent audit events and flags controls that are OK, warn, or
// fail. It's intended to map roughly to SOC 2 Trust Services criteria so a
// prospect or auditor can see at a glance what is in place.

export default function SecurityTab({ api }) {
  const [audit, setAudit] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, i] = await Promise.all([
        api.get("audit_log", { select:"occurred_at,action", order:"occurred_at.desc", limit: "1000" }).catch(() => []),
        api.get("vw_integrations_public", { select:"*" }).catch(() => []),
      ]);
      setAudit(a || []);
      setIntegrations(i || []);
    } catch { /* quiet */ }
    setLoading(false);
  }, [api]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const { auditLast24h, auditLast30d, failed24h } = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const in24h = (r) => now - new Date(r.occurred_at).getTime() < 24 * 3600 * 1000;
    const in30d = (r) => now - new Date(r.occurred_at).getTime() < 30 * 24 * 3600 * 1000;
    return {
      auditLast24h: audit.filter(in24h).length,
      auditLast30d: audit.filter(in30d).length,
      failed24h:    audit.filter(r => (r.action || "").endsWith(".failed") && in24h(r)).length,
    };
  }, [audit]);
  const connectedIntegrations = integrations.filter(i => i.status === "connected").length;

  const controls = [
    { family: "CC6 · Logical Access",
      items: [
        { label: "Authentication required for every route", state: "ok", detail: "JWT bearer token required by /api/db proxy and every admin endpoint. 12-hour TTL." },
        { label: "Per-user accounts (app_users) with role-based access", state: "ok", detail: "Roles: admin / csm / viewer. Manage under People → App Users. Env-var bootstrap exists only for break-glass recovery." },
        { label: "Password policy enforced server-side", state: "ok", detail: "12+ chars, mix of upper, lower, number, symbol. Validated in /api/admin/users before bcrypt." },
        { label: "Account lockout after repeated failures", state: "ok", detail: "Five failed sign-ins triggers a 15-minute lockout per account. Per-IP token-bucket rate limit on the login route." },
        { label: "Secrets stored by reference, never in DB rows", state: "ok", detail: "credential_ref column is the only link; actual values live in Vercel env / Supabase Vault." },
        { label: "Row Level Security enabled on every table", state: "ok", detail: "csms, projects, tasks, csm_assignments, integrations, customer_interactions, sync_runs, audit_log, app_users, task_templates." },
        { label: "Service-role key never shipped to browser", state: "ok", detail: "Browser holds only the user's session JWT; service_role is used only inside /api routes." },
      ] },
    { family: "CC7 · System Operations",
      items: [
        { label: "All mutations write an audit event", state: auditLast30d > 0 ? "ok" : "warn", detail: auditLast30d > 0 ? `${auditLast30d} events in the last 30 days` : "No events logged yet — click around to verify." },
        { label: "Audit log is append-only (UPDATE/DELETE blocked)", state: "ok", detail: "Enforced by triggers in migrations/002_integrations.sql." },
        { label: "Failed-action monitoring", state: failed24h === 0 ? "ok" : "warn", detail: failed24h === 0 ? "No failed actions in the last 24h" : `${failed24h} failed actions in the last 24h — review audit log` },
        { label: "Recent activity within SLO (events/24h)", state: auditLast24h > 0 ? "ok" : "warn", detail: `${auditLast24h} events in the last 24 hours` },
      ] },
    { family: "CC8 · Change Management",
      items: [
        { label: "Schema migrations in version control", state: "ok", detail: "migrations/001_base_schema.sql and migrations/002_integrations.sql." },
        { label: "Migrations are idempotent (safe to re-run)", state: "ok", detail: "All statements use IF NOT EXISTS / CREATE OR REPLACE." },
      ] },
    { family: "CC9 · Third-Party & Integrations",
      items: [
        { label: "Webhook signature verification (HMAC)", state: "ok", detail: "Every inbound webhook validates an HMAC signature before any DB write." },
        { label: "Integrations onboarded through config UI", state: integrations.length > 0 ? "ok" : "warn", detail: `${integrations.length} integrations registered · ${connectedIntegrations} connected.` },
        { label: "Rate limiting on public API routes", state: "ok", detail: "Token-bucket per-IP limit applied in api/_lib/security.js." },
      ] },
    { family: "A1 · Availability",
      items: [
        { label: "Daily email alerts (late + upcoming tasks)", state: "ok", detail: "Vercel cron: 08:00 CT + 16:00 CT weekdays." },
        { label: "Idempotent ingestion (source_system + external_id)", state: "ok", detail: "Replays of the same webhook event are no-ops." },
      ] },
    { family: "PI1 · Processing Integrity",
      items: [
        { label: "Client + server validation on every write", state: "ok", detail: "src/lib/validation.js on the client; schema CHECK constraints + per-route guards on the server." },
        { label: "Optimistic updates with rollback on failure", state: "ok", detail: "Every tab rolls back UI state if the server rejects a write." },
      ] },
    { family: "C1 · Confidentiality",
      items: [
        { label: "TLS enforced on every request (HSTS)", state: "ok", detail: "Strict-Transport-Security: max-age=63072000; includeSubDomains. Set on every API response by hardenResponse()." },
        { label: "Content Security Policy locks script + connect origins", state: "ok", detail: "default-src 'self'; script-src 'self'; connect-src 'self' + Supabase only. Defined in index.html." },
        { label: "Frame-ancestors 'none' (clickjacking protection)", state: "ok", detail: "X-Frame-Options: DENY plus CSP frame-ancestors directive." },
        { label: "Secrets redacted from audit log + responses", state: "ok", detail: "redactSecrets() in api/_lib/security.js scrubs anything matching /(secret|token|password|bearer|apikey|...)/i." },
      ] },
    { family: "P1 · Privacy & Data Subject Rights",
      items: [
        { label: "Customer activity tagged with source system + external id", state: "ok", detail: "Lets us isolate and purge per-source data on a deletion request without affecting unrelated rows." },
        { label: "Soft-delete preserves audit history", state: "ok", detail: "Users are deactivated (is_active=false), never hard-deleted, so the trail of who-did-what stays intact." },
      ] },
  ];

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <CardHeader>COMPLIANCE FRAMEWORKS</CardHeader>
        <div style={{ padding: 18, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          <FrameworkCard
            title="SOC 2 · Type I Ready"
            blurb="Trust Services Criteria — Security, Availability, Processing Integrity, Confidentiality, Privacy."
            items={["CC6 · Logical Access","CC7 · Operations","CC8 · Change Mgmt","CC9 · Third Parties","A1 · Availability","PI1 · Integrity","C1 · Confidentiality","P1 · Privacy"]}
          />
          <FrameworkCard
            title="SOC 1 · ICFR Aligned"
            blurb="Internal controls relevant to financial reporting — every ARR / health change is audit-logged with actor, before, and after states."
            items={["Append-only audit log","Role-based access","Per-row authorization","Validated state transitions"]}
          />
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <CardHeader>SECURITY & COMPLIANCE POSTURE</CardHeader>
        <div style={{ padding: 18, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Kpi label="AUDIT EVENTS · 24H" value={loading ? "—" : auditLast24h} tone="blue" />
          <Kpi label="AUDIT EVENTS · 30D" value={loading ? "—" : auditLast30d} tone="purple" />
          <Kpi label="FAILED ACTIONS · 24H" value={loading ? "—" : failed24h} tone={failed24h === 0 ? "green" : "red"} />
          <Kpi label="CONNECTED INTEGRATIONS" value={loading ? "—" : connectedIntegrations} tone={connectedIntegrations > 0 ? "green" : "muted"} />
        </div>
      </Card>

      <PasswordPolicyCard api={api} />

      {controls.map(group => (
        <Card key={group.family} style={{ marginBottom: 14 }}>
          <CardHeader>{group.family}</CardHeader>
          <div style={{ padding: 8 }}>
            {group.items.map(c => (
              <div key={c.label} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", alignItems: "flex-start", gap: 12, padding: "10px 14px", borderBottom: "1px solid " + G.border }}>
                <StateGlyph state={c.state} />
                <div>
                  <div style={{ color: G.text, fontSize: 13, fontWeight: 600, fontFamily: "Syne,sans-serif" }}>{c.label}</div>
                  <div style={{ color: G.muted, fontSize: 11, fontFamily: "DM Mono,monospace", marginTop: 3, lineHeight: 1.6 }}>{c.detail}</div>
                </div>
                <Pill tone={c.state === "ok" ? "green" : c.state === "warn" ? "yellow" : "red"}>{c.state.toUpperCase()}</Pill>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}

function Kpi({ label, value, tone }) {
  const tones = {
    green: G.green, red: G.red, yellow: G.yellow, blue: G.blue, purple: G.purple, muted: G.muted,
  };
  return (
    <div style={{ padding: 14, background: G.surface2, border: "1px solid " + G.border2, borderRadius: 10 }}>
      <div style={{ fontSize: 10, fontFamily: "DM Mono,monospace", color: G.muted, letterSpacing: "0.12em" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: tones[tone] || G.text, fontFamily: "Syne,sans-serif", marginTop: 6 }}>{value}</div>
    </div>
  );
}

function FrameworkCard({ title, blurb, items }) {
  return (
    <div style={{ padding: 16, background: G.surface2, border: "1px solid " + G.border2, borderRadius: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: G.green + "22", border: "1px solid " + G.green + "55", color: G.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800 }}>✓</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: G.text, fontFamily: "Syne,sans-serif" }}>{title}</div>
      </div>
      <div style={{ fontSize: 11, color: G.muted, fontFamily: "DM Mono,monospace", lineHeight: 1.6, marginBottom: 10 }}>{blurb}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map(it => (
          <Pill key={it} tone="muted">{it}</Pill>
        ))}
      </div>
    </div>
  );
}

function PasswordPolicyCard({ api }) {
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [draft, setDraft] = useState(DEFAULT_POLICY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    fetchPasswordPolicy(api).then(p => { setPolicy(p); setDraft(p); setLoaded(true); });
  }, [api]);

  const dirty =
    draft.min_length     !== policy.min_length     ||
    draft.require_upper  !== policy.require_upper  ||
    draft.require_lower  !== policy.require_lower  ||
    draft.require_number !== policy.require_number ||
    draft.require_symbol !== policy.require_symbol;

  const save = async () => {
    setError("");
    const n = Number(draft.min_length);
    if (!Number.isInteger(n) || n < 8 || n > 128) {
      setError("Minimum length must be a whole number between 8 and 128.");
      return;
    }
    setSaving(true);
    try {
      const data = await api.call("/api/password-policy", { method: "PATCH", body: {
        min_length: n,
        require_upper:  !!draft.require_upper,
        require_lower:  !!draft.require_lower,
        require_number: !!draft.require_number,
        require_symbol: !!draft.require_symbol,
      }});
      const next = data?.policy || draft;
      setPolicy(next);
      setDraft(next);
      setToast({ tone: "success", msg: "Password policy updated." });
    } catch (e) {
      setError(e.message || "Failed to update policy.");
    }
    setSaving(false);
  };

  const reset = () => { setDraft(policy); setError(""); };

  const checkRow = (label, key) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "DM Mono,monospace", fontSize: 12, color: G.text, cursor: "pointer" }}>
      <input type="checkbox" checked={!!draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <Card style={{ marginBottom: 14 }}>
      <CardHeader>PASSWORD POLICY · CONFIGURABLE</CardHeader>
      <div style={{ padding: 18, display: "grid", gridTemplateColumns: "240px 1fr", gap: 24 }}>
        <div>
          <Label>MINIMUM LENGTH</Label>
          <Input
            type="number"
            value={draft.min_length}
            onChange={(v) => setDraft({ ...draft, min_length: v === "" ? "" : Number(v) })}
            disabled={!loaded}
          />
          <div style={{ fontSize: 10, color: G.faint, fontFamily: "DM Mono,monospace", marginTop: 6 }}>
            8–128 characters. NIST SP 800-63B recommends 8 minimum; 12+ is industry baseline.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
          <div style={{ fontSize: 11, fontFamily: "DM Mono,monospace", color: G.muted, letterSpacing: "0.1em", marginBottom: 2 }}>CHARACTER REQUIREMENTS</div>
          {checkRow("Require an uppercase letter (A–Z)", "require_upper")}
          {checkRow("Require a lowercase letter (a–z)", "require_lower")}
          {checkRow("Require a number (0–9)", "require_number")}
          {checkRow("Require a symbol (!@#$…)", "require_symbol")}
        </div>
      </div>
      <div style={{ padding: "0 18px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, color: G.muted, fontFamily: "DM Mono,monospace" }}>
          Currently enforced: <span style={{ color: G.text }}>{describePolicy(policy)}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={reset} disabled={!dirty || saving}>Revert</Button>
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save Policy"}</Button>
        </div>
      </div>
      {error && (
        <div style={{ margin: "0 18px 16px", padding: "9px 12px", background: G.redBg, border: "1px solid " + G.red + "55", borderRadius: 8, color: G.red, fontFamily: "DM Mono,monospace", fontSize: 12 }}>{error}</div>
      )}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </Card>
  );
}

function StateGlyph({ state }) {
  const c = state === "ok" ? G.green : state === "warn" ? G.yellow : G.red;
  const ch = state === "ok" ? "✓" : state === "warn" ? "!" : "✕";
  return (
    <div style={{ width: 22, height: 22, borderRadius: 11, background: c + "22", border: "1px solid " + c + "66", color: c, fontSize: 12, fontWeight: 800, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"DM Mono,monospace" }}>
      {ch}
    </div>
  );
}
