// Account detail view — Gainsight-style tabbed workspace.
//
// Replaces the previous stacked-cards layout with a top tab strip:
//   • Summary  — KPIs, AI executive brief, contact at-a-glance, projects
//   • Timeline — interaction feed (emails, calls, notes, meetings) + "Add Note"
//   • Profile  — editable contact form and internal notes
//
// All activity (manual + auto-synced) lives in customer_interactions, the
// same table the Salesforce/Teams sync writes to. Manual entries set
// source_system="manual" and a client-generated external_id so the UNIQUE
// constraint still applies. Mutations go through /api/db/* via the audited
// helper, so every change lands in audit_log automatically.

import { useState, useEffect, useCallback, useMemo } from "react";
import { authedFetch } from "./lib/auth.js";
import { audited } from "./lib/audit.js";
import { G, fmtDate, fmtArr } from "./lib/theme.js";

const INTERACTION_ICON = {
  call:    "📞",
  meeting: "📅",
  email:   "✉️",
  message: "💬",
  note:    "📝",
  task:    "✅",
};

const NOTE_CATEGORIES = [
  { key: "note",    label: "Note",    color: G.purple },
  { key: "email",   label: "Email",   color: G.blue },
  { key: "meeting", label: "Meeting", color: G.teal },
  { key: "call",    label: "Call",    color: G.green },
];
const CATEGORY_COLOR = Object.fromEntries(NOTE_CATEGORIES.map(c => [c.key, c.color]));

const TABS = [
  { id: "summary",  label: "Summary"  },
  { id: "timeline", label: "Timeline" },
  { id: "projects", label: "Projects" },
  { id: "profile",  label: "Profile"  },
];

const fmtDT = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
};

