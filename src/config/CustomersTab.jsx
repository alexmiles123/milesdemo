// Configuration → Accounts → Customers
//
// Customers are the top entity. Each row expands to reveal the projects
// underneath; each row also has a "+ Add Project" action. Disabling a
// customer is soft (is_active=false) so it can be re-enabled later — the
// consultant portal hides inactive customers.
//
// Project create/edit reuses ProjectModal from ProjectsTab.jsx so the import
// specs and template-apply logic stay in one place.

import { useState, useEffect, useCallback, useMemo } from "react";
import { G, fmtArr, fmtDate, HEALTH_OPTIONS } from "../lib/theme.js";
import { audited } from "../lib/audit.js";
import { Card, CardHeader, Label, Input, Select, Button, FieldError, Toast, Modal, Empty, Th, Td, Pill, Confirm, TextArea } from "./common.jsx";
import ImportModal from "./ImportModal.jsx";
import { ProjectModal, PROJECT_IMPORT_SPEC, TASK_IMPORT_SPEC } from "./ProjectsTab.jsx";

const BLANK_CUSTOMER = {
  name: "", contact_name: "", contact_email: "", contact_phone: "",
  address: "", notes: "", is_active: true,
};
const BLANK_PROJECT = {
  name: "", customer_id: "", customer: "", csm_id: "", stage: "Kickoff",
  health: "green", arr: 0, completion_pct: 0, target_date: "", notes: "",
};

