import { useState, useEffect, useCallback } from "react";
import { G } from "../lib/theme.js";
import ProjectsTab from "./ProjectsTab.jsx";
import CsmsTab from "./CsmsTab.jsx";
import AssignmentsTab from "./AssignmentsTab.jsx";
import IntegrationsTab from "./IntegrationsTab.jsx";
import NotificationsTab from "./NotificationsTab.jsx";
import AuditTab from "./AuditTab.jsx";
import SecurityTab from "./SecurityTab.jsx";

const TABS = [
  { id: "projects",      label: "Projects" },
  { id: "csms",          label: "CSMs" },
  { id: "assignments",   label: "Assignments" },
  { id: "integrations",  label: "Integrations" },
  { id: "notifications", label: "Notifications" },
  { id: "audit",         label: "Audit Log" },
  { id: "security",      label: "Security" },
];

export default function ConfigPage({ api, csms: initialCsms, onCsmsChanged }) {
  const [tab, setTab] = useState(() => {
    const hash = (typeof window !== "undefined" && window.location.hash) || "";
    const m = hash.match(/^#config\/(\w+)/);
    return (m && TABS.find(t => t.id === m[1]))?.id || "projects";
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
    if (typeof window !== "undefined") {
      window.location.hash = "#config/" + tab;
    }
  }, [tab]);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: G.bg, padding: "18px 24px 40px" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: G.text, fontFamily: "Syne,sans-serif", letterSpacing: "0.01em" }}>Configuration</div>
          <div style={{ fontSize: 12, fontFamily: "DM Mono,monospace", color: G.muted, letterSpacing: "0.05em", marginTop: 4 }}>
            Manage accounts, CSMs, assignments, integrations, and security posture.
          </div>
        </div>

        <div style={{ display: "flex", gap: 2, borderBottom: "1px solid " + G.border, marginBottom: 18 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: tab === t.id ? G.surface : "none",
                border: "none",
                borderBottom: tab === t.id ? "2px solid " + G.purple : "2px solid transparent",
                color: tab === t.id ? G.text : G.muted,
                padding: "9px 16px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.03em",
                fontFamily: "Syne,sans-serif",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "projects"     && <ProjectsTab     api={api} csms={csms} onChanged={refreshCsms} />}
        {tab === "csms"         && <CsmsTab         api={api} onChanged={refreshCsms} />}
        {tab === "assignments"  && <AssignmentsTab  api={api} csms={csms} onChanged={refreshCsms} />}
        {tab === "integrations"  && <IntegrationsTab  api={api} />}
        {tab === "notifications" && <NotificationsTab api={api} />}
        {tab === "audit"         && <AuditTab         api={api} />}
        {tab === "security"      && <SecurityTab      api={api} />}
      </div>
    </div>
  );
}
