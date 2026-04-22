import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

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
const fmtArr   = (n) => n!=null ? "$"+(n/1000).toFixed(0)+"K" : "—";
const fmtFull  = (n) => n!=null ? "$"+Number(n).toLocaleString() : "—";
const todayISO = () => new Date().toISOString().split("T")[0];
const pct      = (a,b) => b ? Math.round((a/b)*100) : 0;

// ─── REST API CLIENT ─────────────────────────────────────────────────────────
function makeApi(url, key) {
  const base = url.replace(/\/$/,"") + "/rest/v1";
  const hdrs = {
    "apikey": key,
    "Authorization": "Bearer " + key,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };
  return {
    async get(table, params={}) {
      const qs = Object.entries(params).map(([k,v]) => k + "=" + encodeURIComponent(v)).join("&");
      const url = base + "/" + table + (qs ? "?" + qs : "");
      const res = await fetch(url, { headers: hdrs });
      if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e.message||e.hint||"HTTP "+res.status); }
      return res.json();
    },
    async patch(table, id, body) {
      const res = await fetch(base+"/"+table+"?id=eq."+id,{method:"PATCH",headers:hdrs,body:JSON.stringify(body)});
      if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e.message||e.hint||"HTTP "+res.status); }
      return true;
    },
  };
}

// ─── GLOBAL STYLES ───────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;font-size:14px;}
  html,body,#root{width:100%;max-width:100% !important;overflow-x:hidden;}
  body{background:#060c14;}
  body{background:${G.bg};font-size:14px;}
  ::-webkit-scrollbar{width:4px;height:4px;}
  ::-webkit-scrollbar-track{background:#0a1520;}
  ::-webkit-scrollbar-thumb{background:#1e3346;border-radius:2px;}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes slideup{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
  .rh:hover{background:${G.surface2} !important;cursor:pointer;}
  select,input{outline:none;font-size:13px;}
  button{font-family:Syne,sans-serif;font-size:13px;}
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
function NavBar({view,setView,csm,setCsm,csms,lastSync,onRefresh,refreshing}) {
  return (
    <div style={{borderBottom:"1px solid "+G.border,padding:"0 24px",display:"flex",alignItems:"center",gap:14,height:54,background:"#08111c",flexShrink:0,zIndex:10}}>
      <div style={{display:"flex",alignItems:"center",gap:9}}>
        <Logo size={28}/>
        <div>
          <div style={{fontSize:15,fontWeight:800,letterSpacing:"0.04em",color:G.text,fontFamily:"Syne,sans-serif"}}>Monument</div>
          <div style={{fontSize:13,color:G.muted,fontFamily:"DM Mono,monospace",letterSpacing:"0.1em"}}>PS OPERATIONS</div>
        </div>
      </div>
      <div style={{width:1,height:26,background:G.border}}/>
      {/* View tabs */}
      <div style={{display:"flex",gap:2}}>
        {[["exec","Executive View"],["consultant","Consultant Portal"]].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)}
            style={{background:view===v?"#0f2036":"none",border:"none",color:view===v?G.blue:G.muted,
              padding:"6px 14px",borderRadius:6,cursor:"pointer",fontSize:14,fontWeight:700,letterSpacing:"0.03em"}}>
            {l}
          </button>
        ))}
      </div>
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:12}}>
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
      const sysP = 'You are an expert PS Operations analyst for Monument. Live data: ' + portfolio.length + ' customers, \$' + (totalArr/1000).toFixed(0) + 'K ARR. On Track: ' + portfolio.filter(p=>p.health==='green').length + '. At Risk: ' + portfolio.filter(p=>p.health==='yellow').length + '. Critical: ' + portfolio.filter(p=>p.health==='red').length + '. Late tasks: ' + tasks.filter(t=>t.status==='late').length + '. Customers: ' + portfolio.map(p=>p.customer+': '+p.stage+', '+p.health_label+', '+p.completion_pct+'% done, \$'+(p.arr/1000).toFixed(0)+'K ARR, CSM: '+p.csm+', '+(p.tasks_late||0)+' late tasks').join('; ') + '. CSMs: ' + csms.map(c=>c.csm+': '+c.total_accounts+' accounts, \$'+((c.total_arr||0)/1000).toFixed(0)+'K ARR, '+c.late_tasks+' late tasks').join('; ') + '. Be concise and executive-level in responses.';
      const res = await fetch('/api/claude', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ system:sysP, messages:newMessages }) });
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

