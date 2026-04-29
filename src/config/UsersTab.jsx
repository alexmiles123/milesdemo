// Unified Users tab — the single surface for managing sign-in accounts AND
// the CSM operational records they're linked to. The split between app_users
// (logins) and csms (operational owners of customers/projects) is a useful
// schema separation but a confusing UX, so this tab presents them as one
// thing: a "User" with an optional Title that, when set, also makes them a
// CSM who can own accounts. Backend (/api/admin/users) handles the dual-row
// transaction so the UI doesn't have to.
//
// CSM titles (the dropdown in Add/Edit User) live in the csm_roles table,
// editable via the "Manage Titles" button in the header.

import { useState, useEffect, useCallback } from "react";
import { G, ROLE_OPTIONS } from "../lib/theme.js";
import { audited } from "../lib/audit.js";
import { fetchPasswordPolicy, describePolicy, validatePasswordWith, DEFAULT_POLICY } from "../lib/password.js";
import { fetchRoles, roleOptions, SYSTEM_ROLES } from "../lib/roles.js";
import { Card, CardHeader, Label, Input, Select, Button, Toast, Modal, Empty, Th, Td, Pill, Confirm, FieldError } from "./common.jsx";

const BLANK_NEW = { username: "", email: "", full_name: "", role: "viewer", csm_title: "", password: "", must_reset: true };

const validateNew = (u, policy) => {
  const e = {};
  if (!u.full_name || u.full_name.trim().length < 2) e.full_name = "Full name is required.";
  if (!u.username || u.username.length < 3) e.username = "Username is required (3+ characters).";
  if (!u.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) e.email = "Valid email required.";
  const pwErr = validatePasswordWith(u.password, policy);
  if (pwErr) e.password = pwErr;
  return e;
};

const fmtDateTime = (s) => s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" }) : "—";

// Auto-suggest a username from a full name. "Alex Miles" → "alex.miles".
// User can edit before submitting.
const suggestUsername = (fullName) => {
  if (!fullName) return "";
  const parts = fullName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return parts.join(".").replace(/[^a-z0-9.]/g, "");
};

