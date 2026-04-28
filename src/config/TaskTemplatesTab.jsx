import { useState, useEffect, useCallback } from "react";
import { G, PHASE_ORDER } from "../lib/theme.js";
import { Card, CardHeader, Label, Input, Select, Button, Toast, Modal, Empty, Th, Td, Pill, Confirm } from "./common.jsx";
import ImportModal from "./ImportModal.jsx";

const PRIORITY_OPTS = [
  { value: "critical", label: "Critical" },
  { value: "high",     label: "High" },
  { value: "medium",   label: "Medium" },
  { value: "low",      label: "Low" },
];
const PHASE_OPTS = PHASE_ORDER.map(p => ({ value: p, label: p }));

const BLANK_ITEM = { name: "", phase: "Kickoff", priority: "medium", estimated_hours: "", day_offset: 0, notes: "", sort_order: 1 };

const TEMPLATE_ITEM_IMPORT_SPEC = {
  templateName: "task-template-items.xlsx",
  templateSample: [
    ["Kickoff call",              "Kickoff",       "high",     1.5, 0,  "Initial intros and goal-setting"],
    ["Send welcome email",        "Kickoff",       "medium",   0.5, 1,  ""],
    ["Discovery workshop",        "Discovery",     "high",     4,   5,  ""],
    ["Configure tenant",          "Implementation","high",     8,   10, ""],
    ["UAT cycle",                 "Testing & QA",  "high",     6,   18, ""],
    ["Go-live readiness check",   "Go-Live Prep",  "critical", 2,   25, ""],
    ["Go-live",                   "Go-Live",       "critical", 3,   30, ""],
  ],
  columns: [
    { key: "name",            aliases: ["name", "task", "task name"],                          required: true },
    { key: "phase",           aliases: ["phase", "stage"],                                      parse: "enum",
      values: PHASE_ORDER },
    { key: "priority",        aliases: ["priority"],                                            parse: "enum",
      values: ["critical", "high", "medium", "low"] },
    { key: "estimated_hours", aliases: ["estimated_hours", "hours", "hrs", "estimated hours"], parse: "number" },
    { key: "day_offset",      aliases: ["day_offset", "day offset", "day+", "days", "day"],    parse: "number" },
    { key: "notes",           aliases: ["notes", "note", "description"] },
  ],
};

