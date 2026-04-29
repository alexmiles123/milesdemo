import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import ConfigPage from "./config/ConfigPage.jsx";
import AccountSearch from "./AccountSearch.jsx";
import AccountDetail from "./AccountDetail.jsx";
import ProjectPage from "./ProjectPage.jsx";
import { getSession, login as authLogin, logout as authLogout, clearToken, authedFetch, refreshSession, fetchMe } from "./lib/auth.js";

// ─── THEME ───────────────────────────────────────────────────────────────────
const G = {
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

const PHASE_ORDER = ["Kickoff","Discovery","Implementation","Testing & QA","Go-Live Prep","Go-Live"];
const PHASE_COLOR = {
  "Kickoff":"#6366f1","Discovery":"#8b5cf6","Implementation":"#3b82f6",
  "Testing & QA":"#06b6d4","Go-Live Prep":"#f59e0b","Go-Live":"#22c55e",
};
const HEALTH_COLOR = { green:G.green, yellow:G.yellow, red:G.red };
const STATUS_CFG = {
  complete:{ color:G.green, bg:G.greenBg, bd:G.greenBd, label:"Complete" },
  upcoming:{ color:G.yellow,bg:G.yellowBg,bd:G.yellowBd,label:"Upcoming" },
  late:    { color:G.red,   bg:G.redBg,   bd:G.redBd,   label:"Late"     },
};
const PRIORITY_COLOR = { critical:G.red, high:G.yellow, medium:G.blue, low:G.muted };
const CSM_COLORS = ["#6366f1","#3b82f6","#059669","#d97706","#dc2626","#8b5cf6"];

const fmtDate  = (d) => { if(!d) return "—"; return new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"}); };
const fmtArr   = (n) => {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(1) + "B";
  if (abs >= 1_000_000)     return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000)         return "$" + Math.round(n / 1_000) + "K";
  return "$" + Math.round(n);
};
const fmtFull  = (n) => n!=null ? "$"+Number(n).toLocaleString() : "—";
const fmtMill  = (n) => n!=null ? "$"+(Number(n)/1_000_000).toFixed(3)+"M" : "—";
const pct      = (a,b) => b ? Math.round((a/b)*100) : 0;

// ─── CAPACITY HELPERS ────────────────────────────────────────────────────────
const TASK_HOURS = { critical:8, high:6, medium:4, low:2 };
const getTaskHours = (t) => t.estimated_hours || TASK_HOURS[t.priority] || 3;
const getWeekStart = (dateStr) => {
  const d = new Date(dateStr+"T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
};
const getWeeks = (n=12) => {
  const weeks = [];
  const start = getWeekStart(new Date().toISOString().split("T")[0]);
  for(let i=0;i<n;i++){
    const d=new Date(start+"T00:00:00");
    d.setDate(d.getDate()+i*7);
    weeks.push(d.toISOString().split("T")[0]);
  }
  return weeks;
};
const fmtWeek = (ds) => new Date(ds+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"});
const utilColor = (p) => p>100?G.red:p>80?G.yellow:G.green;
const utilBg = (p) => p>100?G.redBg:p>80?G.yellowBg:G.greenBg;
const utilBd = (p) => p>100?G.redBd:p>80?G.yellowBd:G.greenBd;

// ─── REST API CLIENT ─────────────────────────────────────────────────────────
// All DB traffic goes through /api/db/<table>, which verifies the session JWT
// and forwards to Supabase with the service key. The browser never holds
// Supabase credentials — signing out wipes the only thing it has.
function makeApi() {
  const base = "/api/db";
  // Cookie-based session: every call goes through authedFetch which attaches
  // credentials and the X-CSRF-Token header. We try a single silent refresh
  // on 401 before bouncing the user back to the login screen — handles the
  // common case where the access cookie just expired but the refresh cookie
  // is still good.
  let refreshing = null;
  const handle = async (res, retry) => {
    if (res.status === 401 && retry) {
      refreshing = refreshing || refreshSession().finally(() => { refreshing = null; });
      const refreshed = await refreshing;
      if (refreshed) return retry();
      clearToken();
      if (typeof window !== "undefined") window.location.reload();
      throw new Error("Session expired. Please sign in again.");
    }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const head = e.message || e.error || e.hint || ("HTTP " + res.status);
      throw new Error(e.detail ? `${head} — ${e.detail}` : head);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : true;
  };
  const writeHeaders = { "Prefer": "return=representation" };
  const upsertHeaders = { "Prefer": "return=representation,resolution=merge-duplicates" };
  return {
    async get(table, params={}) {
      const qs = Object.entries(params).map(([k,v]) => k + "=" + encodeURIComponent(v)).join("&");
      const url = base + "/" + table + (qs ? "?" + qs : "");
      const exec = () => authedFetch(url);
      return handle(await exec(), exec);
    },
    async patch(table, id, body) {
      const url = base+"/"+table+"?id=eq."+id;
      const exec = () => authedFetch(url, { method:"PATCH", headers: writeHeaders, body: JSON.stringify(body) });
      await handle(await exec(), exec);
      return true;
    },
    async post(table, body) {
      const url = base+"/"+table;
      const exec = () => authedFetch(url, { method:"POST", headers: writeHeaders, body: JSON.stringify(body) });
      return handle(await exec(), exec);
    },
    async del(table, id) {
      const url = base+"/"+table+"?id=eq."+id;
      const exec = () => authedFetch(url, { method:"DELETE" });
      await handle(await exec(), exec);
      return true;
    },
    async upsert(table, body) {
      const url = base+"/"+table;
      const exec = () => authedFetch(url, { method:"POST", headers: upsertHeaders, body: JSON.stringify(body) });
      return handle(await exec(), exec);
    },
    async call(path, { method = "GET", body } = {}) {
      const init = { method };
      if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
      const exec = () => authedFetch(path, init);
      return handle(await exec(), exec);
    },
  };
}

// ─── GLOBAL STYLES ───────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;font-size:15px;}
  html,body,#root{width:100%;max-width:100% !important;overflow-x:hidden;}
  body{background:#060c14;}
  body{background:${G.bg};font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
  ::-webkit-scrollbar{width:4px;height:4px;}
  ::-webkit-scrollbar-track{background:#0a1520;}
  ::-webkit-scrollbar-thumb{background:#1e3346;border-radius:2px;}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes slideup{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
  .rh:hover{background:${G.surface2} !important;cursor:pointer;}
  select,input,textarea{outline:none;font-size:14px;}
  button{font-family:Syne,sans-serif;font-size:14px;}
  /* Prevent KPI/value overflow inside narrow card columns */
  .num-fit{font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
`;

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────
function Logo({size=32}) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <rect width="36" height="36" rx="8" fill="#08080f"/>
      <path d="M5 28 L12 10 L18 21 L24 10 L31 28 L26 28 L18 15 L10 28 Z" fill="url(#lg)"/>
      <path d="M10 28 L18 15 L26 28" fill="#7c3aed" opacity="0.35"/>
      <defs><linearGradient id="lg" x1="5" y1="10" x2="31" y2="28" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#7c3aed"/><stop offset="100%" stopColor="#a855f7"/>
      </linearGradient></defs>
    </svg>
  );
}

const Card = ({children, style={}}) => (
  <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:12,...style}}>{children}</div>
);
const CardHeader = ({children}) => (
  <div style={{padding:"12px 18px",borderBottom:"1px solid "+G.border,fontSize:15,fontWeight:700,color:G.muted,letterSpacing:"0.05em",fontFamily:"DM Mono,monospace"}}>
    {children}
  </div>
);

const Tip = ({active,payload,label}) => {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:"#0c1a28",border:"1px solid "+G.border2,borderRadius:8,padding:"8px 14px",fontFamily:"DM Mono,monospace",fontSize:12}}>
      {label && <div style={{color:G.muted,marginBottom:5}}>{label}</div>}
      {payload.map((p,i)=><div key={i} style={{color:p.color||G.text}}>{p.name}: <b>{p.value}</b></div>)}
    </div>
  );
};

const Badge = ({status}) => {
  const s = STATUS_CFG[status]||STATUS_CFG.upcoming;
  return (
    <span style={{background:s.bg,border:"1px solid "+s.bd,color:s.color,padding:"2px 8px",borderRadius:4,fontSize:14,fontFamily:"DM Mono,monospace",fontWeight:700,letterSpacing:"0.05em",whiteSpace:"nowrap"}}>
      {s.label.toUpperCase()}
    </span>
  );
};

// ─── NAV BAR ─────────────────────────────────────────────────────────────────
function NavBar({view,setView,csm,setCsm,csms,lastSync,onRefresh,refreshing,onLogout,api,onAccountSelect,role}) {
  // Non-admins only see the consultant portal — exec dashboards and the
  // configuration surface are admin-only. Server endpoints already 403 on
  // those paths, but hiding the tabs keeps the UI honest about what's
  // reachable rather than letting users click into empty/erroring screens.
  const isAdmin = role === "admin";
  const TABS = isAdmin
    ? [["exec","Executive View"],["consultant","Consultant Portal"],["config","Configuration"]]
    : [["consultant","Consultant Portal"]];
  return (
    <div style={{borderBottom:"1px solid "+G.border,padding:"0 24px",display:"flex",alignItems:"center",gap:14,height:54,background:"#08111c",flexShrink:0,zIndex:10}}>
      <div style={{display:"flex",alignItems:"center",gap:9}}>
        <Logo size={28}/>
        <div>
          <div style={{fontSize:16,fontWeight:800,letterSpacing:"0.04em",color:G.text,fontFamily:"Syne,sans-serif"}}>Monument</div>
          <div style={{fontSize:12,color:G.muted,fontFamily:"DM Mono,monospace",letterSpacing:"0.1em"}}>CUSTOMER SUCCESS</div>
        </div>
      </div>
      <div style={{width:1,height:26,background:G.border}}/>
      {/* View tabs */}
      <div style={{display:"flex",gap:2}}>
        {TABS.map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)}
            style={{background:view===v?"#0f2036":"none",border:"none",color:view===v?G.blue:G.muted,
              padding:"6px 14px",borderRadius:6,cursor:"pointer",fontSize:14,fontWeight:700,letterSpacing:"0.03em"}}>
            {l}
          </button>
        ))}
      </div>
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:12}}>
        {api && <AccountSearch api={api} onSelect={onAccountSelect}/>}
        {/* CSM selector for consultant view */}
        {view==="consultant" && (
          <select value={csm?.id||"all"} onChange={e=> setCsm(e.target.value==="all" ? null : csms.find(c=>c.id===e.target.value)||null)}
            style={{background:G.surface,border:"1px solid "+G.border2,color:G.text,padding:"5px 10px",borderRadius:6,fontFamily:"DM Mono,monospace",fontSize:11,cursor:"pointer"}}>
            <option value="all">All CSMs</option>
            {csms.map(c=><option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
          </select>
        )}
        <button onClick={onRefresh}
          style={{background:G.blueBg,border:"1px solid "+G.blueBd,color:G.blue,padding:"5px 12px",borderRadius:6,cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:11,display:"flex",alignItems:"center",gap:6}}>
          <span style={{display:"inline-block",animation:refreshing?"spin .8s linear infinite":"none"}}>⟳</span>
          Refresh
        </button>
        {lastSync && (
          <span style={{fontSize:14,fontFamily:"DM Mono,monospace",color:G.muted}}>
            <span style={{color:G.green,marginRight:5,animation:"pulse 2s infinite",display:"inline-block"}}>●</span>{lastSync}
          </span>
        )}
        {onLogout && <>
          <div style={{width:1,height:20,background:G.border}}/>
          <button onClick={onLogout}
            style={{background:"none",border:"1px solid "+G.border,color:G.muted,padding:"5px 12px",borderRadius:6,cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:11}}>
            Logout
          </button>
        </>}
      </div>
    </div>
  );
}


function AiPanel({ portfolio, tasks, csms }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const STARTERS = ['Which CSM has most ARR at risk?','Top 3 most overdue tasks?','Which customers need immediate attention?','Summarize portfolio health','Who is top performing CSM?'];
  const send = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');
    const newMessages = [...messages, { role:'user', content:msg }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const totalArr = portfolio.reduce((s,p)=>s+(p.arr||0),0);
      const sysP = 'You are an expert Customer Success operations analyst for Monument. Live data: ' + portfolio.length + ' customers, $' + (totalArr/1000).toFixed(0) + 'K ARR. On Track: ' + portfolio.filter(p=>p.health==='green').length + '. At Risk: ' + portfolio.filter(p=>p.health==='yellow').length + '. Critical: ' + portfolio.filter(p=>p.health==='red').length + '. Late tasks: ' + tasks.filter(t=>t.status==='late').length + '. Customers: ' + portfolio.map(p=>p.customer+': '+p.stage+', '+p.health_label+', '+p.completion_pct+'% done, $'+(p.arr/1000).toFixed(0)+'K ARR, CSM: '+p.csm+', '+(p.tasks_late||0)+' late tasks').join('; ') + '. CSMs: ' + csms.map(c=>c.csm+': '+c.total_accounts+' accounts, $'+((c.total_arr||0)/1000).toFixed(0)+'K ARR, '+c.late_tasks+' late tasks').join('; ') + '. Be concise and executive-level in responses.';
      const res = await authedFetch('/api/claude', { method:'POST', body:JSON.stringify({ system:sysP, messages:newMessages }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages(prev => [...prev, { role:'assistant', content:data.content }]);
    } catch(e) { setMessages(prev => [...prev, { role:'assistant', content:'Error: '+e.message }]); }
    setLoading(false);
  };
  return (
    <div style={{width:open?360:48,flexShrink:0,borderLeft:'1px solid #192d40',background:'#0b1521',display:'flex',flexDirection:'column',transition:'width .25s ease',overflow:'hidden',position:'relative'}}>
      <button onClick={()=>setOpen(o=>!o)} style={{position:'absolute',top:12,left:open?12:8,background:'linear-gradient(135deg,#7c3aed,#a855f7)',border:'none',borderRadius:8,width:28,height:28,cursor:'pointer',color:'#fff',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',zIndex:2}}>
        {open ? '→' : '✦'}
      </button>
      {open && <>
        <div style={{padding:'12px 14px 12px 48px',borderBottom:'1px solid #192d40',flexShrink:0}}>
          <div style={{fontSize:14,fontWeight:800,color:'#e8f0f8',fontFamily:'Syne,sans-serif'}}>AI Analyst</div>
          <div style={{fontSize:11,color:'#8fa3b8',fontFamily:'DM Mono,monospace',marginTop:2}}>Claude · Live portfolio data</div>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'12px 14px',display:'flex',flexDirection:'column',gap:10}}>
          {messages.length===0 && <div style={{display:'flex',flexDirection:'column',gap:6}}>
            <div style={{fontSize:12,color:'#8fa3b8',fontFamily:'DM Mono,monospace',marginBottom:6,textAlign:'center'}}>Ask me anything about your portfolio</div>
            {STARTERS.map((s,i)=>(
              <button key={i} onClick={()=>send(s)} style={{background:'#0f1e2d',border:'1px solid #1e3a52',color:'#8fa3b8',padding:'8px 10px',borderRadius:8,cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:11,textAlign:'left',lineHeight:1.4}}>{s}</button>
            ))}
          </div>}
          {messages.map((m,i)=>(
            <div key={i} style={{display:'flex',flexDirection:'column',alignItems:m.role==='user'?'flex-end':'flex-start'}}>
              <div style={{maxWidth:'90%',padding:'9px 12px',borderRadius:m.role==='user'?'12px 12px 2px 12px':'12px 12px 12px 2px',background:m.role==='user'?'linear-gradient(135deg,#7c3aed,#a855f7)':'#0f1e2d',border:m.role==='user'?'none':'1px solid #192d40',color:'#e8f0f8',fontSize:12,fontFamily:'DM Mono,monospace',lineHeight:1.6,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{m.content}</div>
            </div>
          ))}
          {loading && <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 0'}}><div style={{width:7,height:7,borderRadius:'50%',background:'#7c3aed',animation:'pulse 1s infinite'}}/><span style={{fontSize:11,color:'#8fa3b8',fontFamily:'DM Mono,monospace'}}>Analyzing...</span></div>}
        </div>
        {messages.length>0 && <div style={{padding:'4px 14px',flexShrink:0}}><button onClick={()=>setMessages([])} style={{background:'none',border:'none',color:'#8fa3b8',cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10,textDecoration:'underline'}}>Clear</button></div>}
        <div style={{padding:'10px 14px',borderTop:'1px solid #192d40',flexShrink:0,display:'flex',gap:8}}>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}} placeholder='Ask about your portfolio...' style={{flex:1,background:'#080e18',border:'1px solid #1e3a52',color:'#e8f0f8',padding:'8px 12px',borderRadius:8,fontFamily:'DM Mono,monospace',fontSize:12}}/>
          <button onClick={()=>send()} disabled={!input.trim()||loading} style={{background:'linear-gradient(135deg,#7c3aed,#a855f7)',border:'none',borderRadius:8,width:36,height:36,cursor:'pointer',color:'#fff',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,opacity:(!input.trim()||loading)?0.5:1}}>↑</button>
        </div>
      </>}
    </div>
  );
}

// ─── CSM DRILLDOWN MODAL (from Exec Capacity Grid) ──────────────────────────
function CsmDrilldownModal({api,csm,weeks,onClose,onSaved}) {
  const [projects,setProjects]=useState([]);
  const [commitments,setCommitments]=useState([]);
  const [capEntries,setCapEntries]=useState([]);
  const [tasks,setTasks]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [pendingChanges,setPendingChanges]=useState({}); // {"projectId::ws": hours}
  const [expandedProjects,setExpandedProjects]=useState(new Set());

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const [pr,cm,ce]=await Promise.all([
        api.get("projects",{csm_id:"eq."+csm.id,select:"id,name"}),
        api.get("project_commitments",{csm_id:"eq."+csm.id,select:"*"}).catch(()=>[]),
        api.get("capacity_entries",{csm_id:"eq."+csm.id,select:"*"}).catch(()=>[]),
      ]);
      setProjects(pr||[]);setCommitments(cm||[]);setCapEntries(ce||[]);
      const pIds=(pr||[]).map(p=>p.id);
      if(pIds.length){
        const tk=await api.get("tasks",{status:"neq.complete",select:"id,project_id,name,phase,proj_date,priority,estimated_hours"}).catch(()=>[]);
        setTasks((tk||[]).filter(t=>pIds.includes(t.project_id)));
      }else{setTasks([]);}
    }catch(e){console.error(e);}
    setLoading(false);
  },[api,csm]);

  useEffect(()=>{load();},[load]);

  // Get the display value for a cell (pending change takes priority over DB value)
  const getCellHours=(projectId,ws)=>{
    const key=projectId+"::"+ws;
    if(key in pendingChanges) return pendingChanges[key];
    const entry=commitments.find(c=>c.project_id===projectId&&c.week_start_date===ws&&c.commitment_type==="Project Work");
    return entry?.estimated_hours||0;
  };

  const setPendingHours=(projectId,ws,val)=>{
    const h=parseFloat(val)||0;
    const key=projectId+"::"+ws;
    const entry=commitments.find(c=>c.project_id===projectId&&c.week_start_date===ws&&c.commitment_type==="Project Work");
    const dbVal=entry?.estimated_hours||0;
    // Only track if different from DB value
    if(h===dbVal){
      setPendingChanges(prev=>{const next={...prev};delete next[key];return next;});
    }else{
      setPendingChanges(prev=>({...prev,[key]:h}));
    }
  };

  const hasPendingChanges=Object.keys(pendingChanges).length>0;

  const saveAll=async()=>{
    if(!hasPendingChanges){onClose();return;}
    setSaving(true);
    try{
      for(const [key,hours] of Object.entries(pendingChanges)){
        const [projectId,ws]=key.split("::");
        const existing=commitments.find(c=>c.project_id===projectId&&c.week_start_date===ws&&c.commitment_type==="Project Work");
        if(!hours||hours<=0){
          if(existing) await api.del("project_commitments",existing.id);
        }else if(existing){
          await api.patch("project_commitments",existing.id,{estimated_hours:hours});
        }else{
          await api.post("project_commitments",[{csm_id:csm.id,project_id:projectId,week_start_date:ws,estimated_hours:hours,commitment_type:"Project Work",notes:null}]);
        }
      }
      onSaved();
    }catch(e){alert("Save failed: "+e.message);}
    setSaving(false);
    onClose();
  };

  const toggleExpand=(projectId)=>{
    setExpandedProjects(prev=>{
      const next=new Set(prev);
      if(next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  };

  // Compute KPIs using pending values where available
  const weekStats=weeks.map(ws=>{
    const capEntry=capEntries.find(e=>e.week_start_date===ws);
    const available=capEntry?.estimated_hours||40;
    const we=new Date(ws+"T00:00:00");we.setDate(we.getDate()+6);const weStr=we.toISOString().split("T")[0];
    const weekTasks=tasks.filter(t=>t.proj_date>=ws&&t.proj_date<=weStr);
    const weekCommits=commitments.filter(c=>c.week_start_date===ws);
    const otherCommits=weekCommits.filter(c=>c.commitment_type!=="Project Work");
    // Use pending values for project hours
    const manualProjHours=projects.reduce((s,proj)=>s+getCellHours(proj.id,ws),0);
    const projsWithHours=new Set(projects.filter(proj=>getCellHours(proj.id,ws)>0).map(p=>p.id));
    const autoTaskHours=weekTasks.filter(t=>!projsWithHours.has(t.project_id)).reduce((s,t)=>s+getTaskHours(t),0);
    const otherCommitHours=otherCommits.reduce((s,c)=>s+(c.estimated_hours||0),0);
    const committed=autoTaskHours+manualProjHours+otherCommitHours;
    const utilization=available>0?(committed/available)*100:0;
    return {available,committed,utilization};
  });
  const avgUtil=weekStats.length?Math.round(weekStats.reduce((s,w)=>s+w.utilization,0)/weekStats.length):0;
  const totalCommitted=weekStats.reduce((s,w)=>s+w.committed,0);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:16,width:"100%",maxWidth:960,maxHeight:"85vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* Header */}
        <div style={{padding:"16px 22px",borderBottom:"1px solid "+G.border,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontSize:17,fontWeight:800,color:G.text,fontFamily:"Syne,sans-serif"}}>{csm.name} — Project Hours</div>
            <div style={{fontSize:12,color:G.muted,fontFamily:"DM Mono,monospace",marginTop:2}}>{projects.length} project{projects.length!==1?"s":""} · 12-week view</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{background:utilBg(avgUtil),border:"1px solid "+utilBd(avgUtil),borderRadius:8,padding:"6px 14px",textAlign:"center"}}>
              <div style={{fontSize:22,fontWeight:800,color:utilColor(avgUtil),fontFamily:"Syne,sans-serif"}}>{avgUtil}%</div>
              <div style={{fontSize:10,color:utilColor(avgUtil),fontFamily:"DM Mono,monospace",opacity:0.8}}>AVG UTIL</div>
            </div>
            <div style={{background:G.surface2,border:"1px solid "+G.border,borderRadius:8,padding:"6px 14px",textAlign:"center"}}>
              <div style={{fontSize:22,fontWeight:800,color:G.teal,fontFamily:"Syne,sans-serif"}}>{totalCommitted}h</div>
              <div style={{fontSize:10,color:G.muted,fontFamily:"DM Mono,monospace",opacity:0.8}}>COMMITTED</div>
            </div>
            <button onClick={saveAll} style={{background:"none",border:"1px solid "+G.border,color:G.muted,width:30,height:30,borderRadius:8,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>
        </div>

        {/* Content */}
        <div style={{overflowX:"auto",overflowY:"auto",flex:1,padding:"0"}}>
          {loading?(
            <div style={{padding:40,textAlign:"center",color:G.muted,fontFamily:"DM Mono,monospace",fontSize:13}}>Loading projects…</div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
              <thead>
                <tr style={{borderBottom:"1px solid "+G.border}}>
                  <th style={{padding:"8px 12px",textAlign:"left",fontSize:10,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:600,minWidth:170,position:"sticky",left:0,background:G.surface,zIndex:1}}>PROJECT</th>
                  {weeks.map((ws,i)=>(
                    <th key={i} style={{padding:"8px 4px",textAlign:"center",fontSize:10,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:500,minWidth:70}}>{fmtWeek(ws)}</th>
                  ))}
                  <th style={{padding:"8px 8px",textAlign:"center",fontSize:10,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:600,minWidth:60}}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((proj)=>{
                  const projTotal=weeks.reduce((sum,ws)=>sum+getCellHours(proj.id,ws),0);
                  const isExpanded=expandedProjects.has(proj.id);
                  const projTasks=tasks.filter(t=>t.project_id===proj.id);
                  const phaseGroups={};
                  projTasks.forEach(t=>{const ph=t.phase||"Unassigned";if(!phaseGroups[ph])phaseGroups[ph]=[];phaseGroups[ph].push(t);});
                  return [
                    <tr key={proj.id} style={{borderBottom:"1px solid "+G.faint}}>
                      <td style={{padding:"8px 12px",fontSize:13,fontWeight:700,color:G.text,whiteSpace:"nowrap",position:"sticky",left:0,background:G.surface,zIndex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span onClick={()=>toggleExpand(proj.id)}
                            style={{cursor:"pointer",fontSize:10,color:G.muted,width:16,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,userSelect:"none"}}>{isExpanded?"▼":"▶"}</span>
                          {proj.name}
                        </div>
                      </td>
                      {weeks.map((ws,wi)=>{
                        const hrs=getCellHours(proj.id,ws);
                        const key=proj.id+"::"+ws;
                        const isPending=key in pendingChanges;
                        return (
                          <td key={wi} style={{padding:"3px 2px",textAlign:"center"}}>
                            <input type="number" value={hrs||""} min="0" max="60" step="0.5" placeholder="·"
                              onChange={e=>setPendingHours(proj.id,ws,e.target.value)}
                              style={{width:48,background:isPending?G.bg:G.surface2,border:"1px solid "+(isPending?G.teal:G.border),color:hrs>0?(isPending?G.teal:G.text):G.faint,padding:"4px 2px",borderRadius:4,fontFamily:"DM Mono,monospace",fontSize:11,textAlign:"center",fontWeight:hrs>0?700:400}}/>
                          </td>
                        );
                      })}
                      <td style={{padding:"4px 8px",textAlign:"center",fontSize:12,fontFamily:"DM Mono,monospace",color:projTotal>0?G.teal:G.faint,fontWeight:700}}>
                        {projTotal>0?projTotal+"h":"—"}
                      </td>
                    </tr>,
                    // Expanded task rows
                    ...(isExpanded?Object.entries(phaseGroups).map(([phase,phaseTasks])=>
                      phaseTasks.map((t)=>(
                        <tr key={"task-"+t.id} style={{background:"#080e18"}}>
                          <td style={{padding:"4px 12px 4px 42px",fontSize:11,color:G.muted,fontFamily:"DM Mono,monospace",position:"sticky",left:0,background:"#080e18",zIndex:1,whiteSpace:"nowrap"}}>
                            <span style={{color:PHASE_COLOR[phase]||G.faint,marginRight:6,fontSize:9,fontWeight:700}}>{phase}</span>
                            <span style={{color:G.muted}}>{t.name}</span>
                            <span style={{color:PRIORITY_COLOR[t.priority]||G.faint,marginLeft:6,fontSize:9,fontWeight:700}}>{(t.priority||"").toUpperCase()}</span>
                          </td>
                          {weeks.map((_,wi)=><td key={wi} style={{padding:"2px",textAlign:"center"}}/>)}
                          <td style={{padding:"4px 8px",textAlign:"center",fontSize:10,fontFamily:"DM Mono,monospace",color:G.faint}}>{getTaskHours(t)}h</td>
                        </tr>
                      ))
                    ).flat():[])
                  ];
                }).flat()}
                {/* Total Row */}
                <tr style={{borderTop:"2px solid "+G.border,background:"#080e18"}}>
                  <td style={{padding:"8px 12px",fontSize:11,fontWeight:800,color:G.text,fontFamily:"DM Mono,monospace",position:"sticky",left:0,background:"#080e18",zIndex:1}}>TOTAL</td>
                  {weeks.map((ws,wi)=>{
                    const weekTotal=projects.reduce((sum,proj)=>sum+getCellHours(proj.id,ws),0);
                    return <td key={wi} style={{padding:"4px 3px",textAlign:"center",fontSize:12,fontFamily:"DM Mono,monospace",color:weekTotal>0?G.teal:G.faint,fontWeight:800}}>{weekTotal>0?weekTotal+"h":"—"}</td>;
                  })}
                  <td style={{padding:"4px 8px",textAlign:"center",fontSize:13,fontFamily:"DM Mono,monospace",color:G.teal,fontWeight:800}}>
                    {(()=>{const gt=projects.reduce((grand,proj)=>grand+weeks.reduce((sum,ws)=>sum+getCellHours(proj.id,ws),0),0);return gt?gt+"h":"—";})()}
                  </td>
                </tr>
                {projects.length===0&&<tr><td colSpan={weeks.length+2} style={{padding:20,textAlign:"center",color:G.muted,fontFamily:"DM Mono,monospace",fontSize:12}}>No projects assigned</td></tr>}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{padding:"10px 22px",borderTop:"1px solid "+G.border,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <span style={{fontSize:11,color:"#5a7a94",fontFamily:"DM Mono,monospace"}}>
            {hasPendingChanges?Object.keys(pendingChanges).length+" unsaved change"+(Object.keys(pendingChanges).length>1?"s":""):"Click any cell to enter hours · expand rows to see tasks"}
          </span>
          <button onClick={saveAll} disabled={saving}
            style={{background:hasPendingChanges?"linear-gradient(135deg,#7c3aed,#a855f7)":G.surface2,border:hasPendingChanges?"none":"1px solid "+G.border,color:hasPendingChanges?"#fff":G.muted,padding:"8px 20px",borderRadius:8,cursor:"pointer",fontFamily:"Syne,sans-serif",fontSize:12,fontWeight:700,opacity:saving?0.6:1}}>
            {saving?"Saving…":hasPendingChanges?"Save & Close":"Close"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EXECUTIVE CAPACITY DASHBOARD ────────────────────────────────────────────
function ExecCapacityDashboard({api}) {
  const [csmList,setCsmList]=useState([]);
  const [capEntries,setCapEntries]=useState([]);
  const [commitments,setCommitments]=useState([]);
  const [projects,setProjects]=useState([]);
  const [tasks,setTasks]=useState([]);
  const [loading,setLoading]=useState(true);
  const [drilldownCsm,setDrilldownCsm]=useState(null);
  const [error,setError]=useState(null);

  const weeks = getWeeks(12);

  const load=useCallback(async()=>{
    setLoading(true);setError(null);
    try{
      const [cs,ce,cm,pr,tk]=await Promise.all([
        api.get("csms",{is_active:"eq.true",select:"*"}),
        api.get("capacity_entries",{select:"*"}).catch(()=>[]),
        api.get("project_commitments",{select:"*"}).catch(()=>[]),
        api.get("projects",{select:"id,name,csm_id"}),
        api.get("tasks",{status:"neq.complete",select:"id,project_id,name,phase,proj_date,priority,estimated_hours"}),
      ]);
      setCsmList(cs||[]);setCapEntries(ce||[]);setCommitments(cm||[]);setProjects(pr||[]);setTasks(tk||[]);
    }catch(e){setError(e.message);}
    setLoading(false);
  },[api]);

  useEffect(()=>{load();},[load]);

  if(loading) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:G.muted,fontFamily:"DM Mono,monospace",fontSize:13}}>Loading capacity data…</div>;
  if(error) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:G.red,fontFamily:"DM Mono,monospace",fontSize:13}}>Error: {error}. Run migration.sql first.</div>;

  // Build project → CSM lookup
  const projCsm={};
  projects.forEach(p=>{projCsm[p.id]=p.csm_id;});
  const projName={};
  projects.forEach(p=>{projName[p.id]=p.name;});

  // Compute capacity grid data (project hours override auto-task hours per project)
  const gridData = csmList.map(csm=>{
    const csmProjects=projects.filter(p=>p.csm_id===csm.id).map(p=>p.id);
    const weekData=weeks.map(ws=>{
      const we=new Date(ws+"T00:00:00");we.setDate(we.getDate()+6);
      const weStr=we.toISOString().split("T")[0];
      const capEntry=capEntries.find(e=>e.csm_id===csm.id&&e.week_start_date===ws);
      const available=capEntry?.estimated_hours||40;
      const weekTasks=tasks.filter(t=>csmProjects.includes(t.project_id)&&t.proj_date>=ws&&t.proj_date<=weStr);
      const weekCommits=commitments.filter(c=>c.csm_id===csm.id&&c.week_start_date===ws);
      const projWorkCommits=weekCommits.filter(c=>c.commitment_type==="Project Work");
      const otherCommits=weekCommits.filter(c=>c.commitment_type!=="Project Work");
      const projsWithManual=new Set(projWorkCommits.map(c=>c.project_id));
      const autoTaskHours=weekTasks.filter(t=>!projsWithManual.has(t.project_id)).reduce((s,t)=>s+getTaskHours(t),0);
      const manualProjHours=projWorkCommits.reduce((s,c)=>s+(c.estimated_hours||0),0);
      const otherCommitHours=otherCommits.reduce((s,c)=>s+(c.estimated_hours||0),0);
      const taskHours=autoTaskHours+manualProjHours;
      const commitHours=otherCommitHours;
      const committed=taskHours+commitHours;
      const utilization=available>0?(committed/available)*100:0;
      return {ws,available,taskHours,commitHours,committed,utilization,
        taskList:weekTasks.filter(t=>!projsWithManual.has(t.project_id)).map(t=>({...t,customer:projName[t.project_id]||"—",hours:getTaskHours(t)})).concat(projWorkCommits.map(c=>({name:c.commitment_type,customer:projName[c.project_id]||"—",phase:"Manual",priority:"medium",hours:c.estimated_hours}))),
        commitList:otherCommits};
    });
    return {csm,weekData};
  });

  // Summary row
  const summaryWeeks=weeks.map((_,wi)=>{
    const totalAvail=gridData.reduce((s,r)=>s+r.weekData[wi].available,0);
    const totalCommit=gridData.reduce((s,r)=>s+r.weekData[wi].committed,0);
    return {available:totalAvail,committed:totalCommit,utilization:totalAvail>0?(totalCommit/totalAvail)*100:0};
  });

  // Forecast chart data
  const chartData=weeks.map((ws,i)=>({
    name:fmtWeek(ws),
    Available:summaryWeeks[i].available,
    Committed:summaryWeeks[i].committed,
  }));

  // KPIs
  const totalCsms=csmList.length;
  const overloaded=gridData.filter(r=>r.weekData.some(w=>w.utilization>100)).length;
  const avgUtil=summaryWeeks.length?Math.round(summaryWeeks.reduce((s,w)=>s+w.utilization,0)/summaryWeeks.length):0;
  const peakWeek=summaryWeeks.reduce((max,w,i)=>w.utilization>max.u?{u:w.utilization,i}:max,{u:0,i:0});

  const handleCellClick=(csm)=>{
    setDrilldownCsm(csm);
  };

  return (
    <div style={{flex:1,overflowY:"auto",padding:"18px 24px",animation:"fadein .3s ease"}}>
      {/* KPI Strip */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
        {[
          {label:"Team Members",value:totalCsms,color:G.purple,sub:"active CSMs"},
          {label:"Avg Utilization",value:avgUtil+"%",color:avgUtil>80?G.yellow:G.green,sub:"across 12 weeks"},
          {label:"Overloaded CSMs",value:overloaded,color:overloaded>0?G.red:G.green,sub:"with >100% weeks"},
          {label:"Peak Week",value:Math.round(peakWeek.u)+"%",color:utilColor(peakWeek.u),sub:fmtWeek(weeks[peakWeek.i]||weeks[0])},
        ].map((k,i)=>(
          <div key={i} style={{background:G.surface,border:"1px solid "+G.border,borderRadius:10,padding:"12px 14px",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:k.color,borderRadius:"10px 10px 0 0"}}/>
            <div style={{fontSize:26,fontWeight:800,color:k.color,lineHeight:1,marginTop:4,fontFamily:"Syne,sans-serif"}}>{k.value}</div>
            <div style={{fontSize:13,color:G.muted,marginTop:5,fontFamily:"DM Mono,monospace",letterSpacing:"0.05em"}}>{k.label}</div>
            <div style={{fontSize:9,color:"#5a7a94",marginTop:2,fontFamily:"DM Mono,monospace"}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Forecast Chart */}
      <Card style={{marginBottom:12}}>
        <CardHeader>3-MONTH CAPACITY FORECAST — TEAM TOTAL</CardHeader>
        <div style={{padding:"14px 16px"}}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={G.border}/>
              <XAxis dataKey="name" tick={{fill:G.muted,fontSize:10,fontFamily:"DM Mono"}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:G.muted,fontSize:10,fontFamily:"DM Mono"}} axisLine={false} tickLine={false} label={{value:"Hours",angle:-90,position:"insideLeft",fill:G.muted,fontSize:10}}/>
              <Tooltip content={<Tip/>}/>
              <Legend wrapperStyle={{fontSize:11,fontFamily:"DM Mono,monospace"}}/>
              <Area type="monotone" dataKey="Available" stroke={G.green} fill={G.green} fillOpacity={0.15} strokeWidth={2}/>
              <Area type="monotone" dataKey="Committed" stroke={G.purple} fill={G.purple} fillOpacity={0.25} strokeWidth={2}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* 12-Week Capacity Grid */}
      <Card style={{marginBottom:12}}>
        <CardHeader>CAPACITY GRID — 12 WEEK VIEW</CardHeader>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
            <thead>
              <tr style={{borderBottom:"1px solid "+G.border}}>
                <th style={{padding:"8px 12px",textAlign:"left",fontSize:11,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:600,position:"sticky",left:0,background:G.surface,zIndex:1,minWidth:120}}>CSM</th>
                {weeks.map((ws,i)=>(
                  <th key={i} style={{padding:"8px 6px",textAlign:"center",fontSize:10,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:500,minWidth:72}}>
                    {fmtWeek(ws)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Summary Row */}
              <tr style={{borderBottom:"2px solid "+G.border,background:"#080e18"}}>
                <td style={{padding:"8px 12px",fontSize:12,fontWeight:800,color:G.text,fontFamily:"DM Mono,monospace",position:"sticky",left:0,background:"#080e18",zIndex:1}}>TEAM TOTAL</td>
                {summaryWeeks.map((sw,i)=>(
                  <td key={i} style={{padding:"6px 4px",textAlign:"center"}}>
                    <div style={{background:utilBg(sw.utilization),border:"1px solid "+utilBd(sw.utilization),borderRadius:6,padding:"4px 2px"}}>
                      <div style={{fontSize:11,fontWeight:800,color:utilColor(sw.utilization),fontFamily:"DM Mono,monospace"}}>{Math.round(sw.committed)}/{sw.available}</div>
                      <div style={{fontSize:9,color:utilColor(sw.utilization),opacity:0.7}}>{Math.round(sw.utilization)}%</div>
                    </div>
                  </td>
                ))}
              </tr>
              {/* CSM Rows */}
              {gridData.map((row,ri)=>(
                <tr key={row.csm.id} style={{borderBottom:ri<gridData.length-1?"1px solid "+G.faint:"none"}}>
                  <td style={{padding:"8px 12px",position:"sticky",left:0,background:G.surface,zIndex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <div style={{width:22,height:22,borderRadius:"50%",background:CSM_COLORS[ri%CSM_COLORS.length],display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff",flexShrink:0}}>{row.csm.name[0]}</div>
                      <span onClick={()=>setDrilldownCsm(row.csm)}
                        style={{fontSize:13,fontWeight:600,color:G.text,whiteSpace:"nowrap",cursor:"pointer",borderBottom:"1px dashed "+G.faint,transition:"color .15s"}}
                        onMouseEnter={e=>e.currentTarget.style.color=G.teal}
                        onMouseLeave={e=>e.currentTarget.style.color=G.text}>{row.csm.name.split(" ")[0]}</span>
                    </div>
                  </td>
                  {row.weekData.map((wd,wi)=>(
                    <td key={wi} style={{padding:"4px 3px",textAlign:"center"}}>
                      <div onClick={()=>handleCellClick(row.csm)}
                        style={{background:utilBg(wd.utilization),border:"1px solid "+utilBd(wd.utilization),borderRadius:6,padding:"5px 2px",cursor:"pointer",transition:"transform .1s"}}
                        onMouseEnter={e=>e.currentTarget.style.transform="scale(1.05)"}
                        onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
                        <div style={{fontSize:11,fontWeight:700,color:utilColor(wd.utilization),fontFamily:"DM Mono,monospace"}}>{Math.round(wd.committed)}/{wd.available}</div>
                        <div style={{fontSize:9,color:utilColor(wd.utilization),opacity:0.7}}>{Math.round(wd.utilization)}%</div>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Legend */}
      <div style={{display:"flex",gap:16,justifyContent:"center",padding:"8px 0",fontSize:11,fontFamily:"DM Mono,monospace"}}>
        <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:3,background:G.green}}/>Under 80%</span>
        <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:3,background:G.yellow}}/>80–100%</span>
        <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:3,background:G.red}}/>Over 100%</span>
        <span style={{color:G.muted}}>Click any cell to drill down</span>
      </div>

      {drilldownCsm&&<CsmDrilldownModal api={api} csm={drilldownCsm} weeks={weeks} onClose={()=>setDrilldownCsm(null)} onSaved={load}/>}
    </div>
  );
}

// ─── EXECUTIVE DASHBOARD ─────────────────────────────────────────────────────
// Exec dashboard widgets are toggleable. Hidden IDs persist to localStorage so
// each user keeps their preferred layout across reloads.
const EXEC_WIDGETS = [
  { id:"kpi-strip",        label:"KPI Strip (7 cards)" },
  { id:"stage-pipeline",   label:"Implementation Pipeline by Stage" },
  { id:"portfolio-health", label:"Portfolio Health" },
  { id:"task-status",      label:"Task Status Across Portfolio" },
  { id:"arr-distribution", label:"ARR Distribution" },
  { id:"csm-scorecard",    label:"CSM Performance Scorecard" },
  { id:"csm-book",         label:"CSM Book Breakdown" },
  { id:"late-tasks",       label:"Late Tasks (Exec Attention)" },
  { id:"upcoming-go-lives",label:"Upcoming Go-Lives" },
  { id:"critical-accounts",label:"Critical Accounts (Immediate Attention)" },
  { id:"full-portfolio",   label:"Full Portfolio Table" },
];
const LS_HIDDEN = "monument.execDashboard.hiddenWidgets";
function loadHiddenWidgets() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_HIDDEN) || "[]")); }
  catch { return new Set(); }
}

function ExecDashboard({api}) {
  const [portfolio, setPortfolio] = useState([]);
  const [tasks,     setTasks]     = useState([]);
  const [csms,      setCsms]      = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [execTab,   setExecTab]   = useState("dashboard");
  const [hiddenWidgets, setHiddenWidgets] = useState(loadHiddenWidgets);
  const [showCustomize, setShowCustomize] = useState(false);
  const shown = (id) => !hiddenWidgets.has(id);
  const toggleWidget = (id) => setHiddenWidgets(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { localStorage.setItem(LS_HIDDEN, JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });
  const resetWidgets = () => {
    try { localStorage.removeItem(LS_HIDDEN); } catch { /* ignore */ }
    setHiddenWidgets(new Set());
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [port, tsk, csmData, custData] = await Promise.all([
        api.get("vw_portfolio", {"select":"*"}),
        api.get("tasks", {"select":"*", "order":"proj_date.asc"}),
        api.get("vw_csm_scorecard", {"select":"*"}),
        api.get("customers", {"select":"id,name,is_active"}),
      ]);
      setPortfolio(port||[]);
      setTasks(tsk||[]);
      setCsms(csmData||[]);
      setCustomers(custData||[]);
    } catch(e){ console.error("ExecDashboard load error:", e.message); }
    setLoading(false);
  },[api]);

  useEffect(()=>{ load(); },[load]);

  if(loading) return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:G.muted,fontFamily:"DM Mono,monospace",fontSize:13}}>
      Loading executive data…
    </div>
  );

  // ── Aggregate KPIs ──
  // Filter out projects whose customer was disabled in Configuration. The
  // view doesn't apply this filter at the DB layer (intentional — keeps
  // history queryable), so we apply it client-side here so disabling a
  // customer is reflected immediately in the strip and charts below.
  const inactiveCustIds = new Set(customers.filter(c=>c.is_active===false).map(c=>c.id));
  const visiblePortfolio = portfolio.filter(p => !p.customer_id || !inactiveCustIds.has(p.customer_id));
  const activeCustomers  = customers.filter(c => c.is_active !== false);
  const totalCustomers   = activeCustomers.length || new Set(visiblePortfolio.map(p=>p.customer_id||p.customer)).size;
  const totalArr     = visiblePortfolio.reduce((s,p)=>s+(p.arr||0),0);
  const onTrack      = visiblePortfolio.filter(p=>p.health==="green").length;
  const atRisk       = visiblePortfolio.filter(p=>p.health==="yellow").length;
  const critical     = visiblePortfolio.filter(p=>p.health==="red").length;
  const avgCompl     = visiblePortfolio.length ? Math.round(visiblePortfolio.reduce((s,p)=>s+(p.completion_pct||0),0)/visiblePortfolio.length) : 0;
  const visibleProjectIds = new Set(visiblePortfolio.map(p=>p.id));
  const visibleTasks = tasks.filter(t => visibleProjectIds.has(t.project_id));
  const totalLate    = visibleTasks.filter(t=>t.status==="late").length;
  const totalComplete= visibleTasks.filter(t=>t.status==="complete").length;
  const totalUpcoming= visibleTasks.filter(t=>t.status==="upcoming").length;
  const criticalLate = visibleTasks.filter(t=>t.status==="late"&&t.priority==="critical").length;
  // "Go-Live This Month" — filter by target_date falling in the current
  // calendar month, regardless of stage. The previous version filtered by
  // stage ("Go-Live Prep"/"Go-Live"), which silently hid any project whose
  // owner hadn't manually advanced the dropdown — even if the date was
  // two days away.
  const _now = new Date();
  const _monthStart = new Date(_now.getFullYear(), _now.getMonth(), 1);
  const _monthEnd   = new Date(_now.getFullYear(), _now.getMonth()+1, 0, 23,59,59,999);
  const goLivesSoon  = visiblePortfolio.filter(p=>{
    if (!p.target_date) return false;
    const td = new Date(p.target_date);
    return td >= _monthStart && td <= _monthEnd;
  });

  // ── Chart data ──
  const healthData = [
    {name:"On Track",value:onTrack,color:G.green},
    {name:"At Risk", value:atRisk, color:G.yellow},
    {name:"Critical",value:critical,color:G.red},
  ];

  const stageData = PHASE_ORDER.map(ph=>({
    name:ph.length>12?ph.split(" ")[0]:ph,
    fullName:ph,
    count:visiblePortfolio.filter(p=>p.stage===ph).length,
    arr:Math.round(visiblePortfolio.filter(p=>p.stage===ph).reduce((s,p)=>s+(p.arr||0),0)/1000),
    fill:PHASE_COLOR[ph],
  })).filter(d=>d.count>0);

  const csmArrData = csms.map((c,i)=>({
    name:c.csm.split(" ")[0],
    arr:Math.round((c.total_arr||0)/1000),
    accounts:c.total_accounts||0,
    late:c.late_tasks||0,
    fill:CSM_COLORS[i%CSM_COLORS.length],
  }));

  const arrBuckets = [
    {range:"$20-40K",value:visiblePortfolio.filter(p=>p.arr<40000).length,color:"#6366f1"},
    {range:"$40-60K",value:visiblePortfolio.filter(p=>p.arr>=40000&&p.arr<60000).length,color:"#3b82f6"},
    {range:"$60-80K",value:visiblePortfolio.filter(p=>p.arr>=60000&&p.arr<80000).length,color:"#06b6d4"},
    {range:"$80-100K",value:visiblePortfolio.filter(p=>p.arr>=80000).length,color:"#22c55e"},
  ];

  const taskStatusData = [
    {name:"Complete",value:totalComplete,color:G.green},
    {name:"Upcoming",value:totalUpcoming,color:G.yellow},
    {name:"Late",value:totalLate,color:G.red},
  ];

  // Late tasks grouped by project (skip ones whose customer was disabled)
  const lateTasks = visibleTasks.filter(t=>t.status==="late")
    .map(t=>({...t,project:visiblePortfolio.find(p=>p.id===t.project_id)}))
    .filter(t=>t.project)
    .sort((a,b)=>new Date(a.proj_date)-new Date(b.proj_date))
    .slice(0,12);

  // Upcoming go-lives — anything with a target_date in the next 60 days,
  // regardless of stage. Stage-only filtering used to hide projects that
  // were two days from launch but still tagged "Implementation" because
  // a CSM hadn't bumped the dropdown.
  const _horizon = new Date(_now.getTime() + 60*24*60*60*1000);
  const upcomingGoLives = visiblePortfolio
    .filter(p=>{
      if (!p.target_date) return false;
      const td = new Date(p.target_date);
      return td >= _now && td <= _horizon;
    })
    .sort((a,b)=>new Date(a.target_date)-new Date(b.target_date));

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Sub-tab bar */}
      <div style={{display:"flex",gap:2,padding:"0 24px",borderBottom:"1px solid "+G.border,background:"#0a1420",flexShrink:0,alignItems:"center",position:"relative"}}>
        {[["dashboard","Dashboard"],["capacity","Capacity"]].map(([k,l])=>(
          <button key={k} onClick={()=>setExecTab(k)}
            style={{background:execTab===k?"#0f2036":"none",border:"1px solid "+(execTab===k?G.blue+"44":"transparent"),borderBottom:execTab===k?"2px solid "+G.blue:"2px solid transparent",color:execTab===k?G.blue:G.muted,padding:"8px 16px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"DM Mono,monospace",letterSpacing:"0.05em",marginBottom:-1}}>{l}</button>
        ))}
        {execTab === "dashboard" && (
          <>
            <button
              onClick={()=>setShowCustomize(s=>!s)}
              title="Show/hide dashboard widgets"
              style={{marginLeft:"auto",background:showCustomize?"#0f2036":"none",border:"1px solid "+(showCustomize?G.purple+"66":G.border),color:showCustomize?G.purple:G.muted,padding:"6px 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"DM Mono,monospace",letterSpacing:"0.05em",borderRadius:6,display:"inline-flex",alignItems:"center",gap:6,marginRight:0,marginTop:6,marginBottom:6}}>
              <span style={{fontSize:13,lineHeight:1}}>⚙</span> Customize
              {hiddenWidgets.size > 0 && <span style={{background:G.purple,color:"#fff",borderRadius:10,padding:"1px 7px",fontSize:9,fontWeight:800}}>{hiddenWidgets.size}</span>}
            </button>
            {showCustomize && (
              <>
                <div onClick={()=>setShowCustomize(false)} style={{position:"fixed",inset:0,zIndex:40}}/>
                <div style={{position:"absolute",top:"100%",right:24,marginTop:4,background:G.surface,border:"1px solid "+G.border,borderRadius:10,padding:12,zIndex:50,minWidth:320,boxShadow:"0 10px 30px rgba(0,0,0,0.5)"}}>
                  <div style={{display:"flex",alignItems:"center",marginBottom:8}}>
                    <div style={{fontFamily:"Syne,sans-serif",fontSize:13,fontWeight:800,color:G.text,letterSpacing:"0.02em"}}>DASHBOARD WIDGETS</div>
                    <button onClick={resetWidgets} style={{marginLeft:"auto",background:"none",border:"none",color:G.faint,fontSize:10,fontFamily:"DM Mono,monospace",cursor:"pointer",textDecoration:"underline"}}>Show all</button>
                  </div>
                  {EXEC_WIDGETS.map(w=>(
                    <label key={w.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 4px",fontFamily:"DM Mono,monospace",fontSize:12,color:G.text,cursor:"pointer",borderRadius:4}}
                      onMouseEnter={e=>e.currentTarget.style.background="#0f2036"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <input type="checkbox" checked={shown(w.id)} onChange={()=>toggleWidget(w.id)} />
                      <span>{w.label}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      {execTab==="capacity" ? (
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>
          <ExecCapacityDashboard api={api}/>
          <AiPanel portfolio={portfolio} tasks={tasks} csms={csms}/>
        </div>
      ) : (
    <div style={{flex:1,display:"flex",overflow:"hidden"}}><div style={{flex:1,display:"flex",overflow:"hidden"}}><div style={{flex:1,overflowY:"auto",padding:"18px 24px",animation:"fadein .3s ease"}}>

      {/* ── SECTION: KPI Strip ──
          Single row of 5 cards. Every value uses the same fontSize so a "2"
          reads at the same visual weight as a "$2,000,000". */}
      {shown('kpi-strip') && (
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:12,marginBottom:16}}>
        {[
          {label:"Total Customers",    value:String(totalCustomers),    sub:visiblePortfolio.length+" active project"+(visiblePortfolio.length===1?"":"s"), color:G.purple},
          {label:"Total ARR",          value:fmtMill(totalArr),         sub:totalCustomers+" customer"+(totalCustomers===1?"":"s"), color:G.green},
          {label:"Avg Completion",     value:avgCompl+"%",              sub:"across portfolio",                color:G.blue},
          {label:"Late Tasks",         value:String(totalLate),         sub:criticalLate+" critical priority", color:G.red},
          {label:"Go-Live This Month", value:String(goLivesSoon.length),sub:"by target date",                   color:G.teal},
        ].map((k,i)=>(
          <div key={i} style={{background:G.surface,border:"1px solid "+G.border,borderRadius:10,padding:"14px 12px",position:"relative",overflow:"hidden",minWidth:0,animation:"slideup .3s ease "+(i*0.05)+"s both"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:k.color,borderRadius:"10px 10px 0 0"}}/>
            <div style={{fontSize:18,fontWeight:700,color:k.color,lineHeight:1.1,marginTop:6,fontFamily:"DM Mono,monospace",fontVariantNumeric:"tabular-nums",letterSpacing:"-0.02em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={k.value}>{k.value}</div>
            <div style={{fontSize:12,color:G.muted,marginTop:8,fontFamily:"DM Mono,monospace",letterSpacing:"0.05em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={k.label}>{k.label}</div>
            <div style={{fontSize:11,color:"#5a7a94",marginTop:2,fontFamily:"DM Mono,monospace",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={k.sub}>{k.sub}</div>
          </div>
        ))}
      </div>
      )}

      {/* ── SECTION: Charts Row 1 ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12,marginBottom:12}}>

        {/* Stage pipeline */}
        {shown('stage-pipeline') && (
        <Card>
          <CardHeader>IMPLEMENTATION PIPELINE BY STAGE</CardHeader>
          <div style={{padding:"14px 16px"}}>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={stageData} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke={G.border}/>
                <XAxis dataKey="name" tick={{fill:G.muted,fontSize:9,fontFamily:"DM Mono"}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:G.muted,fontSize:9,fontFamily:"DM Mono"}} axisLine={false} tickLine={false}/>
                <Tooltip content={<Tip/>}/>
                <Bar dataKey="count" radius={[4,4,0,0]} name="Customers">
                  {stageData.map((d,i)=><Cell key={i} fill={d.fill}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
              {stageData.map(d=>(
                <span key={d.fullName} style={{display:"flex",alignItems:"center",gap:4,fontSize:13,fontFamily:"DM Mono,monospace",color:G.muted}}>
                  <span style={{width:7,height:7,borderRadius:2,background:d.fill,display:"inline-block"}}/>
                  {d.fullName}: {d.count}
                </span>
              ))}
            </div>
          </div>
        </Card>
        )}

        {/* Health donut */}
        {shown('portfolio-health') && (
        <Card>
          <CardHeader>PORTFOLIO HEALTH</CardHeader>
          <div style={{padding:"14px 16px"}}>
            <ResponsiveContainer width="100%" height={110}>
              <PieChart>
                <Pie data={healthData} cx="50%" cy="50%" innerRadius={32} outerRadius={50} paddingAngle={3} dataKey="value">
                  {healthData.map((d,i)=><Cell key={i} fill={d.color}/>)}
                </Pie>
                <Tooltip content={<Tip/>}/>
              </PieChart>
            </ResponsiveContainer>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:4}}>
              {healthData.map((h,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{width:8,height:8,borderRadius:2,background:h.color}}/>
                  <span style={{fontSize:13,color:G.muted,fontFamily:"DM Mono,monospace",flex:1}}>{h.name}</span>
                  <span style={{fontSize:15,fontWeight:800,color:h.color,fontFamily:"Syne,sans-serif"}}>{h.value}</span>
                  <span style={{fontSize:10,color:"#5a7a94",fontFamily:"DM Mono,monospace"}}>{pct(h.value,portfolio.length)}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
        )}

        {/* Task status donut */}
        {shown('task-status') && (
        <Card>
          <CardHeader>TASK STATUS ACROSS PORTFOLIO</CardHeader>
          <div style={{padding:"14px 16px"}}>
            <ResponsiveContainer width="100%" height={110}>
              <PieChart>
                <Pie data={taskStatusData} cx="50%" cy="50%" innerRadius={32} outerRadius={50} paddingAngle={3} dataKey="value">
                  {taskStatusData.map((d,i)=><Cell key={i} fill={d.color}/>)}
                </Pie>
                <Tooltip content={<Tip/>}/>
              </PieChart>
            </ResponsiveContainer>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:4}}>
              {taskStatusData.map((h,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{width:8,height:8,borderRadius:2,background:h.color}}/>
                  <span style={{fontSize:13,color:G.muted,fontFamily:"DM Mono,monospace",flex:1}}>{h.name}</span>
                  <span style={{fontSize:15,fontWeight:800,color:h.color,fontFamily:"Syne,sans-serif"}}>{h.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
        )}

        {/* ARR buckets */}
        {shown('arr-distribution') && (
        <Card>
          <CardHeader>ARR DISTRIBUTION</CardHeader>
          <div style={{padding:"14px 16px"}}>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={arrBuckets} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke={G.border}/>
                <XAxis dataKey="range" tick={{fill:G.muted,fontSize:9,fontFamily:"DM Mono"}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:G.muted,fontSize:9,fontFamily:"DM Mono"}} axisLine={false} tickLine={false}/>
                <Tooltip content={<Tip/>}/>
                <Bar dataKey="value" radius={[4,4,0,0]} name="Customers">
                  {arrBuckets.map((d,i)=><Cell key={i} fill={d.color}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        )}
      </div>

      {/* ── SECTION: Charts Row 2 ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(360px,1fr))",gap:12,marginBottom:12}}>

        {/* CSM Scorecard bar */}
        {shown('csm-scorecard') && (
        <Card>
          <CardHeader>CSM PERFORMANCE SCORECARD</CardHeader>
          <div style={{padding:"14px 16px"}}>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={csmArrData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke={G.border}/>
                <XAxis dataKey="name" tick={{fill:G.muted,fontSize:10,fontFamily:"DM Mono"}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:G.muted,fontSize:10,fontFamily:"DM Mono"}} axisLine={false} tickLine={false}/>
                <Tooltip content={<Tip/>}/>
                <Bar dataKey="arr" name="ARR $K" radius={[3,3,0,0]} barSize={12}>
                  {csmArrData.map((d,i)=><Cell key={i} fill={d.fill}/>)}
                </Bar>
                <Bar dataKey="accounts" name="Accounts" fill={G.faint} radius={[3,3,0,0]} barSize={10}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        )}

        {/* CSM Detail table */}
        {shown('csm-book') && (
        <Card>
          <CardHeader>CSM BOOK BREAKDOWN</CardHeader>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{borderBottom:"1px solid "+G.border}}>
                {["CSM","Accts","ARR","On Trk","At Risk","Crit","Late Tasks"].map(h=>(
                  <th key={h} style={{padding:"7px 10px",textAlign:"left",fontSize:12,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:600,letterSpacing:"0.05em",whiteSpace:"nowrap"}}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csms.map((c,i)=>(
                <tr key={i} style={{borderBottom:i<csms.length-1?"1px solid "+G.faint:"none"}}>
                  <td style={{padding:"8px 10px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <div style={{width:22,height:22,borderRadius:"50%",background:CSM_COLORS[i%CSM_COLORS.length],display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff",flexShrink:0}}>{c.csm[0]}</div>
                      <span style={{fontSize:14,fontWeight:600,color:G.text}}>{c.csm.split(" ")[0]}</span>
                    </div>
                  </td>
                  <td style={{padding:"8px 10px",fontSize:14,fontFamily:"DM Mono,monospace",color:G.muted}}>{c.total_accounts||0}</td>
                  <td style={{padding:"8px 10px",fontSize:14,fontFamily:"DM Mono,monospace",color:G.green,fontWeight:700}}>{fmtArr(c.total_arr)}</td>
                  <td style={{padding:"8px 10px",fontSize:14,fontFamily:"DM Mono,monospace",color:G.green}}>{c.on_track||0}</td>
                  <td style={{padding:"8px 10px",fontSize:14,fontFamily:"DM Mono,monospace",color:G.yellow}}>{c.at_risk||0}</td>
                  <td style={{padding:"8px 10px",fontSize:14,fontFamily:"DM Mono,monospace",color:G.red,fontWeight:700}}>{c.critical||0}</td>
                  <td style={{padding:"8px 10px"}}>
                    <span style={{color:(c.late_tasks||0)>0?G.red:G.muted,fontSize:14,fontFamily:"DM Mono,monospace",fontWeight:(c.late_tasks||0)>0?700:400}}>
                      {c.late_tasks||0}{(c.late_tasks||0)>0?" ⚠":""}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        )}
      </div>

      {/* ── SECTION: Tables Row ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(380px,1fr))",gap:12,marginBottom:12}}>

        {/* Late tasks escalation */}
        {shown('late-tasks') && (
        <Card>
          <div style={{padding:"11px 16px",borderBottom:"1px solid "+G.border,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:15,fontWeight:700,color:G.red,letterSpacing:"0.07em",fontFamily:"DM Mono,monospace"}}>LATE TASKS — REQUIRES EXEC ATTENTION</span>
            <span style={{fontSize:14,fontFamily:"DM Mono,monospace",color:G.muted}}>{totalLate} total</span>
          </div>
          <div style={{overflowY:"auto",maxHeight:240}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead style={{position:"sticky",top:0,background:G.surface}}>
                <tr style={{borderBottom:"1px solid "+G.border}}>
                  {["Task","Customer","CSM","Phase","Due","Days Late","Priority"].map(h=>(
                    <th key={h} style={{padding:"7px 10px",textAlign:"left",fontSize:12,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:600,letterSpacing:"0.05em",whiteSpace:"nowrap"}}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lateTasks.map((t,i)=>{
                  const daysLate = Math.round((new Date()-new Date(t.proj_date))/86400000);
                  return (
                    <tr key={t.id} className="rh" style={{borderBottom:i<lateTasks.length-1?"1px solid "+G.faint:"none"}}>
                      <td style={{padding:"8px 10px",fontSize:14,fontWeight:600,maxWidth:160}}>
                        <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</div>
                      </td>
                      <td style={{padding:"8px 10px",fontSize:13,color:G.muted,whiteSpace:"nowrap"}}>{t.project?.customer||"—"}</td>
                      <td style={{padding:"8px 10px",fontSize:13,color:G.muted,whiteSpace:"nowrap"}}>{t.project?.csm?.split(" ")[0]||"—"}</td>
                      <td style={{padding:"8px 10px",fontSize:14,fontFamily:"DM Mono,monospace",color:"#5a7a94",whiteSpace:"nowrap"}}>{t.phase}</td>
                      <td style={{padding:"8px 10px",fontSize:13,fontFamily:"DM Mono,monospace",color:G.red,whiteSpace:"nowrap"}}>{fmtDate(t.proj_date)}</td>
                      <td style={{padding:"8px 10px",fontSize:14,fontFamily:"DM Mono,monospace",fontWeight:800,color:G.red}}>+{daysLate}d</td>
                      <td style={{padding:"8px 10px"}}>
                        <span style={{color:PRIORITY_COLOR[t.priority]||G.muted,fontSize:14,fontFamily:"DM Mono,monospace",fontWeight:700}}>{(t.priority||"").toUpperCase()}</span>
                      </td>
                    </tr>
                  );
                })}
                {lateTasks.length===0 && <tr><td colSpan={7} style={{padding:20,textAlign:"center",color:G.green,fontFamily:"DM Mono,monospace",fontSize:12}}>✓ No late tasks!</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        )}

        {/* Upcoming Go-Lives + At Risk */}
        {(shown('upcoming-go-lives') || shown('critical-accounts')) && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {/* Upcoming go-lives */}
          {shown('upcoming-go-lives') && (
          <Card style={{flex:1}}>
            <CardHeader>UPCOMING GO-LIVES</CardHeader>
            <div style={{overflowY:"auto",maxHeight:120}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{borderBottom:"1px solid "+G.border}}>
                    {["Customer","CSM","Stage","ARR","Target"].map(h=>(
                      <th key={h} style={{padding:"6px 10px",textAlign:"left",fontSize:12,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:600,letterSpacing:"0.05em"}}>{h.toUpperCase()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {upcomingGoLives.map((p,i)=>(
                    <tr key={p.id} style={{borderBottom:i<upcomingGoLives.length-1?"1px solid "+G.faint:"none"}}>
                      <td style={{padding:"7px 10px",fontSize:14,fontWeight:600}}>{p.customer}</td>
                      <td style={{padding:"7px 10px",fontSize:13,color:G.muted}}>{p.csm?.split(" ")[0]}</td>
                      <td style={{padding:"7px 10px"}}>
                        <span style={{fontSize:13,fontFamily:"DM Mono,monospace",color:PHASE_COLOR[p.stage]||G.muted,fontWeight:700}}>{p.stage?.toUpperCase()}</span>
                      </td>
                      <td style={{padding:"7px 10px",fontSize:13,fontFamily:"DM Mono,monospace",color:G.green,fontWeight:700}}>{fmtArr(p.arr)}</td>
                      <td style={{padding:"7px 10px",fontSize:13,fontFamily:"DM Mono,monospace",color:G.muted}}>{fmtDate(p.target_date)}</td>
                    </tr>
                  ))}
                  {upcomingGoLives.length===0 && <tr><td colSpan={5} style={{padding:16,textAlign:"center",color:G.muted,fontFamily:"DM Mono,monospace",fontSize:11}}>None scheduled</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          )}

          {/* Critical health accounts */}
          {shown('critical-accounts') && (
          <Card style={{flex:1}}>
            <CardHeader style={{color:G.red}}>CRITICAL ACCOUNTS — IMMEDIATE ATTENTION</CardHeader>
            <div style={{overflowY:"auto",maxHeight:120}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{borderBottom:"1px solid "+G.border}}>
                    {["Customer","CSM","ARR","Stage","Late"].map(h=>(
                      <th key={h} style={{padding:"6px 10px",textAlign:"left",fontSize:12,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:600,letterSpacing:"0.05em"}}>{h.toUpperCase()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {portfolio.filter(p=>p.health==="red").map((p,i,arr)=>(
                    <tr key={p.id} style={{borderBottom:i<arr.length-1?"1px solid "+G.faint:"none",background:G.redBg+"44"}}>
                      <td style={{padding:"7px 10px",fontSize:14,fontWeight:700,color:G.red}}>{p.customer}</td>
                      <td style={{padding:"7px 10px",fontSize:13,color:G.muted}}>{p.csm?.split(" ")[0]}</td>
                      <td style={{padding:"7px 10px",fontSize:13,fontFamily:"DM Mono,monospace",color:G.red,fontWeight:700}}>{fmtArr(p.arr)}</td>
                      <td style={{padding:"7px 10px",fontSize:13,color:G.muted,fontFamily:"DM Mono,monospace"}}>{p.stage}</td>
                      <td style={{padding:"7px 10px",fontSize:14,fontFamily:"DM Mono,monospace",fontWeight:800,color:G.red}}>{p.tasks_late||0}!</td>
                    </tr>
                  ))}
                  {portfolio.filter(p=>p.health==="red").length===0 && <tr><td colSpan={5} style={{padding:16,textAlign:"center",color:G.green,fontFamily:"DM Mono,monospace",fontSize:11}}>✓ No critical accounts</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          )}
        </div>
        )}
      </div>

      {/* ── SECTION: Full Portfolio Table ── */}
      {shown('full-portfolio') && (
      <Card style={{marginBottom:12}}>
        <div style={{padding:"11px 16px",borderBottom:"1px solid "+G.border,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:15,fontWeight:700,color:G.muted,letterSpacing:"0.05em",fontFamily:"DM Mono,monospace"}}>FULL PORTFOLIO — ALL CUSTOMERS</span>
          <span style={{fontSize:14,fontFamily:"DM Mono,monospace",color:"#5a7a94"}}>{portfolio.length} customers · {fmtFull(totalArr)} total ARR</span>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
            <thead>
              <tr style={{borderBottom:"1px solid "+G.border}}>
                {["Customer","CSM","Stage","Health","Completion","ARR","Start","Target","Total Tasks","Complete","Upcoming","Late","Days to Target"].map(h=>(
                  <th key={h} style={{padding:"8px 12px",textAlign:"left",fontSize:12,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:600,letterSpacing:"0.05em",whiteSpace:"nowrap"}}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {portfolio.map((p,i)=>{
                const hc = HEALTH_COLOR[p.health]||G.green;
                const daysToTarget = p.days_to_target!=null ? Math.round(p.days_to_target) : null;
                return (
                  <tr key={p.id} className="rh" style={{borderBottom:i<portfolio.length-1?"1px solid "+G.faint:"none",
                    background:p.health==="red"?G.redBg+"55":p.health==="yellow"?G.yellowBg+"33":"transparent"}}>
                    <td style={{padding:"9px 12px",fontSize:15,fontWeight:700}}>{p.customer}</td>
                    <td style={{padding:"9px 12px",fontSize:13,color:G.muted,fontFamily:"DM Mono,monospace",whiteSpace:"nowrap"}}>{p.csm}</td>
                    <td style={{padding:"9px 12px",fontSize:11,color:PHASE_COLOR[p.stage]||G.muted,fontFamily:"DM Mono,monospace",whiteSpace:"nowrap"}}>{p.stage}</td>
                    <td style={{padding:"9px 12px"}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
                        <span style={{width:8,height:8,borderRadius:"50%",background:hc,boxShadow:"0 0 5px "+hc+"66"}}/>
                        <span style={{color:hc,fontFamily:"DM Mono,monospace",fontSize:10,fontWeight:700}}>{p.health_label}</span>
                      </span>
                    </td>
                    <td style={{padding:"9px 12px",minWidth:120}}>
                      <div style={{display:"flex",alignItems:"center",gap:7}}>
                        <div style={{flex:1,height:5,background:G.border,borderRadius:3,overflow:"hidden"}}>
                          <div style={{width:(p.completion_pct||0)+"%",height:"100%",borderRadius:3,
                            background:p.completion_pct>75?G.green:p.completion_pct>40?G.blue:G.yellow}}/>
                        </div>
                        <span style={{fontSize:13,fontFamily:"DM Mono,monospace",color:G.muted,minWidth:28}}>{p.completion_pct||0}%</span>
                      </div>
                    </td>
                    <td style={{padding:"9px 12px",fontSize:14,fontFamily:"DM Mono,monospace",color:G.green,fontWeight:700,whiteSpace:"nowrap"}}>{fmtArr(p.arr)}</td>
                    <td style={{padding:"9px 12px",fontSize:13,fontFamily:"DM Mono,monospace",color:"#5a7a94",whiteSpace:"nowrap"}}>{fmtDate(p.start_date)}</td>
                    <td style={{padding:"9px 12px",fontSize:13,fontFamily:"DM Mono,monospace",color:G.muted,whiteSpace:"nowrap"}}>{fmtDate(p.target_date)}</td>
                    <td style={{padding:"9px 12px",fontSize:14,fontFamily:"DM Mono,monospace",color:G.muted,textAlign:"center"}}>{p.total_tasks||0}</td>
                    <td style={{padding:"9px 12px",fontSize:14,fontFamily:"DM Mono,monospace",color:G.green,textAlign:"center",fontWeight:700}}>{p.tasks_complete||0}</td>
                    <td style={{padding:"9px 12px",fontSize:14,fontFamily:"DM Mono,monospace",color:G.yellow,textAlign:"center"}}>{p.tasks_upcoming||0}</td>
                    <td style={{padding:"9px 12px",fontSize:14,fontFamily:"DM Mono,monospace",textAlign:"center",fontWeight:700,color:(p.tasks_late||0)>0?G.red:G.faint}}>
                      {(p.tasks_late||0)>0?p.tasks_late+"!":"—"}
                    </td>
                    <td style={{padding:"9px 12px",fontSize:14,fontFamily:"DM Mono,monospace",
                      color:daysToTarget!=null?(daysToTarget<0?G.red:daysToTarget<14?G.yellow:G.muted):G.faint,
                      fontWeight:daysToTarget!=null&&daysToTarget<0?700:400}}>
                      {daysToTarget!=null?(daysToTarget<0?Math.abs(daysToTarget)+"d overdue":daysToTarget+"d"):"—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      )}
    </div>
    </div>
    <AiPanel portfolio={portfolio} tasks={tasks} csms={csms} />
    </div>
      )}
    </div>
  );
}

// ─── ADD COMMITMENT MODAL ────────────────────────────────────────────────────
function AddCommitmentModal({api,csm,onClose,onAdded}) {
  const [type,setType]=useState("Client Call");
  const [hours,setHours]=useState("2");
  const [week,setWeek]=useState(getWeeks(12)[0]);
  const [notes,setNotes]=useState("");
  const [projectId,setProjectId]=useState("");
  const [projects,setProjects]=useState([]);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    if(csm) api.get("projects",{csm_id:"eq."+csm.id,select:"id,name"}).then(setProjects).catch(()=>{});
  },[csm]);

  const save=async()=>{
    if(!hours||!csm) return;
    setSaving(true);
    try{
      await api.post("project_commitments",[{
        csm_id:csm.id,
        project_id:projectId||null,
        week_start_date:week,
        estimated_hours:parseFloat(hours),
        commitment_type:type,
        notes:notes||null,
      }]);
      onAdded();onClose();
    }catch(e){alert("Failed: "+e.message);}
    setSaving(false);
  };

  const weeks=getWeeks(12);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:16,width:"100%",maxWidth:420,padding:24}}>
        <div style={{fontSize:17,fontWeight:800,color:G.text,fontFamily:"Syne,sans-serif",marginBottom:18}}>Add Commitment Block</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <label style={{fontSize:10,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:4}}>TYPE</label>
            <select value={type} onChange={e=>setType(e.target.value)}
              style={{width:"100%",background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"8px 10px",borderRadius:6,fontFamily:"DM Mono,monospace",fontSize:12}}>
              {["Client Call","Travel","Onboarding Session","Internal Meeting","Training","Documentation","Other"].map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:10,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:4}}>WEEK</label>
            <select value={week} onChange={e=>setWeek(e.target.value)}
              style={{width:"100%",background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"8px 10px",borderRadius:6,fontFamily:"DM Mono,monospace",fontSize:12}}>
              {weeks.map(w=><option key={w} value={w}>Week of {fmtWeek(w)}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:10,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:4}}>HOURS</label>
            <input type="number" value={hours} onChange={e=>setHours(e.target.value)} min="0.5" max="40" step="0.5"
              style={{width:"100%",background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"8px 10px",borderRadius:6,fontFamily:"DM Mono,monospace",fontSize:12}}/>
          </div>
          <div>
            <label style={{fontSize:10,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:4}}>PROJECT (OPTIONAL)</label>
            <select value={projectId} onChange={e=>setProjectId(e.target.value)}
              style={{width:"100%",background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"8px 10px",borderRadius:6,fontFamily:"DM Mono,monospace",fontSize:12}}>
              <option value="">No specific project</option>
              {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:10,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:4}}>NOTES</label>
            <input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional notes…"
              style={{width:"100%",background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"8px 10px",borderRadius:6,fontFamily:"DM Mono,monospace",fontSize:12}}/>
          </div>
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={onClose} style={{flex:1,background:G.surface2,border:"1px solid "+G.border,color:G.muted,padding:"10px",borderRadius:8,cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12}}>Cancel</button>
            <button onClick={save} disabled={saving} style={{flex:1,background:"linear-gradient(135deg,#7c3aed,#a855f7)",border:"none",color:"#fff",padding:"10px",borderRadius:8,cursor:"pointer",fontFamily:"Syne,sans-serif",fontSize:13,fontWeight:700,opacity:saving?0.6:1}}>{saving?"Saving…":"Add Commitment"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CSM CAPACITY PANEL ──────────────────────────────────────────────────────
function CsmCapacityPanel({api,csm}) {
  const [capEntries,setCapEntries]=useState([]);
  const [commitments,setCommitments]=useState([]);
  const [projects,setProjects]=useState([]);
  const [tasks,setTasks]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showAddModal,setShowAddModal]=useState(false);
  const [editingWeek,setEditingWeek]=useState(null);
  const [editingProj,setEditingProj]=useState(null); // {projectId, ws}

  const weeks=getWeeks(12);

  const load=useCallback(async()=>{
    if(!csm) return;
    setLoading(true);
    try{
      const [ce,cm,pr]=await Promise.all([
        api.get("capacity_entries",{csm_id:"eq."+csm.id,select:"*"}).catch(()=>[]),
        api.get("project_commitments",{csm_id:"eq."+csm.id,select:"*"}).catch(()=>[]),
        api.get("projects",{csm_id:"eq."+csm.id,select:"id,name"}),
      ]);
      setCapEntries(ce||[]);setCommitments(cm||[]);setProjects(pr||[]);
      const pIds=(pr||[]).map(p=>p.id);
      if(pIds.length){
        const tk=await api.get("tasks",{status:"neq.complete",select:"id,project_id,name,phase,proj_date,priority,estimated_hours"}).catch(()=>[]);
        setTasks((tk||[]).filter(t=>pIds.includes(t.project_id)));
      }else{setTasks([]);}
    }catch(e){console.error(e);}
    setLoading(false);
  },[api,csm]);

  useEffect(()=>{load();},[load]);

  const updateAvailHours=async(ws,hours)=>{
    try{
      const existing=capEntries.find(e=>e.week_start_date===ws);
      if(existing){
        await api.patch("capacity_entries",existing.id,{estimated_hours:parseFloat(hours)});
      }else{
        await api.post("capacity_entries",[{csm_id:csm.id,week_start_date:ws,estimated_hours:parseFloat(hours)}]);
      }
      load();
    }catch(e){alert("Failed: "+e.message);}
    setEditingWeek(null);
  };

  const deleteCommitment=async(id)=>{
    try{await api.del("project_commitments",id);load();}catch(e){alert("Failed: "+e.message);}
  };

  const saveProjectHours=async(projectId,ws,hours)=>{
    const h=parseFloat(hours);
    const existing=commitments.find(c=>c.project_id===projectId&&c.week_start_date===ws&&c.commitment_type==="Project Work");
    try{
      if(!h||h<=0){
        if(existing) await api.del("project_commitments",existing.id);
      }else if(existing){
        await api.patch("project_commitments",existing.id,{estimated_hours:h});
      }else{
        await api.post("project_commitments",[{csm_id:csm.id,project_id:projectId,week_start_date:ws,estimated_hours:h,commitment_type:"Project Work",notes:null}]);
      }
      load();
    }catch(e){alert("Failed: "+e.message);}
    setEditingProj(null);
  };

  if(!csm) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:G.muted,fontFamily:"DM Mono,monospace",fontSize:13,padding:40}}>Select a CSM from the dropdown above to view capacity</div>;
  if(loading) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:G.muted,fontFamily:"DM Mono,monospace",fontSize:13}}>Loading capacity…</div>;

  const projNames={};projects.forEach(p=>{projNames[p.id]=p.name;});

  const weekData=weeks.map(ws=>{
    const we=new Date(ws+"T00:00:00");we.setDate(we.getDate()+6);const weStr=we.toISOString().split("T")[0];
    const capEntry=capEntries.find(e=>e.week_start_date===ws);
    const available=capEntry?.estimated_hours||40;
    const weekTasks=tasks.filter(t=>t.proj_date>=ws&&t.proj_date<=weStr);
    const weekCommits=commitments.filter(c=>c.week_start_date===ws);
    // Separate project work hours from other commitments
    const projWorkCommits=weekCommits.filter(c=>c.commitment_type==="Project Work");
    const otherCommits=weekCommits.filter(c=>c.commitment_type!=="Project Work");
    const projsWithManual=new Set(projWorkCommits.map(c=>c.project_id));
    // For projects with manual hours, use those; otherwise fall back to auto-task estimate
    const autoTaskHours=weekTasks.filter(t=>!projsWithManual.has(t.project_id)).reduce((s,t)=>s+getTaskHours(t),0);
    const manualProjHours=projWorkCommits.reduce((s,c)=>s+(c.estimated_hours||0),0);
    const otherCommitHours=otherCommits.reduce((s,c)=>s+(c.estimated_hours||0),0);
    const committed=autoTaskHours+manualProjHours+otherCommitHours;
    const utilization=available>0?(committed/available)*100:0;
    return {ws,available,autoTaskHours,manualProjHours,otherCommitHours,committed,utilization,weekTasks,weekCommits,capEntry};
  });

  const avgUtil=weekData.length?Math.round(weekData.reduce((s,w)=>s+w.utilization,0)/weekData.length):0;
  const peakWeek=weekData.reduce((max,w)=>w.utilization>max.u?{u:w.utilization,l:fmtWeek(w.ws)}:max,{u:0,l:"—"});
  const overloadedWeeks=weekData.filter(w=>w.utilization>100).length;

  return (
    <div style={{flex:1,overflowY:"auto",padding:"18px 24px",animation:"fadein .25s ease"}}>
      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
        {[
          {label:"Available Hours",value:weekData.reduce((s,w)=>s+w.available,0)+"h",color:G.blue,sub:"next 12 weeks"},
          {label:"Avg Utilization",value:avgUtil+"%",color:avgUtil>80?G.yellow:G.green,sub:"across all weeks"},
          {label:"Peak Week",value:Math.round(peakWeek.u)+"%",color:utilColor(peakWeek.u),sub:peakWeek.l},
          {label:"Overloaded Weeks",value:overloadedWeeks,color:overloadedWeeks>0?G.red:G.green,sub:">100% utilization"},
        ].map((k,i)=>(
          <div key={i} style={{background:G.surface,border:"1px solid "+G.border,borderRadius:10,padding:"12px 14px",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:k.color,borderRadius:"10px 10px 0 0"}}/>
            <div style={{fontSize:26,fontWeight:800,color:k.color,lineHeight:1,marginTop:4,fontFamily:"Syne,sans-serif"}}>{k.value}</div>
            <div style={{fontSize:13,color:G.muted,marginTop:5,fontFamily:"DM Mono,monospace"}}>{k.label}</div>
            <div style={{fontSize:9,color:"#5a7a94",marginTop:2,fontFamily:"DM Mono,monospace"}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* 12-Week Grid */}
      <Card style={{marginBottom:12}}>
        <div style={{padding:"11px 16px",borderBottom:"1px solid "+G.border,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:15,fontWeight:700,color:G.muted,letterSpacing:"0.05em",fontFamily:"DM Mono,monospace"}}>MY 12-WEEK CAPACITY</span>
          <button onClick={()=>setShowAddModal(true)}
            style={{background:"linear-gradient(135deg,#7c3aed,#a855f7)",border:"none",color:"#fff",padding:"6px 14px",borderRadius:6,cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>+ Add Commitment</button>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
            <thead>
              <tr style={{borderBottom:"1px solid "+G.border}}>
                <th style={{padding:"8px 12px",textAlign:"left",fontSize:10,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:600,minWidth:110}}>METRIC</th>
                {weeks.map((ws,i)=>(
                  <th key={i} style={{padding:"8px 4px",textAlign:"center",fontSize:10,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:500,minWidth:70}}>{fmtWeek(ws)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Available Hours Row (editable) */}
              <tr style={{borderBottom:"1px solid "+G.faint}}>
                <td style={{padding:"8px 12px",fontSize:11,fontWeight:700,color:G.blue,fontFamily:"DM Mono,monospace"}}>AVAILABLE</td>
                {weekData.map((wd,i)=>(
                  <td key={i} style={{padding:"4px 3px",textAlign:"center"}}>
                    {editingWeek===wd.ws?(
                      <input type="number" defaultValue={wd.available} autoFocus min="0" max="80" step="1"
                        onBlur={e=>updateAvailHours(wd.ws,e.target.value)}
                        onKeyDown={e=>{if(e.key==="Enter")updateAvailHours(wd.ws,e.target.value);if(e.key==="Escape")setEditingWeek(null);}}
                        style={{width:44,background:G.bg,border:"1px solid "+G.blue,color:G.text,padding:"3px",borderRadius:4,fontFamily:"DM Mono,monospace",fontSize:11,textAlign:"center"}}/>
                    ):(
                      <div onClick={()=>setEditingWeek(wd.ws)}
                        style={{cursor:"pointer",fontSize:12,fontFamily:"DM Mono,monospace",color:G.blue,fontWeight:700,padding:"3px",borderBottom:"1px dashed "+G.border}}>{wd.available}h</div>
                    )}
                  </td>
                ))}
              </tr>
              {/* Project Hours Row */}
              <tr style={{borderBottom:"1px solid "+G.faint}}>
                <td style={{padding:"8px 12px",fontSize:11,fontWeight:700,color:G.teal,fontFamily:"DM Mono,monospace"}}>PROJECT HRS</td>
                {weekData.map((wd,i)=>(
                  <td key={i} style={{padding:"4px 3px",textAlign:"center",fontSize:12,fontFamily:"DM Mono,monospace",color:G.teal,fontWeight:wd.manualProjHours>0?700:400}}>{wd.manualProjHours>0?wd.manualProjHours+"h":"—"}</td>
                ))}
              </tr>
              {/* Other Commitments Row */}
              <tr style={{borderBottom:"1px solid "+G.faint}}>
                <td style={{padding:"8px 12px",fontSize:11,fontWeight:700,color:G.yellow,fontFamily:"DM Mono,monospace"}}>OTHER</td>
                {weekData.map((wd,i)=>(
                  <td key={i} style={{padding:"4px 3px",textAlign:"center",fontSize:12,fontFamily:"DM Mono,monospace",color:G.yellow}}>{wd.otherCommitHours>0?wd.otherCommitHours+"h":"—"}</td>
                ))}
              </tr>
              {/* Task Estimate Row (reference only) */}
              <tr style={{borderBottom:"1px solid "+G.faint}}>
                <td style={{padding:"8px 12px",fontSize:11,fontWeight:500,color:G.faint,fontFamily:"DM Mono,monospace"}} title="Auto-estimated from task due dates — overridden by project hours above">TASK EST.</td>
                {weekData.map((wd,i)=>(
                  <td key={i} style={{padding:"4px 3px",textAlign:"center",fontSize:11,fontFamily:"DM Mono,monospace",color:G.faint}}>{wd.autoTaskHours>0?wd.autoTaskHours+"h":"—"}</td>
                ))}
              </tr>
              {/* Utilization Row */}
              <tr style={{borderBottom:"1px solid "+G.border}}>
                <td style={{padding:"8px 12px",fontSize:11,fontWeight:800,color:G.text,fontFamily:"DM Mono,monospace"}}>UTILIZATION</td>
                {weekData.map((wd,i)=>(
                  <td key={i} style={{padding:"4px 3px",textAlign:"center"}}>
                    <div style={{background:utilBg(wd.utilization),border:"1px solid "+utilBd(wd.utilization),borderRadius:6,padding:"5px 2px"}}>
                      <div style={{fontSize:13,fontWeight:800,color:utilColor(wd.utilization),fontFamily:"DM Mono,monospace"}}>{Math.round(wd.utilization)}%</div>
                      <div style={{fontSize:9,color:utilColor(wd.utilization),opacity:0.7}}>{Math.round(wd.committed)}/{wd.available}h</div>
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Project Breakdown Grid */}
      <Card style={{marginBottom:12}}>
        <div style={{padding:"11px 16px",borderBottom:"1px solid "+G.border,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:15,fontWeight:700,color:G.muted,letterSpacing:"0.05em",fontFamily:"DM Mono,monospace"}}>PROJECT BREAKDOWN — ESTIMATED HOURS</span>
          <span style={{fontSize:11,color:"#5a7a94",fontFamily:"DM Mono,monospace"}}>Click any cell to enter hours</span>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
            <thead>
              <tr style={{borderBottom:"1px solid "+G.border}}>
                <th style={{padding:"8px 12px",textAlign:"left",fontSize:10,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:600,minWidth:140,position:"sticky",left:0,background:G.surface,zIndex:1}}>PROJECT</th>
                {weeks.map((ws,i)=>(
                  <th key={i} style={{padding:"8px 4px",textAlign:"center",fontSize:10,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:500,minWidth:70}}>{fmtWeek(ws)}</th>
                ))}
                <th style={{padding:"8px 8px",textAlign:"center",fontSize:10,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:600,minWidth:60}}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((proj,pi)=>{
                const projTotal=weeks.reduce((sum,ws)=>{
                  const entry=commitments.find(c=>c.project_id===proj.id&&c.week_start_date===ws&&c.commitment_type==="Project Work");
                  return sum+(entry?.estimated_hours||0);
                },0);
                return (
                  <tr key={proj.id} style={{borderBottom:pi<projects.length-1?"1px solid "+G.faint:"none"}}>
                    <td style={{padding:"8px 12px",fontSize:13,fontWeight:700,color:G.text,whiteSpace:"nowrap",position:"sticky",left:0,background:G.surface,zIndex:1}}>
                      {proj.name}
                    </td>
                    {weeks.map((ws,wi)=>{
                      const entry=commitments.find(c=>c.project_id===proj.id&&c.week_start_date===ws&&c.commitment_type==="Project Work");
                      const hrs=entry?.estimated_hours||0;
                      const isEditing=editingProj?.projectId===proj.id&&editingProj?.ws===ws;
                      return (
                        <td key={wi} style={{padding:"3px 2px",textAlign:"center"}}>
                          {isEditing?(
                            <input type="number" defaultValue={hrs||""} autoFocus min="0" max="40" step="0.5" placeholder="0"
                              onBlur={e=>saveProjectHours(proj.id,ws,e.target.value)}
                              onKeyDown={e=>{if(e.key==="Enter")saveProjectHours(proj.id,ws,e.target.value);if(e.key==="Escape")setEditingProj(null);}}
                              style={{width:44,background:G.bg,border:"1px solid "+G.teal,color:G.text,padding:"4px",borderRadius:4,fontFamily:"DM Mono,monospace",fontSize:11,textAlign:"center"}}/>
                          ):(
                            <div onClick={()=>setEditingProj({projectId:proj.id,ws})}
                              style={{cursor:"pointer",fontSize:12,fontFamily:"DM Mono,monospace",color:hrs>0?G.teal:G.faint,fontWeight:hrs>0?700:400,padding:"4px 2px",borderRadius:4,transition:"background .15s"}}
                              onMouseEnter={e=>e.currentTarget.style.background=G.surface2}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                              {hrs>0?hrs+"h":"·"}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td style={{padding:"4px 8px",textAlign:"center",fontSize:12,fontFamily:"DM Mono,monospace",color:projTotal>0?G.teal:G.faint,fontWeight:700}}>
                      {projTotal>0?projTotal+"h":"—"}
                    </td>
                  </tr>
                );
              })}
              {/* Total Row */}
              <tr style={{borderTop:"2px solid "+G.border,background:"#080e18"}}>
                <td style={{padding:"8px 12px",fontSize:11,fontWeight:800,color:G.text,fontFamily:"DM Mono,monospace",position:"sticky",left:0,background:"#080e18",zIndex:1}}>TOTAL</td>
                {weeks.map((ws,wi)=>{
                  const weekTotal=projects.reduce((sum,proj)=>{
                    const entry=commitments.find(c=>c.project_id===proj.id&&c.week_start_date===ws&&c.commitment_type==="Project Work");
                    return sum+(entry?.estimated_hours||0);
                  },0);
                  return <td key={wi} style={{padding:"4px 3px",textAlign:"center",fontSize:12,fontFamily:"DM Mono,monospace",color:weekTotal>0?G.teal:G.faint,fontWeight:800}}>{weekTotal>0?weekTotal+"h":"—"}</td>;
                })}
                <td style={{padding:"4px 8px",textAlign:"center",fontSize:13,fontFamily:"DM Mono,monospace",color:G.teal,fontWeight:800}}>
                  {projects.reduce((grand,proj)=>grand+weeks.reduce((sum,ws)=>{
                    const entry=commitments.find(c=>c.project_id===proj.id&&c.week_start_date===ws&&c.commitment_type==="Project Work");
                    return sum+(entry?.estimated_hours||0);
                  },0),0)||"—"}{projects.reduce((grand,proj)=>grand+weeks.reduce((sum,ws)=>{
                    const entry=commitments.find(c=>c.project_id===proj.id&&c.week_start_date===ws&&c.commitment_type==="Project Work");
                    return sum+(entry?.estimated_hours||0);
                  },0),0)?"h":""}
                </td>
              </tr>
              {projects.length===0&&<tr><td colSpan={weeks.length+2} style={{padding:20,textAlign:"center",color:G.muted,fontFamily:"DM Mono,monospace",fontSize:12}}>No projects assigned</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Other Commitments List */}
      {(()=>{const other=commitments.filter(c=>c.commitment_type!=="Project Work");return other.length>0?(
      <Card style={{marginBottom:12}}>
        <CardHeader>OTHER COMMITMENTS</CardHeader>
        <div style={{overflowY:"auto",maxHeight:200}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{borderBottom:"1px solid "+G.border}}>
                {["Type","Week","Hours","Project","Notes",""].map(h=>(
                  <th key={h} style={{padding:"7px 10px",textAlign:"left",fontSize:10,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:600,letterSpacing:"0.05em"}}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {other.sort((a,b)=>a.week_start_date.localeCompare(b.week_start_date)).map((c,i)=>(
                <tr key={c.id} style={{borderBottom:i<other.length-1?"1px solid "+G.faint:"none"}}>
                  <td style={{padding:"8px 10px",fontSize:13,fontWeight:600,color:G.text}}>{c.commitment_type}</td>
                  <td style={{padding:"8px 10px",fontSize:12,fontFamily:"DM Mono,monospace",color:G.muted}}>{fmtWeek(c.week_start_date)}</td>
                  <td style={{padding:"8px 10px",fontSize:13,fontFamily:"DM Mono,monospace",color:G.yellow,fontWeight:700}}>{c.estimated_hours}h</td>
                  <td style={{padding:"8px 10px",fontSize:12,color:G.muted}}>{projNames[c.project_id]||"—"}</td>
                  <td style={{padding:"8px 10px",fontSize:11,color:"#5a7a94",fontFamily:"DM Mono,monospace",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.notes||"—"}</td>
                  <td style={{padding:"8px 10px"}}>
                    <button onClick={()=>deleteCommitment(c.id)}
                      style={{background:G.redBg,border:"1px solid "+G.redBd,color:G.red,padding:"3px 8px",borderRadius:4,cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:10}}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>):null;})()}

      {/* Legend */}
      <div style={{display:"flex",gap:16,justifyContent:"center",padding:"8px 0",fontSize:11,fontFamily:"DM Mono,monospace"}}>
        <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:3,background:G.green}}/>Under 80%</span>
        <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:3,background:G.yellow}}/>80–100%</span>
        <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:3,background:G.red}}/>Over 100%</span>
        <span style={{color:G.muted}}>Click available hours to edit</span>
      </div>

      {showAddModal&&<AddCommitmentModal api={api} csm={csm} onClose={()=>setShowAddModal(false)} onAdded={load}/>}
    </div>
  );
}

// ─── CONSULTANT PORTAL ───────────────────────────────────────────────────────
function ConsultantPortal({api,csm,onAccountSelect,onProjectSelect}) {
  const [projects, setProjects] = useState([]);
  const [customers,setCustomers]= useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState("");
  const [health,   setHealth]   = useState("all");
  const [stage,    setStage]    = useState("all");
  const [sortKey,  setSortKey]  = useState("customer");
  const [sortDir,  setSortDir]  = useState("asc");
  const [cTab,     setCTab]     = useState("accounts");
  const [openingAccount, setOpeningAccount] = useState(null);

  // Open AccountDetail for a project's customer. Post-FK migration the
  // customer_id on each portfolio row is the source of truth; the legacy
  // name lookup is a fallback for any row that hasn't been backfilled yet.
  // No stub-creation here — rows should only get into `customers` via the
  // Customers config tab, never as a side effect of a click.
  const openAccountByCustomerId = useCallback(async (id) => {
    if (!onAccountSelect || !id) return;
    const cached = customers.find(c => c.id === id);
    if (cached) { onAccountSelect(cached); return; }
    try {
      const rows = await api.get("customers", { id: "eq." + id, select: "*", limit: "1" });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row) onAccountSelect(row);
    } catch (e) { console.error(e); }
  }, [api, onAccountSelect, customers]);

  const openAccountFromProject = useCallback(async (project) => {
    if (!onAccountSelect || !project) return;
    setOpeningAccount(project.id);
    try {
      if (project.customer_id) {
        await openAccountByCustomerId(project.customer_id);
      } else if (project.customer) {
        const rows = await api.get("customers", { name: "eq." + project.customer, select: "*", limit: "1" });
        const row = Array.isArray(rows) ? rows[0] : null;
        if (row) onAccountSelect(row);
      }
    } catch (e) { console.error(e); }
    setOpeningAccount(null);
  }, [api, onAccountSelect, openAccountByCustomerId]);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const params = csm
        ? {"select":"*","csm":"eq."+csm.name}
        : {"select":"*"};
      const [d, cs] = await Promise.all([
        api.get("vw_portfolio", params),
        api.get("customers", { select: "*", is_active: "eq.true", order: "name.asc" }).catch(() => []),
      ]);
      setProjects(d || []);
      setCustomers(cs || []);
    }catch(e){console.error(e);}
    setLoading(false);
  },[api,csm]);

  useEffect(()=>{load();},[load]);

  // Inline stage edit from the project list. Lets a CSM advance a project
  // without opening the task modal, matching how Asana/Rocketlane let you
  // change a status field straight from the row. Optimistically updates
  // local state so the UI reflects the new stage immediately.
  const [stageSaving,setStageSaving]=useState(null);
  const updateProjectStage=async(p,newStage)=>{
    if(newStage===p.stage) return;
    setStageSaving(p.id);
    try{
      await api.patch("projects",p.id,{stage:newStage});
      setProjects(prev=>prev.map(r=>r.id===p.id?{...r,stage:newStage}:r));
    }catch(e){ alert("Failed to update stage: "+e.message); }
    setStageSaving(null);
  };

  const handleSort=(k)=>{ if(sortKey===k)setSortDir(d=>d==="asc"?"desc":"asc"); else{setSortKey(k);setSortDir("asc");} };

  const filtered=projects
    .filter(p=>!search||p.customer?.toLowerCase().includes(search.toLowerCase()))
    .filter(p=>health==="all"||p.health===health)
    .filter(p=>stage==="all"||p.stage===stage)
    .sort((a,b)=>{ const av=a[sortKey]??"",bv=b[sortKey]??""; return sortDir==="asc"?(av>bv?1:-1):(av<bv?1:-1); });

  const stages=[...new Set(projects.map(p=>p.stage))].filter(Boolean);

  if(!csm && projects.length === 0 && loading) return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:G.muted,fontFamily:"DM Mono,monospace",fontSize:13}}>Loading…</div>
  );

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Sub-tab bar */}
      <div style={{display:"flex",gap:2,padding:"0 24px",borderBottom:"1px solid "+G.border,background:"#0a1420",flexShrink:0}}>
        {[["accounts","My Accounts"],["capacity","My Capacity"]].filter(([k])=>k==="accounts"||csm).map(([k,l])=>(
          <button key={k} onClick={()=>setCTab(k)}
            style={{background:cTab===k?"#0f2036":"none",border:"1px solid "+(cTab===k?G.blue+"44":"transparent"),borderBottom:cTab===k?"2px solid "+G.blue:"2px solid transparent",color:cTab===k?G.blue:G.muted,padding:"8px 16px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"DM Mono,monospace",letterSpacing:"0.05em",marginBottom:-1}}>{l}</button>
        ))}
      </div>
      {cTab==="capacity"&&csm ? (
        <CsmCapacityPanel api={api} csm={csm}/>
      ) : (
    <div style={{flex:1,overflowY:"auto",padding:"18px 24px",animation:"fadein .25s ease"}}>
      {/* KPIs — same sizing rules as the exec strip: full-precision values,
          uniform fontSize, auto-fit grid that gives every card room for an
          8-figure currency without truncating. */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12,marginBottom:14}}>
        {[
          {label:"My Accounts",    value:String(filtered.length),                                 color:G.purple},
          {label:"Total ARR",      value:fmtMill(filtered.reduce((s,p)=>s+(p.arr||0),0)),         color:G.green},
          {label:"Avg Completion", value:filtered.length?Math.round(filtered.reduce((s,p)=>s+(p.completion_pct||0),0)/filtered.length)+"%":"—", color:G.blue},
          {label:"Late Tasks",     value:String(filtered.reduce((s,p)=>s+(p.tasks_late||0),0)),   color:G.red},
        ].map((k,i)=>(
          <div key={i} style={{background:G.surface,border:"1px solid "+G.border,borderRadius:10,padding:"14px 12px",position:"relative",overflow:"hidden",minWidth:0}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:k.color,borderRadius:"10px 10px 0 0"}}/>
            <div style={{fontSize:18,fontWeight:700,color:k.color,lineHeight:1.1,marginTop:6,fontFamily:"DM Mono,monospace",fontVariantNumeric:"tabular-nums",letterSpacing:"-0.02em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={k.value}>{k.value}</div>
            <div style={{fontSize:12,color:G.muted,marginTop:8,fontFamily:"DM Mono,monospace",letterSpacing:"0.05em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{k.label}</div>
          </div>
        ))}
      </div>
      {/* Filters */}
      <div style={{background:"#0a1420",border:"1px solid "+G.border,borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
        <div style={{flex:"1 1 160px"}}>
          <label style={{fontSize:13,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:4}}>SEARCH</label>
          <div style={{position:"relative"}}>
            <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",color:G.muted,fontSize:13}}>⌕</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search accounts…"
              style={{width:"100%",background:G.surface,border:"1px solid "+G.border,color:G.text,padding:"6px 10px 6px 24px",borderRadius:6,fontFamily:"DM Mono,monospace",fontSize:12}}/>
          </div>
        </div>
        <div>
          <label style={{fontSize:13,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:4}}>HEALTH</label>
          <div style={{display:"flex",gap:3}}>
            {["all","green","yellow","red"].map(h=>(
              <button key={h} onClick={()=>setHealth(h)}
                style={{background:health===h?(h==="all"?G.blueBg:HEALTH_COLOR[h]+"22"):"transparent",border:"1px solid "+(health===h?(h==="all"?G.blue:HEALTH_COLOR[h]):G.border),color:health===h?(h==="all"?G.blue:HEALTH_COLOR[h]):G.muted,padding:"5px 9px",borderRadius:5,cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:10}}>
                {h==="all"?"All":h==="green"?"On Track":h==="yellow"?"At Risk":"Critical"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label style={{fontSize:13,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:4}}>STAGE</label>
          <select value={stage} onChange={e=>setStage(e.target.value)}
            style={{background:G.surface,border:"1px solid "+G.border,color:G.text,padding:"6px 10px",borderRadius:6,fontFamily:"DM Mono,monospace",fontSize:11,cursor:"pointer"}}>
            <option value="all">All Stages</option>
            {stages.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div style={{textAlign:"right",fontSize:14,fontFamily:"DM Mono,monospace",color:"#5a7a94",marginBottom:6}}>Click a project name to open the project workspace · click an account to view its profile</div>
      {/* Active projects */}
      <Card style={{overflow:"hidden"}}>
        <div style={{padding:"10px 14px",borderBottom:"1px solid "+G.border,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:15,fontWeight:700,color:G.muted,letterSpacing:"0.05em",fontFamily:"DM Mono,monospace"}}>{csm ? "ACTIVE PROJECTS — "+csm.name.toUpperCase() : "ACTIVE PROJECTS"}</span>
          <span style={{fontSize:14,fontFamily:"DM Mono,monospace",color:"#5a7a94"}}>{filtered.length} project{filtered.length===1?"":"s"}</span>
        </div>
        <div style={{overflowX:"auto"}}>
          {loading?<div style={{padding:40,textAlign:"center",color:G.muted,fontFamily:"DM Mono,monospace"}}>Loading…</div>:(
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:820}}>
              <thead>
                <tr style={{borderBottom:"1px solid "+G.border}}>
                  {[["name","Project"],["customer","Customer"],["stage","Stage"],["health","Health"],["completion_pct","Completion"],["arr","ARR"],["target_date","Target"],["tasks_late","Tasks"]].map(([k,l])=>(
                    <th key={k} onClick={()=>handleSort(k)}
                      style={{padding:"8px 12px",textAlign:"left",fontSize:9,color:sortKey===k?G.text:G.muted,fontFamily:"DM Mono,monospace",fontWeight:500,letterSpacing:"0.07em",whiteSpace:"nowrap",cursor:"pointer"}}>
                      {l.toUpperCase()}{sortKey===k?(sortDir==="asc"?" ↑":" ↓"):""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p,i)=>{
                  const hc=HEALTH_COLOR[p.health]||G.green;
                  return (
                    <tr key={p.id} className="rh" onDoubleClick={()=>onProjectSelect&&onProjectSelect(p)}
                      style={{borderBottom:i<filtered.length-1?"1px solid "+G.faint:"none"}}>
                      <td style={{padding:"10px 12px",fontSize:15,fontWeight:700,maxWidth:240}}>
                        <button onClick={(e)=>{e.stopPropagation();onProjectSelect&&onProjectSelect(p);}}
                          title="Open project workspace"
                          style={{background:"none",border:"none",padding:0,color:G.text,fontWeight:700,fontSize:15,fontFamily:"inherit",cursor:"pointer",textAlign:"left",textDecoration:"underline",textDecorationColor:G.text+"33",textUnderlineOffset:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>
                          {p.name || p.customer || "Untitled Project"}
                        </button>
                      </td>
                      <td style={{padding:"10px 12px",fontSize:14,fontWeight:600}}>
                        <button onClick={(e)=>{e.stopPropagation();openAccountFromProject(p);}}
                          disabled={openingAccount===p.id}
                          style={{background:"none",border:"none",padding:0,color:G.blue,fontWeight:600,fontSize:14,fontFamily:"inherit",cursor:openingAccount===p.id?"wait":"pointer",textAlign:"left",textDecoration:"underline",textDecorationColor:G.blue+"55",textUnderlineOffset:3}}>
                          {p.customer}
                        </button>
                      </td>
                      <td style={{padding:"10px 12px"}} onDoubleClick={e=>e.stopPropagation()}>
                        <select value={p.stage||"Kickoff"} disabled={stageSaving===p.id}
                          onClick={e=>e.stopPropagation()}
                          onChange={e=>updateProjectStage(p,e.target.value)}
                          title="Click to change stage"
                          style={{background:"transparent",border:"1px dashed "+G.border,color:PHASE_COLOR[p.stage]||G.muted,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700,padding:"4px 6px",borderRadius:5,cursor:stageSaving===p.id?"wait":"pointer",opacity:stageSaving===p.id?0.5:1,minWidth:130}}>
                          {PHASE_ORDER.map(s=><option key={s} value={s} style={{background:G.surface,color:G.text}}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{padding:"10px 12px"}}>
                        <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
                          <span style={{width:8,height:8,borderRadius:"50%",background:hc,boxShadow:"0 0 5px "+hc+"66"}}/>
                          <span style={{color:hc,fontFamily:"DM Mono,monospace",fontSize:10,fontWeight:700}}>{p.health_label}</span>
                        </span>
                      </td>
                      <td style={{padding:"10px 12px",minWidth:130}}>
                        <div style={{display:"flex",alignItems:"center",gap:7}}>
                          <div style={{flex:1,height:5,background:G.border,borderRadius:3,overflow:"hidden"}}>
                            <div style={{width:(p.completion_pct||0)+"%",height:"100%",borderRadius:3,background:p.completion_pct>75?G.green:p.completion_pct>40?G.blue:G.yellow}}/>
                          </div>
                          <span style={{fontSize:13,fontFamily:"DM Mono,monospace",color:G.muted,minWidth:28}}>{p.completion_pct||0}%</span>
                        </div>
                      </td>
                      <td style={{padding:"10px 12px",fontSize:14,fontFamily:"DM Mono,monospace",color:G.green,fontWeight:700}}>{fmtArr(p.arr)}</td>
                      <td style={{padding:"10px 12px",fontSize:13,fontFamily:"DM Mono,monospace",color:G.muted}}>{fmtDate(p.target_date)}</td>
                      <td style={{padding:"10px 12px"}}>
                        <div style={{display:"flex",gap:5}}>
                          <span style={{fontSize:14,fontFamily:"DM Mono,monospace",color:G.green}}>{p.tasks_complete||0}✓</span>
                          <span style={{fontSize:14,fontFamily:"DM Mono,monospace",color:G.yellow}}>{p.tasks_upcoming||0}◌</span>
                          {(p.tasks_late||0)>0&&<span style={{fontSize:14,fontFamily:"DM Mono,monospace",color:G.red,fontWeight:800}}>{p.tasks_late}!</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length===0&&<tr><td colSpan={8} style={{padding:40,textAlign:"center",color:"#5a7a94",fontFamily:"DM Mono,monospace"}}>No projects match</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* All accounts — every active customer, regardless of project state. */}
      {(() => {
        const projCount = {};
        for (const p of projects) { if (p.customer_id) projCount[p.customer_id] = (projCount[p.customer_id] || 0) + 1; }
        const accounts = customers
          .filter(c => !search || (c.name || "").toLowerCase().includes(search.toLowerCase())
                                || (c.contact_name || "").toLowerCase().includes(search.toLowerCase())
                                || (c.contact_email || "").toLowerCase().includes(search.toLowerCase()))
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        return (
          <Card style={{overflow:"hidden",marginTop:14}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid "+G.border,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:15,fontWeight:700,color:G.muted,letterSpacing:"0.05em",fontFamily:"DM Mono,monospace"}}>ALL ACCOUNTS</span>
              <span style={{fontSize:14,fontFamily:"DM Mono,monospace",color:"#5a7a94"}}>{accounts.length} account{accounts.length===1?"":"s"}</span>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}>
                <thead>
                  <tr style={{borderBottom:"1px solid "+G.border}}>
                    {["Customer","Contact","Email","Projects"].map(h=>(
                      <th key={h} style={{padding:"8px 12px",textAlign:"left",fontSize:9,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:500,letterSpacing:"0.07em",whiteSpace:"nowrap"}}>{h.toUpperCase()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((c,i)=>(
                    <tr key={c.id} className="rh"
                      style={{borderBottom:i<accounts.length-1?"1px solid "+G.faint:"none",cursor:"pointer"}}
                      onClick={()=>onAccountSelect&&onAccountSelect(c)}>
                      <td style={{padding:"10px 12px",fontSize:15,fontWeight:700,color:G.blue,textDecoration:"underline",textDecorationColor:G.blue+"55",textUnderlineOffset:3}}>{c.name}</td>
                      <td style={{padding:"10px 12px",fontSize:13,fontFamily:"DM Mono,monospace",color:G.text}}>{c.contact_name||<span style={{color:G.faint}}>—</span>}</td>
                      <td style={{padding:"10px 12px",fontSize:12,fontFamily:"DM Mono,monospace",color:G.muted}}>{c.contact_email||"—"}</td>
                      <td style={{padding:"10px 12px",fontSize:14,fontFamily:"DM Mono,monospace",color:G.muted,fontVariantNumeric:"tabular-nums"}}>{projCount[c.id]||0}</td>
                    </tr>
                  ))}
                  {accounts.length===0&&<tr><td colSpan={4} style={{padding:30,textAlign:"center",color:"#5a7a94",fontFamily:"DM Mono,monospace",fontSize:12}}>{customers.length===0?"No customers yet — add one from Configuration → Customers.":"No accounts match your search."}</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })()}

    </div>
      )}
    </div>
  );
}

// ─── LOGIN SCREEN ────────────────────────────────────────────────────────────
function LoginScreen({onConnect}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);

  const login=async()=>{
    if(!username||!password){setError("Both fields are required.");return;}
    setLoading(true);setError("");
    try{
      await authLogin(username, password);
      const api=makeApi();
      const data=await api.get("csms",{"is_active":"eq.true","select":"*"});
      if(!Array.isArray(data)) throw new Error("Unexpected response.");
      onConnect(api,data);
    }catch(e){setError(e.message||"Sign-in failed.");}
    setLoading(false);
  };

  const submitForgot = async () => {
    if (!forgotEmail) { setForgotMsg("Enter the email tied to your account."); return; }
    setForgotBusy(true); setForgotMsg("");
    try {
      const r = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      // Generic message regardless of result — never leak whether an account exists.
      if (!r.ok && r.status !== 404) throw new Error("Request failed.");
    } catch { /* deliberately swallow */ }
    setForgotBusy(false);
    setForgotMsg("If an account exists for that email, an administrator has been notified to reset it.");
  };

  return (
    <div style={{minHeight:"100vh",background:G.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Syne,sans-serif"}}>
      <div style={{width:460,animation:"fadein .4s ease"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:36,justifyContent:"center"}}>
          <Logo size={38}/>
          <div>
            <div style={{fontSize:22,fontWeight:800,color:G.text,letterSpacing:"0.03em"}}>Monument</div>
            <div style={{fontSize:13,color:G.muted,fontFamily:"DM Mono,monospace",letterSpacing:"0.12em"}}>CUSTOMER SUCCESS PLATFORM</div>
          </div>
        </div>
        <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:14,padding:32}}>
          {!forgotOpen ? (
            <>
              <div style={{fontSize:18,fontWeight:700,color:G.text,marginBottom:6}}>Sign In</div>
              <div style={{fontSize:14,color:G.muted,fontFamily:"DM Mono,monospace",marginBottom:26,lineHeight:1.7}}>
                Enter your credentials to continue.
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <div>
                  <label style={{fontSize:13,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:5}}>USERNAME</label>
                  <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Username"
                    autoComplete="username"
                    style={{width:"100%",background:"#080e18",border:"1px solid "+G.border,color:G.text,padding:"12px 14px",borderRadius:8,fontFamily:"DM Mono,monospace",fontSize:14}}/>
                </div>
                <div>
                  <label style={{fontSize:13,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:5}}>PASSWORD</label>
                  <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password"
                    autoComplete="current-password"
                    onKeyDown={e=>{if(e.key==="Enter")login();}}
                    style={{width:"100%",background:"#080e18",border:"1px solid "+G.border,color:G.text,padding:"12px 14px",borderRadius:8,fontFamily:"DM Mono,monospace",fontSize:14}}/>
                </div>
                {error&&<div style={{background:G.redBg,border:"1px solid "+G.red+"44",borderRadius:8,padding:"10px 14px",fontSize:13,color:G.red,fontFamily:"DM Mono,monospace",lineHeight:1.5}}>{error}</div>}
                <button onClick={login} disabled={loading}
                  style={{background:"linear-gradient(135deg,#7c3aed,#a855f7)",border:"none",color:"#fff",padding:"14px",borderRadius:8,cursor:loading?"not-allowed":"pointer",fontSize:15,fontWeight:700,marginTop:4,opacity:loading?0.7:1}}>
                  {loading?"Signing in…":"Sign In →"}
                </button>
                <button type="button" onClick={()=>{setForgotOpen(true);setForgotMsg("");}}
                  style={{background:"transparent",border:"none",color:G.muted,fontSize:13,fontFamily:"DM Mono,monospace",cursor:"pointer",padding:"6px",alignSelf:"center",letterSpacing:"0.06em"}}>
                  Forgot password?
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{fontSize:18,fontWeight:700,color:G.text,marginBottom:6}}>Reset Password</div>
              <div style={{fontSize:14,color:G.muted,fontFamily:"DM Mono,monospace",marginBottom:22,lineHeight:1.7}}>
                Enter the email tied to your account. An administrator will be notified to issue a new password.
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <div>
                  <label style={{fontSize:13,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:5}}>EMAIL</label>
                  <input value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)} placeholder="you@company.com"
                    type="email" autoComplete="email"
                    onKeyDown={e=>{if(e.key==="Enter")submitForgot();}}
                    style={{width:"100%",background:"#080e18",border:"1px solid "+G.border,color:G.text,padding:"12px 14px",borderRadius:8,fontFamily:"DM Mono,monospace",fontSize:14}}/>
                </div>
                {forgotMsg && (
                  <div style={{background:G.surface2,border:"1px solid "+G.border2,borderRadius:8,padding:"10px 14px",fontSize:13,color:G.text,fontFamily:"DM Mono,monospace",lineHeight:1.5}}>
                    {forgotMsg}
                  </div>
                )}
                <button onClick={submitForgot} disabled={forgotBusy}
                  style={{background:"linear-gradient(135deg,#7c3aed,#a855f7)",border:"none",color:"#fff",padding:"14px",borderRadius:8,cursor:forgotBusy?"not-allowed":"pointer",fontSize:15,fontWeight:700,marginTop:4,opacity:forgotBusy?0.7:1}}>
                  {forgotBusy?"Submitting…":"Request Reset"}
                </button>
                <button type="button" onClick={()=>{setForgotOpen(false);setForgotMsg("");}}
                  style={{background:"transparent",border:"none",color:G.muted,fontSize:13,fontFamily:"DM Mono,monospace",cursor:"pointer",padding:"6px",alignSelf:"center",letterSpacing:"0.06em"}}>
                  ← Back to sign in
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [api,        setApi]        = useState(null);
  const [csms,       setCsms]       = useState([]);
  const [role,       setRole]       = useState(() => getSession()?.role || null);
  // Default to consultant for non-admins so a viewer/CSM never lands on a
  // tab the NavBar would have hidden anyway.
  const [view,       setView]       = useState(role === "admin" ? "exec" : "consultant");
  const [activeCsm,  setActiveCsm]  = useState(null);
  const [activeAccount, setActiveAccount] = useState(null);
  const [activeProject, setActiveProject] = useState(null);
  const [lastSync,   setLastSync]   = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleConnect=(client,csmList)=>{
    setApi(client);
    setCsms(csmList);
    setLastSync(new Date().toLocaleTimeString());
    const r = getSession()?.role || null;
    setRole(r);
    if (r !== "admin") setView("consultant");
  };

  const handleLogout=()=>{ authLogout(); setApi(null); setCsms([]); setActiveCsm(null); setActiveAccount(null); setActiveProject(null); setRole(null); setView("exec"); };

  const handleRefresh=()=>{
    setRefreshing(true);
    setRefreshKey(k=>k+1);
    setLastSync(new Date().toLocaleTimeString());
    setTimeout(()=>setRefreshing(false),1200);
  };

  useEffect(()=>{
    // Rehydrate. The access JWT now lives in an HttpOnly cookie that JS can't
    // read, so we ask the server who we are via /api/auth/me. If that 401s
    // we try a one-shot refresh; if that also fails, fall through to the
    // login screen. Legacy bearer tokens still work because authedFetch
    // forwards them when no cookie session is present.
    let cancelled = false;
    (async () => {
      let me = await fetchMe();
      if (!me) {
        const refreshed = await refreshSession();
        if (refreshed) me = await fetchMe();
      }
      if (cancelled || !me) return;
      const api = makeApi();
      try {
        const data = await api.get("csms", { is_active: "eq.true", select: "*" });
        if (Array.isArray(data) && !cancelled) handleConnect(api, data);
      } catch { /* fall through to login */ }
    })();
    return () => { cancelled = true; };
  },[]);

  if(!api) return <><style>{GLOBAL_CSS}</style><LoginScreen onConnect={handleConnect}/></>;

  // Defensive guard: if a non-admin somehow has view=exec/config (e.g. stale
  // state after a role change), drop them to the consultant portal.
  const safeView = role === "admin" ? view : "consultant";

  return (
    <div style={{height:"100vh",background:G.bg,color:G.text,fontFamily:"Syne,sans-serif",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{GLOBAL_CSS}</style>
      <NavBar view={safeView} setView={(v)=>{setActiveAccount(null); setActiveProject(null); setView(v);}} csm={activeCsm} setCsm={setActiveCsm} csms={csms}
        lastSync={lastSync} onRefresh={handleRefresh} refreshing={refreshing} onLogout={handleLogout}
        api={api} onAccountSelect={setActiveAccount} role={role}/>
      {activeProject ? (
        <ProjectPage api={api} projectId={activeProject}
          onClose={()=>setActiveProject(null)}/>
      ) : activeAccount ? (
        <AccountDetail api={api} account={activeAccount}
          onClose={()=>setActiveAccount(null)}
          onUpdated={(c)=>setActiveAccount(c)}/>
      ) : safeView==="exec" ? (
        <ExecDashboard api={api} key={refreshKey}/>
      ) : safeView==="config" ? (
        <ConfigPage api={api} csms={csms} onCsmsChanged={setCsms} key={"config-"+refreshKey}/>
      ) : (
        <ConsultantPortal api={api} csm={activeCsm}
          onAccountSelect={setActiveAccount}
          onProjectSelect={(p)=>setActiveProject(p.id)}
          key={refreshKey+"-"+activeCsm?.id}/>
      )}
    </div>
  );
}
