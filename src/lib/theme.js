// Shared design tokens. Kept in sync with the inline `G` object in App.jsx so
// Config / Integration pages feel native. If you add a token here, mirror it
// in App.jsx (or migrate App.jsx to import from this file in a later pass).

export const G = {
  bg:"#060c14", surface:"#0b1521", surface2:"#0f1e2d",
  border:"#192d40", border2:"#1e3a52",
  text:"#e8f0f8", muted:"#8fa3b8", faint:"#4a6480",
  green:"#22c55e", greenBg:"#041f10", greenBd:"#0d3d1f",
  yellow:"#f59e0b", yellowBg:"#1e1400", yellowBd:"#3d2800",
  red:"#ef4444",   redBg:"#1e0505",   redBd:"#3d0a0a",
  blue:"#60a5fa",  blueBg:"#0d1e38",  blueBd:"#1a3a5f",
  purple:"#a78bfa",purpleBg:"#120d24",
  teal:"#2dd4bf",
};

export const PHASE_ORDER = ["Kickoff","Discovery","Implementation","Testing & QA","Go-Live Prep","Go-Live"];
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
