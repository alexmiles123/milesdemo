import { useState, useEffect, useCallback } from "react";
import { G, PROVIDERS, fmtDateTime } from "../lib/theme.js";
import { audit } from "../lib/audit.js";
import { Card, CardHeader, Label, Input, Button, Toast, Modal, Empty, Th, Td, Pill, TextArea, Select } from "./common.jsx";

export default function IntegrationsTab({ api }) {
  const [rows, setRows] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // { integration }
  const [toast, setToast] = useState(null);
  const [testing, setTesting] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [is, rs] = await Promise.all([
        api.get("vw_integrations_public", { select:"*", order:"provider.asc" }).catch(() => []),
        api.get("sync_runs", { select:"*", order:"started_at.desc", limit:"20" }).catch(() => []),
      ]);
      setRows(is || []);
      setRuns(rs || []);
    } catch (e) { setToast({ tone:"error", msg:"Failed to load integrations: " + e.message }); }
    setLoading(false);
  }, [api]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const trigger = async (row, kind) => {
    setTesting(t => ({ ...t, [row.id]: true }));
    try {
      const res = await fetch("/api/integrations/" + row.provider + "/" + kind, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
      setToast({ tone:"success", msg: `${row.display_name}: ${kind} triggered (${data.records_upserted || 0} records).` });
      audit("integration." + kind, "integrations", row.id, { metadata: { provider: row.provider, result: data } });
      await load();
    } catch (e) {
      setToast({ tone:"error", msg: `${row.display_name}: ${e.message}` });
    } finally {
      setTesting(t => ({ ...t, [row.id]: false }));
    }
  };

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <CardHeader>EXTERNAL SYSTEM INTEGRATIONS</CardHeader>
        <div style={{ padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 14 }}>
          {loading && PROVIDERS.map(p => <div key={p.id} style={{ padding: 16, background: G.surface2, border: "1px solid " + G.border, borderRadius: 12, color: G.muted }}>Loading…</div>)}
          {!loading && rows.length === 0 && <Empty>No integrations configured yet.</Empty>}
          {!loading && rows.map(row => {
            const meta = PROVIDERS.find(p => p.id === row.provider) || { label: row.display_name, blurb: "" };
            const statusTone = { connected:"green", syncing:"blue", disconnected:"muted", error:"red" }[row.status] || "muted";
            return (
              <div key={row.id} style={{ padding: 16, background: G.surface2, border: "1px solid " + G.border2, borderRadius: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: G.text, fontFamily: "Syne,sans-serif" }}>{row.display_name}</div>
                    <div style={{ fontSize: 11, fontFamily: "Inter,system-ui,sans-serif", color: G.faint }}>{row.provider}</div>
                  </div>
                  <Pill tone={statusTone}>{row.status.toUpperCase()}</Pill>
                </div>
                <div style={{ fontSize: 12, color: G.muted, fontFamily: "Inter,system-ui,sans-serif", lineHeight: 1.6 }}>{meta.blurb}</div>
                <div style={{ fontSize: 11, color: G.faint, fontFamily: "Inter,system-ui,sans-serif" }}>Last sync: {fmtDateTime(row.last_sync_at)}</div>
                {row.last_error && (
                  <div style={{ fontSize: 11, color: G.red, fontFamily: "Inter,system-ui,sans-serif", background: G.redBg, border: "1px solid " + G.redBd, borderRadius: 6, padding: "6px 8px" }}>
                    {row.last_error}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <Button variant="primary" onClick={() => setModal({ integration: row })}>Configure</Button>
                  <Button onClick={() => trigger(row, "sync")} disabled={row.status !== "connected" || !!testing[row.id]}>
                    {testing[row.id] ? "Syncing…" : "Sync Now"}
                  </Button>
                  <Button variant="ghost" onClick={() => trigger(row, "test")} disabled={!!testing[row.id]}>Test</Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader>RECENT SYNC ACTIVITY</CardHeader>
        {runs.length === 0 ? <Empty>No sync runs yet.</Empty> : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr><Th>Started</Th><Th>Trigger</Th><Th>Status</Th><Th style={{ textAlign:"right" }}>In</Th><Th style={{ textAlign:"right" }}>Upserted</Th><Th style={{ textAlign:"right" }}>Skipped</Th><Th>Error</Th></tr></thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id}>
                    <Td>{fmtDateTime(r.started_at)}</Td>
                    <Td>{r.trigger}</Td>
                    <Td><Pill tone={r.status === "succeeded" ? "green" : r.status === "failed" ? "red" : r.status === "partial" ? "yellow" : "blue"}>{r.status.toUpperCase()}</Pill></Td>
                    <Td style={{ textAlign:"right" }}>{r.records_in}</Td>
                    <Td style={{ textAlign:"right" }}>{r.records_upserted}</Td>
                    <Td style={{ textAlign:"right" }}>{r.records_skipped}</Td>
                    <Td style={{ color: G.red, maxWidth: 320, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.error_message || ""}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal && <ConfigureModal integration={modal.integration} onClose={() => setModal(null)} onSaved={() => { setModal(null); setToast({ tone:"success", msg:"Integration configured." }); load(); }} />}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}

function ConfigureModal({ integration, onClose, onSaved }) {
  const isMicrosoft = integration.provider === "microsoft_teams" || integration.provider === "outlook";
  const [form, setForm] = useState(() => isMicrosoft
    ? { tenant_id: integration.config?.tenant_id || "", client_id: integration.config?.client_id || "", credential_ref: "" }
    : { instance_url: integration.config?.instance_url || "", client_id: integration.config?.client_id || "", credential_ref: "" }
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: integration.provider,
          config: isMicrosoft
            ? { tenant_id: form.tenant_id.trim(), client_id: form.client_id.trim() }
            : { instance_url: form.instance_url.trim(), client_id: form.client_id.trim() },
          credential_ref: form.credential_ref.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
      audit("integration.configure", "integrations", integration.id, { after: data });
      onSaved();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  const secretPlaceholder = {
    microsoft_teams: "TEAMS_CLIENT_SECRET",
    outlook:         "OUTLOOK_CLIENT_SECRET",
    salesforce:      "SALESFORCE_CLIENT_SECRET",
  }[integration.provider] || "CLIENT_SECRET";

  return (
    <Modal title={`Configure ${integration.display_name}`} onClose={onClose} width={640}>
      <div style={{ marginBottom: 14, padding: 12, background: G.blueBg, border: "1px solid " + G.blueBd, borderRadius: 8, color: G.blue, fontSize: 12, fontFamily: "Inter,system-ui,sans-serif", lineHeight: 1.6 }}>
        <b>Security note.</b> Secrets are stored by <i>reference</i> — the app reads the actual value from a server-side env var using the name you provide below. The secret itself never travels through the browser.
      </div>

      {/* ── OUTLOOK SETUP INSTRUCTIONS ──────────────────────────────── */}
      {integration.provider === "outlook" && (
        <div style={{ marginBottom: 16, padding: 14, background: G.surface2, border: "1px solid " + G.border, borderRadius: 8, fontSize: 12, fontFamily: "Inter,system-ui,sans-serif", lineHeight: 1.75, color: G.text }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: G.text }}>How to connect Outlook / Exchange</div>

          <div style={{ fontWeight: 600, color: G.muted, letterSpacing: "0.08em", fontSize: 11, marginBottom: 4 }}>STEP 1 — REGISTER AN AZURE AD APP</div>
          <ol style={{ margin: "0 0 12px 16px", padding: 0 }}>
            <li>Go to <b>portal.azure.com</b> and sign in as a Global Administrator.</li>
            <li>Navigate to <b>Azure Active Directory → App registrations → + New registration</b>.</li>
            <li>Name it (e.g. "Monument Outlook Sync"), leave Redirect URI blank, click <b>Register</b>.</li>
            <li>On the app overview page, copy the <b>Application (client) ID</b> and <b>Directory (tenant) ID</b> — you'll paste them below.</li>
          </ol>

          <div style={{ fontWeight: 600, color: G.muted, letterSpacing: "0.08em", fontSize: 11, marginBottom: 4 }}>STEP 2 — GRANT API PERMISSIONS</div>
          <ol style={{ margin: "0 0 12px 16px", padding: 0 }}>
            <li>In the app, go to <b>API permissions → + Add a permission → Microsoft Graph → Application permissions</b>.</li>
            <li>Search for and add each of these permissions:
              <ul style={{ margin: "6px 0 6px 16px", padding: 0 }}>
                <li><b>Mail.Read</b> — read all users' email</li>
                <li><b>User.Read.All</b> — look up CSM mailboxes by email address</li>
                <li><b>Calendars.Read</b> — (optional) sync calendar meetings</li>
              </ul>
            </li>
            <li>Click <b>Grant admin consent for [your org]</b> and confirm. The status indicators must turn green before the integration will work.</li>
          </ol>

          <div style={{ fontWeight: 600, color: G.muted, letterSpacing: "0.08em", fontSize: 11, marginBottom: 4 }}>STEP 3 — CREATE A CLIENT SECRET</div>
          <ol style={{ margin: "0 0 12px 16px", padding: 0 }}>
            <li>Go to <b>Certificates &amp; secrets → + New client secret</b>.</li>
            <li>Set a description and expiry (24 months max), click <b>Add</b>.</li>
            <li>Copy the <b>Value</b> immediately — it is only shown once.</li>
            <li>Add it to Vercel: <code style={{ background: G.bg, padding: "1px 5px", borderRadius: 3 }}>vercel env add OUTLOOK_CLIENT_SECRET</code></li>
          </ol>

          <div style={{ fontWeight: 600, color: G.muted, letterSpacing: "0.08em", fontSize: 11, marginBottom: 4 }}>STEP 4 — ENSURE CSM EMAILS ARE SET</div>
          <p style={{ margin: "0 0 0 0" }}>
            The sync reads each CSM's mailbox using their <b>email address</b> stored in Configuration → CSMs.
            Make sure every CSM row has a valid <b>work email</b> (their Microsoft 365 UPN — typically <code style={{ background: G.bg, padding: "1px 5px", borderRadius: 3 }}>firstname.lastname@yourcompany.com</code>).
          </p>
        </div>
      )}

      {/* ── FORM FIELDS ─────────────────────────────────────────────── */}
      {isMicrosoft ? (
        <>
          <Label>AZURE AD TENANT ID (DIRECTORY ID)</Label>
          <Input value={form.tenant_id} onChange={v => set("tenant_id", v)} placeholder="00000000-0000-0000-0000-000000000000" />
          <div style={{ height: 12 }} />
          <Label>APPLICATION (CLIENT) ID</Label>
          <Input value={form.client_id} onChange={v => set("client_id", v)} placeholder="00000000-0000-0000-0000-000000000000" />
        </>
      ) : (
        <>
          <Label>SALESFORCE INSTANCE URL</Label>
          <Input value={form.instance_url} onChange={v => set("instance_url", v)} placeholder="https://yourcompany.my.salesforce.com" />
          <div style={{ height: 12 }} />
          <Label>CONNECTED APP CLIENT ID (CONSUMER KEY)</Label>
          <Input value={form.client_id} onChange={v => set("client_id", v)} placeholder="3MVG9..." />
        </>
      )}
      <div style={{ height: 12 }} />
      <Label>CLIENT SECRET — ENV VAR NAME</Label>
      <Input value={form.credential_ref} onChange={v => set("credential_ref", v)} placeholder={secretPlaceholder} />
      <div style={{ fontSize: 11, color: G.faint, fontFamily: "Inter,system-ui,sans-serif", marginTop: 4 }}>
        Set the actual value with <code>vercel env add {form.credential_ref || secretPlaceholder}</code>. Only the name is stored in the database.
      </div>

      {err && <div style={{ marginTop: 14, padding: "9px 12px", background: G.redBg, border: "1px solid " + G.red + "55", borderRadius: 8, color: G.red, fontFamily: "Inter,system-ui,sans-serif", fontSize: 12 }}>{err}</div>}
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop: 20 }}>
        <Button onClick={onClose} variant="ghost">Cancel</Button>
        <Button onClick={save} variant="primary" disabled={saving}>{saving ? "Saving…" : "Save & Connect"}</Button>
      </div>
    </Modal>
  );
}
