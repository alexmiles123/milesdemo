import { useState, useEffect, useCallback } from "react";
import { G } from "../lib/theme.js";
import { fetchPasswordPolicy, describePolicy, validatePasswordWith, DEFAULT_POLICY } from "../lib/password.js";
import { Card, CardHeader, Label, Input, Select, Button, Toast, Modal, Empty, Th, Td, Pill, Confirm, FieldError } from "./common.jsx";

const ROLES = [
  { value: "admin",  label: "Admin (full access)" },
  { value: "csm",    label: "CSM (consultant + assigned accounts)" },
  { value: "viewer", label: "Viewer (read-only)" },
];

const BLANK_NEW = { username: "", email: "", full_name: "", role: "viewer", password: "", must_reset: true };

const validateNew = (u, policy) => {
  const e = {};
  if (!u.username || u.username.length < 3) e.username = "Username is required (3+ characters).";
  if (!u.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) e.email = "Valid email required.";
  const pwErr = validatePasswordWith(u.password, policy);
  if (pwErr) e.password = pwErr;
  return e;
};

const fmtDateTime = (s) => s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" }) : "—";

export default function UsersTab({ api }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const [policy, setPolicy] = useState(DEFAULT_POLICY);

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
  useEffect(() => { load(); fetchPasswordPolicy(api).then(setPolicy); }, [api, load]);

  const visible = users.filter(u => showInactive || u.is_active);

  const togglePatch = async (u, patch) => {
    try {
      await api.call("/api/admin/users", { method: "PATCH", body: { id: u.id, ...patch } });
      await load();
    } catch (e) { setToast({ tone: "error", msg: e.message }); }
  };

  const disable = async (u) => {
    setConfirm(null);
    try {
      await api.call("/api/admin/users", { method: "DELETE", body: { id: u.id } });
      setToast({ tone: "success", msg: "User disabled." });
      await load();
    } catch (e) { setToast({ tone: "error", msg: e.message }); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <CardHeader right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "DM Mono,monospace", color: G.muted, cursor: "pointer" }}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show disabled
            </label>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>+ Add User</Button>
          </div>
        }>USERS · {visible.length}</CardHeader>

        {loading ? (
          <Empty>Loading users…</Empty>
        ) : visible.length === 0 ? (
          <Empty>
            No users yet. <button onClick={() => setCreateOpen(true)} style={{ background: "none", border: "none", color: G.purple, cursor: "pointer", textDecoration: "underline", fontFamily: "DM Mono,monospace" }}>Add the first user</button> to get started.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>USERNAME</Th>
                  <Th>FULL NAME</Th>
                  <Th>EMAIL</Th>
                  <Th>ROLE</Th>
                  <Th>STATUS</Th>
                  <Th>LAST LOGIN</Th>
                  <Th style={{ textAlign: "right" }}>ACTIONS</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map(u => (
                  <tr key={u.id}>
                    <Td style={{ color: G.text, fontWeight: 700 }}>{u.username}</Td>
                    <Td>{u.full_name || "—"}</Td>
                    <Td style={{ color: G.muted }}>{u.email}</Td>
                    <Td>
                      <Select
                        value={u.role}
                        onChange={(v) => togglePatch(u, { role: v })}
                        options={ROLES}
                        style={{ padding: "6px 8px", fontSize: 11 }}
                      />
                    </Td>
                    <Td>
                      {u.locked_until && new Date(u.locked_until) > new Date() ? <Pill tone="red">LOCKED</Pill> :
                       !u.is_active ? <Pill tone="muted">DISABLED</Pill> :
                       u.must_reset ? <Pill tone="yellow">MUST RESET</Pill> :
                       <Pill tone="green">ACTIVE</Pill>}
                    </Td>
                    <Td style={{ color: G.muted }}>{fmtDateTime(u.last_login_at)}</Td>
                    <Td style={{ textAlign: "right" }}>
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
        <div style={{ padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, fontFamily: "DM Mono,monospace", fontSize: 12, color: G.muted, lineHeight: 1.6 }}>
          <div><div style={{ color: G.text, fontWeight: 700, marginBottom: 4 }}>Password policy</div>{describePolicy(policy)}.</div>
          <div><div style={{ color: G.text, fontWeight: 700, marginBottom: 4 }}>Account lockout</div>15 minutes after 5 failed sign-in attempts.</div>
          <div><div style={{ color: G.text, fontWeight: 700, marginBottom: 4 }}>Session length</div>12-hour signed JWT, no server-side store.</div>
          <div><div style={{ color: G.text, fontWeight: 700, marginBottom: 4 }}>Audit trail</div>Every create / update / disable is logged to audit_log.</div>
        </div>
      </Card>

      {createOpen && <CreateUserModal api={api} policy={policy} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); setToast({ tone: "success", msg: "User created." }); load(); }} setToast={setToast} />}
      {resetUser && <ResetPasswordModal api={api} user={resetUser} policy={policy} onClose={() => setResetUser(null)} onDone={() => { setResetUser(null); setToast({ tone: "success", msg: "Password reset." }); load(); }} setToast={setToast} />}
      {confirm && <Confirm message={`Disable ${confirm.username}? They will no longer be able to sign in. You can re-enable them later.`} onCancel={() => setConfirm(null)} onConfirm={() => disable(confirm)} />}
      {toast && <Toast tone={toast.tone}>{toast.msg}<button onClick={() => setToast(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", marginLeft: 12 }}>×</button></Toast>}
    </div>
  );
}

function CreateUserModal({ api, policy, onClose, onCreated, setToast }) {
  const [form, setForm] = useState(BLANK_NEW);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e = validateNew(form, policy);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api.call("/api/admin/users", { method: "POST", body: form });
      onCreated();
    } catch (err) { setToast({ tone: "error", msg: err.message }); }
    setBusy(false);
  };

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <Modal title="Add User" onClose={onClose} width={520}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <Label>USERNAME</Label>
          <Input value={form.username} onChange={(v) => set("username", v.replace(/\s/g, ""))} placeholder="jdoe" />
          <FieldError error={errors.username} />
        </div>
        <div>
          <Label>FULL NAME</Label>
          <Input value={form.full_name} onChange={(v) => set("full_name", v)} placeholder="Jane Doe" />
        </div>
        <div>
          <Label>EMAIL</Label>
          <Input value={form.email} onChange={(v) => set("email", v)} placeholder="jane@company.com" type="email" />
          <FieldError error={errors.email} />
        </div>
        <div>
          <Label>ROLE</Label>
          <Select value={form.role} onChange={(v) => set("role", v)} options={ROLES} />
        </div>
        <div>
          <Label>TEMPORARY PASSWORD</Label>
          <Input value={form.password} onChange={(v) => set("password", v)} type="text" placeholder="At least 12 characters" />
          <FieldError error={errors.password} />
          <div style={{ fontSize: 10, color: G.faint, fontFamily: "DM Mono,monospace", marginTop: 4 }}>
            {describePolicy(policy)}. Share this securely; the user will be required to reset it on first login.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "DM Mono,monospace", color: G.muted }}>
          <input id="must-reset" type="checkbox" checked={form.must_reset} onChange={(e) => set("must_reset", e.target.checked)} />
          <label htmlFor="must-reset">Require password reset on first login</label>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create User"}</Button>
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
          <div style={{ fontSize: 10, color: G.faint, fontFamily: "DM Mono,monospace", marginTop: 4 }}>{describePolicy(policy)}.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "DM Mono,monospace", color: G.muted }}>
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
