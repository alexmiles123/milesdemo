import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { G } from "../lib/theme.js";
import { audited } from "../lib/audit.js";
import { Modal, Button } from "./common.jsx";

// A generic Excel/CSV importer.
//
// Props:
//   title:       string shown in modal header
//   spec: {
//     table:       Supabase table name for insert (ignored when onCommit is set)
//     auditAction: audit event name (e.g. "project.create")
//     columns: [
//       { key: "name",    aliases: ["name","project","project name"], required: true },
//       { key: "csm_id",  aliases: ["csm","owner"], lookup: (raw, ctx) => id|null,
//         requiredMsg: "CSM not found" },
//       { key: "arr",     aliases: ["arr","annual recurring revenue"], parse: "number" },
//       { key: "target_date", aliases: ["target","target date","go-live"], parse: "date" },
//       ...
//     ],
//     // optional per-row transform applied after column parsing
//     transformRow: (row, ctx) => row,
//     // optional defaults applied to every row
//     defaults: { stage: "Kickoff", health: "green" }
//   }
//   ctx:      free-form lookup context (e.g., { csms, projects }) forwarded to lookup()
//   onCommit: optional async (rows) => { created, failed?, errors? }. When set, the
//             default DB insert is skipped and the caller decides what to do with the
//             parsed rows (e.g., append to local state in a parent form). Needed for
//             cases where the import is part of a larger unsaved record.
//   onDone:   callback(summary) once import commits
//
export default function ImportModal({ title, spec, ctx, onClose, onDone, onCommit, api }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]); // parsed, validated preview
  const [parseError, setParseError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState(null);
  const fileInputRef = useRef(null);

  const validColumns = rows.length
    ? spec.columns.filter(c => rows[0] && c.key in rows[0].parsed)
    : [];

  const anyValid = rows.some(r => !r._errors.length);

  const parseFile = async (file) => {
    setParseError(null);
    setFileName(file.name);
    setSummary(null);
    try {
      // Cap upload size (10 MB) and row count (50k) before parsing. SheetJS
      // is happy to allocate gigabytes for a maliciously-crafted workbook;
      // the cap shields the tab from a runaway Out-Of-Memory crash and
      // makes the failure a friendly "file too large" toast instead.
      const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
      const MAX_ROWS = 50_000;
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(`File is too large. Maximum is ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`);
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("Workbook has no sheets.");
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
      if (!raw.length) throw new Error("File has no data rows.");
      if (raw.length > MAX_ROWS) {
        throw new Error(`Too many rows: ${raw.length}. Maximum is ${MAX_ROWS}. Split the file into smaller batches.`);
      }

      const normHeaders = {};
      Object.keys(raw[0]).forEach(h => {
        normHeaders[h.toString().trim().toLowerCase()] = h;
      });

      const out = raw.map((r, i) => {
        const parsed = { ...(spec.defaults || {}) };
        const errors = [];
        for (const col of spec.columns) {
          let sourceKey = null;
          for (const alias of col.aliases) {
            if (alias.toLowerCase() in normHeaders) {
              sourceKey = normHeaders[alias.toLowerCase()];
              break;
            }
          }
          if (sourceKey === null) {
            if (col.required) errors.push(`Missing column "${col.aliases[0]}"`);
            continue;
          }
          const rawVal = r[sourceKey];
          const str = (rawVal === null || rawVal === undefined) ? "" : String(rawVal).trim();
          if (!str) {
            if (col.required) errors.push(`"${col.aliases[0]}" is empty`);
            continue;
          }
          let val = str;
          if (col.parse === "number") {
            const n = Number(str.replace(/[$,%\s]/g, ""));
            if (Number.isNaN(n)) { errors.push(`"${col.aliases[0]}" is not a number`); continue; }
            val = n;
          } else if (col.parse === "date") {
            const d = new Date(str);
            if (Number.isNaN(d.getTime())) { errors.push(`"${col.aliases[0]}" is not a valid date`); continue; }
            val = d.toISOString().slice(0, 10);
          } else if (col.parse === "enum") {
            const match = col.values.find(v => v.toLowerCase() === str.toLowerCase());
            if (!match) { errors.push(`"${col.aliases[0]}" must be one of: ${col.values.join(", ")}`); continue; }
            val = match;
          } else if (col.parse === "healthEnum") {
            // Accept green/yellow/red OR "On Track"/"At Risk"/"Critical"
            const map = {
              green: "green", yellow: "yellow", red: "red",
              "on track": "green", "at risk": "yellow", critical: "red",
            };
            const v = map[str.toLowerCase()];
            if (!v) { errors.push(`"${col.aliases[0]}" must be On Track / At Risk / Critical`); continue; }
            val = v;
          }
          if (col.lookup) {
            const looked = col.lookup(val, ctx);
            if (!looked) { errors.push(col.requiredMsg || `"${col.aliases[0]}" not found: "${val}"`); continue; }
            val = looked;
          }
          parsed[col.key] = val;
        }
        const transformed = spec.transformRow ? spec.transformRow(parsed, ctx) : parsed;
        return { row: i + 2, parsed: transformed, _errors: errors };
      });

      setRows(out);
    } catch (e) {
      setParseError(e.message);
      setRows([]);
    }
  };

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) parseFile(f);
  };

  const doImport = async () => {
    setImporting(true);
    const toInsert = rows.filter(r => !r._errors.length).map(r => r.parsed);
    let results;
    if (typeof onCommit === "function") {
      try {
        const r = await onCommit(toInsert);
        results = {
          created: r?.created ?? toInsert.length,
          failed:  r?.failed  ?? 0,
          errors:  r?.errors  ?? [],
        };
      } catch (e) {
        results = { created: 0, failed: toInsert.length, errors: [e.message] };
      }
    } else {
      results = { created: 0, failed: 0, errors: [] };
      // Insert in chunks of 50 so one bad row doesn't kill the whole batch
      for (let i = 0; i < toInsert.length; i += 50) {
        const chunk = toInsert.slice(i, i + 50);
        try {
          await audited(spec.auditAction, spec.table, null, () => api.post(spec.table, chunk), { after: { count: chunk.length } });
          results.created += chunk.length;
        } catch (e) {
          results.failed += chunk.length;
          results.errors.push(e.message);
        }
      }
    }
    setSummary(results);
    setImporting(false);
    if (results.created > 0) onDone && onDone(results);
  };

  const downloadTemplate = () => {
    const headers = spec.columns.map(c => c.aliases[0]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...(spec.templateSample || [])]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, spec.templateName || "import-template.xlsx");
  };

  const describeType = (col) => {
    if (col.lookup) return "lookup (name)";
    if (col.parse === "number") return "number";
    if (col.parse === "date") return "date (YYYY-MM-DD)";
    if (col.parse === "enum") return col.values.join(" | ");
    if (col.parse === "healthEnum") return "On Track | At Risk | Critical";
    return "text";
  };
  const sampleFor = (idx) => {
    const sample = spec.templateSample?.[0];
    return sample && sample[idx] !== undefined && sample[idx] !== "" ? String(sample[idx]) : "—";
  };

  const validRows = rows.filter(r => !r._errors.length);
  const errorRows = rows.filter(r => r._errors.length);

  return (
    <Modal title={title} onClose={onClose} width={780}>
      {!summary && (
        <>
          <div style={{ border: "1px solid " + G.border, borderRadius: 10, background: G.surface2, marginBottom: 14, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid " + G.border, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: G.text, fontFamily: "DM Mono,monospace", letterSpacing: "0.05em" }}>TEMPLATE · COLUMN LAYOUT</div>
              <div style={{ fontSize: 10, color: G.muted, fontFamily: "DM Mono,monospace" }}>.xlsx · .xls · .csv · headers case-insensitive</div>
              <Button variant="primary" onClick={downloadTemplate} style={{ marginLeft: "auto" }}>↓ Download .xlsx Template</Button>
            </div>
            <div style={{ maxHeight: 220, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "DM Mono,monospace" }}>
                <thead style={{ position: "sticky", top: 0, background: G.surface }}>
                  <tr style={{ borderBottom: "1px solid " + G.border }}>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: G.muted, letterSpacing: "0.05em" }}>COLUMN</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: G.muted, letterSpacing: "0.05em" }}>REQUIRED</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: G.muted, letterSpacing: "0.05em" }}>FORMAT</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: G.muted, letterSpacing: "0.05em" }}>EXAMPLE</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.columns.map((col, idx) => (
                    <tr key={col.key} style={{ borderBottom: "1px solid " + G.faint }}>
                      <td style={{ padding: "5px 10px", color: G.text, fontWeight: 700 }}>{col.aliases[0]}</td>
                      <td style={{ padding: "5px 10px", color: col.required ? G.red : G.faint }}>{col.required ? "YES" : "optional"}</td>
                      <td style={{ padding: "5px 10px", color: G.muted }}>{describeType(col)}</td>
                      <td style={{ padding: "5px 10px", color: G.muted }}>{sampleFor(idx)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: "2px dashed " + G.border, borderRadius: 10, padding: "28px 16px",
              textAlign: "center", cursor: "pointer", background: G.surface2,
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 13, color: G.text, fontFamily: "DM Mono,monospace", marginBottom: 4 }}>
              {fileName ? `Loaded: ${fileName}` : "Drop an Excel/CSV file, or click to browse"}
            </div>
            <div style={{ fontSize: 10, color: G.faint, fontFamily: "DM Mono,monospace" }}>
              Required columns: {spec.columns.filter(c => c.required).map(c => c.aliases[0]).join(", ")}
            </div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
          </div>

          {parseError && (
            <div style={{ padding: "9px 12px", background: G.redBg, border: "1px solid " + G.red + "55", borderRadius: 8, color: G.red, fontFamily: "DM Mono,monospace", fontSize: 12, marginBottom: 14 }}>
              {parseError}
            </div>
          )}

          {rows.length > 0 && (
            <>
              <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 10, fontSize: 12, fontFamily: "DM Mono,monospace" }}>
                <span style={{ color: G.green }}>{validRows.length} valid</span>
                {errorRows.length > 0 && <span style={{ color: G.red }}>{errorRows.length} with errors</span>}
                <span style={{ color: G.muted }}>{rows.length} total rows</span>
              </div>

              <div style={{ maxHeight: 280, overflow: "auto", border: "1px solid " + G.border, borderRadius: 8, marginBottom: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "DM Mono,monospace" }}>
                  <thead style={{ position: "sticky", top: 0, background: G.surface }}>
                    <tr style={{ borderBottom: "1px solid " + G.border }}>
                      <th style={{ padding: "6px 8px", textAlign: "left", color: G.muted }}>ROW</th>
                      {validColumns.map(c => (
                        <th key={c.key} style={{ padding: "6px 8px", textAlign: "left", color: G.muted }}>{c.aliases[0].toUpperCase()}</th>
                      ))}
                      <th style={{ padding: "6px 8px", textAlign: "left", color: G.muted }}>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 100).map((r, i) => {
                      const bad = r._errors.length > 0;
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid " + G.faint, background: bad ? G.redBg + "22" : "transparent" }}>
                          <td style={{ padding: "5px 8px", color: G.muted }}>{r.row}</td>
                          {validColumns.map(c => (
                            <td key={c.key} style={{ padding: "5px 8px", color: G.text, whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {String(r.parsed[c.key] ?? "—")}
                            </td>
                          ))}
                          <td style={{ padding: "5px 8px", color: bad ? G.red : G.green }}>
                            {bad ? r._errors.join("; ") : "OK"}
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length > 100 && (
                      <tr><td colSpan={validColumns.length + 2} style={{ padding: 10, textAlign: "center", color: G.muted }}>
                        …{rows.length - 100} more rows not shown in preview
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {summary && (
        <div style={{ padding: "16px 18px", border: "1px solid " + G.border, borderRadius: 10, background: G.surface2, marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: G.text, fontFamily: "Syne,sans-serif", marginBottom: 10 }}>Import complete</div>
          <div style={{ fontFamily: "DM Mono,monospace", fontSize: 12, color: G.muted, lineHeight: 1.8 }}>
            <div><span style={{ color: G.green }}>✓</span> Created: <strong style={{ color: G.text }}>{summary.created}</strong></div>
            {summary.failed > 0 && <div><span style={{ color: G.red }}>✗</span> Failed: <strong style={{ color: G.text }}>{summary.failed}</strong></div>}
            {summary.errors.length > 0 && (
              <div style={{ marginTop: 8, padding: 8, background: G.redBg + "33", borderRadius: 6, color: G.red, fontSize: 11 }}>
                {summary.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>{summary ? "Close" : "Cancel"}</Button>
        {!summary && (
          <Button variant="primary" onClick={doImport} disabled={!anyValid || importing}>
            {importing ? "Importing…" : `Import ${validRows.length} row${validRows.length !== 1 ? "s" : ""}`}
          </Button>
        )}
      </div>
    </Modal>
  );
}
