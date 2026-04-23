import { useState, useEffect, useCallback, useMemo } from "react";
import { G, PHASE_ORDER, HEALTH_OPTIONS, fmtDate, fmtArr } from "../lib/theme.js";
import { validateProject, hasErrors } from "../lib/validation.js";
import { audited } from "../lib/audit.js";
import { Card, CardHeader, Label, Input, Select, Button, FieldError, Toast, Modal, Empty, Th, Td, Pill, Confirm, TextArea } from "./common.jsx";
import ImportModal from "./ImportModal.jsx";

const BLANK = { name:"", customer:"", csm_id:"", stage:"Kickoff", health:"green", arr:0, completion_pct:0, target_date:"", notes:"" };

export default function ProjectsTab({ api, csms, onChanged }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [modal, setModal] = useState(null); // { mode:"create"|"edit", data }
  const [confirm, setConfirm] = useState(null); // project pending delete
  const [toast, setToast] = useState(null);
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get("projects", { select: "*", order: "updated_at.desc" });
      setProjects(rows || []);
    } catch (e) {
      setToast({ tone:"error", msg:"Failed to load projects: " + e.message });
    }
    setLoading(false);
  }, [api]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const csmById = useMemo(() => Object.fromEntries(csms.map(c => [c.id, c])), [csms]);

  const filtered = projects.filter(p => {
    if (healthFilter !== "all" && p.health !== healthFilter) return false;
    if (stageFilter !== "all" && p.stage !== stageFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!(p.name || "").toLowerCase().includes(s) &&
          !(p.customer || "").toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const openCreate = () => setModal({ mode:"create", data:{ ...BLANK } });
  const openEdit   = (p) => setModal({ mode:"edit", data:{ ...BLANK, ...p, csm_id: p.csm_id || "", target_date: p.target_date || "" } });
  const closeModal = () => setModal(null);

  const del = async (p) => {
    setConfirm(null);
    const before = { ...p };
    setProjects(prev => prev.filter(x => x.id !== p.id));
    try {
      await audited("project.delete", "projects", p.id, () => api.del("projects", p.id), { before });
      setToast({ tone:"success", msg:`Deleted "${p.name}".` });
      onChanged && onChanged();
    } catch (e) {
      setProjects(prev => [...prev, before]);
      setToast({ tone:"error", msg:"Delete failed: " + e.message });
    }
  };

  return (
    <>
      <Card>
        <CardHeader right={<div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={() => setShowImport(true)}>Import from Excel</Button>
          <Button variant="primary" onClick={openCreate}>+ New Project</Button>
        </div>}>
          ACCOUNTS · PROJECTS ({filtered.length}{filtered.length !== projects.length ? ` of ${projects.length}` : ""})
        </CardHeader>
        <div style={{ padding: "12px 18px", display: "flex", gap: 10, alignItems: "center", borderBottom: "1px solid " + G.border }}>
          <Input value={search} onChange={setSearch} placeholder="Search by name or customer..." style={{ flex: 1, maxWidth: 360 }} />
          <Select value={healthFilter} onChange={setHealthFilter} options={[{ value:"all", label:"All health" }, ...HEALTH_OPTIONS]} style={{ width: 150 }} />
          <Select value={stageFilter} onChange={setStageFilter} options={[{ value:"all", label:"All stages" }, ...PHASE_ORDER.map(s => ({ value:s, label:s }))]} style={{ width: 180 }} />
        </div>
        {loading ? <Empty>Loading…</Empty> : filtered.length === 0 ? (
          <Empty>{projects.length === 0 ? "No projects yet. Create your first one." : "No projects match your filters."}</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>Name</Th><Th>Customer</Th><Th>CSM</Th><Th>Stage</Th><Th>Health</Th>
                  <Th style={{ textAlign:"right" }}>ARR</Th>
                  <Th style={{ textAlign:"right" }}>Done %</Th>
                  <Th>Target</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} style={{ cursor: "pointer" }} className="rh" onClick={() => openEdit(p)}>
                    <Td style={{ fontWeight: 700, color: G.text }}>{p.name}</Td>
                    <Td>{p.customer || "—"}</Td>
                    <Td>{csmById[p.csm_id]?.name || <span style={{ color: G.faint }}>Unassigned</span>}</Td>
                    <Td>{p.stage}</Td>
                    <Td><Pill tone={p.health}>{(HEALTH_OPTIONS.find(h => h.value === p.health) || {}).label || p.health}</Pill></Td>
                    <Td style={{ textAlign:"right", fontVariantNumeric: "tabular-nums" }}>{fmtArr(p.arr)}</Td>
                    <Td style={{ textAlign:"right" }}>{p.completion_pct ?? 0}%</Td>
                    <Td>{fmtDate(p.target_date)}</Td>
                    <Td style={{ textAlign:"right" }} onClick={(e)=>e.stopPropagation()}>
                      <Button variant="danger" onClick={() => setConfirm(p)}>Delete</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal && (
        <ProjectModal
          api={api} csms={csms} initial={modal.data} mode={modal.mode}
          onClose={closeModal}
          onSaved={(row, mode) => {
            closeModal();
            setToast({ tone:"success", msg: mode === "create" ? `Created "${row.name}".` : `Updated "${row.name}".` });
            load();
            onChanged && onChanged();
          }}
        />
      )}

      {showImport && (
        <ImportModal
          title="Import Projects from Excel"
          api={api}
          ctx={{ csms }}
          spec={PROJECT_IMPORT_SPEC}
          onClose={() => setShowImport(false)}
          onDone={(r) => { setToast({ tone: "success", msg: `Imported ${r.created} project${r.created === 1 ? "" : "s"}.` }); load(); onChanged && onChanged(); }}
        />
      )}

      {confirm && <Confirm message={`Delete project "${confirm.name}"? This cascades to tasks and capacity.`} onCancel={() => setConfirm(null)} onConfirm={() => del(confirm)} />}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}

const PROJECT_IMPORT_SPEC = {
  table: "projects",
  auditAction: "project.import",
  templateName: "projects-import-template.xlsx",
  templateSample: [
    ["Acme Implementation", "Acme Corp", "Alex Miles", "Kickoff", "On Track", 120000, 0, "2026-09-30"],
    ["Globex Rollout", "Globex", "Morgan Wu", "Discovery", "At Risk", 80000, 25, "2026-07-15"],
  ],
  defaults: { stage: "Kickoff", health: "green", completion_pct: 0, arr: 0 },
  columns: [
    { key: "name", aliases: ["name", "project name", "project"], required: true },
    { key: "customer", aliases: ["customer", "account", "customer name"] },
    {
      key: "csm_id",
      aliases: ["csm", "owner", "csm name"],
      lookup: (val, ctx) => {
        const csm = ctx.csms.find(c => c.name.toLowerCase() === val.toLowerCase());
        return csm ? csm.id : null;
      },
      requiredMsg: "CSM name not found — create the CSM first",
    },
    { key: "stage", aliases: ["stage", "phase"], parse: "enum", values: PHASE_ORDER },
    { key: "health", aliases: ["health", "status"], parse: "healthEnum" },
    { key: "arr", aliases: ["arr", "annual recurring revenue", "revenue"], parse: "number" },
    { key: "completion_pct", aliases: ["completion %", "completion_pct", "completion", "done %"], parse: "number" },
    { key: "target_date", aliases: ["target date", "target", "go-live", "target go-live"], parse: "date" },
    { key: "notes", aliases: ["notes"] },
  ],
  transformRow: (r) => ({ ...r, start_date: new Date().toISOString().slice(0, 10) }),
};

function ProjectModal({ api, csms, initial, mode, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    const e = validateProject(form);
    setErrors(e);
    if (hasErrors(e)) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        customer: form.customer?.trim() || null,
        csm_id: form.csm_id || null,
        stage: form.stage,
        health: form.health,
        arr: Number(form.arr) || 0,
        completion_pct: Number(form.completion_pct) || 0,
        target_date: form.target_date || null,
      };
      if (mode === "create") {
        payload.start_date = new Date().toISOString().slice(0, 10);
        const rows = await audited("project.create", "projects", null, () => api.post("projects", [payload]), { after: payload });
        onSaved(rows[0], "create");
      } else {
        await audited("project.update", "projects", initial.id, () => api.patch("projects", initial.id, payload), { before: initial, after: payload });
        onSaved({ ...initial, ...payload }, "edit");
      }
    } catch (err) {
      setErrors({ _root: err.message || "Save failed." });
    }
    setSaving(false);
  };

  return (
    <Modal title={mode === "create" ? "New Project" : "Edit Project"} onClose={onClose} width={620}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ gridColumn: "span 2" }}>
          <Label>PROJECT NAME</Label>
          <Input value={form.name} onChange={v => set("name", v)} placeholder="e.g. Acme Corp Implementation" />
          <FieldError error={errors.name} />
        </div>
        <div>
          <Label>CUSTOMER</Label>
          <Input value={form.customer} onChange={v => set("customer", v)} placeholder="Customer / account name" />
        </div>
        <div>
          <Label>CSM</Label>
          <Select value={form.csm_id} onChange={v => set("csm_id", v)}
            options={[{ value:"", label:"— Unassigned —" }, ...csms.map(c => ({ value:c.id, label:c.name }))]} />
        </div>
        <div>
          <Label>STAGE</Label>
          <Select value={form.stage} onChange={v => set("stage", v)} options={PHASE_ORDER.map(s => ({ value:s, label:s }))} />
        </div>
        <div>
          <Label>HEALTH</Label>
          <Select value={form.health} onChange={v => set("health", v)} options={HEALTH_OPTIONS} />
        </div>
        <div>
          <Label>ARR ($/yr)</Label>
          <Input type="number" value={form.arr} onChange={v => set("arr", v)} />
          <FieldError error={errors.arr} />
        </div>
        <div>
          <Label>COMPLETION %</Label>
          <Input type="number" value={form.completion_pct} onChange={v => set("completion_pct", v)} />
          <FieldError error={errors.completion_pct} />
        </div>
        <div>
          <Label>TARGET GO-LIVE</Label>
          <Input type="date" value={form.target_date} onChange={v => set("target_date", v)} />
          <FieldError error={errors.target_date} />
        </div>
      </div>
      {errors._root && (
        <div style={{ marginTop: 14, padding: "9px 12px", background: G.redBg, border: "1px solid " + G.red + "55", borderRadius: 8, color: G.red, fontFamily: "DM Mono,monospace", fontSize: 12 }}>{errors._root}</div>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <Button onClick={onClose} variant="ghost">Cancel</Button>
        <Button onClick={save} variant="primary" disabled={saving}>{saving ? "Saving…" : mode === "create" ? "Create Project" : "Save Changes"}</Button>
      </div>
    </Modal>
  );
}
