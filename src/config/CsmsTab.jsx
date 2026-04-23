import { useState, useEffect, useCallback } from "react";
import { G, ROLE_OPTIONS } from "../lib/theme.js";
import { validateCsm, hasErrors } from "../lib/validation.js";
import { audited } from "../lib/audit.js";
import { Card, CardHeader, Label, Input, Select, Button, FieldError, Toast, Modal, Empty, Th, Td, Pill, Confirm } from "./common.jsx";

const BLANK = { name:"", email:"", role:"CSM", is_active:true };

export default function CsmsTab({ api, onChanged }) {
  const [csms, setCsms] = useState([]);
  const [roles, setRoles] = useState([]); // from csm_roles table
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [showRolesModal, setShowRolesModal] = useState(false);

  const loadRoles = useCallback(async () => {
    try {
      const rows = await api.get("csm_roles", { select: "*", order: "sort_order.asc" });
      setRoles(rows || []);
    } catch {
      // Table may not exist yet (migration 004 not applied). Fall back to
      // the legacy hardcoded list so the dropdown still works.
      setRoles(ROLE_OPTIONS.map((n, i) => ({ id: n, name: n, is_active: true, sort_order: (i + 1) * 10 })));
    }
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get("csms", { select:"*", order:"name.asc" });
      setCsms(rows || []);
    } catch (e) { setToast({ tone:"error", msg:"Failed to load CSMs: " + e.message }); }
    setLoading(false);
  }, [api]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); loadRoles(); }, [load, loadRoles]);

  const visible = csms.filter(c => showInactive || c.is_active);

  const toggleActive = async (c) => {
    const before = { ...c };
    const after = { ...c, is_active: !c.is_active };
    setCsms(prev => prev.map(x => x.id === c.id ? after : x));
    try {
      await audited("csm.update", "csms", c.id, () => api.patch("csms", c.id, { is_active: after.is_active }), { before, after });
      onChanged && onChanged();
    } catch (e) {
      setCsms(prev => prev.map(x => x.id === c.id ? before : x));
      setToast({ tone:"error", msg:"Update failed: " + e.message });
    }
  };

  const del = async (c) => {
    setConfirm(null);
    const before = { ...c };
    setCsms(prev => prev.filter(x => x.id !== c.id));
    try {
      await audited("csm.delete", "csms", c.id, () => api.del("csms", c.id), { before });
      setToast({ tone:"success", msg:`Deleted ${c.name}.` });
      onChanged && onChanged();
    } catch (e) {
      setCsms(prev => [...prev, before]);
      setToast({ tone:"error", msg:"Delete failed (CSM may still be assigned to projects): " + e.message });
    }
  };

  return (
    <>
      <Card>
        <CardHeader right={<div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={() => setShowRolesModal(true)}>Manage Roles</Button>
          <Button variant="primary" onClick={() => setModal({ mode:"create", data:{ ...BLANK } })}>+ New CSM</Button>
        </div>}>
          CUSTOMER SUCCESS MANAGERS ({visible.length}{visible.length !== csms.length ? ` of ${csms.length}` : ""})
        </CardHeader>
        <div style={{ padding: "10px 18px", display: "flex", gap: 10, alignItems: "center", borderBottom: "1px solid " + G.border }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "DM Mono,monospace", fontSize: 11, color: G.muted, cursor: "pointer" }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
          </label>
        </div>
        {loading ? <Empty>Loading…</Empty> : visible.length === 0 ? (
          <Empty>No CSMs yet. Create one to start assigning accounts.</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th></Th></tr></thead>
              <tbody>
                {visible.map(c => (
                  <tr key={c.id} style={{ cursor:"pointer" }} className="rh" onClick={() => setModal({ mode:"edit", data: { ...BLANK, ...c } })}>
                    <Td style={{ fontWeight: 700, color: G.text }}>{c.name}</Td>
                    <Td>{c.email || <span style={{ color: G.faint }}>—</span>}</Td>
                    <Td>{c.role}</Td>
                    <Td><Pill tone={c.is_active ? "green" : "muted"}>{c.is_active ? "ACTIVE" : "INACTIVE"}</Pill></Td>
                    <Td style={{ textAlign:"right" }} onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" onClick={() => toggleActive(c)} style={{ marginRight: 6 }}>{c.is_active ? "Deactivate" : "Activate"}</Button>
                      <Button variant="danger" onClick={() => setConfirm(c)}>Delete</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal && (
        <CsmModal api={api} roles={roles} initial={modal.data} mode={modal.mode} onClose={() => setModal(null)}
          onSaved={(row, mode) => {
            setModal(null);
            setToast({ tone:"success", msg: mode === "create" ? `Added ${row.name}.` : `Updated ${row.name}.` });
            load();
            onChanged && onChanged();
          }}
        />
      )}
      {showRolesModal && (
        <RolesModal api={api} roles={roles}
          onClose={() => setShowRolesModal(false)}
          onChanged={() => { loadRoles(); setToast({ tone:"success", msg:"Roles updated." }); }}
        />
      )}
      {confirm && <Confirm message={`Delete CSM "${confirm.name}"? Assigned projects will be unassigned.`} onCancel={() => setConfirm(null)} onConfirm={() => del(confirm)} />}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}

function CsmModal({ api, roles, initial, mode, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    const e = validateCsm(form);
    setErrors(e);
    if (hasErrors(e)) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email?.trim() || null,
        role: form.role || "CSM",
        is_active: !!form.is_active,
      };
      if (mode === "create") {
        const rows = await audited("csm.create", "csms", null, () => api.post("csms", [payload]), { after: payload });
        onSaved(rows[0], "create");
      } else {
        await audited("csm.update", "csms", initial.id, () => api.patch("csms", initial.id, payload), { before: initial, after: payload });
        onSaved({ ...initial, ...payload }, "edit");
      }
    } catch (err) {
      setErrors({ _root: err.message || "Save failed." });
    }
    setSaving(false);
  };

  return (
    <Modal title={mode === "create" ? "New CSM" : "Edit CSM"} onClose={onClose} width={520}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ gridColumn: "span 2" }}>
          <Label>FULL NAME</Label>
          <Input value={form.name} onChange={v => set("name", v)} placeholder="First Last" />
          <FieldError error={errors.name} />
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <Label>EMAIL</Label>
          <Input value={form.email} onChange={v => set("email", v)} placeholder="csm@example.com" type="email" />
          <FieldError error={errors.email} />
        </div>
        <div>
          <Label>ROLE</Label>
          <Select value={form.role} onChange={v => set("role", v)} options={(roles || []).filter(r => r.is_active).map(r => r.name)} />
        </div>
        <div style={{ display:"flex", alignItems:"flex-end" }}>
          <label style={{ display:"flex", alignItems:"center", gap:8, fontFamily:"DM Mono,monospace", fontSize:12, color: G.text, cursor:"pointer" }}>
            <input type="checkbox" checked={!!form.is_active} onChange={e => set("is_active", e.target.checked)} /> Active
          </label>
        </div>
      </div>
      {errors._root && (
        <div style={{ marginTop: 14, padding: "9px 12px", background: G.redBg, border: "1px solid " + G.red + "55", borderRadius: 8, color: G.red, fontFamily: "DM Mono,monospace", fontSize: 12 }}>{errors._root}</div>
      )}
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop: 20 }}>
        <Button onClick={onClose} variant="ghost">Cancel</Button>
        <Button onClick={save} variant="primary" disabled={saving}>{saving ? "Saving…" : mode === "create" ? "Add CSM" : "Save Changes"}</Button>
      </div>
    </Modal>
  );
}

