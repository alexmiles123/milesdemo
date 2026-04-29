// Shared design tokens. Surfaces, borders and text colors are now CSS
// variables so flipping `document.documentElement.dataset.theme` between
// "light" and "dark" re-paints the whole app without any JS state plumbing.
// Brand colors (red/green/blue/yellow/purple/teal) stay hex — they're the
// same on either background. Tinted *Bg/*Bd shades vary per theme so they
// stay readable on both, so they're vars too. *Soft variants are pre-mixed
// alpha tints used for hover/highlight states.

export const G = {
  bg:       "var(--bg)",
  surface:  "var(--surface)",
  surface2: "var(--surface2)",
  border:   "var(--border)",
  border2:  "var(--border2)",
  text:     "var(--text)",
  muted:    "var(--muted)",
  faint:    "var(--faint)",

  // Brand colors — same in both themes.
  green: "#16a34a", yellow: "#d97706", red: "#dc2626",
  blue:  "#2563eb", purple: "#7c3aed", teal: "#0d9488",

  // Tinted backgrounds / borders — theme-aware.
  greenBg:"var(--green-bg)",  greenBd:"var(--green-bd)",
  yellowBg:"var(--yellow-bg)", yellowBd:"var(--yellow-bd)",
  redBg:  "var(--red-bg)",    redBd:  "var(--red-bd)",
  blueBg: "var(--blue-bg)",   blueBd: "var(--blue-bd)",
  purpleBg:"var(--purple-bg)",

  // Soft alpha tints — used where the old code did `G.redBg + "44"` etc.
  redSoft:    "var(--red-soft)",
  yellowSoft: "var(--yellow-soft)",
  textSoft:   "var(--text-soft)",
};

// Light + dark token tables, emitted as a <style> tag from App so flipping
// data-theme on <html> re-themes everything synchronously.
export const THEME_CSS = `
:root, :root[data-theme="light"] {
  --bg:#f7f8fb; --surface:#ffffff; --surface2:#f5f7fa;
  --border:#e5e7eb; --border2:#d1d5db;
  --text:#111827; --muted:#6b7280; --faint:#9ca3af;
  --green-bg:#f0fdf4; --green-bd:#bbf7d0;
  --yellow-bg:#fffbeb; --yellow-bd:#fde68a;
  --red-bg:#fef2f2; --red-bd:#fecaca;
  --blue-bg:#eff6ff; --blue-bd:#bfdbfe;
  --purple-bg:#f5f3ff;
  --red-soft:rgba(220,38,38,0.10);
  --yellow-soft:rgba(217,119,6,0.10);
  --text-soft:rgba(17,24,39,0.20);
}
:root[data-theme="dark"] {
  --bg:#0b0f17; --surface:#111723; --surface2:#172033;
  --border:#243044; --border2:#334155;
  --text:#f3f4f6; --muted:#94a3b8; --faint:#64748b;
  --green-bg:#0a2818; --green-bd:#166534;
  --yellow-bg:#2a1c08; --yellow-bd:#854d0e;
  --red-bg:#2a0e0e; --red-bd:#7f1d1d;
  --blue-bg:#0e1c3a; --blue-bd:#1e40af;
  --purple-bg:#1e1635;
  --red-soft:rgba(248,113,113,0.18);
  --yellow-soft:rgba(251,191,36,0.18);
  --text-soft:rgba(243,244,246,0.25);
}
`;

export const PHASE_ORDER = ["Analysis","Design","Develop","Evaluate","Deploy"];
export const HEALTH_OPTIONS = [
  { value:"green",  label:"On Track" },
  { value:"yellow", label:"At Risk" },
  { value:"red",    label:"Critical" },
];
export const ROLE_OPTIONS = ["CSM","Senior CSM","Lead CSM","CSM Manager","Director"];
export const ASSIGNMENT_ROLES = ["primary","secondary","observer"];
export const PROVIDERS = [
  { id:"microsoft_teams", label:"Microsoft Teams", blurb:"Sync calls, meetings, and chat as customer interactions." },
  { id:"salesforce",      label:"Salesforce",      blurb:"Sync accounts, opportunities, and activity history." },
];

export const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"}) : "—";
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-US",{month:"short",day:"numeric",year:"2-digit",hour:"numeric",minute:"2-digit"}) : "—";

// Compact currency formatter that scales by magnitude. Avoids the "$2,000K"
// overflow problem on KPI cards — a $2M ARR rolls up to "$2.0M", not a string
// that gets truncated at the card boundary.
export const fmtArr = (n) => {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(1) + "B";
  if (abs >= 1_000_000)     return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000)         return "$" + Math.round(n / 1_000) + "K";
  return "$" + Math.round(n);
};
export const fmtFull = (n) => n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US");
// Always-in-millions formatter for KPI cards. $9,723,452 → "$9.723M". Keeps
// every ARR card the same width regardless of magnitude.
export const fmtMillions = (n) => n == null ? "—" : "$" + (n / 1_000_000).toFixed(3) + "M";