// ─── EXECUTIVE DASHBOARD ─────────────────────────────────────────────────────
function ExecDashboard({api}) {
  const [portfolio, setPortfolio] = useState([]);
  const [tasks,     setTasks]     = useState([]);
  const [csms,      setCsms]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [selProject,setSelProject]= useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [port, tsk, csmData] = await Promise.all([
        api.get("vw_portfolio", {"select":"*"}),
        api.get("tasks", {"select":"*", "order":"proj_date.asc"}),
        api.get("vw_csm_scorecard", {"select":"*"}),
      ]);
      setPortfolio(port||[]);
      setTasks(tsk||[]);
      setCsms(csmData||[]);
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
  const totalArr     = portfolio.reduce((s,p)=>s+(p.arr||0),0);
  const arrAtRisk    = portfolio.filter(p=>p.health!=="green").reduce((s,p)=>s+(p.arr||0),0);
  const arrCritical  = portfolio.filter(p=>p.health==="red").reduce((s,p)=>s+(p.arr||0),0);
  const onTrack      = portfolio.filter(p=>p.health==="green").length;
  const atRisk       = portfolio.filter(p=>p.health==="yellow").length;
  const critical     = portfolio.filter(p=>p.health==="red").length;
  const avgCompl     = portfolio.length ? Math.round(portfolio.reduce((s,p)=>s+(p.completion_pct||0),0)/portfolio.length) : 0;
  const totalLate    = tasks.filter(t=>t.status==="late").length;
  const totalComplete= tasks.filter(t=>t.status==="complete").length;
  const totalUpcoming= tasks.filter(t=>t.status==="upcoming").length;
  const criticalLate = tasks.filter(t=>t.status==="late"&&t.priority==="critical").length;
  const goLivesSoon  = portfolio.filter(p=>p.stage==="Go-Live Prep"||p.stage==="Go-Live");

  // ── Chart data ──
  const healthData = [
    {name:"On Track",value:onTrack,color:G.green},
    {name:"At Risk", value:atRisk, color:G.yellow},
    {name:"Critical",value:critical,color:G.red},
  ];

  const stageData = PHASE_ORDER.map(ph=>({
    name:ph.length>12?ph.split(" ")[0]:ph,
    fullName:ph,
    count:portfolio.filter(p=>p.stage===ph).length,
    arr:Math.round(portfolio.filter(p=>p.stage===ph).reduce((s,p)=>s+(p.arr||0),0)/1000),
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
    {range:"$20-40K",value:portfolio.filter(p=>p.arr<40000).length,color:"#6366f1"},
    {range:"$40-60K",value:portfolio.filter(p=>p.arr>=40000&&p.arr<60000).length,color:"#3b82f6"},
    {range:"$60-80K",value:portfolio.filter(p=>p.arr>=60000&&p.arr<80000).length,color:"#06b6d4"},
    {range:"$80-100K",value:portfolio.filter(p=>p.arr>=80000).length,color:"#22c55e"},
  ];

  const taskStatusData = [
    {name:"Complete",value:totalComplete,color:G.green},
    {name:"Upcoming",value:totalUpcoming,color:G.yellow},
    {name:"Late",value:totalLate,color:G.red},
  ];

  // Late tasks grouped by project
  const lateTasks = tasks.filter(t=>t.status==="late")
    .map(t=>({...t,project:portfolio.find(p=>p.id===t.project_id)}))
    .filter(t=>t.project)
    .sort((a,b)=>new Date(a.proj_date)-new Date(b.proj_date))
    .slice(0,12);

  // Upcoming go-lives
  const upcomingGoLives = portfolio
    .filter(p=>["Go-Live Prep","Go-Live"].includes(p.stage))
    .sort((a,b)=>new Date(a.target_date)-new Date(b.target_date));

  return (
    <div style={{flex:1,display:"flex",overflow:"hidden"}}><div style={{flex:1,overflowY:"auto",padding:"18px 24px",animation:"fadein .3s ease"}}>

      {/* ── SECTION: KPI Strip ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:10,marginBottom:16}}>
        {[
          {label:"Total Customers",    value:portfolio.length,          sub:"active implementations", color:G.purple},
          {label:"Total ARR",          value:fmtArr(totalArr),          sub:fmtFull(totalArr),         color:G.green},
          {label:"ARR at Risk",        value:fmtArr(arrAtRisk),         sub:atRisk+" at risk  "+critical+" critical", color:G.yellow},
          {label:"ARR Critical",       value:fmtArr(arrCritical),       sub:critical+" red accounts",  color:G.red},
          {label:"Avg Completion",     value:avgCompl+"%",              sub:"across portfolio",        color:G.blue},
          {label:"Late Tasks",         value:totalLate,                 sub:criticalLate+" critical priority", color:G.red},
          {label:"Go-Live This Month", value:goLivesSoon.length,        sub:"in prep or live now",     color:G.teal},
        ].map((k,i)=>(
          <div key={i} style={{background:G.surface,border:"1px solid "+G.border,borderRadius:10,padding:"12px 14px",position:"relative",overflow:"hidden",animation:"slideup .3s ease "+(i*0.05)+"s both"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:k.color,borderRadius:"10px 10px 0 0"}}/>
            <div style={{fontSize:26,fontWeight:800,color:k.color,lineHeight:1,marginTop:4,fontFamily:"Syne,sans-serif"}}>{k.value}</div>
            <div style={{fontSize:13,color:G.muted,marginTop:5,fontFamily:"DM Mono,monospace",letterSpacing:"0.05em"}}>{k.label}</div>
            <div style={{fontSize:9,color:"#5a7a94",marginTop:2,fontFamily:"DM Mono,monospace"}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── SECTION: Charts Row 1 ── */}
      <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 1fr 1fr",gap:12,marginBottom:12}}>

        {/* Stage pipeline */}
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

        {/* Health donut */}
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

        {/* Task status donut */}
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

        {/* ARR buckets */}
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
      </div>

      {/* ── SECTION: Charts Row 2 ── */}
      <div style={{display:"grid",gridTemplateColumns:"1.4fr 1fr",gap:12,marginBottom:12}}>

        {/* CSM Scorecard bar */}
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

        {/* CSM Detail table */}
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
      </div>

      {/* ── SECTION: Tables Row ── */}
      <div style={{display:"grid",gridTemplateColumns:"1.3fr 1fr",gap:12,marginBottom:12}}>

        {/* Late tasks escalation */}
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

        {/* Upcoming Go-Lives + At Risk */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {/* Upcoming go-lives */}
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

          {/* Critical health accounts */}
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
        </div>
      </div>

      {/* ── SECTION: Full Portfolio Table ── */}
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
    </div>
    <AiPanel portfolio={portfolio} tasks={tasks} csms={csms} />
    </div>
  );
}

// ─── CONSULTANT PORTAL ───────────────────────────────────────────────────────
function TaskModal({project,api,onClose,onUpdated}) {
  const [tasks,     setTasks]   = useState([]);
  const [loading,   setLoading] = useState(true);
  const [saving,    setSaving]  = useState(null);
  const [editing,   setEditing] = useState(null);
  const [phase,     setPhase]   = useState("all");
  const [toast,     setToast]   = useState(null);

  const load = useCallback(async()=>{
    setLoading(true);
    try { const d=await api.get("tasks",{"project_id":"eq."+project.id,"order":"proj_date.asc","select":"*"}); setTasks(d||[]); }
    catch(e){ showToast("Load failed: "+e.message,"error"); }
    setLoading(false);
  },[project.id]);

  useEffect(()=>{ load(); },[load]);

  const showToast=(msg,type="success")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),2500); };

  const markComplete=async(task)=>{
    if(task.status==="complete") return;
    setSaving(task.id);
    try{
      await api.patch("tasks", task.id, { actual_date: todayISO(), status: "complete" });
      setTasks(p=>p.map(t=>t.id===task.id?{...t,actual_date:todayISO(),status:"complete"}:t));
      showToast("✓ Task marked complete!"); onUpdated();
    } catch(e){ showToast("Failed: "+e.message,"error"); }
    setSaving(null);
  };

  const saveEdit=async(task,field,value)=>{
    setSaving(task.id);
    try{
      await api.patch("tasks",task.id,{[field]:value||null});
      setTasks(p=>p.map(t=>t.id===task.id?{...t,[field]:value||null}:t));
      showToast("✓ Updated!"); onUpdated();
    } catch(e){ showToast("Failed: "+e.message,"error"); }
    setEditing(null); setSaving(null);
  };

  const shown=phase==="all"?tasks:tasks.filter(t=>t.phase===phase);
  const phases=PHASE_ORDER.filter(ph=>tasks.some(t=>t.phase===ph));
  const stats={ complete:tasks.filter(t=>t.status==="complete").length, upcoming:tasks.filter(t=>t.status==="upcoming").length, late:tasks.filter(t=>t.status==="late").length };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      {toast&&<div style={{position:"fixed",top:20,right:20,zIndex:1001,background:toast.type==="error"?G.redBg:G.greenBg,border:"1px solid "+(toast.type==="error"?G.red:G.green)+"55",borderRadius:8,padding:"10px 18px",fontFamily:"DM Mono,monospace",fontSize:12,color:toast.type==="error"?G.red:G.green}}>{toast.msg}</div>}
      <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:16,width:"100%",maxWidth:1020,maxHeight:"92vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* Header */}
        <div style={{padding:"15px 22px",borderBottom:"1px solid "+G.border,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <div style={{width:11,height:11,borderRadius:"50%",background:HEALTH_COLOR[project.health]||G.green,boxShadow:"0 0 8px "+(HEALTH_COLOR[project.health]||G.green)+"88"}}/>
          <div style={{flex:1}}>
            <div style={{fontSize:19,fontWeight:800,color:G.text,fontFamily:"Syne,sans-serif"}}>{project.customer}</div>
            <div style={{fontSize:13,color:G.muted,fontFamily:"DM Mono,monospace",marginTop:2}}>{project.csm} · {project.stage} · {fmtArr(project.arr)} ARR · Target {fmtDate(project.target_date)}</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            {[["complete","Complete"],["upcoming","Upcoming"],["late","Late"]].map(([s,l])=>(
              <div key={s} style={{background:STATUS_CFG[s].bg,border:"1px solid "+STATUS_CFG[s].bd,borderRadius:8,padding:"5px 14px",textAlign:"center"}}>
                <div style={{fontSize:20,fontWeight:800,color:STATUS_CFG[s].color,lineHeight:1,fontFamily:"Syne,sans-serif"}}>{stats[s]}</div>
                <div style={{fontSize:13,fontFamily:"DM Mono,monospace",color:STATUS_CFG[s].color,opacity:0.8,marginTop:2}}>{l.toUpperCase()}</div>
              </div>
            ))}
          </div>
          <button onClick={onClose} style={{background:"none",border:"1px solid "+G.border,color:G.muted,width:30,height:30,borderRadius:8,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
        {/* Progress */}
        <div style={{padding:"8px 22px",borderBottom:"1px solid "+G.border,display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <div style={{flex:1,height:7,background:G.border,borderRadius:4,overflow:"hidden"}}>
            <div style={{width:tasks.length?(stats.complete/tasks.length*100)+"%":"0%",height:"100%",background:"linear-gradient(90deg,"+G.green+","+G.green+"88)",borderRadius:4,transition:"width .6s"}}/>
          </div>
          <span style={{fontSize:14,fontFamily:"DM Mono,monospace",color:G.green,fontWeight:700}}>{tasks.length?Math.round(stats.complete/tasks.length*100):0}% done</span>
        </div>
        {/* Phase tabs */}
        <div style={{padding:"8px 22px 0",borderBottom:"1px solid "+G.border,display:"flex",gap:3,flexWrap:"wrap",flexShrink:0}}>
          {["all",...phases].map(ph=>{
            const n=ph==="all"?tasks.length:tasks.filter(t=>t.phase===ph).length;
            const late=ph==="all"?stats.late:tasks.filter(t=>t.phase===ph&&t.status==="late").length;
            return (
              <button key={ph} onClick={()=>setPhase(ph)}
                style={{background:phase===ph?"#0f2036":"none",border:"1px solid "+(phase===ph?G.blue:"transparent"),color:phase===ph?G.blue:G.muted,padding:"5px 12px",borderRadius:"6px 6px 0 0",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:10,fontWeight:600,marginBottom:-1,display:"flex",alignItems:"center",gap:5}}>
                {ph==="all"?"All Phases":ph}
                <span style={{background:late>0?G.redBg:G.border,color:late>0?G.red:G.muted,borderRadius:4,padding:"1px 5px",fontSize:9}}>{n}</span>
              </button>
            );
          })}
        </div>
        {/* Tasks */}
        <div style={{overflowY:"auto",flex:1}}>
          {loading?<div style={{padding:60,textAlign:"center",color:G.muted,fontFamily:"DM Mono,monospace"}}>Loading tasks…</div>:(
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead style={{position:"sticky",top:0,background:G.surface,zIndex:1}}>
                <tr style={{borderBottom:"1px solid "+G.border}}>
                  <th style={{width:44,padding:"9px 8px 9px 18px"}}></th>
                  {["Task","Phase","Assignee","Projected Date","Actual Date","Variance","Priority","Status"].map(h=>(
                    <th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:13,color:G.muted,fontFamily:"DM Mono,monospace",fontWeight:500,letterSpacing:"0.07em",whiteSpace:"nowrap"}}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((task,i)=>{
                  const sc=STATUS_CFG[task.status]||STATUS_CFG.upcoming;
                  const variance=task.actual_date?Math.round((new Date(task.actual_date)-new Date(task.proj_date))/86400000):task.status==="late"?Math.round((new Date()-new Date(task.proj_date))/86400000):null;
                  const isProjEdit=editing?.id===task.id&&editing?.field==="proj_date";
                  const isActEdit=editing?.id===task.id&&editing?.field==="actual_date";
                  const isSaving=saving===task.id;
                  return (
                    <tr key={task.id} style={{borderBottom:i<shown.length-1?"1px solid #0c1828":"none",background:task.status==="late"?"#120400":i%2===1?G.surface2:"transparent",opacity:isSaving?0.6:1,transition:"opacity .2s"}}>
                      <td style={{padding:"10px 8px 10px 18px",textAlign:"center"}}>
                        <div onClick={()=>!isSaving&&markComplete(task)}
                          style={{width:20,height:20,borderRadius:5,border:"2px solid "+(task.status==="complete"?G.green:G.border2),background:task.status==="complete"?G.green:"transparent",cursor:task.status==="complete"?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}>
                          {task.status==="complete"&&<span style={{color:"#fff",fontSize:11,fontWeight:800}}>✓</span>}
                        </div>
                      </td>
                      <td style={{padding:"10px 12px",maxWidth:220}}>
                        <div style={{display:"flex",alignItems:"flex-start",gap:7}}>
                          <span style={{width:8,height:8,borderRadius:"50%",background:sc.color,flexShrink:0,marginTop:3,boxShadow:task.status!=="upcoming"?"0 0 5px "+sc.color+"88":"none"}}/>
                          <span style={{fontSize:13,fontWeight:600,color:task.status==="complete"?G.muted:G.text,textDecoration:task.status==="complete"?"line-through":"none",lineHeight:1.4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{task.name}</span>
                        </div>
                        {task.notes&&<div style={{fontSize:9,color:"#5a7a94",fontFamily:"DM Mono,monospace",marginTop:2,marginLeft:15,lineHeight:1.4}}>{task.notes.slice(0,70)}{task.notes.length>70?"…":""}</div>}
                      </td>
                      <td style={{padding:"10px 12px",fontSize:14,fontFamily:"DM Mono,monospace",color:"#5a7a94",whiteSpace:"nowrap"}}>{task.phase}</td>
                      <td style={{padding:"10px 12px",fontSize:13,color:G.muted,whiteSpace:"nowrap"}}>{task.assignee_name||task.assignee_type||"—"}</td>
                      <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                        {isProjEdit?(
                          <input type="date" defaultValue={task.proj_date} autoFocus
                            onBlur={e=>saveEdit(task,"proj_date",e.target.value)}
                            onKeyDown={e=>{if(e.key==="Enter")saveEdit(task,"proj_date",e.target.value);if(e.key==="Escape")setEditing(null);}}
                            style={{background:G.bg,border:"1px solid "+G.blue,color:G.text,padding:"4px 8px",borderRadius:5,fontFamily:"DM Mono,monospace",fontSize:12}}/>
                        ):(
                          <div onClick={()=>setEditing({id:task.id,field:"proj_date"})}
                            style={{cursor:"pointer",fontSize:14,fontFamily:"DM Mono,monospace",color:task.status==="late"?G.red:G.muted,borderBottom:"1px dashed "+G.border,display:"inline-block",padding:"2px 4px"}}
                            title="Click to edit">
                            {fmtDate(task.proj_date)} ✎
                          </div>
                        )}
                      </td>
                      <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                        {isActEdit?(
                          <input type="date" defaultValue={task.actual_date||""} autoFocus
                            onBlur={e=>saveEdit(task,"actual_date",e.target.value)}
                            onKeyDown={e=>{if(e.key==="Enter")saveEdit(task,"actual_date",e.target.value);if(e.key==="Escape")setEditing(null);}}
                            style={{background:G.bg,border:"1px solid "+G.green,color:G.text,padding:"4px 8px",borderRadius:5,fontFamily:"DM Mono,monospace",fontSize:12}}/>
                        ):(
                          <div onClick={()=>setEditing({id:task.id,field:"actual_date"})}
                            style={{cursor:"pointer",fontSize:14,fontFamily:"DM Mono,monospace",color:task.actual_date?(variance>0?G.red:variance<0?G.green:G.muted):G.faint,borderBottom:"1px dashed "+G.border,display:"inline-block",padding:"2px 4px"}}
                            title="Click to set actual date">
                            {task.actual_date?fmtDate(task.actual_date)+" ✎":"+ Set date"}
                          </div>
                        )}
                      </td>
                      <td style={{padding:"10px 12px",fontFamily:"DM Mono,monospace",fontSize:12,whiteSpace:"nowrap"}}>
                        {variance!=null?<span style={{color:variance>2?G.red:variance<0?G.green:G.muted,fontWeight:700}}>{variance>0?"+"+variance+"d":variance<0?variance+"d":"On time"}</span>:"—"}
                      </td>
                      <td style={{padding:"10px 12px"}}>
                        <span style={{color:PRIORITY_COLOR[task.priority]||G.muted,fontFamily:"DM Mono,monospace",fontSize:10,fontWeight:700,letterSpacing:"0.08em"}}>{(task.priority||"").toUpperCase()}</span>
                      </td>
                      <td style={{padding:"10px 12px"}}><Badge status={task.status}/></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {/* Footer */}
        <div style={{padding:"9px 22px",borderTop:"1px solid "+G.border,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <span style={{fontSize:14,fontFamily:"DM Mono,monospace",color:"#5a7a94"}}>{shown.length} tasks · Click checkbox to complete · Click date to edit</span>
          <div style={{display:"flex",gap:12,fontSize:14,fontFamily:"DM Mono,monospace"}}>
            <span style={{color:G.green}}>● Complete</span><span style={{color:G.yellow}}>● Upcoming</span><span style={{color:G.red}}>● Late</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConsultantPortal({api,csm}) {
  const [projects, setProjects] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);
  const [search,   setSearch]   = useState("");
  const [health,   setHealth]   = useState("all");
  const [stage,    setStage]    = useState("all");
  const [sortKey,  setSortKey]  = useState("customer");
  const [sortDir,  setSortDir]  = useState("asc");

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const params = csm
        ? {"select":"*","csm":"eq."+csm.name}
        : {"select":"*"};
      const d=await api.get("vw_portfolio",params);
      setProjects(d||[]);
    }catch(e){console.error(e);}
    setLoading(false);
  },[api,csm]);

  useEffect(()=>{load();},[load]);

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
    <div style={{flex:1,overflowY:"auto",padding:"18px 24px",animation:"fadein .25s ease"}}>
      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
        {[
          {label:"My Accounts",    value:filtered.length,                                         color:G.purple},
          {label:"Total ARR",      value:fmtArr(filtered.reduce((s,p)=>s+(p.arr||0),0)),          color:G.green},
          {label:"Avg Completion", value:filtered.length?Math.round(filtered.reduce((s,p)=>s+(p.completion_pct||0),0)/filtered.length)+"%":"—", color:G.blue},
          {label:"Late Tasks",     value:filtered.reduce((s,p)=>s+(p.tasks_late||0),0),           color:G.red},
        ].map((k,i)=>(
          <div key={i} style={{background:G.surface,border:"1px solid "+G.border,borderRadius:10,padding:"12px 16px",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:k.color,borderRadius:"10px 10px 0 0"}}/>
            <div style={{fontSize:26,fontWeight:800,color:k.color,lineHeight:1,marginTop:4,fontFamily:"Syne,sans-serif"}}>{k.value}</div>
            <div style={{fontSize:13,color:G.muted,marginTop:4,fontFamily:"DM Mono,monospace"}}>{k.label}</div>
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
      <div style={{textAlign:"right",fontSize:14,fontFamily:"DM Mono,monospace",color:"#5a7a94",marginBottom:6}}>Double-click any row to manage tasks</div>
      {/* Table */}
      <Card style={{overflow:"hidden"}}>
        <div style={{padding:"10px 14px",borderBottom:"1px solid "+G.border,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:15,fontWeight:700,color:G.muted,letterSpacing:"0.05em",fontFamily:"DM Mono,monospace"}}>{csm ? "ACCOUNTS — "+csm.name.toUpperCase() : "ALL ACCOUNTS"}</span>
          <span style={{fontSize:14,fontFamily:"DM Mono,monospace",color:"#5a7a94"}}>{filtered.length} accounts</span>
        </div>
        <div style={{overflowX:"auto"}}>
          {loading?<div style={{padding:40,textAlign:"center",color:G.muted,fontFamily:"DM Mono,monospace"}}>Loading…</div>:(
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}>
              <thead>
                <tr style={{borderBottom:"1px solid "+G.border}}>
                  {[["customer","Customer"],["stage","Stage"],["health","Health"],["completion_pct","Completion"],["arr","ARR"],["target_date","Target"],["tasks_late","Tasks"]].map(([k,l])=>(
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
                    <tr key={p.id} className="rh" onDoubleClick={()=>setSelected(p)}
                      style={{borderBottom:i<filtered.length-1?"1px solid "+G.faint:"none"}}>
                      <td style={{padding:"10px 12px",fontSize:15,fontWeight:700}}>{p.customer}</td>
                      <td style={{padding:"10px 12px",fontSize:11,color:PHASE_COLOR[p.stage]||G.muted,fontFamily:"DM Mono,monospace"}}>{p.stage}</td>
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
                {filtered.length===0&&<tr><td colSpan={7} style={{padding:40,textAlign:"center",color:"#5a7a94",fontFamily:"DM Mono,monospace"}}>No accounts match</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      {selected&&<TaskModal project={selected} api={api} onClose={()=>setSelected(null)} onUpdated={load}/>}
    </div>
  );
}

// ─── SETUP SCREEN ────────────────────────────────────────────────────────────
function SetupScreen({onConnect}) {
  const [url,     setUrl]     = useState(localStorage.getItem("sb_url")||"");
  const [key,     setKey]     = useState(localStorage.getItem("sb_key")||"");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const connect=async()=>{
    if(!url||!key){setError("Both fields are required.");return;}
    setLoading(true);setError("");
    try{
      const api=makeApi(url.trim(),key.trim());
      const data=await api.get("csms",{"is_active":"eq.true","select":"*"});
      if(!Array.isArray(data)) throw new Error("Unexpected response — check your credentials.");
      localStorage.setItem("sb_url",url.trim());
      localStorage.setItem("sb_key",key.trim());
      onConnect(api,data);
    }catch(e){setError("Connection failed: "+e.message);}
    setLoading(false);
  };

  return (
    <div style={{minHeight:"100vh",background:G.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Syne,sans-serif"}}>
      <div style={{width:460,animation:"fadein .4s ease"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:36,justifyContent:"center"}}>
          <Logo size={38}/>
          <div>
            <div style={{fontSize:20,fontWeight:800,color:G.text,letterSpacing:"0.03em"}}>Monument</div>
            <div style={{fontSize:12,color:G.muted,fontFamily:"DM Mono,monospace",letterSpacing:"0.12em"}}>PS OPERATIONS PLATFORM</div>
          </div>
        </div>
        <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:14,padding:32}}>
          <div style={{fontSize:16,fontWeight:700,color:G.text,marginBottom:6}}>Connect to Supabase</div>
          <div style={{fontSize:13,color:G.muted,fontFamily:"DM Mono,monospace",marginBottom:26,lineHeight:1.7}}>
            URL: Supabase → Settings → General<br/>
            Key: Settings → API Keys → Legacy → service_role
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div>
              <label style={{fontSize:14,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:5}}>PROJECT URL</label>
              <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://xxxx.supabase.co"
                style={{width:"100%",background:"#080e18",border:"1px solid "+G.border,color:G.text,padding:"10px 14px",borderRadius:8,fontFamily:"DM Mono,monospace",fontSize:12}}/>
            </div>
            <div>
              <label style={{fontSize:14,fontFamily:"DM Mono,monospace",color:G.muted,letterSpacing:"0.1em",display:"block",marginBottom:5}}>SERVICE ROLE KEY</label>
              <input value={key} onChange={e=>setKey(e.target.value)} type="password" placeholder="eyJ…"
                style={{width:"100%",background:"#080e18",border:"1px solid "+G.border,color:G.text,padding:"10px 14px",borderRadius:8,fontFamily:"DM Mono,monospace",fontSize:12}}/>
              <div style={{fontSize:10,color:"#5a7a94",fontFamily:"DM Mono,monospace",marginTop:4}}>Use service_role key — bypasses auth for demo</div>
            </div>
            {error&&<div style={{background:G.redBg,border:"1px solid "+G.red+"44",borderRadius:8,padding:"10px 14px",fontSize:12,color:G.red,fontFamily:"DM Mono,monospace",lineHeight:1.5}}>{error}</div>}
            <button onClick={connect} disabled={loading}
              style={{background:"linear-gradient(135deg,#7c3aed,#a855f7)",border:"none",color:"#fff",padding:"13px",borderRadius:8,cursor:loading?"not-allowed":"pointer",fontSize:14,fontWeight:700,marginTop:4,opacity:loading?0.7:1}}>
              {loading?"Connecting…":"Connect →"}
            </button>
          </div>
        </div>
        <div style={{textAlign:"center",fontSize:14,fontFamily:"DM Mono,monospace",color:"#5a7a94",marginTop:14}}>Credentials saved locally · Never transmitted</div>
      </div>
    </div>
  );
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [api,        setApi]        = useState(null);
  const [csms,       setCsms]       = useState([]);
  const [view,       setView]       = useState("exec");
  const [activeCsm,  setActiveCsm]  = useState(null);
  const [lastSync,   setLastSync]   = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleConnect=(client,csmList)=>{ setApi(client); setCsms(csmList); setLastSync(new Date().toLocaleTimeString()); };

  const handleRefresh=()=>{
    setRefreshing(true);
    setRefreshKey(k=>k+1);
    setLastSync(new Date().toLocaleTimeString());
    setTimeout(()=>setRefreshing(false),1200);
  };

  if(!api) return <><style>{GLOBAL_CSS}</style><SetupScreen onConnect={handleConnect}/></>;

  return (
    <div style={{minHeight:"100vh",background:G.bg,color:G.text,fontFamily:"Syne,sans-serif",display:"flex",flexDirection:"column"}}>
      <style>{GLOBAL_CSS}</style>
      <NavBar view={view} setView={setView} csm={activeCsm} setCsm={setActiveCsm} csms={csms}
        lastSync={lastSync} onRefresh={handleRefresh} refreshing={refreshing}/>
      {view==="exec"
        ? <ExecDashboard api={api} key={refreshKey}/>
        : <ConsultantPortal api={api} csm={activeCsm} key={refreshKey+"-"+activeCsm?.id}/>}
    </div>
  );
}
