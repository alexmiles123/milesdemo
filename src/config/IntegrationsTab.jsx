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
                    <div style={{ fontSize: 11, fontFamily: "DM Mono,monospace", color: G.faint }}>{row.provider}</div>
                  </div>
                  <Pill tone={statusTone}>{row.status.toUpperCase()}</Pill>
                </div>
                <div style={{ fontSize: 12, color: G.muted, fontFamily: "DM Mono,monospace", lineHeight: 1.6 }}>{meta.blurb}</div>
                <div style={{ fontSize: 11, color: G.faint, fontFamily: "DM Mono,monospace" }}>Last sync: {fmtDateTime(row.last_sync_at)}</div>
                {row.last_error && (
                  <div style={{ fontSize: 11, color: G.red, fontFamily: "DM Mono,monospace", background: G.redBg, border: "1px solid " + G.redBd, borderRadius: 6, padding: "6px 8px" }}>
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
  const [form, setForm] = useState(() => integration.provider === "microsoft_teams"
    ? { tenant_id: integration.config?.tenant_id || "", client_id: integration.config?.client_id || "", credential_ref: "", webhook_secret_preview: "" }
    : { instance_url: integration.config?.instance_url || "", client_id: integration.config?.client_id || "", credential_ref: "", webhook_secret_preview: "" }
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
          config: integration.provider === "microsoft_teams"
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

  return (
    <Modal title={`Configure ${integration.display_name}`} onClose={onClose} width={600}>
      <div style={{ marginBottom: 14, padding: 12, background: G.blueBg, border: "1px solid " + G.blueBd, borderRadius: 8, color: G.blue, fontSize: 12, fontFamily: "DM Mono,monospace", lineHeight: 1.6 }}>
        <b>Security note.</b> Secrets are stored by <i>reference</i> — the app reads the actual value from a server-side secret store (Vercel env var or Supabase Vault) using the name you provide below. The secret itself never travels through the browser.
      </div>
      {integration.provider === "microsoft_teams" ? (
        <>
          <Label>AZURE AD TENANT ID</Label>
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
      <Input value={form.credential_ref} onChange={v => set("credential_ref", v)} placeholder={integration.provider === "microsoft_teams" ? "TEAMS_CLIENT_SECRET" : "SALESFORCE_CLIENT_SECRET"} />
      <div style={{ fontSize: 11, color: G.faint, fontFamily: "DM Mono,monospace", marginTop: 4 }}>
        Set the actual value with <code>vercel env add {form.credential_ref || "&lt;NAME&gt;"}</code>. Only the name is stored in the database.
      </div>
      {err && <div style={{ marginTop: 14, padding: "9px 12px", background: G.redBg, border: "1px solid " + G.red + "55", borderRadius: 8, color: G.red, fontFamily: "DM Mono,monospace", fontSize: 12 }}>{err}</div>}
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop: 20 }}>
        <Button onClick={onClose} variant="ghost">Cancel</Button>
        <Button onClick={save} variant="primary" disabled={saving}>{saving ? "Saving…" : "Save & Connect"}</Button>
      </div>
    </Modal>
  );
}