export default function UsersTab({ api, onCsmsChanged }) {
  const [users, setUsers] = useState([]);
  const [csmTitles, setCsmTitles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [resetUser, setResetUser] = useState(null);
  const [titlesOpen, setTitlesOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [appRoles, setAppRoles] = useState(SYSTEM_ROLES);

  const loadTitles = useCallback(async () => {
    try {
      const rows = await api.get("csm_roles", { select: "*", order: "sort_order.asc" });
      setCsmTitles(rows || []);
    } catch {
      setCsmTitles(ROLE_OPTIONS.map((n, i) => ({ id: n, name: n, is_active: true, sort_order: (i + 1) * 10 })));
    }
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.call("/api/admin/users");
      setUsers((data && data.users) || []);
    } catch (e) {
      setUsers([]);
      setToast({ tone: "error", msg: "Failed to load users: " + e.message });
    }
    setLoading(false);
  }, [api]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    load();
    loadTitles();
    fetchPasswordPolicy(api).then(setPolicy);
    fetchRoles(api).then(setAppRoles);
  }, [api, load, loadTitles]);

  const appRoleOpts = roleOptions(appRoles);
  const titleOpts = csmTitles.filter(r => r.is_active).map(r => r.name);

  const visible = users.filter(u => showInactive || u.is_active);

  const togglePatch = async (u, patch) => {
    try {
      await api.call("/api/admin/users", { method: "PATCH", body: { id: u.id, ...patch } });
      await load();
      onCsmsChanged && onCsmsChanged();
    } catch (e) { setToast({ tone: "error", msg: e.message }); }
  };

  const disable = async (u) => {
    setConfirm(null);
    try {
      await api.call("/api/admin/users", { method: "DELETE", body: { id: u.id } });
      setToast({ tone: "success", msg: `${u.username} disabled. Their CSM record (if any) was also deactivated.` });
      await load();
      onCsmsChanged && onCsmsChanged();
    } catch (e) { setToast({ tone: "error", msg: e.message }); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <CardHeader right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "Inter,system-ui,sans-serif", color: G.muted, cursor: "pointer" }}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show disabled
            </label>
            <Button variant="ghost" onClick={() => setTitlesOpen(true)}>Manage Titles</Button>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>+ Add User</Button>
          </div>
        }>USERS · {visible.length}</CardHeader>

        {loading ? (
          <Empty>Loading users…</Empty>
        ) : visible.length === 0 ? (
          <Empty>
            No users yet. <button onClick={() => setCreateOpen(true)} style={{ background: "none", border: "none", color: G.purple, cursor: "pointer", textDecoration: "underline", fontFamily: "Inter,system-ui,sans-serif" }}>Add the first user</button> to get started.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>USERNAME</Th>
                  <Th>FULL NAME</Th>
                  <Th>EMAIL</Th>
                  <Th>TITLE</Th>
                  <Th>ACCESS</Th>
                  <Th>STATUS</Th>
                  <Th>LAST LOGIN</Th>
                  <Th style={{ textAlign: "right" }}>ACTIONS</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map(u => (
                  <tr key={u.id} style={{ cursor: "pointer" }} onClick={() => setEditUser(u)}>
                    <Td style={{ color: G.text, fontWeight: 700 }}>{u.username}</Td>
                    <Td>{u.full_name || "—"}</Td>
                    <Td style={{ color: G.muted }}>{u.email}</Td>
                    <Td>
                      {u.csm_title
                        ? <Pill tone="purple">{u.csm_title}</Pill>
                        : <span style={{ color: G.faint, fontFamily: "Inter,system-ui,sans-serif", fontSize: 11 }}>—</span>}
                    </Td>
                    <Td>
                      <Pill tone="muted">{u.role}</Pill>
                    </Td>
                    <Td>
                      {u.locked_until && new Date(u.locked_until) > new Date() ? <Pill tone="red">LOCKED</Pill> :
                       !u.is_active ? <Pill tone="muted">DISABLED</Pill> :
                       u.must_reset ? <Pill tone="yellow">MUST RESET</Pill> :
                       <Pill tone="green">ACTIVE</Pill>}
                    </Td>
                    <Td style={{ color: G.muted }}>{fmtDateTime(u.last_login_at)}</Td>
                    <Td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <Button variant="ghost" onClick={() => setResetUser(u)}>Reset PW</Button>
                        {u.is_active
                          ? <Button variant="danger" onClick={() => setConfirm(u)}>Disable</Button>
                          : <Button variant="success" onClick={() => togglePatch(u, { is_active: true })}>Enable</Button>}
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
        <CardHeader>SECURITY POSTURE</CardHeader>
        <div style={{ padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, fontFamily: "Inter,system-ui,sans-serif", fontSize: 12, color: G.muted, lineHeight: 1.6 }}>
          <div><div style={{ color: G.text, fontWeight: 700, marginBottom: 4 }}>Password policy</div>{describePolicy(policy)}.</div>
          <div><div style={{ color: G.text, fontWeight: 700, marginBottom: 4 }}>Account lockout</div>15 minutes after 5 failed sign-in attempts.</div>
          <div><div style={{ color: G.text, fontWeight: 700, marginBottom: 4 }}>Session length</div>12-hour signed JWT, no server-side store.</div>
          <div><div style={{ color: G.text, fontWeight: 700, marginBottom: 4 }}>Audit trail</div>Every create / update / disable is logged to audit_log.</div>
        </div>
      </Card>

      {createOpen && <CreateUserModal api={api} policy={policy} appRoleOpts={appRoleOpts} titleOpts={titleOpts} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); setToast({ tone: "success", msg: "User created." }); load(); onCsmsChanged && onCsmsChanged(); }} setToast={setToast} />}
      {editUser && <EditUserModal api={api} user={editUser} appRoleOpts={appRoleOpts} titleOpts={titleOpts} onClose={() => setEditUser(null)} onSaved={() => { setEditUser(null); setToast({ tone: "success", msg: "User updated." }); load(); onCsmsChanged && onCsmsChanged(); }} setToast={setToast} />}
      {resetUser && <ResetPasswordModal api={api} user={resetUser} policy={policy} onClose={() => setResetUser(null)} onDone={() => { setResetUser(null); setToast({ tone: "success", msg: "Password reset." }); load(); }} setToast={setToast} />}
      {titlesOpen && <TitlesModal api={api} titles={csmTitles} onClose={() => setTitlesOpen(false)} onChanged={() => { loadTitles(); setToast({ tone: "success", msg: "Titles updated." }); }} />}
      {confirm && <Confirm message={`Disable ${confirm.username}? They will no longer be able to sign in${confirm.csm_id ? ", and their CSM record will be deactivated" : ""}. You can re-enable later.`} onCancel={() => setConfirm(null)} onConfirm={() => disable(confirm)} />}
      {toast && <Toast tone={toast.tone}>{toast.msg}<button onClick={() => setToast(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", marginLeft: 12 }}>×</button></Toast>}
    </div>
  );
}

function CreateUserModal({ api, policy, appRoleOpts, titleOpts, onClose, onCreated, setToast }) {
  const [form, setForm] = useState(BLANK_NEW);
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e = validateNew(form, policy);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api.call("/api/admin/users", { method: "POST", body: {
        username: form.username.trim(),
        email: form.email.trim().toLowerCase(),
        full_name: form.full_name.trim(),
        role: form.role,
        password: form.password,
        must_reset: form.must_reset,
        csm_title: form.csm_title || null,
      }});
      onCreated();
    } catch (err) { setToast({ tone: "error", msg: err.message }); }
    setBusy(false);
  };

  const set = (k, v) => setForm(prev => {
    const next = { ...prev, [k]: v };
    // Auto-suggest username from full name until the user types in the
    // username field themselves — they can always override.
    if (k === "full_name" && !usernameTouched) next.username = suggestUsername(v);
    return next;
  });

  const titleSelectOpts = ["", ...titleOpts];

  return (
    <Modal title="Add User" onClose={onClose} width={560}>
      <div style={{ fontSize: 12, color: G.muted, fontFamily: "Inter,system-ui,sans-serif", marginBottom: 14, lineHeight: 1.5 }}>
        Adding a user creates their sign-in account. If you set a Title, they're also added as a CSM and can own customer accounts.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ gridColumn: "span 2" }}>
          <Label>FULL NAME</Label>
          <Input value={form.full_name} onChange={(v) => set("full_name", v)} placeholder="Jane Doe" />
          <FieldError error={errors.full_name} />
        </div>
        <div>
          <Label>EMAIL</Label>
          <Input value={form.email} onChange={(v) => set("email", v)} placeholder="jane@company.com" type="email" />
          <FieldError error={errors.email} />
        </div>
        <div>
          <Label>USERNAME</Label>
          <Input value={form.username} onChange={(v) => { setUsernameTouched(true); set("username", v.replace(/\s/g, "")); }} placeholder="jane.doe" />
          <FieldError error={errors.username} />
        </div>
        <div>
          <Label>TITLE (OPTIONAL)</Label>
          <Select value={form.csm_title} onChange={(v) => set("csm_title", v)} options={titleSelectOpts} />
          <div style={{ fontSize: 10, color: G.faint, fontFamily: "Inter,system-ui,sans-serif", marginTop: 4 }}>
            Set this for CSMs and CS leadership. Leave blank for admin-only or read-only users.
          </div>
        </div>
        <div>
          <Label>ACCESS LEVEL</Label>
          <Select value={form.role} onChange={(v) => set("role", v)} options={appRoleOpts} />
          <div style={{ fontSize: 10, color: G.faint, fontFamily: "Inter,system-ui,sans-serif", marginTop: 4 }}>
            Admin = full access. CSM = consultant portal. Viewer = read-only.
          </div>
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <Label>TEMPORARY PASSWORD</Label>
          <Input value={form.password} onChange={(v) => set("password", v)} type="text" placeholder="At least 12 characters" />
          <FieldError error={errors.password} />
          <div style={{ fontSize: 10, color: G.faint, fontFamily: "Inter,system-ui,sans-serif", marginTop: 4 }}>
            {describePolicy(policy)}. Share securely — the user will reset it on first login.
          </div>
        </div>
        <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "Inter,system-ui,sans-serif", color: G.muted }}>
          <input id="must-reset" type="checkbox" checked={form.must_reset} onChange={(e) => set("must_reset", e.target.checked)} />
          <label htmlFor="must-reset">Require password reset on first login</label>
        </div>
        <div style={{ gridColumn: "span 2", display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create User"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function EditUserModal({ api, user, appRoleOpts, titleOpts, onClose, onSaved, setToast }) {
  const [form, setForm] = useState({
    full_name: user.full_name || "",
    email: user.email || "",
    role: user.role || "viewer",
    csm_title: user.csm_title || "",
    is_active: !!user.is_active,
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e = {};
    if (!form.full_name.trim()) e.full_name = "Full name is required.";
    if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Valid email required.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api.call("/api/admin/users", { method: "PATCH", body: {
        id: user.id,
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        role: form.role,
        csm_title: form.csm_title,
        is_active: form.is_active,
      }});
      onSaved();
    } catch (err) { setToast({ tone: "error", msg: err.message }); }
    setBusy(false);
  };

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const titleSelectOpts = ["", ...titleOpts];

  return (
    <Modal title={`Edit User — ${user.username}`} onClose={onClose} width={560}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ gridColumn: "span 2" }}>
          <Label>FULL NAME</Label>
          <Input value={form.full_name} onChange={(v) => set("full_name", v)} />
          <FieldError error={errors.full_name} />
        </div>
        <div>
          <Label>USERNAME</Label>
          <Input value={user.username} disabled />
          <div style={{ fontSize: 10, color: G.faint, fontFamily: "Inter,system-ui,sans-serif", marginTop: 4 }}>Cannot be changed.</div>
        </div>
        <div>
          <Label>EMAIL</Label>
          <Input value={form.email} onChange={(v) => set("email", v)} type="email" />
          <FieldError error={errors.email} />
        </div>
        <div>
          <Label>TITLE</Label>
          <Select value={form.csm_title} onChange={(v) => set("csm_title", v)} options={titleSelectOpts} />
          <div style={{ fontSize: 10, color: G.faint, fontFamily: "Inter,system-ui,sans-serif", marginTop: 4 }}>
            {form.csm_title
              ? "Linked CSM record will reflect this title."
              : user.csm_title
                ? "Clearing the title will unlink them from their CSM record."
                : "Set a title to also create a CSM record for this user."}
          </div>
        </div>
        <div>
          <Label>ACCESS LEVEL</Label>
          <Select value={form.role} onChange={(v) => set("role", v)} options={appRoleOpts} />
        </div>
        <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: "Inter,system-ui,sans-serif", color: G.text }}>
          <input id="edit-active" type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
          <label htmlFor="edit-active">Active (uncheck to disable login and deactivate CSM record)</label>
        </div>
        <div style={{ gridColumn: "span 2", display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save Changes"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ api, user, policy, onClose, onDone, setToast }) {
  const [pw, setPw] = useState("");
  const [mustReset, setMustReset] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const pwErr = validatePasswordWith(pw, policy);
    if (pwErr) { setError(pwErr); return; }
    setBusy(true);
    try {
      await api.call("/api/admin/users", { method: "PATCH", body: { id: user.id, password: pw, must_reset: mustReset } });
      onDone();
    } catch (e) { setToast({ tone: "error", msg: e.message }); }
    setBusy(false);
  };

  return (
    <Modal title={`Reset password — ${user.username}`} onClose={onClose} width={460}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <Label>NEW PASSWORD</Label>
          <Input value={pw} onChange={setPw} type="text" placeholder={`At least ${policy.min_length} characters`} />
          <FieldError error={error} />
          <div style={{ fontSize: 10, color: G.faint, fontFamily: "Inter,system-ui,sans-serif", marginTop: 4 }}>{describePolicy(policy)}.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "Inter,system-ui,sans-serif", color: G.muted }}>
          <input id="reset-mustreset" type="checkbox" checked={mustReset} onChange={(e) => setMustReset(e.target.checked)} />
          <label htmlFor="reset-mustreset">Require user to choose a new password on next sign-in</label>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Resetting…" : "Reset Password"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// CSM-titles editor — moved from the old CsmsTab so admins can still curate
