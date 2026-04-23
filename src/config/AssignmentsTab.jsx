import { useState, useEffect, useCallback, useMemo } from "react";
import { G, ASSIGNMENT_ROLES, fmtDate } from "../lib/theme.js";
import { validateAssignment, hasErrors } from "../lib/validation.js";
import { audited } from "../lib/audit.js";
import { Card, CardHeader, Label, Input, Select, Button, FieldError, Toast, Modal, Empty, Th, Td, Pill, Confirm, TextArea } from "./common.jsx";

const BLANK = { csm_id:"", project_id:"", role:"primary", allocation_pct:100, start_date:new Date().toISOString().split("T")[0], end_date:"", notes:"" };

export default function AssignmentsTab({ api, csms, onChanged }) {
  const [assignments, setAssignments] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const [csmFilter, setCsmFilter] = useState("all");
  const [activeOnly, setActiveOnly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, p] = await Promise.all([
        api.get("csm_assignments", { select:"*", order:"updated_at.desc" }).catch(() => []),
        api.get("projects", { select:"id,name,customer,csm_id,stage,health" }),
      ]);
      setAssignments(a || []);
      setProjects(p || []);
    } catch (e) { setToast({ tone:"error", msg:"Failed to load assignments: " + e.message }); }
    setLoading(false);
  }, [api]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const csmById = useMemo(() => Object.fromEntries(csms.map(c => [c.id, c])), [csms]);
  const projectById = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects]);

  const filtered = assignments.filter(a => {
    if (csmFilter !== "all" && a.csm_id !== csmFilter) return false;
    if (activeOnly && a.end_date && a.end_date < new Date().toISOString().split("T")[0]) return false;
    return true;
  });

  const del = async (a) => {
    setConfirm(null);
    const before = { ...a };
    setAssignments(prev => prev.filter(x => x.id !== a.id));
    try {
      await audited("assignment.delete", "csm_assignments", a.id, () => api.del("csm_assignments", a.id), { before });
      setToast({ tone:"success", msg:"Assignment removed." });
      onChanged && onChanged();
    } catch (e) {
      setAssignments(prev => [...prev, before]);
      setToast({ tone:"error", msg:"Delete failed: " + e.message });
    }
  };

  return (
    <>
      <Card>
        <CardHeader right={<Button variant="primary" onClick={() => setModal({ mode:"create", data:{ ...BLANK } })}>+ New Assignment</Button>}>
          CSM ↔ ACCOUNT ASSIGNMENTS ({filtered.length}{filtered.length !== assignments.length ? ` of ${assignments.length}` : ""})
        </CardHeader>
        <div style={{ padding: "10px 18px", display: "flex", gap: 12, alignItems: "center", borderBottom: "1px solid " + G.border }}>
          <Select value={csmFilter} onChange={setCsmFilter}
            options={[{ value:"all", label:"All CSMs" }, ...csms.map(c => ({ value:c.id, label:c.name }))]} style={{ width: 220 }} />
          <label style={{ display:"flex", alignItems:"center", gap:6, fontFamily:"DM Mono,monospace", fontSize:11, color: G.muted, cursor:"pointer" }}>
            <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} /> Active only
          </label>
        </div>
        {loading ? <Empty>Loading…</Empty> : filtered.length === 0 ? (
          <Empty>
            No assignments{assignments.length ? " match the current filters" : " yet"}.
            {projects.length === 0 && " Create a project first."}
            {csms.length === 0 && " Create a CSM first."}
          </Empty>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr>
                <Th>CSM</Th><Th>Account</Th><Th>Role</Th>
                <Th style={{ textAlign:"right" }}>Alloc %</Th>
                <Th>Start</Th><Th>End</Th><Th></Th>
              </tr></thead>
              <tbody>
                {filtered.map(a => {
                  const csm = csmById[a.csm_id], proj = projectById[a.project_id];
                  return (
                    <tr key={a.id} style={{ cursor:"pointer" }} className="rh" onClick={() => setModal({ mode:"edit", data: { ...BLANK, ...a } })}>
                      <Td style={{ fontWeight:700, color:G.text }}>{csm?.name || <span style={{ color:G.red }}>Missing CSM</span>}</Td>
                      <Td>{proj?.name || <span style={{ color:G.red }}>Missing project</span>}</Td>
                      <Td><Pill tone={a.role === "primary" ? "purple" : a.role === "secondary" ? "blue" : "muted"}>{(a.role || "").toUpperCase()}</Pill></Td>
                      <Td style={{ textAlign:"right" }}>{a.allocation_pct}%</Td>
                      <Td>{fmtDate(a.start_date)}</Td>
                      <Td>{a.end_date ? fmtDate(a.end_date) : <span style={{ color: G.green }}>ongoing</span>}</Td>
                      <Td style={{ textAlign:"right" }} onClick={e => e.stopPropagation()}>
                        <Button variant="danger" onClick={() => setConfirm(a)}>Remove</Button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal && (
        <AssignmentModal api={api} csms={csms} projects={projects} initial={modal.data} mode={modal.mode} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); setToast({ tone:"success", msg:"Assignment saved." }); load(); onChanged && onChanged(); }}
        />
      )}
      {confirm && <Confirm message="Remove this assignment?" onCancel={() => setConfirm(null)} onConfirm={() => del(confirm)} />}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}

function AssignmentModal({ api, csms, projects, initial, mode, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    const e = validateAssignment(form);
    setErrors(e);
    if (hasErrors(e)) return;
    setSaving(true);
    try {
      const payload = {
        csm_id: form.csm_id,
        project_id: form.project_id,
        role: form.role,
        allocation_pct: Number(form.allocation_pct) || 100,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        notes: form.notes || null,
      };
      if (mode === "create") {
        await audited("assignment.create", "csm_assignments", null, () => api.post("csm_assignments", [payload]), { after: payload });
      } else {
        await audited("assignment.update", "csm_assignments", initial.id, () => api.patch("csm_assignments", initial.id, payload), { before: initial, after: payload });
      }
      onSaved();
    } catch (err) {
      setErrors({ _root: err.message || "Save failed." });
    }
    setSaving(false);
  };

  return (
    <Modal title={mode === "create" ? "New Assignment" : "Edit Assignment"} onClose={onClose} width={620}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        <div>
          <Label>CSM</Label>
          <Select value={form.csm_id} onChange={v => set("csm_id", v)}
            options={[{ value:"", label:"— Select a CSM —" }, ...csms.filter(c => c.is_active).map(c => ({ value:c.id, label:c.name }))]} />
          <FieldError error={errors.csm_id} />
        </div>
        <div>
          <Label>ACCOUNT / PROJECT</Label>
          <Select value={form.project_id} onChange={v => set("project_id", v)}
            options={[{ value:"", label:"— Select an account —" }, ...projects.map(p => ({ value:p.id, label:p.name }))]} />
          <FieldError error={errors.project_id} />
        </div>
        <div>
          <Label>ROLE</Label>
          <Select value={form.role} onChange={v => set("role", v)} options={ASSIGNMENT_ROLES} />
        </div>
        <div>
          <Label>ALLOCATION %</Label>
          <Input type="number" value={form.allocation_pct} onChange={v => set("allocation_pct", v)} />
          <FieldError error={errors.allocation_pct} />
        </div>
        <div>
          <Label>START DATE</Label>
          <Input type="date" value={form.start_date} onChange={v => set("start_date", v)} />
        </div>
        <div>
          <Label>END DATE (optional)</Label>
          <Input type="date" value={form.end_date} onChange={v => set("end_date", v)} />
          <FieldError error={errors.end_date} />
        </div>
        <div style={{ gridColumn:"span 2" }}>
          <Label>NOTES</Label>
          <TextArea value={form.notes} onChange={v => set("notes", v)} placeholder="Scope, context, handoff notes..." rows={2} />
        </div>
      </div>
      {errors._root && (
        <div style={{ marginTop: 14, padding: "9px 12px", background: G.redBg, border: "1px solid " + G.red + "55", borderRadius: 8, color: G.red, fontFamily: "DM Mono,monospace", fontSize: 12 }}>{errors._root}</div>
      )}
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop: 20 }}>
        <Button onClick={onClose} variant="ghost">Cancel</Button>
        <Button onClick={save} variant="primary" disabled={saving}>{saving ? "Saving…" : mode === "create" ? "Create Assignment" : "Save Changes"}</Button>
      </div>
    </Modal>
  );
}
