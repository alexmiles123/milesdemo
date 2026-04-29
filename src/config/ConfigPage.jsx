import { useState, useEffect, useCallback } from "react";
import { G } from "../lib/theme.js";
import CustomersTab from "./CustomersTab.jsx";
import CsmsTab from "./CsmsTab.jsx";
import AssignmentsTab from "./AssignmentsTab.jsx";
import IntegrationsTab from "./IntegrationsTab.jsx";
import NotificationsTab from "./NotificationsTab.jsx";
import AuditTab from "./AuditTab.jsx";
import SecurityTab from "./SecurityTab.jsx";
import UsersTab from "./UsersTab.jsx";
import RolesTab from "./RolesTab.jsx";
import TaskTemplatesTab from "./TaskTemplatesTab.jsx";

// Sidebar nav grouped by domain. The flat horizontal tab strip stopped scaling
// once we added users + task templates + compliance — too many siblings, no
// hierarchy. The groups below mirror the way an admin actually thinks about
// settings ("I need to add a user" → People; "I need to wire up Salesforce"
// → Operations).
const SECTIONS = [
  {
    id: "accounts",
    label: "Accounts",
    desc: "Customers, projects, and onboarding templates.",
    items: [
      { id: "customers",      label: "Customers",            desc: "Customer accounts and the projects under each one." },
      { id: "task-templates", label: "Task Templates",       desc: "Reusable task lists applied when a new project starts." },
    ],
  },
  {
    id: "people",
    label: "People",
    desc: "CSMs, app users, and account assignments.",
    items: [
      { id: "csms",        label: "CSMs",        desc: "The customer success roster and roles." },
      { id: "users",       label: "App Users",   desc: "Sign-in accounts that can access this platform." },
      { id: "roles",       label: "Roles",       desc: "Application roles and the views they unlock." },
      { id: "assignments", label: "Assignments", desc: "Which CSMs cover which accounts." },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    desc: "External systems and outbound notifications.",
    items: [
      { id: "integrations",  label: "Integrations",  desc: "Microsoft Teams, Salesforce, and the activity sync." },
      { id: "notifications", label: "Notifications", desc: "Daily alerts, reminders, and routing rules." },
    ],
  },
  {
    id: "compliance",
    label: "Compliance & Security",
    desc: "Audit history and SOC-aligned controls.",
    items: [
      { id: "audit",    label: "Audit Log", desc: "Append-only record of every change in the system." },
      { id: "security", label: "Security",  desc: "Password policy, session controls, and SOC posture." },
    ],
  },
];

const ALL_TABS = SECTIONS.flatMap(s => s.items);
const findSection = (tabId) => SECTIONS.find(s => s.items.some(i => i.id === tabId)) || SECTIONS[0];

export default function ConfigPage({ api, csms: initialCsms, onCsmsChanged }) {
  const [tab, setTab] = useState(() => {
    const hash = (typeof window !== "undefined" && window.location.hash) || "";
    const m = hash.match(/^#config\/([\w-]+)/);
    // Map the legacy "projects" hash to the new Customers tab so deep links
    // bookmarked before the rename still resolve.
    const raw = m && m[1];
    const id = raw === "projects" ? "customers" : raw;
    const fromHash = id && ALL_TABS.find(t => t.id === id)?.id;
    return fromHash || "customers";
  });
  const [csms, setCsms] = useState(initialCsms || []);

  const refreshCsms = useCallback(async () => {
    try {
      const rows = await api.get("csms", { select: "*", order: "name.asc" });
      setCsms(rows || []);
      onCsmsChanged && onCsmsChanged(rows || []);
    } catch { /* swallow */ }
  }, [api, onCsmsChanged]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refreshCsms(); }, [refreshCsms]);

  useEffect(() => {
    if (typeof window !== "undefined") window.location.hash = "#config/" + tab;
  }, [tab]);

  const activeItem = ALL_TABS.find(t => t.id === tab) || ALL_TABS[0];
  const activeSection = findSection(tab);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: G.bg }}>
      <div style={{ maxWidth: 1500, margin: "0 auto", padding: "20px 24px 40px", display: "grid", gridTemplateColumns: "260px 1fr", gap: 24 }}>

        {/* Sidebar */}
        <aside style={{ position: "sticky", top: 0, alignSelf: "start" }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: G.text, fontFamily: "Syne,sans-serif" }}>Configuration</div>
            <div style={{ fontSize: 12, fontFamily: "Inter,system-ui,sans-serif", color: G.muted, letterSpacing: "0.05em", marginTop: 4 }}>
              Settings, people, integrations, and compliance.
            </div>
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {SECTIONS.map(sec => (
              <div key={sec.id}>
                <div style={{ fontSize: 11, fontFamily: "Inter,system-ui,sans-serif", color: G.faint, letterSpacing: "0.12em", textTransform: "uppercase", padding: "0 10px 6px" }}>
                  {sec.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {sec.items.map(item => {
                    const active = tab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setTab(item.id)}
                        style={{
                          textAlign: "left",
                          background: active ? G.surface2 : "transparent",
                          border: "1px solid " + (active ? G.border2 : "transparent"),
                          borderLeft: "3px solid " + (active ? G.purple : "transparent"),
                          color: active ? G.text : G.muted,
                          padding: "9px 12px",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontSize: 14,
                          fontWeight: active ? 700 : 500,
                          fontFamily: "Syne,sans-serif",
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main panel */}
        <main style={{ minWidth: 0 }}>
          <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid " + G.border }}>
            <div style={{ fontSize: 11, fontFamily: "Inter,system-ui,sans-serif", color: G.faint, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              {activeSection.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: G.text, fontFamily: "Syne,sans-serif", marginTop: 4 }}>
              {activeItem.label}
            </div>
            <div style={{ fontSize: 13, color: G.muted, marginTop: 4 }}>{activeItem.desc}</div>
          </div>

          <div style={{ animation: "fadein .2s ease" }}>
            {tab === "customers"      && <CustomersTab      api={api} csms={csms} onChanged={refreshCsms} />}
            {tab === "task-templates" && <TaskTemplatesTab  api={api} />}
            {tab === "csms"           && <CsmsTab           api={api} onChanged={refreshCsms} />}
            {tab === "users"          && <UsersTab          api={api} />}
            {tab === "roles"          && <RolesTab          api={api} />}
            {tab === "assignments"    && <AssignmentsTab    api={api} csms={csms} onChanged={refreshCsms} />}
            {tab === "integrations"   && <IntegrationsTab   api={api} />}
            {tab === "notifications"  && <NotificationsTab  api={api} />}
            {tab === "audit"          && <AuditTab          api={api} />}
            {tab === "security"       && <SecurityTab       api={api} />}
          </div>
        </main>
      </div>
    </div>
  );
}
