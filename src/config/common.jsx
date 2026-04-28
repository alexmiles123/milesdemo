import { G } from "../lib/theme.js";

// ─── Primitive form controls, styled to match the existing dashboard ────────

export const Card = ({ children, style = {} }) => (
  <div style={{ background: G.surface, border: "1px solid " + G.border, borderRadius: 12, ...style }}>{children}</div>
);

export const CardHeader = ({ children, right }) => (
  <div style={{ padding: "12px 18px", borderBottom: "1px solid " + G.border, display: "flex", alignItems: "center" }}>
    <div style={{ fontSize: 15, fontWeight: 700, color: G.muted, letterSpacing: "0.05em", fontFamily: "DM Mono,monospace" }}>{children}</div>
    {right ? <div style={{ marginLeft: "auto" }}>{right}</div> : null}
  </div>
);

export const Label = ({ children }) => (
  <label style={{ fontSize: 11, fontFamily: "DM Mono,monospace", color: G.muted, letterSpacing: "0.12em", display: "block", marginBottom: 5 }}>
    {children}
  </label>
);

export const Input = ({ value, onChange, placeholder, type = "text", style = {}, disabled = false, ...rest }) => (
  <input
    value={value ?? ""}
    onChange={(e) => onChange && onChange(e.target.value)}
    placeholder={placeholder}
    type={type}
    disabled={disabled}
    {...rest}
    style={{
      width: "100%", background: "#080e18", border: "1px solid " + G.border, color: G.text,
      padding: "9px 12px", borderRadius: 8, fontFamily: "DM Mono,monospace", fontSize: 12,
      opacity: disabled ? 0.55 : 1, ...style,
    }}
  />
);

export const TextArea = ({ value, onChange, placeholder, rows = 3, style = {} }) => (
  <textarea
    value={value ?? ""}
    onChange={(e) => onChange && onChange(e.target.value)}
    placeholder={placeholder}
    rows={rows}
    style={{
      width: "100%", background: "#080e18", border: "1px solid " + G.border, color: G.text,
      padding: "9px 12px", borderRadius: 8, fontFamily: "DM Mono,monospace", fontSize: 12, resize: "vertical", ...style,
    }}
  />
);

export const Select = ({ value, onChange, options, disabled = false, style = {} }) => (
  <select
    value={value ?? ""}
    onChange={(e) => onChange && onChange(e.target.value)}
    disabled={disabled}
    style={{
      width: "100%", background: "#080e18", border: "1px solid " + G.border, color: G.text,
      padding: "9px 12px", borderRadius: 8, fontFamily: "DM Mono,monospace", fontSize: 12,
      opacity: disabled ? 0.55 : 1, cursor: disabled ? "not-allowed" : "pointer", ...style,
    }}
  >
    {options.map((o) => {
      const val = typeof o === "string" ? o : o.value;
      const label = typeof o === "string" ? o : o.label;
      return <option key={val} value={val}>{label}</option>;
    })}
  </select>
);

export const Button = ({ children, onClick, variant = "default", disabled = false, style = {}, type = "button" }) => {
  const variants = {
    default: { bg: G.surface2, bd: G.border2, c: G.text },
    primary: { bg: "linear-gradient(135deg,#7c3aed,#a855f7)", bd: "transparent", c: "#fff" },
    danger:  { bg: G.redBg, bd: G.redBd, c: G.red },
    ghost:   { bg: "transparent", bd: G.border, c: G.muted },
    success: { bg: G.greenBg, bd: G.greenBd, c: G.green },
  };
  const s = variants[variant] || variants.default;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: s.bg, border: "1px solid " + s.bd, color: s.c, padding: "8px 14px", borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer", fontFamily: "DM Mono,monospace", fontSize: 11,
        fontWeight: 600, letterSpacing: "0.05em", opacity: disabled ? 0.55 : 1, ...style,
      }}
    >
      {children}
    </button>
  );
};