export default function TaskTemplatesTab({ api }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | "new" | template object
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.call("/api/admin/templates");
      setTemplates((data && data.templates) || []);
    } catch (e) {
      setTemplates([]);
      setToast({ tone: "error", msg: "Failed to load templates: " + e.message });
    }
    setLoading(false);
  }, [api]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const del = async (t) => {
    setConfirm(null);
    try {
      await api.call("/api/admin/templates", { method: "DELETE", body: { id: t.id } });
      setToast({ tone: "success", msg: "Template deleted." });
      await load();
    } catch (e) { setToast({ tone: "error", msg: e.message }); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <CardHeader right={<Button variant="primary" onClick={() => setEditing("new")}>+ New Template</Button>}>
          TASK TEMPLATES · {templates.length}
        </CardHeader>
        {loading ? (
          <Empty>Loading templates…</Empty>
        ) : templates.length === 0 ? (
          <Empty>
            No templates yet. <button onClick={() => setEditing("new")} style={{ background: "none", border: "none", color: G.purple, cursor: "pointer", textDecoration: "underline", fontFamily: "DM Mono,monospace" }}>Create your first template</button> so new projects get a head start.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>NAME</Th>
                  <Th>DESCRIPTION</Th>
                  <Th style={{ textAlign: "center" }}>TASKS</Th>
                  <Th style={{ textAlign: "center" }}>STATUS</Th>
                  <Th style={{ textAlign: "right" }}>ACTIONS</Th>
                </tr>
              </thead>
              <tbody>
                {templates.map(t => (
                  <tr key={t.id}>
                    <Td style={{ color: G.text, fontWeight: 700 }}>
                      {t.name}
                      {t.is_default && <span style={{ marginLeft: 8 }}><Pill tone="purple">DEFAULT</Pill></span>}
                    </Td>
                    <Td style={{ color: G.muted, maxWidth: 400 }}>{t.description || "—"}</Td>
                    <Td style={{ textAlign: "center" }}>{t.items?.length || 0}</Td>
                    <Td style={{ textAlign: "center" }}>{t.is_active ? <Pill tone="green">ACTIVE</Pill> : <Pill tone="muted">INACTIVE</Pill>}</Td>
                    <Td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <Button variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
                        <Button variant="danger" onClick={() => setConfirm(t)}>Delete</Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>HOW TEMPLATES ARE APPLIED</CardHeader>
        <div style={{ padding: 18, fontFamily: "DM Mono,monospace", fontSize: 12, color: G.muted, lineHeight: 1.7 }}>
          When you create a project, choose a template (the one marked DEFAULT is selected automatically) and a start date.
          Every item in the template is added to that project as a task, with its <code style={{ color: G.text }}>proj_date</code> set
          to the start date plus the item's <code style={{ color: G.text }}>day offset</code>. Existing projects can also have a
          template applied retroactively from their detail page; tasks are added, never replaced.
        </div>
      </Card>

      {editing && (
        <TemplateEditor
          api={api}
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setToast({ tone: "success", msg: "Template saved." }); load(); }}
          setToast={setToast}
        />
      )}
      {confirm && <Confirm message={`Delete "${confirm.name}"? Existing projects keep tasks already created from this template.`} onCancel={() => setConfirm(null)} onConfirm={() => del(confirm)} />}
      {toast && <Toast tone={toast.tone}>{toast.msg}<button onClick={() => setToast(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", marginLeft: 12 }}>×</button></Toast>}
    </div>
  );
}

function TemplateEditor({ api, template, onClose, onSaved, setToast }) {
  const [name, setName]               = useState(template?.name || "");
  const [description, setDescription] = useState(template?.description || "");
  const [isDefault, setIsDefault]     = useState(!!template?.is_default);
  const [items, setItems]             = useState(template?.items?.length ? template.items.map(it => ({ ...it })) : [{ ...BLANK_ITEM }]);
  const [busy, setBusy]               = useState(false);
  const [showImport, setShowImport]   = useState(false);

  const updateItem = (idx, patch) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const addItem    = () => setItems(prev => [...prev, { ...BLANK_ITEM, sort_order: prev.length + 1 }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));
  const moveItem   = (idx, delta) => setItems(prev => {
    const next = [...prev];
    const tgt = idx + delta;
    if (tgt < 0 || tgt >= next.length) return prev;
    [next[idx], next[tgt]] = [next[tgt], next[idx]];
    return next.map((it, i) => ({ ...it, sort_order: i + 1 }));
  });

  const handleImportCommit = async (parsed) => {
    const incoming = parsed.map(r => ({
      name:            r.name,
      phase:           r.phase    || "Kickoff",
      priority:        r.priority || "medium",
      estimated_hours: r.estimated_hours ?? "",
      day_offset:      r.day_offset ?? 0,
      notes:           r.notes || "",
      sort_order:      0,
    }));
    setItems(prev => {
      // Replace the lone blank seed row that's there for new templates so the user
      // doesn't have to delete it after import.
      const seed = prev.length === 1 && !(prev[0].name || "").trim();
      const base = seed ? [] : prev;
      return [...base, ...incoming].map((it, i) => ({ ...it, sort_order: i + 1 }));
    });
    return { created: incoming.length };
  };

  const submit = async () => {
    if (!name.trim()) { setToast({ tone: "error", msg: "Template name is required." }); return; }
    if (!items.length || !items.every(it => it.name.trim())) {
      setToast({ tone: "error", msg: "Every task item needs a name." });
      return;
    }
    setBusy(true);
    try {
      if (template) {
        await api.call("/api/admin/templates", { method: "PATCH", body: {
          id: template.id, name, description, is_default: isDefault,
          items: items.map((it, i) => ({ ...it, sort_order: i + 1 })),
        }});
      } else {
        await api.call("/api/admin/templates", { method: "POST", body: {
          name, description, is_default: isDefault,
          items: items.map((it, i) => ({ ...it, sort_order: i + 1 })),
        }});
      }
      onSaved();
    } catch (e) { setToast({ tone: "error", msg: e.message }); }
    setBusy(false);
  };

  return (
    <Modal title={template ? `Edit Template — ${template.name}` : "New Task Template"} onClose={onClose} width={920}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <Label>NAME</Label>
            <Input value={name} onChange={setName} placeholder="Standard Onboarding" />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "DM Mono,monospace", color: G.muted, paddingBottom: 11 }}>
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              Set as default for new projects
            </label>
          </div>
        </div>
        <div>
          <Label>DESCRIPTION</Label>
          <Input value={description} onChange={setDescription} placeholder="When this template should be used." />
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontFamily: "DM Mono,monospace", color: G.muted, letterSpacing: "0.12em" }}>TASK ITEMS · {items.length}</div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <Button variant="default" onClick={() => setShowImport(true)}>↓ Import from Excel</Button>
              <Button variant="default" onClick={addItem}>+ Add task</Button>
            </div>
          </div>
          <div style={{ border: "1px solid " + G.border, borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ background: G.surface2 }}>
                <tr>
                  <Th style={{ width: 32 }}>#</Th>
                  <Th>NAME</Th>
                  <Th style={{ width: 140 }}>PHASE</Th>
                  <Th style={{ width: 110 }}>PRIORITY</Th>
                  <Th style={{ width: 90 }}>HRS</Th>
                  <Th style={{ width: 90 }}>DAY+</Th>
                  <Th style={{ width: 100, textAlign: "right" }}></Th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <Td style={{ color: G.muted, textAlign: "center" }}>{idx + 1}</Td>
                    <Td><Input value={it.name} onChange={(v) => updateItem(idx, { name: v })} placeholder="Task name" /></Td>
                    <Td><Select value={it.phase} onChange={(v) => updateItem(idx, { phase: v })} options={PHASE_OPTS} style={{ padding: "6px 8px", fontSize: 11 }} /></Td>
                    <Td><Select value={it.priority} onChange={(v) => updateItem(idx, { priority: v })} options={PRIORITY_OPTS} style={{ padding: "6px 8px", fontSize: 11 }} /></Td>
                    <Td><Input type="number" value={it.estimated_hours ?? ""} onChange={(v) => updateItem(idx, { estimated_hours: v })} placeholder="—" /></Td>
                    <Td><Input type="number" value={it.day_offset ?? 0} onChange={(v) => updateItem(idx, { day_offset: v })} /></Td>
                    <Td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        <Button variant="ghost" onClick={() => moveItem(idx, -1)} style={{ padding: "4px 8px" }}>↑</Button>
                        <Button variant="ghost" onClick={() => moveItem(idx, 1)} style={{ padding: "4px 8px" }}>↓</Button>
                        <Button variant="danger" onClick={() => removeItem(idx)} style={{ padding: "4px 8px" }}>×</Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10, color: G.faint, fontFamily: "DM Mono,monospace", marginTop: 8 }}>
            DAY+ = number of days after project start_date the task should be due.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : (template ? "Save Changes" : "Create Template")}</Button>
        </div>
      </div>

      {showImport && (
        <ImportModal
          title="Import Task Items from Excel"
          api={api}
          spec={TEMPLATE_ITEM_IMPORT_SPEC}
          onClose={() => setShowImport(false)}
          onCommit={handleImportCommit}
          onDone={(r) => setToast({ tone: "success", msg: `Added ${r.created} task item${r.created === 1 ? "" : "s"}. Review then click ${template ? "Save Changes" : "Create Template"} to persist.` })}
        />
      )}
    </Modal>
  );
}
