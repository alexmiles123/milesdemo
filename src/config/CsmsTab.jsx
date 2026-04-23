import { useState, useEffect, useCallback } from "react";
import { G, ROLE_OPTIONS } from "../lib/theme.js";
import { validateCsm, hasErrors } from "../lib/validation.js";
import { audited } from "../lib/audit.js";
import { Card, CardHeader, Label, Input, Select, Button, FieldError, Toast, Modal, Empty, Th, Td, Pill, Confirm } from "./common.jsx";

const BLANK = { name:"", email:"", role:"CSM", is_active:true };

export default function CsmsTab({ api, onChanged }) {
  const [csms, setCsms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get("csms", { select:"*", order:"name.asc" });
      setCsms(rows || []);
    } catch (e) { setToast({ tone:"error", msg:"Failed to load CSMs: " + e.message }); }
    setLoading(false);
  }, [api]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

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
        <CardHeader right={<Button variant="primary" onClick={() => setModal({ mode:"create", data:{ ...BLANK } })}>+ New CSM</Button>}>
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
        <CsmModal api={api} initial={modal.data} mode={modal.mode} onClose={() => setModal(null)}
          onSaved={(row, mode) => {
            setModal(null);
            setToast({ tone:"success", msg: mode === "create" ? `Added ${row.name}.` : `Updated ${row.name}.` });
            load();
            onChanged && onChanged();
          }}
        />
      )}
      {confirm && <Confirm message={`Delete CSM "${confirm.name}"? Assigned projects will be unassigned.`} onCancel={() => setConfirm(null)} onConfirm={() => del(confirm)} />}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}

function CsmModal({ api, initial, mode, onClose, onSaved }) {
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
          <Select value={form.role} onChange={v => set("role", v)} options={ROLE_OPTIONS} />
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