export default function AccountDetail({ api, account, onClose, onUpdated, onProjectSelect }) {
  const [tab, setTab] = useState("summary");
  const [form, setForm] = useState(account);
  const [saving, setSaving] = useState(false);
  const [interactions, setInteractions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryErr, setSummaryErr] = useState(null);

  useEffect(() => { setForm(account); }, [account]);

  const load = useCallback(async () => {
    if (!account?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [acts, projs] = await Promise.all([
        api.get("customer_interactions", {
          customer_id: "eq." + account.id,
          select: "*",
          order: "occurred_at.desc",
          limit: "200",
        }),
        api.get("projects", {
          customer_id: "eq." + account.id,
          select: "*",
          order: "target_date.asc",
          limit: "100",
        }).catch(() => []),
      ]);
      setInteractions(acts || []);
      setProjects(projs || []);
    } catch (e) {
      setError("Failed to load: " + e.message);
    }
    setLoading(false);
  }, [api, account?.id]);

  useEffect(() => { load(); }, [load]);

  // Last-30-days window powers both the summary KPI and the AI brief input.
  const recent = useMemo(() => interactions.filter(i => {
    if (!i.occurred_at) return false;
    return (Date.now() - new Date(i.occurred_at).getTime()) / 86400000 <= 30;
  }), [interactions]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const saveContact = async () => {
    setSaving(true);
    try {
      const payload = {
        contact_name:  form.contact_name  || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        address:       form.address       || null,
        notes:         form.notes         || null,
        is_active:     form.is_active ?? true,
      };
      await audited(
        "customer.update", "customers", account.id,
        () => api.patch("customers", account.id, payload),
        { before: account, after: payload }
      );
      onUpdated && onUpdated({ ...account, ...payload });
    } catch (e) {
      setError("Save failed: " + e.message);
    }
    setSaving(false);
  };

  const summarize = async () => {
    setSummarizing(true);
    setSummaryErr(null);
    try {
      const compact = recent.slice(0, 80).map(i => ({
        when: i.occurred_at, type: i.interaction_type, source: i.source_system,
        subject: i.subject, body: (i.body || i.summary || "").slice(0, 1500),
      }));
      const system = [
        "You are an executive briefing assistant for a professional services firm.",
        "Given a customer's recent activity, produce a crisp 60-second brief for a CRO or VP-level reader.",
        "Be concrete and specific. No filler. Quote names and dates when they matter.",
        'Return ONLY a JSON object with: "tldr" (2-3 sentences), "sentiment" (one of "positive"|"neutral"|"at_risk"|"critical"), "key_points" (3-6 bullets), "action_items" (concrete next steps), "risks" (churn signals, missed commitments).',
        "No markdown, no prose outside the JSON.",
      ].join(" ");
      const userMsg =
        `Account: ${account.name}\nWindow: last 30 days (${compact.length} entries)\n\nActivity:\n` +
        JSON.stringify(compact, null, 2);
      const res = await authedFetch("/api/claude", {
        method: "POST",
        body: JSON.stringify({ system, messages: [{ role: "user", content: userMsg }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const raw = (data.content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch { throw new Error("Couldn't parse AI response."); }
      setSummary({ ...parsed, generated_at: new Date().toISOString(), window_count: compact.length });
    } catch (e) {
      setSummaryErr(e.message || "Could not generate summary.");
    }
    setSummarizing(false);
  };

  if (!account) return null;

  return (
    <div style={{ background: G.bg, minHeight: "100%", color: G.text, fontFamily: "Inter,system-ui,sans-serif" }}>
      {/* HEADER + TAB STRIP */}
      <div style={{ background: G.surface, borderBottom: "1px solid " + G.border, padding: "20px 28px 0 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <button onClick={onClose}
            style={{ background: G.surface2, border: "1px solid " + G.border, color: G.muted,
                     padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
            ← Back
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.01em", color: G.text }}>
            {account.name}
          </h1>
          {account.is_active === false && (
            <span style={{ fontSize: 10, color: G.red, fontFamily: "Inter,system-ui,sans-serif",
                            letterSpacing: "0.1em", border: "1px solid " + G.red + "55",
                            padding: "3px 8px", borderRadius: 4, background: G.redBg }}>INACTIVE</span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 11, color: G.muted, fontFamily: "Inter,system-ui,sans-serif" }}>
            {projects.length} {projects.length === 1 ? "project" : "projects"} · {interactions.length} activities
          </span>
        </div>

        {error && (
          <div style={{ padding: "9px 12px", background: G.redBg, border: "1px solid " + G.red + "55",
                         borderRadius: 8, color: G.red, fontSize: 12, marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 0, marginTop: 4 }}>
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  background: "none", border: "none",
                  color: active ? G.text : G.muted,
                  padding: "12px 18px", cursor: "pointer", fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  borderBottom: active ? "2px solid " + G.purple : "2px solid transparent",
                  marginBottom: -1,
                }}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: "24px 28px" }}>
        {tab === "summary"  && <SummaryTab account={account} projects={projects}
                                            recent={recent}
                                            summary={summary} summarizing={summarizing}
                                            summaryErr={summaryErr} onSummarize={summarize}
                                            onProjectSelect={onProjectSelect} loading={loading} />}
        {tab === "timeline" && <TimelineTab api={api} account={account}
                                             interactions={interactions} loading={loading}
                                             onRefresh={load} setError={setError} />}
        {tab === "projects" && <ProjectsTab projects={projects} onProjectSelect={onProjectSelect} />}
        {tab === "profile"  && <ProfileTab form={form} set={set} onSave={saveContact} saving={saving} />}
      </div>
    </div>
  );
}

// ─── SUMMARY TAB ─────────────────────────────────────────────────────────────
function SummaryTab({ account, projects, recent, summary, summarizing, summaryErr, onSummarize, onProjectSelect, loading }) {
  const totalArr = projects.reduce((s, p) => s + (Number(p.arr) || 0), 0);
  const activeProjects = projects.filter(p => p.stage !== "Go-Live").length;
  const atRisk = projects.filter(p => p.health === "yellow" || p.health === "red").length;
  const recentActivity = recent.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* KPI ROW */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        <Kpi label="Combined ARR"        value={fmtArr(totalArr)} accent={G.purple}/>
        <Kpi label="Active Projects"     value={activeProjects}    accent={G.blue}/>
        <Kpi label="Projects At Risk"    value={atRisk}            accent={atRisk > 0 ? G.red : G.green}/>
        <Kpi label="Activity (30d)"      value={recentActivity}    accent={G.teal}/>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        {/* AI EXEC SUMMARY */}
        <Card title="EXECUTIVE BRIEF · LAST 30 DAYS">
          {!summary && !summarizing && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
              <div style={{ color: G.muted, fontSize: 13 }}>
                {recent.length === 0
                  ? "No activity in the last 30 days — nothing to summarize."
                  : "Generate an AI-written briefing: TL;DR, key points, action items, and risks."}
              </div>
              <PrimaryButton onClick={onSummarize} disabled={recent.length === 0}>
                Generate Summary
              </PrimaryButton>
            </div>
          )}
          {summarizing && (
            <div style={{ color: G.muted, fontSize: 13, padding: "8px 0" }}>
              Reading {recent.length} activity entries…
            </div>
          )}
          {summaryErr && (
            <div style={{ color: G.red, fontSize: 12, padding: "4px 0" }}>{summaryErr}</div>
          )}
          {summary && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <SentimentBadge sentiment={summary.sentiment}/>
                <span style={{ fontSize: 10, color: G.faint, fontFamily: "Inter,system-ui,sans-serif",
                                letterSpacing: "0.08em", marginLeft: "auto" }}>
                  Generated {fmtDT(summary.generated_at)} · {summary.window_count} items analyzed
                </span>
                <button onClick={onSummarize} disabled={summarizing}
                  style={{ background: "transparent", border: "1px solid " + G.border,
                           color: G.muted, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                           fontFamily: "Inter,system-ui,sans-serif", fontSize: 10 }}>
                  ↻ Refresh
                </button>
              </div>
              {summary.tldr && (
                <div style={{ fontSize: 14, color: G.text, lineHeight: 1.55 }}>{summary.tldr}</div>
              )}
              <SummaryList label="Key Points"   items={summary.key_points}   color={G.blue}/>
              <SummaryList label="Action Items" items={summary.action_items} color={G.green}/>
              <SummaryList label="Risks"        items={summary.risks}        color={G.red}/>
            </div>
          )}
        </Card>

        {/* CONTACT AT-A-GLANCE */}
        <Card title="CONTACT">
          <Glance label="Primary"  value={account.contact_name  || "—"}/>
          <Glance label="Email"    value={account.contact_email || "—"}/>
          <Glance label="Phone"    value={account.contact_phone || "—"}/>
          <Glance label="Address"  value={account.address       || "—"}/>
        </Card>
      </div>

      {/* PROJECTS PREVIEW */}
      <Card title={`PROJECTS · ${projects.length}`}>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : projects.length === 0 ? (
          <Empty>No projects yet for this account.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {projects.slice(0, 8).map(p => (
              <ProjectRow key={p.id} project={p} onSelect={onProjectSelect}/>
            ))}
            {projects.length > 8 && (
              <div style={{ padding: "10px 0 0", fontSize: 11, color: G.faint, fontFamily: "Inter,system-ui,sans-serif" }}>
                + {projects.length - 8} more — see Projects tab
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── TIMELINE TAB ────────────────────────────────────────────────────────────
function TimelineTab({ api, account, interactions, loading, onRefresh, setError }) {
  const [newNote, setNewNote] = useState({ subject: "", body: "", category: "note" });
  const [savingNote, setSavingNote] = useState(false);
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all"
    ? interactions
    : interactions.filter(i => i.interaction_type === filter);

  const addNote = async () => {
    if (!newNote.subject.trim() && !newNote.body.trim()) return;
    setSavingNote(true);
    try {
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
        "customer.note.add", "customer_interactions", null,
        () => api.post("customer_interactions", [row]),
        { after: row, metadata: { customer_id: account.id } }
      );
      setNewNote({ subject: "", body: "", category: "note" });
      onRefresh();
    } catch (e) {
      setError("Could not save note: " + e.message);
    }
    setSavingNote(false);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20, alignItems: "start" }}>
      {/* FEED */}
      <Card title={`ACTIVITY · ${filtered.length} of ${interactions.length}`}
            right={
              <div style={{ display: "flex", gap: 4 }}>
                {[
                  { key: "all",     label: "All"      },
                  { key: "email",   label: "Email"    },
                  { key: "meeting", label: "Meeting"  },
                  { key: "call",    label: "Call"     },
                  { key: "note",    label: "Note"     },
                ].map(f => {
                  const active = filter === f.key;
                  return (
                    <button key={f.key} onClick={() => setFilter(f.key)}
                      style={{
                        background: active ? G.blueBg : "transparent",
                        border: "1px solid " + (active ? G.blue : G.border),
                        color: active ? G.blue : G.muted,
                        padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                        fontFamily: "Inter,system-ui,sans-serif", fontSize: 10, fontWeight: 600,
                        letterSpacing: "0.05em",
                      }}>
                      {f.label}
                    </button>
                  );
                })}
              </div>
            }>
        {loading ? (
          <Empty>Loading activity…</Empty>
        ) : filtered.length === 0 ? (
          <Empty>
            {filter === "all"
              ? "No activity yet. Add a note on the right, or connect Salesforce/Teams to pull emails and calls automatically."
              : "No activity matching this filter."}
          </Empty>
        ) : (
          <div>{filtered.map(i => <ActivityRow key={i.id} item={i}/>)}</div>
        )}
      </Card>

      {/* ADD NOTE */}
      <Card title="LOG ACTIVITY">
        <Label>TYPE</Label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {NOTE_CATEGORIES.map(c => {
            const active = newNote.category === c.key;
            return (
              <button key={c.key}
                onClick={() => setNewNote(p => ({ ...p, category: c.key }))}
                style={{
                  padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                  background: active ? c.color + "1a" : G.surface2,
                  border: "1px solid " + (active ? c.color : G.border),
                  color: active ? c.color : G.muted,
                  fontFamily: "Inter,system-ui,sans-serif", fontSize: 11, fontWeight: 600,
                  letterSpacing: "0.05em",
                }}>
                {INTERACTION_ICON[c.key]} {c.label}
              </button>
            );
          })}
        </div>

        <Label>SUBJECT</Label>
        <Input value={newNote.subject}
               onChange={(v) => setNewNote(p => ({ ...p, subject: v }))}
               placeholder="Subject line"/>
        <div style={{ height: 10 }}/>
        <Label>NOTES</Label>
        <Input value={newNote.body}
               onChange={(v) => setNewNote(p => ({ ...p, body: v }))}
               placeholder="What happened? What was discussed?" multiline rows={5}/>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <PrimaryButton onClick={addNote}
            disabled={savingNote || (!newNote.subject.trim() && !newNote.body.trim())}>
            {savingNote ? "Saving…" : "Save Activity"}
          </PrimaryButton>
        </div>
      </Card>
    </div>
  );
}

// ─── PROJECTS TAB ────────────────────────────────────────────────────────────
function ProjectsTab({ projects, onProjectSelect }) {
  if (projects.length === 0) {
    return <Card title="PROJECTS"><Empty>No projects for this account.</Empty></Card>;
  }
  return (
    <Card title={`PROJECTS · ${projects.length}`}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {projects.map(p => (
          <ProjectRow key={p.id} project={p} onSelect={onProjectSelect}/>
        ))}
      </div>
    </Card>
  );
}

// ─── PROFILE TAB ─────────────────────────────────────────────────────────────
function ProfileTab({ form, set, onSave, saving }) {
  return (
    <Card title="CONTACT">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Field label="Contact Name"   value={form.contact_name}  onChange={v => set("contact_name", v)}/>
        <Field label="Contact Email"  value={form.contact_email} onChange={v => set("contact_email", v)} type="email"/>
        <Field label="Phone"          value={form.contact_phone} onChange={v => set("contact_phone", v)}/>
        <Field label="Address"        value={form.address}       onChange={v => set("address", v)}/>
        <Field label="Internal Notes" value={form.notes}         onChange={v => set("notes", v)} multiline colSpan={2} rows={4}/>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <PrimaryButton onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save Contact"}
        </PrimaryButton>
      </div>
    </Card>
  );
}

// ─── ROW & PRIMITIVES ────────────────────────────────────────────────────────
function ActivityRow({ item }) {
  const icon = INTERACTION_ICON[item.interaction_type] || "•";
  const isManual = item.source_system === "manual";
  const badgeColor = CATEGORY_COLOR[item.interaction_type] || G.faint;
  return (
    <div style={{ display: "flex", gap: 12, padding: "14px 0",
                  borderBottom: "1px solid " + G.border, alignItems: "flex-start" }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: G.surface2,
                    border: "1px solid " + G.border,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: G.text }}>
            {item.subject || "(no subject)"}
          </div>
          <span style={{ fontSize: 10, fontFamily: "Inter,system-ui,sans-serif",
                          letterSpacing: "0.05em", fontWeight: 700,
                          padding: "2px 8px", borderRadius: 4,
                          background: badgeColor + "1a",
                          border: "1px solid " + badgeColor + "55",
                          color: badgeColor }}>
            {item.interaction_type.toUpperCase()}
          </span>
          {!isManual && (
            <span style={{ fontSize: 10, color: G.faint, fontFamily: "Inter,system-ui,sans-serif",
                            letterSpacing: "0.05em" }}>
              · {item.source_system.toUpperCase()}
            </span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 11, color: G.muted,
                          fontFamily: "Inter,system-ui,sans-serif" }}>
            {fmtDT(item.occurred_at)}
          </span>
        </div>
        {item.body && (
          <div style={{ fontSize: 13, color: G.muted, whiteSpace: "pre-wrap",
                        lineHeight: 1.55 }}>{item.body}</div>
        )}
        {item.summary && !item.body && (
          <div style={{ fontSize: 13, color: G.muted, fontStyle: "italic", lineHeight: 1.55 }}>
            {item.summary}
          </div>
        )}
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer"
             style={{ fontSize: 11, color: G.blue, fontFamily: "Inter,system-ui,sans-serif",
                      textDecoration: "none", display: "inline-block", marginTop: 4 }}>
            View source →
          </a>
        )}
      </div>
    </div>
  );
}

function ProjectRow({ project, onSelect }) {
  const healthColor = project.health === "red" ? G.red : project.health === "yellow" ? G.yellow : G.green;
  const stage = project.stage || "—";
  return (
    <button onClick={() => onSelect && onSelect(project)}
      style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0",
               borderBottom: "1px solid " + G.border, background: "transparent",
               border: "none", borderBottomWidth: 1, cursor: "pointer",
               textAlign: "left", width: "100%" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: healthColor, flexShrink: 0 }}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: G.text, whiteSpace: "nowrap",
                       overflow: "hidden", textOverflow: "ellipsis" }}>
          {project.name || "(unnamed project)"}
        </div>
        <div style={{ fontSize: 11, color: G.muted, fontFamily: "Inter,system-ui,sans-serif", marginTop: 2 }}>
          {stage} · target {fmtDate(project.target_date)} · {project.completion_pct ?? 0}% complete
        </div>
      </div>
      <span style={{ fontSize: 12, color: G.text, fontFamily: "Inter,system-ui,sans-serif", fontVariantNumeric: "tabular-nums" }}>
        {fmtArr(project.arr)}
      </span>
      <span style={{ color: G.faint, fontSize: 14 }}>›</span>
    </button>
  );
}

const SENTIMENT = {
  positive: { label: "POSITIVE", color: G.green  },
  neutral:  { label: "NEUTRAL",  color: G.muted  },
  at_risk:  { label: "AT RISK",  color: G.yellow },
  critical: { label: "CRITICAL", color: G.red    },
};
function SentimentBadge({ sentiment }) {
  const s = SENTIMENT[sentiment] || SENTIMENT.neutral;
  return (
    <span style={{ fontSize: 10, fontFamily: "Inter,system-ui,sans-serif", letterSpacing: "0.1em",
                    fontWeight: 700, padding: "3px 10px", borderRadius: 4,
                    background: s.color + "1a", border: "1px solid " + s.color + "66",
                    color: s.color }}>
      {s.label}
    </span>
  );
}

function SummaryList({ label, items, color }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 10, fontFamily: "Inter,system-ui,sans-serif", letterSpacing: "0.12em",
                     color: color, marginBottom: 6, fontWeight: 700 }}>
        {label.toUpperCase()}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((item, i) => (
          <li key={i} style={{ fontSize: 13, color: G.text, lineHeight: 1.55 }}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Kpi({ label, value, accent }) {
  return (
    <div style={{ background: G.surface, border: "1px solid " + G.border, borderRadius: 12,
                  padding: "16px 18px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent }}/>
      <div style={{ fontSize: 10, fontFamily: "Inter,system-ui,sans-serif", color: G.muted,
                     letterSpacing: "0.12em", marginBottom: 6 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: G.text, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}

function Card({ title, right, children }) {
  return (
    <div style={{ background: G.surface, border: "1px solid " + G.border, borderRadius: 12,
                  padding: "16px 20px", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontFamily: "Inter,system-ui,sans-serif", letterSpacing: "0.12em",
                       color: G.muted, fontWeight: 600 }}>
          {title}
        </div>
        {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ padding: "32px 16px", textAlign: "center", color: G.muted, fontSize: 13 }}>
      {children}
    </div>
  );
}

function Glance({ label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontFamily: "Inter,system-ui,sans-serif", color: G.muted,
                     letterSpacing: "0.1em", marginBottom: 2 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 13, color: G.text, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 10, fontFamily: "Inter,system-ui,sans-serif", letterSpacing: "0.1em",
                   color: G.muted, marginBottom: 5 }}>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, multiline, rows = 3 }) {
  const style = {
    width: "100%", background: G.surface, border: "1px solid " + G.border,
    color: G.text, padding: "9px 12px", borderRadius: 8,
    fontFamily: "Inter,system-ui,sans-serif", fontSize: 13,
    resize: multiline ? "vertical" : "none",
  };
  return multiline
    ? <textarea value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} style={style}/>
    : <input    value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder}            style={style}/>;
}

function Field({ label, value, onChange, type = "text", placeholder, multiline, colSpan = 1, rows = 3 }) {
  return (
    <div style={{ gridColumn: `span ${colSpan}` }}>
      <Label>{label}</Label>
      {multiline ? (
        <textarea value={value || ""} onChange={e => onChange(e.target.value)}
                  placeholder={placeholder} rows={rows}
                  style={{ width: "100%", background: G.surface, border: "1px solid " + G.border,
                           color: G.text, padding: "9px 12px", borderRadius: 8,
                           fontFamily: "Inter,system-ui,sans-serif", fontSize: 13, resize: "vertical" }}/>
      ) : (
        <input type={type} value={value || ""} onChange={e => onChange(e.target.value)}
               placeholder={placeholder}
               style={{ width: "100%", background: G.surface, border: "1px solid " + G.border,
                        color: G.text, padding: "9px 12px", borderRadius: 8,
                        fontFamily: "Inter,system-ui,sans-serif", fontSize: 13 }}/>
      )}
    </div>
  );
}

function PrimaryButton({ children, ...rest }) {
  return (
    <button {...rest}
      style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "#fff",
               border: "none", padding: "8px 16px", borderRadius: 7, cursor: "pointer",
               fontSize: 13, fontWeight: 600, fontFamily: "Inter,system-ui,sans-serif",
               opacity: rest.disabled ? 0.55 : 1 }}>
      {children}
    </button>
  );
}