export const FieldError = ({ error }) => error ? (
  <div style={{ color: G.red, fontSize: 11, fontFamily: "DM Mono,monospace", marginTop: 4 }}>{error}</div>
) : null;

export const Toast = ({ tone = "success", children, onClose }) => {
  const c = tone === "error" ? { bg: G.redBg, bd: G.red + "44", fg: G.red } :
            tone === "info"  ? { bg: G.blueBg, bd: G.blueBd, fg: G.blue } :
                               { bg: G.greenBg, bd: G.greenBd, fg: G.green };
  return (
    <div style={{
      position: "fixed", bottom: 18, right: 18, zIndex: 1000, background: c.bg, border: "1px solid " + c.bd,
      color: c.fg, padding: "10px 14px", borderRadius: 10, fontFamily: "DM Mono,monospace", fontSize: 12,
      display: "flex", alignItems: "center", gap: 12, maxWidth: 480, animation: "fadein .2s ease",
    }}>
      <span>{children}</span>
      {onClose ? <button onClick={onClose} style={{ background: "none", border: "none", color: c.fg, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>×</button> : null}
    </div>
  );
};

export const Modal = ({ title, onClose, children, width = 560 }) => (
  <div
    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
  >
    <div style={{ background: G.surface, border: "1px solid " + G.border, borderRadius: 14, width: "100%", maxWidth: width, maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid " + G.border, display: "flex", alignItems: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: G.text, fontFamily: "Syne,sans-serif" }}>{title}</div>
        <button
          onClick={onClose}
          style={{ marginLeft: "auto", background: "none", border: "1px solid " + G.border, color: G.muted, borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 14 }}
        >×</button>
      </div>
      <div style={{ padding: 20, overflowY: "auto" }}>{children}</div>
    </div>
  </div>
);

export const Empty = ({ children }) => (
  <div style={{ padding: "40px 20px", textAlign: "center", color: G.muted, fontFamily: "DM Mono,monospace", fontSize: 12 }}>{children}</div>
);

export const Th = ({ children, style = {} }) => (
  <th style={{ textAlign: "left", padding: "10px 14px", fontSize: 11, fontFamily: "DM Mono,monospace", color: G.muted, letterSpacing: "0.1em", fontWeight: 600, borderBottom: "1px solid " + G.border, ...style }}>
    {children}
  </th>
);

export const Td = ({ children, style = {}, ...rest }) => (
  <td {...rest} style={{ padding: "12px 14px", fontSize: 12, color: G.text, fontFamily: "DM Mono,monospace", borderBottom: "1px solid " + G.border, ...style }}>{children}</td>
);

export const Pill = ({ tone = "muted", children }) => {
  const tones = {
    muted:   { c: G.muted,  bg: G.surface2, bd: G.border2 },
    green:   { c: G.green,  bg: G.greenBg,  bd: G.greenBd },
    yellow:  { c: G.yellow, bg: G.yellowBg, bd: G.yellowBd },
    red:     { c: G.red,    bg: G.redBg,    bd: G.redBd },
    blue:    { c: G.blue,   bg: G.blueBg,   bd: G.blueBd },
    purple:  { c: G.purple, bg: G.purpleBg, bd: "#2a1e4f" },
  };
  const t = tones[tone] || tones.muted;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 4, background: t.bg, border: "1px solid " + t.bd, color: t.c, fontSize: 10, fontFamily: "DM Mono,monospace", fontWeight: 700, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
};

export const Confirm = ({ message, onConfirm, onCancel }) => (
  <Modal title="Are you sure?" onClose={onCancel} width={420}>
    <div style={{ color: G.text, fontFamily: "DM Mono,monospace", fontSize: 13, lineHeight: 1.6, marginBottom: 18 }}>{message}</div>
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <Button onClick={onCancel} variant="ghost">Cancel</Button>
      <Button onClick={onConfirm} variant="danger">Delete</Button>
    </div>
  </Modal>
);
