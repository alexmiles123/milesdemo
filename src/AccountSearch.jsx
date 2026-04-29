// Global account search. Lives in the NavBar across every screen.
//
// Types into the input → debounced query against customers.name (ILIKE). The
// dropdown shows the top 8 matches; picking one calls onSelect(customer),
// which opens the AccountDetail view.

import { useState, useEffect, useRef } from "react";
import { G } from "./lib/theme.js";

export default function AccountSearch({ api, onSelect }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);

  // Close on outside click.
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced search.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        // PostgREST: name=ilike.*foo*  is case-insensitive substring.
        const rows = await api.get("customers", {
          select: "id,name,contact_name,contact_email,is_active",
          name: "ilike.*" + encodeURIComponent(q.trim()) + "*",
          is_active: "eq.true",
          order: "name.asc",
          limit: "8",
        });
        setResults(Array.isArray(rows) ? rows : []);
        setHoverIdx(0);
      } catch {
        setResults([]);
      }
      setLoading(false);
    }, 220);
    return () => clearTimeout(debounceRef.current);
  }, [q, api]);

  const pick = (c) => {
    setQ("");
    setOpen(false);
    setResults([]);
    onSelect(c);
  };

  const onKey = (e) => {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHoverIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHoverIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(results[hoverIdx]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", width: 260 }}>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => q && setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search accounts…"
        style={{
          width: "100%", background: G.surface, border: "1px solid " + G.border2,
          color: G.text, padding: "6px 12px 6px 30px", borderRadius: 6,
          fontFamily: "DM Mono,monospace", fontSize: 11,
        }}
      />
      <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                      color: G.muted, fontSize: 12, pointerEvents: "none" }}>⌕</span>

      {open && q && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: G.surface, border: "1px solid " + G.border, borderRadius: 8,
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)", zIndex: 50, maxHeight: 320, overflow: "auto",
        }}>
          {loading && (
            <div style={{ padding: "10px 14px", color: G.muted,
                          fontFamily: "DM Mono,monospace", fontSize: 11 }}>Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div style={{ padding: "10px 14px", color: G.faint,
                          fontFamily: "DM Mono,monospace", fontSize: 11 }}>No matches.</div>
          )}
          {!loading && results.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setHoverIdx(i)}
              onClick={() => pick(c)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 14px",
                background: i === hoverIdx ? G.surface2 : "transparent",
                border: "none", borderBottom: "1px solid " + G.border,
                color: G.text, cursor: "pointer",
                fontFamily: "DM Mono,monospace", fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 700 }}>{c.name}</div>
              {(c.contact_name || c.contact_email) && (
                <div style={{ fontSize: 10, color: G.muted, marginTop: 2 }}>
                  {c.contact_name || ""}{c.contact_name && c.contact_email ? " · " : ""}{c.contact_email || ""}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
