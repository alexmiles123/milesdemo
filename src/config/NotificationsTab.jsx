import { useState, useEffect, useCallback } from "react";
import { G } from "../lib/theme.js";
import { audited } from "../lib/audit.js";
import { Card, CardHeader, Label, Button, Toast, Empty, Pill, TextArea } from "./common.jsx";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Parse the comma/newline-separated free-text box into an array of emails.
function parseList(raw) {
  return (raw || "")
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function validateEmails(list) {
  const bad = list.filter(e => !EMAIL_RE.test(e));
  return bad.length ? `Invalid: ${bad.join(", ")}` : null;
}

export default function NotificationsTab({ api }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [edits, setEdits] = useState({});     // { [id]: { to, cc, enabled } }
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get("notification_rules", { select: "*", order: "status.asc,event_type.asc" });
      setRules(rows || []);
      const seed = {};
      (rows || []).forEach(r => {
        seed[r.id] = {
          to: (r.to_recipients || []).join(", "),
          cc: (r.cc_recipients || []).join(", "),
          enabled: !!r.enabled,
        };
      });
      setEdits(seed);
    } catch (e) {
      setToast({ tone: "error", msg: "Failed to load notification rules: " + e.message });
      setRules([]);
    }
    setLoading(false);
  }, [api]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const set = (id, key, value) => setEdits(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  const dirty = (r) => {
    const e = edits[r.id]; if (!e) return false;
    const origTo = (r.to_recipients || []).join(", ");
    const origCc = (r.cc_recipients || []).join(", ");
    return e.to !== origTo || e.cc !== origCc || e.enabled !== r.enabled;
  };

  const save = async (rule) => {
    const e = edits[rule.id];
    const to = parseList(e.to);
    const cc = parseList(e.cc);
    const toErr = validateEmails(to); const ccErr = validateEmails(cc);
    if (toErr) return setToast({ tone: "error", msg: "TO: " + toErr });
    if (ccErr) return setToast({ tone: "error", msg: "CC: " + ccErr });

    const before = { to_recipients: rule.to_recipients, cc_recipients: rule.cc_recipients, enabled: rule.enabled };
    const after  = { to_recipients: to, cc_recipients: cc, enabled: !!e.enabled };

    setSavingId(rule.id);
    try {
      await audited("notification_rule.update", "notification_rules", rule.id,
        () => api.patch("notification_rules", rule.id, after),
        { before, after });
      setToast({ tone: "success", msg: `${rule.label}: saved (${to.length} TO, ${cc.length} CC).` });
      await load();
    } catch (err) {
      setToast({ tone: "error", msg: "Save failed: " + err.message });
    }
    setSavingId(null);
  };

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <CardHeader>
          NOTIFICATION RULES
        </CardHeader>
        <div style={{ padding: 16, fontFamily: "Inter,system-ui,sans-serif", fontSize: 12, color: G.muted, lineHeight: 1.7, borderBottom: "1px solid " + G.border }}>
          Configure who receives each type of notification email. Each rule has its own
          <b style={{ color: G.text }}> TO</b> list (the primary recipients) and
          <b style={{ color: G.text }}> CC</b> list (additional people copied on every send).
          Cron jobs read these lists at send time, so updates take effect immediately.
          Separate multiple emails with commas or newlines.
          Rules tagged <Pill tone="yellow">PENDING</Pill> have their UI in place but the triggering logic is not yet wired — you can pre-configure recipients and they'll be honored once the trigger ships.
        </div>
      </Card>

      {loading ? <Empty>Loading notification rules…</Empty> : rules.length === 0 ? (
        <Empty>No rules yet. Run migration 003 to seed the default events.</Empty>
      ) : rules.map(r => {
        const e = edits[r.id] || { to: "", cc: "", enabled: r.enabled };
        const isDirty = dirty(r);
        return (
          <Card key={r.id} style={{ marginBottom: 14 }}>
            <CardHeader right={
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Pill tone={r.status === "wired" ? "green" : "yellow"}>{r.status.toUpperCase()}</Pill>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "Inter,system-ui,sans-serif", fontSize: 11, color: G.muted, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!e.enabled} onChange={ev => set(r.id, "enabled", ev.target.checked)} /> Enabled
                </label>
                <Button variant="primary" onClick={() => save(r)} disabled={!isDirty || savingId === r.id}>
                  {savingId === r.id ? "Saving…" : isDirty ? "Save" : "Saved"}
                </Button>
              </div>
            }>
              {r.label.toUpperCase()}
            </CardHeader>
            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 11, fontFamily: "Inter,system-ui,sans-serif", color: G.faint, marginBottom: 12, lineHeight: 1.6 }}>
                <span style={{ color: G.muted }}>event: </span>{r.event_type}
                {r.description && <div style={{ color: G.muted, marginTop: 6 }}>{r.description}</div>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <Label>TO RECIPIENTS</Label>
                  <TextArea
                    value={e.to}
                    onChange={v => set(r.id, "to", v)}
                    rows={2}
                    placeholder="csm-ops@company.com, exec@company.com"
                  />
                </div>
                <div>
                  <Label>CC RECIPIENTS</Label>
                  <TextArea
                    value={e.cc}
                    onChange={v => set(r.id, "cc", v)}
                    rows={2}
                    placeholder="leadership@company.com"
                  />
                </div>
              </div>
            </div>
          </Card>
        );
      })}

      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}
