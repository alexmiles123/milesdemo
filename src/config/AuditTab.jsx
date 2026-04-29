import { useState, useEffect, useCallback } from "react";
import { G, fmtDateTime } from "../lib/theme.js";
import { Card, CardHeader, Input, Select, Button, Empty, Th, Td, Pill } from "./common.jsx";

export default function AuditTab({ api }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("audit_log", { select:"*", order:"occurred_at.desc", limit: "200" });
      setRows(res || []);
    } catch { setRows([]); }
    setLoading(false);
  }, [api]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const actions = ["all", ...Array.from(new Set(rows.map(r => r.action)))].sort();
  const filtered = rows.filter(r => {
    if (actionFilter !== "all" && r.action !== actionFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      const blob = [r.actor, r.action, r.target_table, r.target_id, JSON.stringify(r.metadata || {})].join(" ").toLowerCase();
      if (!blob.includes(s)) return false;
    }
    return true;
  });

  return (
    <Card>
      <CardHeader right={<Button onClick={load}>Refresh</Button>}>
        AUDIT LOG · APPEND-ONLY · LAST 200 EVENTS
      </CardHeader>
      <div style={{ padding: "12px 18px", display:"flex", gap:10, alignItems:"center", borderBottom: "1px solid " + G.border }}>
        <Input value={search} onChange={setSearch} placeholder="Search actor, action, target, metadata..." style={{ flex:1, maxWidth: 420 }} />
        <Select value={actionFilter} onChange={setActionFilter} options={actions.map(a => ({ value:a, label: a === "all" ? "All actions" : a }))} style={{ width: 240 }} />
      </div>
      {loading ? <Empty>Loading audit log…</Empty> : filtered.length === 0 ? (
        <Empty>No events{rows.length ? " match the current filters" : " yet — start clicking around."}.</Empty>
      ) : (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>
              <Th style={{ width: 180 }}>When</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Target</Th>
              <Th>IP</Th>
              <Th></Th>
            </tr></thead>
            <tbody>
              {filtered.map(r => {
                const isOpen = expanded === r.id;
                const isFailure = (r.action || "").endsWith(".failed");
                return (
                  <>
                    <tr key={r.id} style={{ cursor:"pointer" }} className="rh" onClick={() => setExpanded(isOpen ? null : r.id)}>
                      <Td>{fmtDateTime(r.occurred_at)}</Td>
                      <Td style={{ color: G.text }}>{r.actor}</Td>
                      <Td><Pill tone={isFailure ? "red" : r.action.includes("delete") ? "yellow" : r.action.includes("create") ? "green" : "blue"}>{r.action}</Pill></Td>
                      <Td style={{ color: G.muted }}>{r.target_table}{r.target_id ? ` · ${r.target_id.slice(0, 8)}…` : ""}</Td>
                      <Td style={{ color: G.faint }}>{r.ip_address || "—"}</Td>
                      <Td style={{ textAlign:"right", color: G.faint }}>{isOpen ? "▾" : "▸"}</Td>
                    </tr>
                    {isOpen && (
                      <tr key={r.id + "-d"}>
                        <td colSpan={6} style={{ background: G.bg, padding: 16, borderBottom: "1px solid " + G.border }}>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 14, fontFamily: "Inter,system-ui,sans-serif", fontSize: 11 }}>
                            <LogBlob title="Before" obj={r.before_state} />
                            <LogBlob title="After" obj={r.after_state} />
                          </div>
                          <LogBlob title="Metadata" obj={r.metadata} />
                          <div style={{ marginTop: 8, display:"flex", gap: 18, color: G.faint, fontSize: 11, fontFamily:"Inter,system-ui,sans-serif" }}>
                            <span>Request: {r.request_id || "—"}</span>
                            <span>User agent: {r.user_agent || "—"}</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function LogBlob({ title, obj }) {
  if (!obj || (typeof obj === "object" && Object.keys(obj).length === 0)) {
    return <div style={{ color: G.faint }}><b style={{ color: G.muted }}>{title}:</b> —</div>;
  }
  return (
    <div>
      <div style={{ color: G.muted, marginBottom: 4, letterSpacing: "0.08em", fontSize: 10 }}>{title.toUpperCase()}</div>
      <pre style={{
        background: G.surface2, border: "1px solid " + G.border, borderRadius: 6, padding: 10,
        color: G.text, fontSize: 11, overflowX:"auto", maxHeight: 260, whiteSpace: "pre-wrap", wordBreak:"break-word",
      }}>{JSON.stringify(obj, null, 2)}</pre>
    </div>
  );
}
