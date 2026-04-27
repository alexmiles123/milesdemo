import { useState, useEffect, useCallback } from "react";
import { G } from "../lib/theme.js";
import { Card, CardHeader, Label, Input, TextArea, Button, FieldError, Toast, Modal, Empty, Th, Td, Pill, Confirm } from "./common.jsx";

// App-roles management. Lists every role in the `app_roles` table, lets an
// admin add custom ones (e.g. "Director", "Sales Engineer") with their own
// view permissions, and edit the labels/descriptions of system roles. The
// three system roles (admin, csm, viewer) cannot be renamed or deleted —
// other parts of the codebase reference those names by string.
export default function RolesTab({ api }) {
  const [roles, setRoles]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState(null); // role row in edit mode
  const [adding, setAdding]     = useState(false);
  const [confirm, setConfirm]   = useState(null);
  const [toast, setToast]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.call("/api/admin/roles");
      setRoles((data && data.roles) || []);
    } catch (e) {
      setRoles([]);
      setToast({ tone: "error", msg: "Failed to load roles: " + e.message });
    }
    setLoading(false);
  }, [api]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const remove = async (r) => {
    setConfirm(null);
    try {
      await api.call("/api/admin/roles", { method: "DELETE", body: { name: r.name } });
      setToast({ tone: "success", msg: `Deleted role "${r.label || r.name}".` });
      await load();
    } catch (e) { setToast({ tone: "error", msg: e.message }); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <CardHeader right={<Button variant="primary" onClick={() => setAdding(true)}>+ Add Role</Button>}>
          ROLES · {roles.length}
        </CardHeader>
        {loading ? (
          <Empty>Loading roles…</Empty>
        ) : roles.length === 0 ? (
          <Empty>
            No roles defined. Apply migration <code style={{ color: G.purple }}>010_app_roles.sql</code> in Supabase to seed the system roles.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>NAME</Th>
                  <Th>LABEL</Th>
                  <Th>DESCRIPTION</Th>
                  <Th style={{ textAlign: "center" }}>EXEC VIEW</Th>
                  <Th style={{ textAlign: "center" }}>CONFIG</Th>
                  <Th>TYPE</Th>
                  <Th style={{ textAlign: "right" }}>ACTIONS</Th>
                </tr>
              </thead>
              <tbody>
                {roles.map(r => (
                  <tr key={r.name}>
                    <Td style={{ color: G.text, fontWeight: 700 }}>{r.name}</Td>
                    <Td>{r.label}</Td>
                    <Td style={{ color: G.muted, maxWidth: 360 }}>{r.description || "—"}</Td>
                    <Td style={{ textAlign: "center" }}>
                      {r.can_view_exec ? <Pill tone="green">YES</Pill> : <Pill tone="muted">NO</Pill>}
                    </Td>
                    <Td style={{ textAlign: "center" }}>
                      {r.can_view_config ? <Pill tone="green">YES</Pill> : <Pill tone="muted">NO</Pill>}
                    </Td>
                    <Td>
                      {r.is_system ? <Pill tone="purple">SYSTEM</Pill> : <Pill tone="blue">CUSTOM</Pill>}
                    </Td>
                    <Td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <Button variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
                        {!r.is_system && (
                          <Button variant="danger" onClick={() => setConfirm(r)}>Delete</Button>
                        )}
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
        <CardHeader>HOW ROLES MAP TO THE UI</CardHeader>
        <div style={{ padding: 18, fontFamily: "DM Mono,monospace", fontSize: 12, color: G.muted, lineHeight: 1.7 }}>
          <div><strong style={{ color: G.text }}>Consultant Portal</strong> — visible to every authenticated user, regardless of role.</div>
          <div><strong style={{ color: G.text }}>Executive View</strong> — visible only to roles with <code style={{ color: G.purple }}>can_view_exec = true</code>.</div>
          <div><strong style={{ color: G.text }}>Configuration</strong> — visible only to roles with <code style={{ color: G.purple }}>can_view_config = true</code>.</div>
          <div style={{ marginTop: 10, color: G.faint }}>
            The admin role is locked to retain both flags so an admin cannot accidentally lock themselves out.
          </div>
        </div>
      </Card>

      {(adding || editing) && (
        <RoleModal
          api={api}
          initial={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={(name, mode) => {
            setAdding(false); setEditing(null);
            setToast({ tone: "success", msg: mode === "create" ? `Added role "${name}".` : `Updated role "${name}".` });
            load();
          }}
        />
      )}
      {confirm && <Confirm message={`Delete role "${confirm.label || confirm.name}"? Users still assigned to it will need to be reassigned first.`} onCancel={() => setConfirm(null)} onConfirm={() => remove(confirm)} />}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </div>
  );
}

function RoleModal({ api, initial, onClose, onSaved }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(initial || {
    name: "", label: "", description: "",
    can_view_exec: false, can_view_config: false, sort_order: 100,
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const validate = () => {
    const e = {};
    if (!isEdit) {
      if (!/^[a-z][a-z0-9_]{1,31}$/.test((form.name || "").trim())) {
        e.name = "Lowercase letters, digits, and underscores only. Must start with a letter.";
      }
    }
    if (!form.label?.trim()) e.label = "Label is required.";
    return e;
  };

  const save = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      if (isEdit) {
        await api.call("/api/admin/roles", { method: "PATCH", body: {
          name: initial.name,
          label: form.label.trim(),
          description: form.description?.trim() || "",
          can_view_exec: !!form.can_view_exec,
          can_view_config: !!form.can_view_config,
          sort_order: Number(form.sort_order) || 100,
        }});
        onSaved(initial.name, "edit");
      } else {
        await api.call("/api/admin/roles", { method: "POST", body: {
          name: form.name.trim().toLowerCase(),
          label: form.label.trim(),
          description: form.description?.trim() || "",
          can_view_exec: !!form.can_view_exec,
          can_view_config: !!form.can_view_config,
          sort_order: Number(form.sort_order) || 100,
        }});
        onSaved(form.name.trim(), "create");
      }
    } catch (err) {
      setErrors({ _root: err.message || "Save failed." });
    }
    setSaving(false);
  };

  const adminLocked = isEdit && initial?.name === "admin";

  return (
    <Modal title={isEdit ? `Edit role — ${initial.name}` : "Add Role"} onClose={onClose} width={520}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <Label>NAME (INTERNAL ID)</Label>
          <Input
            value={form.name}
            onChange={(v) => set("name", v.toLowerCase())}
            placeholder="e.g. director"
            disabled={isEdit}
          />
          <FieldError error={errors.name} />
          <div style={{ fontSize: 10, color: G.faint, fontFamily: "DM Mono,monospace", marginTop: 4 }}>
            {isEdit ? "Cannot be renamed — referenced by JWTs and existing user records." : "Lowercase letters, digits, underscores. Used as the role identifier."}
          </div>
        </div>
        <div>
          <Label>LABEL (DISPLAYED IN UI)</Label>
          <Input value={form.label} onChange={(v) => set("label", v)} placeholder="e.g. Director" />
          <FieldError error={errors.label} />
        </div>
        <div>
          <Label>DESCRIPTION</Label>
          <TextArea value={form.description || ""} onChange={(v) => set("description", v)} rows={2} placeholder="Briefly describe what this role can do." />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "DM Mono,monospace", fontSize: 12, color: adminLocked ? G.faint : G.text, cursor: adminLocked ? "not-allowed" : "pointer", padding: "10px 12px", border: "1px solid " + G.border, borderRadius: 8, background: "#080e18" }}>
            <input type="checkbox" checked={!!form.can_view_exec} disabled={adminLocked} onChange={(e) => set("can_view_exec", e.target.checked)} />
            Executive View
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "DM Mono,monospace", fontSize: 12, color: adminLocked ? G.faint : G.text, cursor: adminLocked ? "not-allowed" : "pointer", padding: "10px 12px", border: "1px solid " + G.border, borderRadius: 8, background: "#080e18" }}>
            <input type="checkbox" checked={!!form.can_view_config} disabled={adminLocked} onChange={(e) => set("can_view_config", e.target.checked)} />
            Configuration
          </label>
        </div>
        {adminLocked && (
          <div style={{ fontSize: 11, color: G.muted, fontFamily: "DM Mono,monospace", padding: "8px 12px", background: G.surface2, border: "1px solid " + G.border, borderRadius: 8 }}>
            Admin always retains access to both views.
          </div>
        )}
        <div>
          <Label>SORT ORDER</Label>
          <Input value={String(form.sort_order ?? 100)} onChange={(v) => set("sort_order", v.replace(/[^0-9]/g, ""))} />
          <div style={{ fontSize: 10, color: G.faint, fontFamily: "DM Mono,monospace", marginTop: 4 }}>
            Lower numbers appear first in dropdowns.
          </div>
        </div>
        {errors._root && (
          <div style={{ padding: "9px 12px", background: G.redBg, border: "1px solid " + G.red + "55", borderRadius: 8, color: G.red, fontFamily: "DM Mono,monospace", fontSize: 12 }}>{errors._root}</div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : (isEdit ? "Save Changes" : "Add Role")}</Button>
        </div>
      </div>
    </Modal>
  );
}