export default function CustomersTab({ api, csms, onChanged }) {
  const [customers, setCustomers]   = useState([]);
  const [projects, setProjects]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [expanded, setExpanded]     = useState({}); // { [customer.id]: true }
  const [custModal, setCustModal]   = useState(null); // { mode, data }
  const [projModal, setProjModal]   = useState(null); // { mode, data, lockCustomer }
  const [confirmDisable, setConfirmDisable] = useState(null);
  const [confirmDelProj, setConfirmDelProj] = useState(null);
  const [taskImportFor, setTaskImportFor] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [toast, setToast]           = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cs, ps] = await Promise.all([
        api.get("customers", { select: "*", order: "name.asc" }),
        api.get("projects",  { select: "*", order: "updated_at.desc" }),
      ]);
      setCustomers(cs || []);
      setProjects(ps || []);
    } catch (e) {
      setToast({ tone: "error", msg: "Failed to load: " + e.message });
    }
    setLoading(false);
  }, [api]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const csmById = useMemo(() => Object.fromEntries(csms.map(c => [c.id, c])), [csms]);

  const projectsByCustomer = useMemo(() => {
    const map = {};
    for (const p of projects) {
      const k = p.customer_id || "_orphan";
      (map[k] ||= []).push(p);
    }
    return map;
  }, [projects]);

  const orphanProjects = projectsByCustomer._orphan || [];

  const filtered = customers.filter(c => {
    if (!showInactive && c.is_active === false) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (c.name || "").toLowerCase().includes(s)
        || (c.contact_name || "").toLowerCase().includes(s)
        || (c.contact_email || "").toLowerCase().includes(s);
  });

  // ── customer actions ─────────────────────────────────────────────────────
  const openCreateCustomer = () => setCustModal({ mode: "create", data: { ...BLANK_CUSTOMER } });
  const openEditCustomer   = (c) => setCustModal({ mode: "edit", data: { ...BLANK_CUSTOMER, ...c } });

  const toggleActive = async (c, nextActive) => {
    const before = { ...c };
    const after  = { ...c, is_active: nextActive };
    setCustomers(prev => prev.map(x => x.id === c.id ? after : x));
    try {
      await audited(
        nextActive ? "customer.enable" : "customer.disable",
        "customers", c.id,
        () => api.patch("customers", c.id, { is_active: nextActive }),
        { before, after },
      );
      setToast({ tone: "success", msg: `${nextActive ? "Re-enabled" : "Disabled"} "${c.name}".` });
    } catch (e) {
      setCustomers(prev => prev.map(x => x.id === c.id ? before : x));
      setToast({ tone: "error", msg: "Update failed: " + e.message });
    }
  };

  const requestDisable = (c) => {
    const active = (projectsByCustomer[c.id] || []).filter(p => p.stage !== "Go-Live").length;
    setConfirmDisable({ customer: c, activeProjects: active });
  };

  // ── project actions ──────────────────────────────────────────────────────
  const openCreateProjectFor = (customer) => setProjModal({
    mode: "create",
    data: { ...BLANK_PROJECT, customer_id: customer.id, customer: customer.name },
    lockCustomer: true,
  });
  const openEditProject = (p) => setProjModal({
    mode: "edit",
    data: { ...BLANK_PROJECT, ...p, csm_id: p.csm_id || "", customer_id: p.customer_id || "", target_date: p.target_date || "" },
    lockCustomer: false,
  });

  const delProject = async (p) => {
    setConfirmDelProj(null);
    const before = { ...p };
    setProjects(prev => prev.filter(x => x.id !== p.id));
    try {
      await audited("project.delete", "projects", p.id, () => api.del("projects", p.id), { before });
      setToast({ tone: "success", msg: `Deleted "${p.name}".` });
      onChanged && onChanged();
    } catch (e) {
      setProjects(prev => [...prev, before]);
      setToast({ tone: "error", msg: "Delete failed: " + e.message });
    }
  };

  // ── render ───────────────────────────────────────────────────────────────
  const totalProjects = projects.length;

  return (
    <>
      <Card>
        <CardHeader right={<div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={() => setShowImport(true)}>Import Projects</Button>
          <Button variant="primary" onClick={openCreateCustomer}>+ Add Customer</Button>
        </div>}>
          CUSTOMERS ({filtered.length}{filtered.length !== customers.length ? ` of ${customers.length}` : ""}) · {totalProjects} project{totalProjects === 1 ? "" : "s"}
        </CardHeader>
        <div style={{ padding: "12px 18px", display: "flex", gap: 10, alignItems: "center", borderBottom: "1px solid " + G.border, flexWrap: "wrap" }}>
          <Input value={search} onChange={setSearch} placeholder="Search by name, contact, or email…" style={{ flex: 1, maxWidth: 360 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "DM Mono,monospace", color: G.muted, cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show disabled
          </label>
        </div>

        {loading ? <Empty>Loading…</Empty> : filtered.length === 0 ? (
          <Empty>{customers.length === 0 ? "No customers yet. Add your first one to get started." : "No customers match your filters."}</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th style={{ width: 32 }}></Th>
                  <Th>Customer</Th>
                  <Th>Contact</Th>
                  <Th style={{ textAlign: "right" }}>Projects</Th>
                  <Th>Status</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const list = projectsByCustomer[c.id] || [];
                  const isOpen = !!expanded[c.id];
                  const inactive = c.is_active === false;
                  return (
                    <CustomerRow
                      key={c.id}
                      customer={c}
                      projects={list}
                      csmById={csmById}
                      isOpen={isOpen}
                      inactive={inactive}
                      onToggle={() => setExpanded(p => ({ ...p, [c.id]: !p[c.id] }))}
                      onAddProject={() => openCreateProjectFor(c)}
                      onEditProject={openEditProject}
                      onDeleteProject={(p) => setConfirmDelProj(p)}
                      onImportTasks={(p) => setTaskImportFor(p)}
                      onEdit={() => openEditCustomer(c)}
                      onDisable={() => requestDisable(c)}
                      onEnable={() => toggleActive(c, true)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {orphanProjects.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Card>
            <CardHeader>UNLINKED PROJECTS ({orphanProjects.length})</CardHeader>
            <div style={{ padding: "8px 18px", fontSize: 11, fontFamily: "DM Mono,monospace", color: G.muted }}>
              These projects don't have a customer record yet. Edit each to assign one.
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr><Th>Name</Th><Th>Legacy customer text</Th><Th>CSM</Th><Th>Stage</Th><Th></Th></tr>
                </thead>
                <tbody>
                  {orphanProjects.map(p => (
                    <tr key={p.id} className="rh" style={{ cursor: "pointer" }} onClick={() => openEditProject(p)}>
                      <Td style={{ fontWeight: 700, color: G.text }}>{p.name}</Td>
                      <Td>{p.customer || "—"}</Td>
                      <Td>{csmById[p.csm_id]?.name || <span style={{ color: G.faint }}>Unassigned</span>}</Td>
                      <Td>{p.stage}</Td>
                      <Td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" onClick={() => openEditProject(p)}>Assign Customer</Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {custModal && (
        <CustomerModal
          api={api}
          initial={custModal.data}
          mode={custModal.mode}
          onClose={() => setCustModal(null)}
          onSaved={(row, mode) => {
            setCustModal(null);
            setToast({ tone: "success", msg: mode === "create" ? `Added "${row.name}".` : `Updated "${row.name}".` });
            load();
          }}
        />
      )}

      {projModal && (
        <ProjectModal
          api={api}
          csms={csms}
          customers={customers}
          initial={projModal.data}
          mode={projModal.mode}
          lockCustomer={projModal.lockCustomer}
          onClose={() => setProjModal(null)}
          onSaved={(row, mode) => {
            setProjModal(null);
            setToast({ tone: "success", msg: mode === "create" ? `Created "${row.name}".` : `Updated "${row.name}".` });
            load();
            onChanged && onChanged();
          }}
        />
      )}

      {showImport && (
        <ImportModal
          title="Import Projects from Excel"
          api={api}
          ctx={{ csms, customers }}
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

      {confirmDisable && (
        <Modal title={`Disable "${confirmDisable.customer.name}"?`} onClose={() => setConfirmDisable(null)} width={460}>
          <div style={{ color: G.text, fontFamily: "DM Mono,monospace", fontSize: 12, lineHeight: 1.6, marginBottom: 14 }}>
            Disabling hides the customer from the consultant portal and search. Their existing projects stay in place; you can re-enable from the "Show disabled" filter.
            {confirmDisable.activeProjects > 0 && (
              <div style={{ marginTop: 10, color: G.yellow }}>
                ⚠ {confirmDisable.activeProjects} project{confirmDisable.activeProjects === 1 ? "" : "s"} under this customer {confirmDisable.activeProjects === 1 ? "is" : "are"} still active. Those will also stop showing up.
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button onClick={() => setConfirmDisable(null)} variant="ghost">Cancel</Button>
            <Button onClick={() => { const c = confirmDisable.customer; setConfirmDisable(null); toggleActive(c, false); }} variant="danger">Disable</Button>
          </div>
        </Modal>
      )}

      {confirmDelProj && (
        <Confirm
          message={`Delete project "${confirmDelProj.name}"? This cascades to tasks and capacity.`}
          onCancel={() => setConfirmDelProj(null)}
          onConfirm={() => delProject(confirmDelProj)}
        />
      )}

      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}

// ── Customer row + expanded projects panel ────────────────────────────────
function CustomerRow({ customer, projects, csmById, isOpen, inactive, onToggle, onAddProject, onEditProject, onDeleteProject, onImportTasks, onEdit, onDisable, onEnable }) {
  return (
    <>
      <tr className="rh" style={{ cursor: "pointer", opacity: inactive ? 0.55 : 1 }}>
        <Td style={{ width: 32, textAlign: "center" }} onClick={onToggle}>
          <span style={{ display: "inline-block", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s", color: G.muted }}>▶</span>
        </Td>
        <Td style={{ fontWeight: 700, color: G.text }} onClick={onToggle}>
          {customer.name}
          {inactive && <span style={{ marginLeft: 8 }}><Pill tone="muted">Disabled</Pill></span>}
        </Td>
        <Td onClick={onToggle}>
          <div>{customer.contact_name || <span style={{ color: G.faint }}>—</span>}</div>
          {customer.contact_email && <div style={{ fontSize: 10, color: G.muted }}>{customer.contact_email}</div>}
        </Td>
        <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} onClick={onToggle}>{projects.length}</Td>
        <Td onClick={onToggle}>
          {inactive ? <Pill tone="muted">Inactive</Pill> : <Pill tone="green">Active</Pill>}
        </Td>
        <Td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <Button variant="primary" onClick={onAddProject} style={{ marginRight: 6 }}>+ Add Project</Button>
          <Button variant="ghost" onClick={onEdit} style={{ marginRight: 6 }}>Edit</Button>
          {inactive
            ? <Button variant="success" onClick={onEnable}>Enable</Button>
            : <Button variant="danger"  onClick={onDisable}>Disable</Button>}
        </Td>
      </tr>

      {isOpen && (
        <tr>
          <td colSpan={6} style={{ padding: 0, background: "#080e18", borderBottom: "1px solid " + G.border }}>
            {projects.length === 0 ? (
              <div style={{ padding: "16px 24px", color: G.muted, fontFamily: "DM Mono,monospace", fontSize: 11 }}>
                No projects under this customer yet.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#0a121e" }}>
                    <Th style={{ paddingLeft: 50 }}>Project</Th>
                    <Th>CSM</Th>
                    <Th>Stage</Th>
                    <Th>Health</Th>
                    <Th style={{ textAlign: "right" }}>ARR</Th>
                    <Th>Target</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map(p => (
                    <tr key={p.id} className="rh" style={{ cursor: "pointer" }} onClick={() => onEditProject(p)}>
                      <Td style={{ paddingLeft: 50, fontWeight: 700, color: G.text }}>{p.name}</Td>
                      <Td>{csmById[p.csm_id]?.name || <span style={{ color: G.faint }}>Unassigned</span>}</Td>
                      <Td>{p.stage}</Td>
                      <Td><Pill tone={p.health}>{(HEALTH_OPTIONS.find(h => h.value === p.health) || {}).label || p.health}</Pill></Td>
                      <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtArr(p.arr)}</Td>
                      <Td>{fmtDate(p.target_date)}</Td>
                      <Td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" onClick={() => onImportTasks(p)} style={{ marginRight: 6 }}>Import Tasks</Button>
                        <Button variant="danger" onClick={() => onDeleteProject(p)}>Delete</Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Add / edit customer ───────────────────────────────────────────────────
function CustomerModal({ api, initial, mode, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    const e = {};
    if (!form.name || !form.name.trim()) e.name = "Customer name is required.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const payload = {
        name:           form.name.trim(),
        contact_name:   form.contact_name?.trim() || null,
        contact_email:  form.contact_email?.trim() || null,
        contact_phone:  form.contact_phone?.trim() || null,
        address:        form.address?.trim() || null,
        notes:          form.notes?.trim() || null,
        is_active:      form.is_active !== false,
      };
      if (mode === "create") {
        const rows = await audited("customer.create", "customers", null, () => api.post("customers", [payload]), { after: payload });
        onSaved(rows[0], "create");
      } else {
        await audited("customer.update", "customers", initial.id, () => api.patch("customers", initial.id, payload), { before: initial, after: payload });
        onSaved({ ...initial, ...payload }, "edit");
      }
    } catch (err) {
      setErrors({ _root: err.message || "Save failed." });
    }
    setSaving(false);
  };

  return (
    <Modal title={mode === "create" ? "New Customer" : "Edit Customer"} onClose={onClose} width={580}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ gridColumn: "span 2" }}>
          <Label>CUSTOMER NAME</Label>
          <Input value={form.name} onChange={v => set("name", v)} placeholder="e.g. Acme Corporation" />
          <FieldError error={errors.name} />
        </div>
        <div>
          <Label>CONTACT NAME</Label>
          <Input value={form.contact_name} onChange={v => set("contact_name", v)} placeholder="Primary contact" />
        </div>
        <div>
          <Label>CONTACT EMAIL</Label>
          <Input type="email" value={form.contact_email} onChange={v => set("contact_email", v)} placeholder="contact@acme.com" />
        </div>
        <div>
          <Label>CONTACT PHONE</Label>
          <Input value={form.contact_phone} onChange={v => set("contact_phone", v)} placeholder="(555) 123-4567" />
        </div>
        <div>
          <Label>ADDRESS</Label>
          <Input value={form.address} onChange={v => set("address", v)} placeholder="Street, City, State" />
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <Label>NOTES</Label>
          <TextArea value={form.notes} onChange={v => set("notes", v)} placeholder="Account-level context that doesn't fit on a project." />
        </div>
        <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: 8 }}>
          <input id="cust-active" type="checkbox" checked={form.is_active !== false} onChange={e => set("is_active", e.target.checked)} />
          <label htmlFor="cust-active" style={{ fontSize: 12, fontFamily: "DM Mono,monospace", color: G.text, cursor: "pointer" }}>
            Active — show on the consultant portal
          </label>
        </div>
      </div>
      {errors._root && (
        <div style={{ marginTop: 14, padding: "9px 12px", background: G.redBg, border: "1px solid " + G.red + "55", borderRadius: 8, color: G.red, fontFamily: "DM Mono,monospace", fontSize: 12 }}>{errors._root}</div>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <Button onClick={onClose} variant="ghost">Cancel</Button>
        <Button onClick={save} variant="primary" disabled={saving}>{saving ? "Saving…" : mode === "create" ? "Add Customer" : "Save Changes"}</Button>
      </div>
    </Modal>
  );
}