function RolesModal({ api, roles, onClose, onChanged }) {
  const rows = roles || [];
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    if (rows.some(r => r.name.toLowerCase() === name.toLowerCase())) {
      setErr("That role already exists."); return;
    }
    setSaving(true); setErr(null);
    try {
      const nextSort = (rows[rows.length - 1]?.sort_order || 0) + 10;
      const payload = { name, sort_order: nextSort };
      await audited("csm_role.create", "csm_roles", null, () => api.post("csm_roles", [payload]), { after: payload });
      setNewName("");
      onChanged && onChanged();
    } catch (e) {
      setErr(e.message || "Create failed.");
    }
    setSaving(false);
  };

  const toggleActive = async (r) => {
    try {
      await audited("csm_role.update", "csm_roles", r.id, () => api.patch("csm_roles", r.id, { is_active: !r.is_active }), { before: r, after: { ...r, is_active: !r.is_active } });
      onChanged && onChanged();
    } catch (e) {
      setErr(e.message || "Update failed.");
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete role "${r.name}"? CSMs currently using it will keep the text value.`)) return;
    try {
      await audited("csm_role.delete", "csm_roles", r.id, () => api.del("csm_roles", r.id), { before: r });
      onChanged && onChanged();
    } catch (e) {
      setErr(e.message || "Delete failed.");
    }
  };

  return (
    <Modal title="Manage CSM Roles" onClose={onClose} width={560}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Input value={newName} onChange={setNewName} placeholder="New role (e.g. Staff CSM)" />
        <Button variant="primary" onClick={add} disabled={saving || !newName.trim()}>Add</Button>
      </div>
      {err && (
        <div style={{ marginBottom: 12, padding: "8px 12px", background: G.redBg, border: "1px solid " + G.red + "55", borderRadius: 8, color: G.red, fontFamily: "DM Mono,monospace", fontSize: 12 }}>{err}</div>
      )}
      <div style={{ border: "1px solid " + G.border, borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "DM Mono,monospace", fontSize: 12 }}>
          <thead style={{ background: G.surface }}>
            <tr style={{ borderBottom: "1px solid " + G.border }}>
              <th style={{ padding: "8px 12px", textAlign: "left", color: G.muted, letterSpacing: "0.05em" }}>ROLE</th>
              <th style={{ padding: "8px 12px", textAlign: "left", color: G.muted, letterSpacing: "0.05em" }}>STATUS</th>
              <th style={{ padding: "8px 12px", color: G.muted }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 16, textAlign: "center", color: G.muted }}>No roles defined.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} style={{ borderBottom: "1px solid " + G.faint }}>
                <td style={{ padding: "8px 12px", color: G.text, fontWeight: 700 }}>{r.name}</td>
                <td style={{ padding: "8px 12px" }}>
                  <Pill tone={r.is_active ? "green" : "muted"}>{r.is_active ? "ACTIVE" : "DISABLED"}</Pill>
                </td>
                <td style={{ padding: "6px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                  <Button variant="ghost" onClick={() => toggleActive(r)} style={{ marginRight: 6 }}>
                    {r.is_active ? "Disable" : "Enable"}
                  </Button>
                  <Button variant="danger" onClick={() => remove(r)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