// the dropdown of titles ("Senior CSM", "Lead CSM", etc.) without a separate
// section in the nav.
function TitlesModal({ api, titles, onClose, onChanged }) {
  const rows = titles || [];
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");

  const startRename = (r) => { setEditingId(r.id); setEditingName(r.name); setErr(null); };
  const cancelRename = () => { setEditingId(null); setEditingName(""); setErr(null); };

  const saveRename = async (r) => {
    const name = editingName.trim();
    if (!name) { setErr("Title cannot be empty."); return; }
    if (name === r.name) { cancelRename(); return; }
    if (rows.some(x => x.id !== r.id && x.name.toLowerCase() === name.toLowerCase())) {
      setErr("That title already exists."); return;
    }
    setSaving(true); setErr(null);
    try {
      await audited("csm_role.update", "csm_roles", r.id, () => api.patch("csm_roles", r.id, { name }), { before: r, after: { ...r, name } });
      cancelRename();
      onChanged && onChanged();
    } catch (e) { setErr(e.message || "Rename failed."); }
    setSaving(false);
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    if (rows.some(r => r.name.toLowerCase() === name.toLowerCase())) {
      setErr("That title already exists."); return;
    }
    setSaving(true); setErr(null);
    try {
      const nextSort = (rows[rows.length - 1]?.sort_order || 0) + 10;
      const payload = { name, sort_order: nextSort };
      await audited("csm_role.create", "csm_roles", null, () => api.post("csm_roles", [payload]), { after: payload });
      setNewName("");
      onChanged && onChanged();
    } catch (e) { setErr(e.message || "Create failed."); }
    setSaving(false);
  };

  const toggleActive = async (r) => {
    try {
      await audited("csm_role.update", "csm_roles", r.id, () => api.patch("csm_roles", r.id, { is_active: !r.is_active }), { before: r, after: { ...r, is_active: !r.is_active } });
      onChanged && onChanged();
    } catch (e) { setErr(e.message || "Update failed."); }
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete title "${r.name}"? Users currently using it will keep the text value.`)) return;
    try {
      await audited("csm_role.delete", "csm_roles", r.id, () => api.del("csm_roles", r.id), { before: r });
      onChanged && onChanged();
    } catch (e) { setErr(e.message || "Delete failed."); }
  };

  return (
    <Modal title="Manage Titles" onClose={onClose} width={560}>
      <div style={{ fontSize: 12, color: G.muted, fontFamily: "Inter,system-ui,sans-serif", marginBottom: 12 }}>
        Titles appear in the dropdown when adding or editing a user. Setting a title links the user to a CSM record that can own customer accounts.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Input value={newName} onChange={setNewName} placeholder="New title (e.g. Staff CSM)" />
        <Button variant="primary" onClick={add} disabled={saving || !newName.trim()}>Add</Button>
      </div>
      {err && (
        <div style={{ marginBottom: 12, padding: "8px 12px", background: G.redBg, border: "1px solid " + G.red + "55", borderRadius: 8, color: G.red, fontFamily: "Inter,system-ui,sans-serif", fontSize: 12 }}>{err}</div>
      )}
      <div style={{ border: "1px solid " + G.border, borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Inter,system-ui,sans-serif", fontSize: 12 }}>
          <thead style={{ background: G.surface }}>
            <tr style={{ borderBottom: "1px solid " + G.border }}>
              <Th>TITLE</Th><Th>STATUS</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 16, textAlign: "center", color: G.muted }}>No titles defined.</td></tr>
            )}
            {rows.map(r => {
              const isEditing = editingId === r.id;
              return (
                <tr key={r.id}>
                  <Td style={{ color: G.text, fontWeight: 700 }}>
                    {isEditing ? (
                      <Input
                        value={editingName}
                        onChange={setEditingName}
                        onKeyDown={(e) => { if (e.key === "Enter") saveRename(r); if (e.key === "Escape") cancelRename(); }}
                        autoFocus
                        style={{ padding: "5px 8px" }}
                      />
                    ) : r.name}
                  </Td>
                  <Td>
                    <Pill tone={r.is_active ? "green" : "muted"}>{r.is_active ? "ACTIVE" : "DISABLED"}</Pill>
                  </Td>
                  <Td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {isEditing ? (
                      <>
                        <Button variant="primary" onClick={() => saveRename(r)} disabled={saving} style={{ marginRight: 6 }}>Save</Button>
                        <Button variant="ghost" onClick={cancelRename} disabled={saving}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" onClick={() => startRename(r)} style={{ marginRight: 6 }}>Rename</Button>
                        <Button variant="ghost" onClick={() => toggleActive(r)} style={{ marginRight: 6 }}>
                          {r.is_active ? "Disable" : "Enable"}
                        </Button>
                        <Button variant="danger" onClick={() => remove(r)}>Delete</Button>
                      </>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
