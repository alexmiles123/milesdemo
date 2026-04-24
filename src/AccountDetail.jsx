// Account detail view.
//
// Shows a customer's contact fields (name / email / phone / address) and
// an activity feed pulled from customer_interactions. The same feed shows
// automatic events written by the Salesforce/Teams sync jobs AND manual
// notes added here — both live in one table, differentiated by
// source_system and interaction_type.
//
// Mutations go through /api/db/* via the passed `api` client, which means
// every change is logged to audit_log automatically by the audit wrapper.

import { useState, useEffect, useCallback } from "react";

const G = {
  bg: "#060c14", surface: "#0b1521", surface2: "#0f1e2d",
  border: "#192d40", border2: "#1e3a52",
  text: "#e8f0f8", muted: "#8fa3b8", faint: "#4a6480",
  green: "#22c55e", yellow: "#f59e0b", red: "#ef4444",
  blue: "#60a5fa", purple: "#a78bfa", teal: "#2dd4bf",
};

// Lazy-import audited to avoid a circular-ish bundle penalty.
import { audited } from "./lib/audit.js";

const INTERACTION_ICON = {
  call:    "📞",
  meeting: "📅",
  email:   "✉️",
  message: "💬",
  note:    "📝",
  task:    "✅",
};

// Categories the user can pick when logging an activity. Order matters —
// this is the order shown in the picker. Keys match interaction_type.
const NOTE_CATEGORIES = [
  { key: "note",    label: "Note",    color: "#a78bfa" },
  { key: "email",   label: "Email",   color: "#60a5fa" },
  { key: "meeting", label: "Meeting", color: "#2dd4bf" },
];
const CATEGORY_COLOR = Object.fromEntries(NOTE_CATEGORIES.map(c => [c.key, c.color]));

const fmtDT = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
};

