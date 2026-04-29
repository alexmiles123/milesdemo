import { useState, useEffect, useCallback, useMemo } from "react";
import { G, PHASE_ORDER, HEALTH_OPTIONS, fmtDate, fmtArr } from "../lib/theme.js";
import { validateProject, hasErrors } from "../lib/validation.js";
import { audited } from "../lib/audit.js";
import { Card, CardHeader, Label, Input, Select, Button, FieldError, Toast, Modal, Empty, Th, Td, Pill, Confirm, TextArea } from "./common.jsx";
import ImportModal from "./ImportModal.jsx";
import { PROJECT_IMPORT_SPEC, TASK_IMPORT_SPEC } from "./importSpecs.js";

const BLANK = { name:"", customer_id:"", customer:"", csm_id:"", stage:"Kickoff", health:"green", arr:0, completion_pct:0, target_date:"", notes:"" };

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
  const [taskImportFor, setTaskImportFor] = useState(null); // project pending task import

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
                    <Td style={{ textAlign:"right", whiteSpace:"nowrap" }} onClick={(e)=>e.stopPropagation()}>
                      <Button variant="ghost" onClick={() => setTaskImportFor(p)} style={{ marginRight: 6 }}>Import Tasks</Button>
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

      {taskImportFor && (
        <ImportModal
          title={`Import Tasks → ${taskImportFor.name}`}
          api={api}
          ctx={{ project: taskImportFor }}
          spec={TASK_IMPORT_SPEC}
          onClose={() => setTaskImportFor(null)}
          onDone={(r) => { setToast({ tone: "success", msg: `Imported ${r.created} task${r.created === 1 ? "" : "s"} into "${taskImportFor.name}".` }); setTaskImportFor(null); }}
        />
      )}

      {confirm && <Confirm message={`Delete project "${confirm.name}"? This cascades to tasks and capacity.`} onCancel={() => setConfirm(null)} onConfirm={() => del(confirm)} />}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}

export function ProjectModal({ api, csms, customers = [], initial, mode, onClose, onSaved, lockCustomer = false }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const customerOptions = [{ value: "", label: "— Select customer —" },
    ...customers.filter(c => c.is_active !== false)
                .map(c => ({ value: c.id, label: c.name }))];

  // Load templates once when the create modal opens. Edit mode never needs
  // them — applying retroactively belongs on the project detail page.
  useEffect(() => {
    if (mode !== "create" || templatesLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.call("/api/admin/templates");
        if (cancelled) return;
        const active = ((data && data.templates) || []).filter(t => t.is_active);
        setTemplates(active);
        const def = active.find(t => t.is_default);
        if (def) setTemplateId(def.id);
      } catch { /* templates are optional; project create still works */ }
      if (!cancelled) setTemplatesLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [mode, templatesLoaded, api]);

  const save = async () => {
    const e = validateProject(form);
    setErrors(e);
    if (hasErrors(e)) return;
    setSaving(true);
    try {
      const startDate = new Date().toISOString().slice(0, 10);
      const picked = customers.find(c => c.id === form.customer_id);
      const payload = {
        name: form.name.trim(),
        customer_id: form.customer_id || null,
        // Keep the denormalized customer-name cache in sync so legacy reads
        // (imports, exports, existing reports) keep working.
        customer: picked ? picked.name : (form.customer?.trim() || null),
        csm_id: form.csm_id || null,
        stage: form.stage,
        health: form.health,
        arr: Number(form.arr) || 0,
        completion_pct: Number(form.completion_pct) || 0,
        target_date: form.target_date || null,
      };
      if (mode === "create") {
        payload.start_date = startDate;
        const rows = await audited("project.create", "projects", null, () => api.post("projects", [payload]), { after: payload });
        const created = rows[0];
        if (templateId && created?.id) {
          try {
            await api.call("/api/admin/apply-template", { method: "POST", body: {
              project_id: created.id, template_id: templateId, start_date: startDate,
            }});
          } catch (tplErr) {
            // Project saved, template failed. Surface but don't block.
            setErrors({ _root: "Project created, but template apply failed: " + tplErr.message });
            setSaving(false);
            return;
          }
        }
        onSaved(created, "create");
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
          <Select value={form.customer_id} onChange={v => set("customer_id", v)} options={customerOptions} disabled={lockCustomer} />
          <FieldError error={errors.customer_id} />
          {customers.length === 0 && (
            <div style={{ fontSize: 10, color: G.faint, fontFamily: "Inter,system-ui,sans-serif", marginTop: 4 }}>
              No customers yet — add one from the Customers list first.
            </div>
          )}
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
        {mode === "create" && (
          <div style={{ gridColumn: "span 2", paddingTop: 8, borderTop: "1px dashed " + G.border, marginTop: 4 }}>
            <Label>APPLY TASK TEMPLATE</Label>
            <Select
              value={templateId}
              onChange={setTemplateId}
              options={[{ value: "", label: templates.length ? "— No template —" : "— No templates configured —" },
                       ...templates.map(t => ({ value: t.id, label: t.name + (t.is_default ? "  (default)" : "") + "  ·  " + (t.items?.length || 0) + " tasks" }))]}
            />
            <div style={{ fontSize: 10, color: G.faint, fontFamily: "Inter,system-ui,sans-serif", marginTop: 4 }}>
              Tasks will be added with due dates relative to today. Manage templates under Configuration → Task Templates.
            </div>
          </div>
        )}
      </div>
      {errors._root && (
        <div style={{ marginTop: 14, padding: "9px 12px", background: G.redBg, border: "1px solid " + G.red + "55", borderRadius: 8, color: G.red, fontFamily: "Inter,system-ui,sans-serif", fontSize: 12 }}>{errors._root}</div>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <Button onClick={onClose} variant="ghost">Cancel</Button>
        <Button onClick={save} variant="primary" disabled={saving}>{saving ? "Saving…" : mode === "create" ? "Create Project" : "Save Changes"}</Button>
      </div>
    </Modal>
  );
}