export default function AccountDetail({ api, account, onClose, onUpdated }) {
  const [form, setForm] = useState(account);
  const [saving, setSaving] = useState(false);
  const [interactions, setInteractions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newNote, setNewNote] = useState({ subject: "", body: "", category: "note" });
  const [savingNote, setSavingNote] = useState(false);

  // Keep local form in sync if the parent swaps accounts.
  useEffect(() => { setForm(account); }, [account]);

  const loadActivity = useCallback(async () => {
    if (!account?.id) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await api.get("customer_interactions", {
        customer_id: "eq." + account.id,
        select: "*",
        order: "occurred_at.desc",
        limit: "200",
      });
      setInteractions(rows || []);
    } catch (e) {
      setError("Failed to load activity: " + e.message);
    }
    setLoading(false);
  }, [api, account?.id]);

  useEffect(() => { loadActivity(); }, [loadActivity]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const saveContact = async () => {
    setSaving(true);
    try {
      const payload = {
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        address: form.address || null,
        notes: form.notes || null,
        is_active: form.is_active ?? true,
      };
      await audited(
        "customer.update",
        "customers",
        account.id,
        () => api.patch("customers", account.id, payload),
        { before: account, after: payload }
      );
      onUpdated && onUpdated({ ...account, ...payload });
    } catch (e) {
      setError("Save failed: " + e.message);
    }
    setSaving(false);
  };

  const addNote = async () => {
    if (!newNote.subject.trim() && !newNote.body.trim()) return;
    setSavingNote(true);
    try {
      // customer_interactions requires source_system + external_id; we use
      // "manual" + a client-generated id so the UNIQUE constraint still
      // applies even for UI-entered rows.
      const external_id = "manual-" + crypto.randomUUID();
      const row = {
        customer_id: account.id,
        interaction_type: newNote.category || "note",
        source_system: "manual",
        external_id,
        subject: newNote.subject.trim() || null,
        body: newNote.body.trim() || null,
        occurred_at: new Date().toISOString(),
      };
      await audited(
        "customer.note.add",
        "customer_interactions",
        null,
        () => api.post("customer_interactions", [row]),
        { after: row, metadata: { customer_id: account.id } }
      );
      setNewNote({ subject: "", body: "", category: "note" });
      loadActivity();
    } catch (e) {
      setError("Could not save note: " + e.message);
    }
    setSavingNote(false);
  };

  return (
    <div style={{ padding: "22px 28px", overflow: "auto", height: "100%", fontFamily: "Syne,sans-serif", color: G.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <button
          onClick={onClose}
          style={{ background: G.surface, border: "1px solid " + G.border, color: G.muted,
                   padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                   fontFamily: "DM Mono,monospace", fontSize: 11 }}
        >
          ← Back
        </button>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: "0.01em" }}>
          {account.name}
        </h1>
        {account.is_active === false && (
          <span style={{ fontSize: 10, color: G.red, fontFamily: "DM Mono,monospace",
                          letterSpacing: "0.1em", border: "1px solid " + G.red + "55",
                          padding: "3px 8px", borderRadius: 4 }}>INACTIVE</span>
        )}
      </div>

      {error && (
        <div style={{ padding: "9px 12px", background: G.red + "12",
                       border: "1px solid " + G.red + "55", borderRadius: 8,
                       color: G.red, fontFamily: "DM Mono,monospace", fontSize: 12,
                       marginBottom: 14 }}>{error}</div>
      )}

      {/* CONTACT + META */}
      <Card title="CONTACT">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Contact Name"  value={form.contact_name}  onChange={(v) => set("contact_name", v)} />
          <Field label="Contact Email" value={form.contact_email} onChange={(v) => set("contact_email", v)} type="email" />
          <Field label="Phone"         value={form.contact_phone} onChange={(v) => set("contact_phone", v)} />
          <Field label="Address"       value={form.address}       onChange={(v) => set("address", v)} />
          <Field label="Internal Notes" value={form.notes}       onChange={(v) => set("notes", v)} multiline colSpan={2} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <Button variant="primary" onClick={saveContact} disabled={saving}>
            {saving ? "Saving…" : "Save Contact"}
          </Button>
        </div>
      </Card>

      {/* ADD NOTE */}
      <Card title="ADD NOTE">
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: "DM Mono,monospace", letterSpacing: "0.1em",
                          color: G.muted, marginBottom: 5 }}>CATEGORY</div>
            <div style={{ display: "flex", gap: 6 }}>
              {NOTE_CATEGORIES.map((c) => {
                const active = newNote.category === c.key;
                return (
                  <button
                    key={c.key}
                    onClick={() => setNewNote((p) => ({ ...p, category: c.key }))}
                    style={{
                      padding: "6px 14px", borderRadius: 6, cursor: "pointer",
                      background: active ? c.color + "22" : G.surface2,
                      border: "1px solid " + (active ? c.color : G.border),
                      color: active ? c.color : G.muted,
                      fontFamily: "DM Mono,monospace", fontSize: 11, fontWeight: 700,
                      letterSpacing: "0.08em",
                    }}
                  >
                    {INTERACTION_ICON[c.key]} {c.label.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Subject" value={newNote.subject}
                 onChange={(v) => setNewNote((p) => ({ ...p, subject: v }))}
                 placeholder="Subject line for this note" />
          <Field label="Notes" value={newNote.body}
                 onChange={(v) => setNewNote((p) => ({ ...p, body: v }))}
                 placeholder="What happened? What was discussed?" multiline />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <Button variant="primary" onClick={addNote}
                  disabled={savingNote || (!newNote.subject.trim() && !newNote.body.trim())}>
            {savingNote ? "Saving…" : "Add Note"}
          </Button>
        </div>
      </Card>

      {/* ACTIVITY */}
      <Card title={"ACTIVITY · " + interactions.length}>
        {loading ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: G.muted,
                        fontFamily: "DM Mono,monospace", fontSize: 12 }}>
            Loading activity…
          </div>
        ) : interactions.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: G.muted,
                        fontFamily: "DM Mono,monospace", fontSize: 12 }}>
            No activity yet. Add a note above, or connect a Salesforce/Teams
            integration to pull emails and calls automatically.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {interactions.map((i) => (
              <ActivityRow key={i.id} item={i} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ActivityRow({ item }) {
  const icon = INTERACTION_ICON[item.interaction_type] || "•";
  const isManual = item.source_system === "manual";
  const badgeColor = CATEGORY_COLOR[item.interaction_type] || G.faint;
  return (
    <div style={{ display: "flex", gap: 12, padding: "12px 0",
                  borderBottom: "1px solid " + G.border, alignItems: "flex-start" }}>
      <div style={{ width: 28, height: 28, borderRadius: 6, background: G.surface2,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: G.text }}>
            {item.subject || "(no subject)"}
          </div>
          <span style={{ fontSize: 10, fontFamily: "DM Mono,monospace",
                          letterSpacing: "0.08em", fontWeight: 700,
                          padding: "2px 8px", borderRadius: 4,
                          background: badgeColor + "22",
                          border: "1px solid " + badgeColor + "55",
                          color: badgeColor }}>
            {item.interaction_type.toUpperCase()}
          </span>
          {!isManual && (
            <span style={{ fontSize: 10, color: G.faint, fontFamily: "DM Mono,monospace",
                            letterSpacing: "0.08em" }}>
              · {item.source_system.toUpperCase()}
            </span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 11, color: G.muted,
                          fontFamily: "DM Mono,monospace" }}>
            {fmtDT(item.occurred_at)}
          </span>
        </div>
        {item.body && (
          <div style={{ fontSize: 12, color: G.muted, whiteSpace: "pre-wrap",
                        lineHeight: 1.5 }}>{item.body}</div>
        )}
        {item.summary && !item.body && (
          <div style={{ fontSize: 12, color: G.muted, fontStyle: "italic", lineHeight: 1.5 }}>
            {item.summary}
          </div>
        )}
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer"
             style={{ fontSize: 11, color: G.blue, fontFamily: "DM Mono,monospace",
                      textDecoration: "none", display: "inline-block", marginTop: 4 }}>
            View source →
          </a>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: G.surface, border: "1px solid " + G.border,
                  borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontFamily: "DM Mono,monospace",
                    letterSpacing: "0.12em", color: G.muted, marginBottom: 14 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder, multiline, colSpan = 1 }) {
  return (
    <div style={{ gridColumn: `span ${colSpan}` }}>
      <div style={{ fontSize: 10, fontFamily: "DM Mono,monospace", letterSpacing: "0.1em",
                     color: G.muted, marginBottom: 5 }}>{label.toUpperCase()}</div>
      {multiline ? (
        <textarea
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          style={{ width: "100%", background: "#080e18", border: "1px solid " + G.border,
                   color: G.text, padding: "9px 12px", borderRadius: 8,
                   fontFamily: "DM Mono,monospace", fontSize: 12, resize: "vertical" }}
        />
      ) : (
        <input
          type={type}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ width: "100%", background: "#080e18", border: "1px solid " + G.border,
                   color: G.text, padding: "9px 12px", borderRadius: 8,
                   fontFamily: "DM Mono,monospace", fontSize: 12 }}
        />
      )}
    </div>
  );
}

function Button({ variant = "ghost", children, ...rest }) {
  const styles = {
    primary: { background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "#fff", border: "none" },
    ghost:   { background: G.surface, color: G.text, border: "1px solid " + G.border },
  };
  return (
    <button
      {...rest}
      style={{ ...styles[variant], padding: "8px 16px", borderRadius: 7, cursor: "pointer",
               fontSize: 12, fontWeight: 700, fontFamily: "Syne,sans-serif",
               opacity: rest.disabled ? 0.6 : 1 }}
    >
      {children}
    </button>
  );
}
