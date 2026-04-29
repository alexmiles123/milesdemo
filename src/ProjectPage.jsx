// Full-page project detail view — the PSA workspace for a single project.
//
// Replaces the old TaskModal popup with a proper page. Five tabs:
//   • Overview — KPIs, stage stepper, health, ARR, target, charts
//   • Tasks    — full inline-editable task list with phase filters + add row
//   • Timeline — custom SVG Gantt, tasks plotted across time, phase markers
//   • Notes    — chronological log of CSM commentary, optionally tied to a task
//   • Files    — attachments scoped to the project, optionally a phase or task
//
// Wired into App.jsx via `activeProject` state, mirroring the activeAccount
// flow: when set, the App swaps the consultant portal for this page; the
// onClose callback clears it. No router needed.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { authedFetch } from "./lib/auth.js";
import { G, PHASE_ORDER, fmtDate, fmtArr } from "./lib/theme.js";

// Mirror App.jsx — these aren't exported from theme.js so we duplicate the
// short maps locally rather than reach into another module.
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
const todayISO = () => new Date().toISOString().split("T")[0];

const TABS = [
  { id:"overview", label:"Overview" },
  { id:"tasks",    label:"Tasks" },
  { id:"timeline", label:"Timeline" },
  { id:"notes",    label:"Notes" },
  { id:"files",    label:"Files" },
];

// Tiny toast helper — same UX as TaskModal but local to this file.
function useToast() {
  const [toast, setToast] = useState(null);
  const show = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };
  return [toast, show];
}

export default function ProjectPage({ api, projectId, onClose }) {
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [savingProject, setSavingProject] = useState(null);
  const [editingProj, setEditingProj] = useState(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [proj, tk, nt, fl] = await Promise.all([
        api.get("projects", { id: "eq." + projectId, select: "*", limit: "1" }),
        api.get("tasks", { project_id: "eq." + projectId, order: "proj_date.asc", select: "*" }),
        api.get("project_notes", { project_id: "eq." + projectId, order: "created_at.desc", select: "*" }).catch(() => []),
        api.get("project_attachments", { project_id: "eq." + projectId, order: "created_at.desc", select: "*" }).catch(() => []),
      ]);
      setProject(Array.isArray(proj) ? proj[0] : proj);
      setTasks(tk || []);
      setNotes(nt || []);
      setFiles(fl || []);
    } catch (e) {
      showToast("Load failed: " + e.message, "error");
    }
    setLoading(false);
  }, [api, projectId]);

  useEffect(() => { load(); }, [load]);

  // ── PROJECT EDITS ────────────────────────────────────────────────────────
  const saveProjectField = async (field, value) => {
    setSavingProject(field);
    try {
      await api.patch("projects", project.id, { [field]: value });
      setProject(p => ({ ...p, [field]: value }));
      showToast("✓ " + field.replace("_", " ") + " updated");
    } catch (e) {
      showToast("Failed: " + e.message, "error");
    }
    setSavingProject(null);
    setEditingProj(null);
  };

  const cycleHealth = () => {
    if (savingProject) return;
    const order = ["green","yellow","red"];
    const next = order[(order.indexOf(project.health) + 1) % order.length];
    saveProjectField("health", next);
  };

  const setStage = (newStage) => {
    if (savingProject || newStage === project.stage) return;
    saveProjectField("stage", newStage);
  };

  const advanceStage = () => {
    const idx = PHASE_ORDER.indexOf(project.stage);
    if (idx < 0 || idx >= PHASE_ORDER.length - 1) return;
    setStage(PHASE_ORDER[idx + 1]);
  };

  // ── TASK EDITS (used by Tasks tab) ───────────────────────────────────────
  const taskHandlers = useTaskHandlers(api, tasks, setTasks, showToast);

  // ── NOTE / FILE handlers (used by their tabs) ────────────────────────────
  const noteHandlers = useNoteHandlers(api, project, notes, setNotes, showToast);
  const fileHandlers = useFileHandlers(project, files, setFiles, showToast);

  // ── DERIVED ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    complete: tasks.filter(t => t.status === "complete").length,
    upcoming: tasks.filter(t => t.status === "upcoming").length,
    late:     tasks.filter(t => t.status === "late").length,
  }), [tasks]);

  if (loading || !project) {
    return (
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:G.muted,fontFamily:"Inter,system-ui,sans-serif",fontSize:13}}>
        Loading project…
      </div>
    );
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",animation:"fadein .25s ease"}}>
      {toast && (
        <div style={{position:"fixed",top:74,right:24,zIndex:60,background:toast.type==="error"?G.redBg:G.greenBg,border:"1px solid "+(toast.type==="error"?G.red:G.green)+"55",borderRadius:8,padding:"10px 18px",fontFamily:"Inter,system-ui,sans-serif",fontSize:12,color:toast.type==="error"?G.red:G.green}}>
          {toast.msg}
        </div>
      )}

      <ProjectHeader
        project={project}
        savingProject={savingProject}
        editingProj={editingProj}
        setEditingProj={setEditingProj}
        cycleHealth={cycleHealth}
        saveProjectField={saveProjectField}
        stats={stats}
        taskCount={tasks.length}
        onClose={onClose}
      />

      <div style={{display:"flex",gap:0,padding:"0 24px",borderBottom:"1px solid "+G.border,background:G.surface,flexShrink:0}}>
        {TABS.map(t => {
          const active = tab === t.id;
          const counts = { tasks: tasks.length, notes: notes.length, files: files.length };
          const count = counts[t.id];
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                background:"none",border:"none",
                color:active?G.text:G.muted,
                padding:"12px 18px",cursor:"pointer",fontSize:13,
                fontWeight:active?600:500,letterSpacing:"0",
                borderBottom:active?"2px solid "+G.purple:"2px solid transparent",
                marginBottom:-1,display:"inline-flex",alignItems:"center",gap:6,
              }}>
              {t.label}
              {count > 0 && (
                <span style={{
                  background:active?G.purple+"1a":G.surface2,
                  color:active?G.purple:G.muted,
                  borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:600,
                  fontFamily:"Inter,system-ui,sans-serif",
                }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{flex:1,overflowY:"auto"}}>
        {tab === "overview" && (
          <OverviewTab
            project={project}
            tasks={tasks}
            stats={stats}
            savingProject={savingProject}
            setStage={setStage}
            advanceStage={advanceStage}
            recentNotes={notes.slice(0, 3)}
            fileCount={files.length}
          />
        )}
        {tab === "tasks" && (
          <TasksTab
            project={project}
            tasks={tasks}
            handlers={taskHandlers}
          />
        )}
        {tab === "timeline" && (
          <TimelineTab project={project} tasks={tasks} />
        )}
        {tab === "notes" && (
          <NotesTab notes={notes} tasks={tasks} handlers={noteHandlers} />
        )}
        {tab === "files" && (
          <FilesTab files={files} tasks={tasks} handlers={fileHandlers} />
        )}
      </div>
    </div>
  );
}

// ─── HEADER ──────────────────────────────────────────────────────────────────
function ProjectHeader({ project, savingProject, editingProj, setEditingProj, cycleHealth, saveProjectField, stats, taskCount, onClose }) {
  const completionPct = taskCount ? Math.round((stats.complete / taskCount) * 100) : 0;
  return (
    <div style={{padding:"16px 24px",borderBottom:"1px solid "+G.border,background:G.surface,flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:14}}>
        <button onClick={onClose}
          title="Back to portfolio"
          style={{background:"transparent",border:"1px solid "+G.border,color:G.muted,padding:"6px 12px",borderRadius:6,cursor:"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
          ← BACK
        </button>
        <div onClick={cycleHealth}
          title={"Health: "+(project.health||"green").toUpperCase()+" · click to change"}
          style={{width:14,height:14,borderRadius:"50%",background:HEALTH_COLOR[project.health]||G.green,boxShadow:"0 0 8px "+(HEALTH_COLOR[project.health]||G.green)+"88",cursor:savingProject==="health"?"wait":"pointer",border:"2px solid "+G.surface,outline:"1px solid "+(HEALTH_COLOR[project.health]||G.green)+"77",flexShrink:0,opacity:savingProject==="health"?0.5:1}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:22,fontWeight:800,color:G.text,fontFamily:"Syne,sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {project.name || project.customer || "Untitled Project"}
          </div>
          <div style={{fontSize:13,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",marginTop:4,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            {project.customer && <span>{project.customer}</span>}
            {project.csm && <><span style={{color:G.faint}}>·</span><span>{project.csm}</span></>}
            <span style={{color:G.faint}}>·</span>
            <span style={{color:G.green,fontWeight:700}}>{fmtArr(project.arr)} ARR</span>
            <span style={{color:G.faint}}>·</span>
            <span>Target:&nbsp;
              {editingProj === "target_date" ? (
                <input type="date" defaultValue={project.target_date || ""} autoFocus
                  onBlur={e => saveProjectField("target_date", e.target.value || null)}
                  onKeyDown={e => {
                    if (e.key === "Enter") saveProjectField("target_date", e.target.value || null);
                    if (e.key === "Escape") setEditingProj(null);
                  }}
                  style={{background:G.bg,border:"1px solid "+G.blue,color:G.text,padding:"3px 6px",borderRadius:5,fontFamily:"Inter,system-ui,sans-serif",fontSize:12}}/>
              ) : (
                <span onClick={() => setEditingProj("target_date")} title="Click to change"
                  style={{cursor:"pointer",borderBottom:"1px dashed "+G.border2,padding:"1px 3px",color:G.text,fontWeight:700}}>
                  {fmtDate(project.target_date)} ✎
                </span>
              )}
            </span>
            <span style={{color:G.faint}}>·</span>
            <span style={{color:PHASE_COLOR[project.stage]||G.muted,fontWeight:700}}>{project.stage}</span>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          {[["complete","Complete"],["upcoming","Upcoming"],["late","Late"]].map(([s,l]) => (
            <div key={s} style={{background:STATUS_CFG[s].bg,border:"1px solid "+STATUS_CFG[s].bd,borderRadius:8,padding:"6px 14px",textAlign:"center",minWidth:74}}>
              <div style={{fontSize:20,fontWeight:800,color:STATUS_CFG[s].color,lineHeight:1,fontFamily:"Syne,sans-serif"}}>{stats[s]}</div>
              <div style={{fontSize:11,fontFamily:"Inter,system-ui,sans-serif",color:STATUS_CFG[s].color,opacity:0.8,marginTop:3,letterSpacing:"0.05em"}}>{l.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{flex:1,height:6,background:G.border,borderRadius:3,overflow:"hidden"}}>
          <div style={{width:completionPct+"%",height:"100%",background:"linear-gradient(90deg,"+G.green+","+G.green+"99)",borderRadius:3,transition:"width .6s"}}/>
        </div>
        <span style={{fontSize:12,fontFamily:"Inter,system-ui,sans-serif",color:G.green,fontWeight:700,whiteSpace:"nowrap"}}>{completionPct}% COMPLETE</span>
      </div>
    </div>
  );
}

// ─── OVERVIEW TAB ────────────────────────────────────────────────────────────
function OverviewTab({ project, tasks, stats, savingProject, setStage, advanceStage, recentNotes, fileCount }) {
  const stageIdx = PHASE_ORDER.indexOf(project.stage);
  const stagePctByPhase = (ph) => {
    const items = tasks.filter(t => t.phase === ph);
    if (!items.length) return null;
    return items.filter(t => t.status === "complete").length / items.length * 100;
  };
  const currentStageTasks = tasks.filter(t => t.phase === project.stage);
  const currentStageReady = currentStageTasks.length > 0 && currentStageTasks.every(t => t.status === "complete");
  const nextStage = stageIdx >= 0 && stageIdx < PHASE_ORDER.length - 1 ? PHASE_ORDER[stageIdx + 1] : null;

  // Days to / from target
  const daysToTarget = project.target_date
    ? Math.ceil((new Date(project.target_date) - new Date()) / 86400000)
    : null;

  // Tasks-by-phase for the bar visualization
  const phaseBreakdown = PHASE_ORDER.map(ph => ({
    phase: ph,
    total: tasks.filter(t => t.phase === ph).length,
    complete: tasks.filter(t => t.phase === ph && t.status === "complete").length,
    late: tasks.filter(t => t.phase === ph && t.status === "late").length,
  }));
  const maxPhase = Math.max(1, ...phaseBreakdown.map(p => p.total));

  const kpis = [
    { label:"TOTAL TASKS",  value:String(tasks.length),                            color:G.purple },
    { label:"COMPLETION",   value:tasks.length?Math.round(stats.complete/tasks.length*100)+"%":"—", color:G.green },
    { label:"LATE",         value:String(stats.late),                              color:stats.late>0?G.red:G.muted },
    { label:"DAYS TO GO",   value:daysToTarget==null?"—":daysToTarget>=0?daysToTarget+"d":Math.abs(daysToTarget)+"d late", color:daysToTarget==null?G.muted:daysToTarget<0?G.red:daysToTarget<14?G.yellow:G.blue },
    { label:"FILES",        value:String(fileCount),                                color:G.teal },
    { label:"NOTES",        value:String(recentNotes.length>0?recentNotes.length:0), color:G.muted },
  ];

  return (
    <div style={{padding:"20px 24px"}}>
      {/* KPI strip */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:18}}>
        {kpis.map((k,i) => (
          <div key={i} style={{background:G.surface,border:"1px solid "+G.border,borderRadius:10,padding:"14px 14px",position:"relative",overflow:"hidden",minWidth:0}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:k.color,borderRadius:"10px 10px 0 0"}}/>
            <div style={{fontSize:22,fontWeight:700,color:k.color,marginTop:6,fontFamily:"Inter,system-ui,sans-serif",letterSpacing:"-0.02em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{k.value}</div>
            <div style={{fontSize:11,color:G.muted,marginTop:8,fontFamily:"Inter,system-ui,sans-serif",letterSpacing:"0.05em",whiteSpace:"nowrap"}}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Stage stepper */}
      <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:12,padding:"16px 22px",marginBottom:18}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <span style={{fontSize:11,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",letterSpacing:"0.08em",fontWeight:700}}>PROJECT STAGE</span>
          {nextStage && (
            <button onClick={advanceStage} disabled={!!savingProject}
              title={currentStageReady ? "All current-stage tasks are complete" : "Tasks remain in this stage — you can still advance"}
              style={{background:currentStageReady?G.green:G.blueBg,color:currentStageReady?"#fff":G.blue,border:"1px solid "+(currentStageReady?G.green:G.blue),padding:"7px 16px",borderRadius:6,cursor:savingProject?"wait":"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:11,fontWeight:700,letterSpacing:"0.05em",opacity:savingProject?0.5:1}}>
              {currentStageReady?"✓ ADVANCE":"ADVANCE"} TO {nextStage.toUpperCase()} →
            </button>
          )}
        </div>
        <div style={{display:"flex",alignItems:"flex-start",gap:0}}>
          {PHASE_ORDER.map((ph, i) => {
            const isCurrent = ph === project.stage;
            const isPast = i < stageIdx;
            const phPct = stagePctByPhase(ph);
            const phColor = PHASE_COLOR[ph];
            const dotBg = isCurrent ? phColor : isPast ? G.green : G.surface2;
            const dotBorder = isCurrent ? phColor : isPast ? G.green : G.border2;
            const labelColor = isCurrent ? phColor : isPast ? G.green : G.muted;
            return (
              <div key={ph} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"stretch",position:"relative",minWidth:0}}>
                <div style={{display:"flex",alignItems:"center"}}>
                  <div style={{flex:1,height:2,background:i===0?"transparent":(i<=stageIdx?G.green:G.border2)}}/>
                  <button onClick={() => setStage(ph)} disabled={!!savingProject}
                    title={"Set stage to "+ph}
                    style={{background:dotBg,border:"2px solid "+dotBorder,width:36,height:36,borderRadius:"50%",cursor:savingProject?"wait":"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:isCurrent||isPast?"#fff":G.muted,fontFamily:"Inter,system-ui,sans-serif",boxShadow:isCurrent?"0 0 14px "+phColor+"99":"none",flexShrink:0,padding:0,transition:"all .2s"}}>
                    {isPast?"✓":i+1}
                  </button>
                  <div style={{flex:1,height:2,background:i===PHASE_ORDER.length-1?"transparent":(i<stageIdx?G.green:G.border2)}}/>
                </div>
                <div style={{marginTop:8,textAlign:"center",fontSize:10,fontFamily:"Inter,system-ui,sans-serif",color:labelColor,fontWeight:isCurrent?700:500,letterSpacing:"0.04em",lineHeight:1.3,padding:"0 4px"}}>
                  {ph.toUpperCase()}
                </div>
                <div style={{textAlign:"center",fontSize:10,fontFamily:"Inter,system-ui,sans-serif",color:G.faint,marginTop:3}}>
                  {phPct == null ? "—" : Math.round(phPct) + "%"}
                </div>
              </div>
            );
          })}
        </div>
        {currentStageReady && nextStage && (
          <div style={{marginTop:14,padding:"9px 14px",background:G.greenBg,border:"1px solid "+G.green+"55",borderRadius:6,fontSize:12,color:G.green,fontFamily:"Inter,system-ui,sans-serif",lineHeight:1.5}}>
            ✓ All {currentStageTasks.length} {project.stage} task{currentStageTasks.length===1?"":"s"} complete — ready to advance to <strong>{nextStage}</strong>.
          </div>
        )}
      </div>

      {/* Two-column: phase breakdown + recent notes */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
        <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:12,padding:"16px 22px"}}>
          <div style={{fontSize:11,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",letterSpacing:"0.08em",fontWeight:700,marginBottom:14}}>TASKS BY PHASE</div>
          {tasks.length === 0 ? (
            <div style={{fontSize:13,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",padding:"20px 0",textAlign:"center"}}>No tasks yet</div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {phaseBreakdown.map(p => (
                <div key={p.phase}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:11,fontFamily:"Inter,system-ui,sans-serif"}}>
                    <span style={{color:PHASE_COLOR[p.phase]||G.muted,fontWeight:600}}>{p.phase}</span>
                    <span style={{color:G.muted}}>
                      {p.complete}/{p.total} done
                      {p.late > 0 && <span style={{color:G.red,marginLeft:8}}>· {p.late} late</span>}
                    </span>
                  </div>
                  <div style={{height:8,background:G.border,borderRadius:4,overflow:"hidden",display:"flex"}}>
                    {p.total > 0 && (
                      <>
                        <div style={{width:(p.complete/p.total*100)+"%",background:G.green}}/>
                        {p.late > 0 && <div style={{width:(p.late/p.total*100)+"%",background:G.red}}/>}
                      </>
                    )}
                  </div>
                  <div style={{fontSize:9,color:G.faint,fontFamily:"Inter,system-ui,sans-serif",marginTop:3}}>
                    {p.total > 0 ? `${Math.round(p.total/maxPhase*100)}% of largest phase` : "no tasks"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:12,padding:"16px 22px"}}>
          <div style={{fontSize:11,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",letterSpacing:"0.08em",fontWeight:700,marginBottom:14}}>RECENT NOTES</div>
          {recentNotes.length === 0 ? (
            <div style={{fontSize:13,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",padding:"20px 0",textAlign:"center"}}>
              No notes yet — head to the <strong style={{color:G.blue}}>Notes</strong> tab to add one.
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {recentNotes.map(n => (
                <div key={n.id} style={{padding:"10px 12px",background:G.surface2,border:"1px solid "+G.border,borderRadius:8}}>
                  <div style={{fontSize:11,fontFamily:"Inter,system-ui,sans-serif",color:G.muted,marginBottom:5,display:"flex",justifyContent:"space-between"}}>
                    <span style={{color:G.text,fontWeight:600}}>{n.author}</span>
                    <span>{fmtDate(n.created_at)}</span>
                  </div>
                  <div style={{fontSize:13,color:G.text,lineHeight:1.5,whiteSpace:"pre-wrap"}}>
                    {n.body.length > 240 ? n.body.slice(0, 240) + "…" : n.body}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TASKS TAB ───────────────────────────────────────────────────────────────
function useTaskHandlers(api, tasks, setTasks, showToast) {
  const [saving, setSaving] = useState(null);

  const markComplete = async (task) => {
    if (task.status === "complete") return;
    setSaving(task.id);
    try {
      await api.patch("tasks", task.id, { actual_date: todayISO(), status: "complete" });
      setTasks(p => p.map(t => t.id === task.id ? { ...t, actual_date: todayISO(), status: "complete" } : t));
      showToast("✓ Task marked complete!");
    } catch (e) { showToast("Failed: " + e.message, "error"); }
    setSaving(null);
  };

  const reopenTask = async (task) => {
    setSaving(task.id);
    try {
      await api.patch("tasks", task.id, { actual_date: null, status: "upcoming" });
      setTasks(p => p.map(t => t.id === task.id ? { ...t, actual_date: null, status: "upcoming" } : t));
      showToast("Reopened");
    } catch (e) { showToast("Failed: " + e.message, "error"); }
    setSaving(null);
  };

  const saveEdit = async (task, field, value) => {
    setSaving(task.id);
    try {
      const v = value === "" ? null : value;
      await api.patch("tasks", task.id, { [field]: v });
      setTasks(p => p.map(t => t.id === task.id ? { ...t, [field]: v } : t));
      showToast("✓ Updated!");
    } catch (e) { showToast("Failed: " + e.message, "error"); }
    setSaving(null);
  };

  const deleteTask = async (task) => {
    if (!window.confirm(`Delete task "${task.name}"? This cannot be undone.`)) return;
    setSaving(task.id);
    try {
      await api.del("tasks", task.id);
      setTasks(p => p.filter(t => t.id !== task.id));
      showToast("✓ Task deleted");
    } catch (e) { showToast("Failed: " + e.message, "error"); }
    setSaving(null);
  };

  const bulkDeleteTasks = async (ids) => {
    try {
      await Promise.all(ids.map(id => api.del("tasks", id)));
      setTasks(p => p.filter(t => !ids.includes(t.id)));
      showToast(`✓ Deleted ${ids.length} task${ids.length !== 1 ? "s" : ""}`);
    } catch (e) { showToast("Failed: " + e.message, "error"); }
  };

  const addTask = async (projectId, currentStage, data) => {
    const result = await api.post("tasks", [{
      project_id: projectId,
      name: data.name,
      phase: data.phase || currentStage || "Kickoff",
      proj_date: data.proj_date,
      priority: data.priority || "medium",
      assignee_name: data.assignee_name,
      status: "upcoming",
    }]);
    const created = Array.isArray(result) ? result[0] : result;
    if (created) setTasks(p => [...p, created].sort((a,b) => (a.proj_date || "~").localeCompare(b.proj_date || "~")));
    showToast("✓ Task added");
    return created;
  };

  return { saving, markComplete, reopenTask, saveEdit, deleteTask, addTask, bulkDeleteTasks };
}

function TasksTab({ project, tasks, handlers }) {
  const [phase, setPhase] = useState("all");
  const [editing, setEditing] = useState(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const shown = phase === "all" ? tasks : tasks.filter(t => t.phase === phase);

  const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(prev => prev.size === shown.length ? new Set() : new Set(shown.map(t => t.id)));
  const bulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} task${selected.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkBusy(true);
    await handlers.bulkDeleteTasks([...selected]);
    setSelected(new Set());
    setBulkBusy(false);
  };
  const stats = {
    complete: tasks.filter(t => t.status === "complete").length,
    upcoming: tasks.filter(t => t.status === "upcoming").length,
    late:     tasks.filter(t => t.status === "late").length,
  };

  return (
    <div style={{padding:"16px 24px"}}>
      <div style={{display:"flex",gap:3,flexWrap:"wrap",alignItems:"center",marginBottom:14}}>
        {["all", ...PHASE_ORDER].map(ph => {
          const n = ph === "all" ? tasks.length : tasks.filter(t => t.phase === ph).length;
          const late = ph === "all" ? stats.late : tasks.filter(t => t.phase === ph && t.status === "late").length;
          return (
            <button key={ph} onClick={() => setPhase(ph)}
              style={{background:phase===ph?G.blueBg:"transparent",border:"1px solid "+(phase===ph?G.blue:G.border),color:phase===ph?G.blue:G.muted,padding:"6px 12px",borderRadius:6,cursor:"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
              {ph === "all" ? "All Phases" : ph}
              <span style={{background:late>0?G.redBg:G.border,color:late>0?G.red:G.muted,borderRadius:4,padding:"1px 5px",fontSize:9}}>{n}</span>
            </button>
          );
        })}
        <div style={{flex:1}}/>
        {!showAddTask && (
          <button onClick={() => setShowAddTask(true)}
            style={{background:G.blueBg,border:"1px solid "+G.blue,color:G.blue,padding:"6px 14px",borderRadius:6,cursor:"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:11,fontWeight:700,letterSpacing:"0.05em"}}>
            + ADD TASK
          </button>
        )}
      </div>

      {showAddTask && (
        <AddTaskRow
          defaultPhase={phase === "all" ? (project.stage || "Kickoff") : phase}
          onSave={async (data) => {
            await handlers.addTask(project.id, project.stage, data);
            setShowAddTask(false);
          }}
          onCancel={() => setShowAddTask(false)}
        />
      )}

      <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:10,overflow:"hidden"}}>
        {shown.length === 0 ? (
          <div style={{padding:50,textAlign:"center",color:G.muted,fontFamily:"Inter,system-ui,sans-serif",fontSize:13}}>
            No tasks {phase === "all" ? "yet" : "in " + phase} — click <strong style={{color:G.blue}}>+ ADD TASK</strong> above to create one.
          </div>
        ) : (
          <>
            {selected.size > 0 && (
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"8px 14px",background:G.redBg,borderBottom:"1px solid "+G.redBd,fontFamily:"Inter,system-ui,sans-serif",fontSize:12}}>
                <span style={{color:G.red,fontWeight:700}}>{selected.size} task{selected.size!==1?"s":""} selected</span>
                <button onClick={() => setSelected(new Set())} style={{background:"none",border:"none",color:G.muted,cursor:"pointer",fontSize:12,fontFamily:"Inter,system-ui,sans-serif",textDecoration:"underline"}}>Clear</button>
                <div style={{marginLeft:"auto"}}>
                  <button onClick={bulkDelete} disabled={bulkBusy}
                    style={{background:G.redBg,border:"1px solid "+G.redBd,color:G.red,padding:"6px 14px",borderRadius:8,cursor:"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:11,fontWeight:700,opacity:bulkBusy?0.55:1}}>
                    {bulkBusy?"Deleting…":`Delete ${selected.size} selected`}
                  </button>
                </div>
              </div>
            )}
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{borderBottom:"1px solid "+G.border,background:G.surface2}}>
                  <th style={{width:36,padding:"10px 8px 10px 14px",textAlign:"center"}}>
                    <input type="checkbox"
                      ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < shown.length; }}
                      checked={selected.size === shown.length && shown.length > 0}
                      onChange={toggleAll}
                      style={{cursor:"pointer",accentColor:G.red}}
                    />
                  </th>
                  <th style={{width:44,padding:"10px 4px"}}></th>
                  {["Task","Phase","Assignee","Projected","Actual","Variance","Priority","Status",""].map(h => (
                    <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:10,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",fontWeight:500,letterSpacing:"0.07em",whiteSpace:"nowrap"}}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((task, i) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    isLast={i === shown.length - 1}
                    rowIdx={i}
                    editing={editing}
                    setEditing={setEditing}
                    handlers={handlers}
                    selected={selected.has(task.id)}
                    onToggleSelect={() => toggleSelect(task.id)}
                  />
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function AddTaskRow({ defaultPhase, onSave, onCancel }) {
  const [name, setName] = useState("");
  const [phase, setPhase] = useState(defaultPhase || "Kickoff");
  const [projDate, setProjDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await onSave({ name: name.trim(), phase, proj_date: projDate || null, priority, assignee_name: assignee.trim() || null }); }
    finally { setBusy(false); }
  };

  return (
    <div style={{padding:"12px 14px",background:G.surface2,border:"1px solid "+G.blue+"55",borderRadius:8,marginBottom:10,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Task name…" autoFocus
        onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
        style={{flex:"2 1 200px",background:G.bg,border:"1px solid "+G.blue,color:G.text,padding:"7px 10px",borderRadius:6,fontFamily:"Inter,system-ui,sans-serif",fontSize:12}}/>
      <select value={phase} onChange={e => setPhase(e.target.value)}
        style={{background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"7px 8px",borderRadius:6,fontFamily:"Inter,system-ui,sans-serif",fontSize:11,cursor:"pointer"}}>
        {PHASE_ORDER.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <input type="date" value={projDate} onChange={e => setProjDate(e.target.value)}
        style={{background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"7px 8px",borderRadius:6,fontFamily:"Inter,system-ui,sans-serif",fontSize:11}}/>
      <select value={priority} onChange={e => setPriority(e.target.value)}
        style={{background:G.bg,border:"1px solid "+G.border,color:PRIORITY_COLOR[priority],padding:"7px 8px",borderRadius:6,fontFamily:"Inter,system-ui,sans-serif",fontSize:11,cursor:"pointer",fontWeight:700}}>
        {["critical","high","medium","low"].map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
      </select>
      <input value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="Assignee (optional)"
        style={{flex:"1 1 130px",background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"7px 10px",borderRadius:6,fontFamily:"Inter,system-ui,sans-serif",fontSize:12}}/>
      <button onClick={submit} disabled={busy || !name.trim()}
        style={{background:name.trim()?G.green:G.surface2,border:"1px solid "+(name.trim()?G.green:G.border),color:name.trim()?"#fff":G.muted,padding:"7px 14px",borderRadius:6,cursor:busy?"wait":(name.trim()?"pointer":"not-allowed"),fontFamily:"Inter,system-ui,sans-serif",fontSize:11,fontWeight:700,opacity:busy?0.6:1}}>
        {busy ? "…" : "+ ADD"}
      </button>
      <button onClick={onCancel}
        style={{background:"transparent",border:"1px solid "+G.border,color:G.muted,padding:"7px 10px",borderRadius:6,cursor:"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:11}}>
        Cancel
      </button>
    </div>
  );
}

function TaskRow({ task, isLast, rowIdx, editing, setEditing, handlers, selected, onToggleSelect }) {
  const sc = STATUS_CFG[task.status] || STATUS_CFG.upcoming;
  const variance = task.actual_date
    ? Math.round((new Date(task.actual_date) - new Date(task.proj_date)) / 86400000)
    : task.status === "late"
      ? Math.round((new Date() - new Date(task.proj_date)) / 86400000)
      : null;
  const isProjEdit = editing?.id === task.id && editing?.field === "proj_date";
  const isActEdit  = editing?.id === task.id && editing?.field === "actual_date";
  const isNameEdit = editing?.id === task.id && editing?.field === "name";
  const isAsgnEdit = editing?.id === task.id && editing?.field === "assignee_name";
  const isPhaseEdit= editing?.id === task.id && editing?.field === "phase";
  const isPriEdit  = editing?.id === task.id && editing?.field === "priority";
  const isSaving   = handlers.saving === task.id;

  const blurOrEnter = (field) => ({
    onBlur: e => { handlers.saveEdit(task, field, e.target.value); setEditing(null); },
    onKeyDown: e => {
      if (e.key === "Enter") { handlers.saveEdit(task, field, e.target.value); setEditing(null); }
      if (e.key === "Escape") setEditing(null);
    },
  });

  return (
    <tr style={{borderBottom:isLast?"none":"1px solid #0c1828",background:selected?G.redBg:task.status==="late"?"#120400":rowIdx%2===1?G.surface2:"transparent",opacity:isSaving?0.6:1,transition:"opacity .2s"}}>
      <td style={{padding:"11px 4px 11px 14px",textAlign:"center"}} onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={!!selected} onChange={onToggleSelect} style={{cursor:"pointer",accentColor:G.red}} />
      </td>
      <td style={{padding:"11px 8px",textAlign:"center"}}>
        <div onClick={() => !isSaving && (task.status === "complete" ? handlers.reopenTask(task) : handlers.markComplete(task))}
          title={task.status === "complete" ? "Click to reopen" : "Click to mark complete"}
          style={{width:20,height:20,borderRadius:5,border:"2px solid "+(task.status==="complete"?G.green:G.border2),background:task.status==="complete"?G.green:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}>
          {task.status === "complete" && <span style={{color:"#fff",fontSize:11,fontWeight:800}}>✓</span>}
        </div>
      </td>
      <td style={{padding:"11px 12px",maxWidth:240}}>
        {isNameEdit ? (
          <input defaultValue={task.name} autoFocus {...blurOrEnter("name")}
            style={{width:"100%",background:G.bg,border:"1px solid "+G.blue,color:G.text,padding:"5px 8px",borderRadius:5,fontFamily:"Syne,sans-serif",fontSize:13,fontWeight:600}}/>
        ) : (
          <div style={{display:"flex",alignItems:"flex-start",gap:7}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:sc.color,flexShrink:0,marginTop:5,boxShadow:task.status!=="upcoming"?"0 0 5px "+sc.color+"88":"none"}}/>
            <span onClick={() => setEditing({ id: task.id, field: "name" })} title="Click to rename"
              style={{fontSize:13,fontWeight:600,color:task.status==="complete"?G.muted:G.text,textDecoration:task.status==="complete"?"line-through":"none",lineHeight:1.4,cursor:"pointer"}}>
              {task.name}
            </span>
          </div>
        )}
        {task.notes && !isNameEdit && (
          <div style={{fontSize:10,color:"#5a7a94",fontFamily:"Inter,system-ui,sans-serif",marginTop:3,marginLeft:15,lineHeight:1.4}}>
            {task.notes.slice(0, 70)}{task.notes.length > 70 ? "…" : ""}
          </div>
        )}
      </td>
      <td style={{padding:"11px 12px",fontSize:13,fontFamily:"Inter,system-ui,sans-serif",whiteSpace:"nowrap"}}>
        {isPhaseEdit ? (
          <select defaultValue={task.phase} autoFocus
            onBlur={e => { handlers.saveEdit(task, "phase", e.target.value); setEditing(null); }}
            onChange={e => { handlers.saveEdit(task, "phase", e.target.value); setEditing(null); }}
            style={{background:G.bg,border:"1px solid "+G.blue,color:G.text,padding:"3px 6px",borderRadius:5,fontFamily:"Inter,system-ui,sans-serif",fontSize:11}}>
            {PHASE_ORDER.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : (
          <span onClick={() => setEditing({ id: task.id, field: "phase" })} title="Click to move to a different phase"
            style={{color:PHASE_COLOR[task.phase]||"#5a7a94",cursor:"pointer",borderBottom:"1px dashed "+G.border}}>
            {task.phase} ✎
          </span>
        )}
      </td>
      <td style={{padding:"11px 12px",fontSize:12,color:G.muted,whiteSpace:"nowrap"}}>
        {isAsgnEdit ? (
          <input defaultValue={task.assignee_name||""} autoFocus placeholder="Assignee" {...blurOrEnter("assignee_name")}
            style={{background:G.bg,border:"1px solid "+G.blue,color:G.text,padding:"4px 8px",borderRadius:5,fontFamily:"Inter,system-ui,sans-serif",fontSize:12,width:140}}/>
        ) : (
          <span onClick={() => setEditing({ id: task.id, field: "assignee_name" })} title="Click to set assignee"
            style={{cursor:"pointer",borderBottom:"1px dashed "+G.border,padding:"2px 4px"}}>
            {task.assignee_name || task.assignee_type || "—"} ✎
          </span>
        )}
      </td>
      <td style={{padding:"11px 12px",whiteSpace:"nowrap"}}>
        {isProjEdit ? (
          <input type="date" defaultValue={task.proj_date||""} autoFocus {...blurOrEnter("proj_date")}
            style={{background:G.bg,border:"1px solid "+G.blue,color:G.text,padding:"4px 8px",borderRadius:5,fontFamily:"Inter,system-ui,sans-serif",fontSize:12}}/>
        ) : (
          <span onClick={() => setEditing({ id: task.id, field: "proj_date" })} title="Click to edit"
            style={{cursor:"pointer",fontSize:13,fontFamily:"Inter,system-ui,sans-serif",color:task.status==="late"?G.red:G.muted,borderBottom:"1px dashed "+G.border,padding:"2px 4px"}}>
            {fmtDate(task.proj_date)} ✎
          </span>
        )}
      </td>
      <td style={{padding:"11px 12px",whiteSpace:"nowrap"}}>
        {isActEdit ? (
          <input type="date" defaultValue={task.actual_date||""} autoFocus {...blurOrEnter("actual_date")}
            style={{background:G.bg,border:"1px solid "+G.green,color:G.text,padding:"4px 8px",borderRadius:5,fontFamily:"Inter,system-ui,sans-serif",fontSize:12}}/>
        ) : (
          <span onClick={() => setEditing({ id: task.id, field: "actual_date" })} title="Click to set actual date"
            style={{cursor:"pointer",fontSize:13,fontFamily:"Inter,system-ui,sans-serif",color:task.actual_date?(variance>0?G.red:variance<0?G.green:G.muted):G.faint,borderBottom:"1px dashed "+G.border,padding:"2px 4px"}}>
            {task.actual_date ? fmtDate(task.actual_date) + " ✎" : "+ Set"}
          </span>
        )}
      </td>
      <td style={{padding:"11px 12px",fontFamily:"Inter,system-ui,sans-serif",fontSize:11,whiteSpace:"nowrap"}}>
        {variance != null
          ? <span style={{color:variance>2?G.red:variance<0?G.green:G.muted,fontWeight:700}}>{variance>0?"+"+variance+"d":variance<0?variance+"d":"On time"}</span>
          : "—"}
      </td>
      <td style={{padding:"11px 12px"}}>
        {isPriEdit ? (
          <select defaultValue={task.priority} autoFocus
            onBlur={e => { handlers.saveEdit(task, "priority", e.target.value); setEditing(null); }}
            onChange={e => { handlers.saveEdit(task, "priority", e.target.value); setEditing(null); }}
            style={{background:G.bg,border:"1px solid "+G.blue,color:PRIORITY_COLOR[task.priority]||G.text,padding:"3px 6px",borderRadius:5,fontFamily:"Inter,system-ui,sans-serif",fontSize:10,fontWeight:700}}>
            {["critical","high","medium","low"].map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
          </select>
        ) : (
          <span onClick={() => setEditing({ id: task.id, field: "priority" })} title="Click to change priority"
            style={{color:PRIORITY_COLOR[task.priority]||G.muted,fontFamily:"Inter,system-ui,sans-serif",fontSize:10,fontWeight:700,letterSpacing:"0.08em",cursor:"pointer",borderBottom:"1px dashed "+G.border,padding:"2px 4px"}}>
            {(task.priority || "").toUpperCase()} ✎
          </span>
        )}
      </td>
      <td style={{padding:"11px 12px"}}>
        <span style={{display:"inline-block",padding:"3px 9px",background:sc.bg,border:"1px solid "+sc.bd,borderRadius:5,color:sc.color,fontFamily:"Inter,system-ui,sans-serif",fontSize:10,fontWeight:700,letterSpacing:"0.05em"}}>
          {sc.label.toUpperCase()}
        </span>
      </td>
      <td style={{padding:"11px 12px",textAlign:"right"}}>
        <button onClick={() => !isSaving && handlers.deleteTask(task)} disabled={isSaving} title="Delete task"
          style={{background:"transparent",border:"1px solid "+G.border,color:G.faint,width:24,height:24,borderRadius:5,cursor:"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:12,display:"inline-flex",alignItems:"center",justifyContent:"center"}}
          onMouseEnter={e => { e.currentTarget.style.color = G.red; e.currentTarget.style.borderColor = G.red; }}
          onMouseLeave={e => { e.currentTarget.style.color = G.faint; e.currentTarget.style.borderColor = G.border; }}>
          ✕
        </button>
      </td>
    </tr>
  );
}

// ─── TIMELINE TAB (custom SVG Gantt) ─────────────────────────────────────────
function TimelineTab({ project, tasks }) {
  // Compute the date range. Anchor on min(task.proj_date) and max(target_date,
  // task.proj_date). If no dates, fall back to today ± 30d so we still draw
  // something useful.
  const dated = tasks.filter(t => t.proj_date);
  const allDates = [
    ...dated.map(t => new Date(t.proj_date).getTime()),
    ...dated.filter(t => t.actual_date).map(t => new Date(t.actual_date).getTime()),
    ...(project.target_date ? [new Date(project.target_date).getTime()] : []),
    Date.now(),
  ];
  const minMs = Math.min(...allDates) - 7 * 86400000;
  const maxMs = Math.max(...allDates) + 7 * 86400000;
  const totalDays = Math.max(1, Math.round((maxMs - minMs) / 86400000));

  const ROW_H = 32;
  const HEADER_H = 56;
  const LEFT_W  = 220;
  const ROWS = Math.max(1, dated.length);
  const VIEWBOX_W = 1100;
  const PLOT_W  = VIEWBOX_W - LEFT_W - 20;
  const CHART_H = HEADER_H + ROWS * ROW_H + 40;

  const xFor = (ms) => LEFT_W + ((ms - minMs) / (maxMs - minMs)) * PLOT_W;
  const dayMs = 86400000;
  const tickEvery = totalDays > 120 ? 30 : totalDays > 45 ? 14 : 7;
  const ticks = [];
  const startDay = new Date(minMs);
  startDay.setHours(0,0,0,0);
  for (let t = startDay.getTime(); t <= maxMs; t += tickEvery * dayMs) {
    ticks.push(t);
  }

  const todayMs = Date.now();
  const targetMs = project.target_date ? new Date(project.target_date).getTime() : null;

  // Group rows by phase so we can paint a faint phase strip behind their bars.
  const rowsByPhase = {};
  PHASE_ORDER.forEach(p => { rowsByPhase[p] = []; });
  dated.forEach(t => { (rowsByPhase[t.phase] || (rowsByPhase[t.phase] = [])).push(t); });

  const orderedTasks = [];
  for (const ph of PHASE_ORDER) {
    (rowsByPhase[ph] || []).slice().sort((a, b) => (a.proj_date || "").localeCompare(b.proj_date || "")).forEach(t => orderedTasks.push(t));
  }
  // Append phases not in PHASE_ORDER (defensive)
  Object.keys(rowsByPhase).forEach(ph => {
    if (!PHASE_ORDER.includes(ph)) {
      rowsByPhase[ph].forEach(t => orderedTasks.push(t));
    }
  });

  return (
    <div style={{padding:"16px 24px"}}>
      <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:12,padding:"16px 22px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <span style={{fontSize:11,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",letterSpacing:"0.08em",fontWeight:700}}>PROJECT TIMELINE</span>
          <div style={{display:"flex",gap:14,fontSize:10,fontFamily:"Inter,system-ui,sans-serif",color:G.muted}}>
            <span><span style={{display:"inline-block",width:10,height:10,background:G.blue,borderRadius:2,marginRight:5,verticalAlign:"middle"}}/>Projected</span>
            <span><span style={{display:"inline-block",width:10,height:10,background:G.green,borderRadius:2,marginRight:5,verticalAlign:"middle"}}/>Actual</span>
            <span><span style={{display:"inline-block",width:10,height:10,background:G.red,borderRadius:2,marginRight:5,verticalAlign:"middle"}}/>Late</span>
            <span><span style={{display:"inline-block",width:1,height:12,background:G.yellow,marginRight:5,verticalAlign:"middle"}}/>Today</span>
            {targetMs && <span><span style={{display:"inline-block",width:1,height:12,background:G.purple,marginRight:5,verticalAlign:"middle"}}/>Target</span>}
          </div>
        </div>

        {orderedTasks.length === 0 ? (
          <div style={{padding:50,textAlign:"center",color:G.muted,fontFamily:"Inter,system-ui,sans-serif",fontSize:13}}>
            No tasks have a projected date — add one in the <strong style={{color:G.blue}}>Tasks</strong> tab to plot a timeline.
          </div>
        ) : (
          <div style={{overflowX:"auto"}}>
            <svg viewBox={`0 0 ${VIEWBOX_W} ${CHART_H}`} style={{width:"100%",minWidth:800,height:CHART_H,fontFamily:"Inter,system-ui,sans-serif"}}>
              {/* Date ticks */}
              {ticks.map((t, i) => {
                const x = xFor(t);
                return (
                  <g key={i}>
                    <line x1={x} y1={HEADER_H - 8} x2={x} y2={CHART_H - 20} stroke={G.border} strokeWidth={1} strokeDasharray="2,4"/>
                    <text x={x} y={HEADER_H - 14} fill={G.muted} fontSize="10" textAnchor="middle">
                      {new Date(t).toLocaleDateString("en-US", { month:"short", day:"numeric" })}
                    </text>
                  </g>
                );
              })}

              {/* Task rows */}
              {orderedTasks.map((task, i) => {
                const y = HEADER_H + i * ROW_H + 8;
                const projMs = new Date(task.proj_date).getTime();
                const endMs = task.actual_date ? new Date(task.actual_date).getTime() : projMs;
                const x1 = xFor(Math.min(projMs, endMs));
                const x2 = xFor(Math.max(projMs, endMs));
                const w = Math.max(6, x2 - x1);
                const isLate = task.status === "late";
                const isComplete = task.status === "complete";
                const barColor = isLate ? G.red : isComplete ? G.green : G.blue;
                const phaseAccent = PHASE_COLOR[task.phase] || G.muted;
                return (
                  <g key={task.id}>
                    {/* Row background stripe */}
                    {i % 2 === 1 && <rect x={LEFT_W - 6} y={y - 6} width={PLOT_W + 12} height={ROW_H - 4} fill={G.surface2} opacity="0.5"/>}
                    {/* Phase pip on the left */}
                    <rect x={LEFT_W - 6} y={y - 6} width={3} height={ROW_H - 4} fill={phaseAccent}/>
                    {/* Task name */}
                    <text x={6} y={y + 12} fill={isComplete ? G.muted : G.text} fontSize="11"
                      textDecoration={isComplete ? "line-through" : "none"}>
                      {task.name.length > 28 ? task.name.slice(0, 26) + "…" : task.name}
                    </text>
                    {/* Phase label */}
                    <text x={6} y={y + 24} fill={phaseAccent} fontSize="9">{task.phase}</text>
                    {/* The bar */}
                    <rect x={x1} y={y + 2} width={w} height={ROW_H - 14} rx={3}
                      fill={barColor} opacity={isComplete ? 0.55 : 0.85}/>
                    {/* Projected vs actual marker — small tick at the proj_date */}
                    {task.actual_date && (
                      <circle cx={xFor(projMs)} cy={y + 2 + (ROW_H - 14) / 2} r={3} fill={G.muted} stroke={G.bg} strokeWidth={1}/>
                    )}
                    <title>{`${task.name}\n${task.phase} · ${task.priority}\nProjected: ${fmtDate(task.proj_date)}${task.actual_date ? "\nActual: "+fmtDate(task.actual_date) : ""}\nStatus: ${task.status}`}</title>
                  </g>
                );
              })}

              {/* Today line */}
              {todayMs >= minMs && todayMs <= maxMs && (
                <g>
                  <line x1={xFor(todayMs)} y1={HEADER_H - 4} x2={xFor(todayMs)} y2={CHART_H - 20}
                    stroke={G.yellow} strokeWidth={1.5}/>
                  <text x={xFor(todayMs)} y={CHART_H - 6} fill={G.yellow} fontSize="9" textAnchor="middle">TODAY</text>
                </g>
              )}

              {/* Target line */}
              {targetMs && targetMs >= minMs && targetMs <= maxMs && (
                <g>
                  <line x1={xFor(targetMs)} y1={HEADER_H - 4} x2={xFor(targetMs)} y2={CHART_H - 20}
                    stroke={G.purple} strokeWidth={1.5} strokeDasharray="4,3"/>
                  <text x={xFor(targetMs)} y={CHART_H - 6} fill={G.purple} fontSize="9" textAnchor="middle">TARGET</text>
                </g>
              )}

              {/* Header bottom rule */}
              <line x1={0} y1={HEADER_H} x2={VIEWBOX_W} y2={HEADER_H} stroke={G.border} strokeWidth={1}/>
              <line x1={LEFT_W} y1={HEADER_H} x2={LEFT_W} y2={CHART_H - 20} stroke={G.border} strokeWidth={1}/>
            </svg>
          </div>
        )}
      </div>

      {/* Date stats */}
      {dated.length > 0 && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginTop:14}}>
          {[
            { label:"FIRST DATE", value:fmtDate(new Date(Math.min(...dated.map(t => new Date(t.proj_date).getTime())))), color:G.blue },
            { label:"LAST DATE",  value:fmtDate(new Date(Math.max(...dated.map(t => new Date(t.proj_date).getTime())))), color:G.purple },
            { label:"DATED TASKS", value:String(dated.length), color:G.teal },
            { label:"DURATION",   value:totalDays + " days",   color:G.muted },
          ].map((k,i) => (
            <div key={i} style={{background:G.surface,border:"1px solid "+G.border,borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontSize:9,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",letterSpacing:"0.08em",fontWeight:600}}>{k.label}</div>
              <div style={{fontSize:16,fontWeight:700,color:k.color,marginTop:5,fontFamily:"Inter,system-ui,sans-serif"}}>{k.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── NOTES TAB ───────────────────────────────────────────────────────────────
function useNoteHandlers(api, project, notes, setNotes, showToast) {
  const [busy, setBusy] = useState(false);

  const addNote = async ({ body, task_id, author }) => {
    if (!body.trim()) return null;
    setBusy(true);
    try {
      const result = await api.post("project_notes", [{
        project_id: project.id,
        csm_id: project.csm_id || null,
        task_id: task_id || null,
        author: author || "You",
        body: body.trim(),
      }]);
      const created = Array.isArray(result) ? result[0] : result;
      if (created) setNotes(p => [created, ...p]);
      showToast("✓ Note added");
      return created;
    } catch (e) {
      showToast("Failed: " + e.message, "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const deleteNote = async (note) => {
    if (!window.confirm("Delete this note? This cannot be undone.")) return;
    try {
      await api.del("project_notes", note.id);
      setNotes(p => p.filter(n => n.id !== note.id));
      showToast("✓ Note deleted");
    } catch (e) { showToast("Failed: " + e.message, "error"); }
  };

  return { busy, addNote, deleteNote };
}

function NotesTab({ notes, tasks, handlers }) {
  const [body, setBody] = useState("");
  const [taskId, setTaskId] = useState("");
  const [author, setAuthor] = useState("");

  const submit = async () => {
    const created = await handlers.addNote({ body, task_id: taskId || null, author: author.trim() || "You" });
    if (created) { setBody(""); setTaskId(""); }
  };

  const taskById = useMemo(() => {
    const m = {};
    tasks.forEach(t => { m[t.id] = t; });
    return m;
  }, [tasks]);

  return (
    <div style={{padding:"16px 24px",display:"grid",gridTemplateColumns:"1fr 320px",gap:18,alignItems:"start"}}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {/* Composer */}
        <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:12,padding:"14px 18px"}}>
          <div style={{fontSize:11,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",letterSpacing:"0.08em",fontWeight:700,marginBottom:10}}>NEW NOTE</div>
          <textarea value={body} onChange={e => setBody(e.target.value)}
            placeholder="What's the latest? Status updates, blockers, follow-ups…"
            rows={4}
            style={{width:"100%",background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"10px 12px",borderRadius:8,fontFamily:"Inter,system-ui,sans-serif",fontSize:13,resize:"vertical",lineHeight:1.5}}/>
          <div style={{display:"flex",gap:10,marginTop:10,alignItems:"center",flexWrap:"wrap"}}>
            <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Your name"
              style={{flex:"1 1 140px",background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"7px 10px",borderRadius:6,fontFamily:"Inter,system-ui,sans-serif",fontSize:12}}/>
            <select value={taskId} onChange={e => setTaskId(e.target.value)}
              style={{flex:"2 1 180px",background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"7px 10px",borderRadius:6,fontFamily:"Inter,system-ui,sans-serif",fontSize:12}}>
              <option value="">Project-level note (no task)</option>
              {tasks.map(t => <option key={t.id} value={t.id}>{t.phase} · {t.name}</option>)}
            </select>
            <button onClick={submit} disabled={handlers.busy || !body.trim()}
              style={{background:body.trim()?G.blue:G.surface2,border:"1px solid "+(body.trim()?G.blue:G.border),color:body.trim()?"#fff":G.muted,padding:"7px 18px",borderRadius:6,cursor:handlers.busy?"wait":(body.trim()?"pointer":"not-allowed"),fontFamily:"Inter,system-ui,sans-serif",fontSize:11,fontWeight:700,letterSpacing:"0.05em"}}>
              {handlers.busy ? "POSTING…" : "POST NOTE"}
            </button>
          </div>
        </div>

        {/* Note list */}
        {notes.length === 0 ? (
          <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:12,padding:"36px 24px",textAlign:"center",color:G.muted,fontFamily:"Inter,system-ui,sans-serif",fontSize:13}}>
            No notes yet. Use this space to log status updates, customer feedback, or anything worth remembering for next week's standup.
          </div>
        ) : notes.map(n => (
          <div key={n.id} style={{background:G.surface,border:"1px solid "+G.border,borderRadius:12,padding:"12px 18px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7,gap:10,flexWrap:"wrap"}}>
              <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",fontSize:11,fontFamily:"Inter,system-ui,sans-serif"}}>
                <span style={{color:G.text,fontWeight:700}}>{n.author}</span>
                <span style={{color:G.faint}}>·</span>
                <span style={{color:G.muted}}>{fmtDate(n.created_at)}</span>
                {n.task_id && taskById[n.task_id] && (
                  <>
                    <span style={{color:G.faint}}>·</span>
                    <span style={{color:PHASE_COLOR[taskById[n.task_id].phase]||G.blue,padding:"1px 6px",borderRadius:4,background:G.surface2,border:"1px solid "+G.border}}>
                      {taskById[n.task_id].name.length > 30 ? taskById[n.task_id].name.slice(0, 28) + "…" : taskById[n.task_id].name}
                    </span>
                  </>
                )}
              </div>
              <button onClick={() => handlers.deleteNote(n)}
                title="Delete note"
                style={{background:"transparent",border:"1px solid "+G.border,color:G.faint,padding:"3px 8px",borderRadius:5,cursor:"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:10}}
                onMouseEnter={e => { e.currentTarget.style.color = G.red; e.currentTarget.style.borderColor = G.red; }}
                onMouseLeave={e => { e.currentTarget.style.color = G.faint; e.currentTarget.style.borderColor = G.border; }}>
                Delete
              </button>
            </div>
            <div style={{fontSize:13,color:G.text,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{n.body}</div>
          </div>
        ))}
      </div>

      {/* Right rail — quick stats */}
      <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:12,padding:"14px 18px",position:"sticky",top:8}}>
        <div style={{fontSize:11,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",letterSpacing:"0.08em",fontWeight:700,marginBottom:10}}>NOTES SUMMARY</div>
        <div style={{display:"flex",flexDirection:"column",gap:8,fontSize:12,fontFamily:"Inter,system-ui,sans-serif"}}>
          <div style={{display:"flex",justifyContent:"space-between",color:G.muted}}>
            <span>Total notes</span>
            <span style={{color:G.text,fontWeight:700}}>{notes.length}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",color:G.muted}}>
            <span>Task-linked</span>
            <span style={{color:G.text,fontWeight:700}}>{notes.filter(n => n.task_id).length}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",color:G.muted}}>
            <span>Last 7 days</span>
            <span style={{color:G.text,fontWeight:700}}>
              {notes.filter(n => Date.now() - new Date(n.created_at).getTime() < 7*86400000).length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── FILES TAB ───────────────────────────────────────────────────────────────
function useFileHandlers(project, files, setFiles, showToast) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const uploadFile = async (file, { phase = null, task_id = null } = {}) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast("File too large — limit is 5 MB", "error");
      return;
    }
    setUploading(true);
    setProgress(10);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setProgress(40);
      const base64 = String(dataUrl).split(",")[1] || "";
      const res = await authedFetch("/api/files", {
        method: "POST",
        body: JSON.stringify({
          project_id: project.id,
          task_id,
          phase,
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          content_base64: base64,
        }),
      });
      setProgress(85);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || ("HTTP " + res.status));
      }
      const data = await res.json();
      if (data && data.attachment) setFiles(p => [data.attachment, ...p]);
      setProgress(100);
      showToast("✓ Uploaded " + file.name);
    } catch (e) {
      showToast("Upload failed: " + e.message, "error");
    } finally {
      setUploading(false);
      setTimeout(() => setProgress(0), 600);
    }
  };

  const deleteFile = async (att) => {
    if (!window.confirm(`Delete "${att.file_name}"? This cannot be undone.`)) return;
    try {
      const res = await authedFetch("/api/files?id=" + encodeURIComponent(att.id), { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || ("HTTP " + res.status));
      }
      setFiles(p => p.filter(f => f.id !== att.id));
      showToast("✓ Deleted");
    } catch (e) { showToast("Failed: " + e.message, "error"); }
  };

  const downloadFile = async (att) => {
    try {
      const res = await authedFetch("/api/files?id=" + encodeURIComponent(att.id));
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || ("HTTP " + res.status));
      }
      const data = await res.json();
      if (data && data.url) window.open(data.url, "_blank", "noopener");
      else throw new Error("No URL returned");
    } catch (e) { showToast("Download failed: " + e.message, "error"); }
  };

  return { uploading, progress, uploadFile, deleteFile, downloadFile };
}

function FilesTab({ files, tasks, handlers }) {
  const [phase, setPhase] = useState("");
  const [taskId, setTaskId] = useState("");
  const [filterPhase, setFilterPhase] = useState("all");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const onPick = (e) => {
    const file = e.target.files?.[0];
    if (file) handlers.uploadFile(file, { phase: phase || null, task_id: taskId || null });
    if (e.target) e.target.value = "";
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handlers.uploadFile(file, { phase: phase || null, task_id: taskId || null });
  };

  const taskById = useMemo(() => {
    const m = {};
    tasks.forEach(t => { m[t.id] = t; });
    return m;
  }, [tasks]);

  const shown = filterPhase === "all" ? files : files.filter(f => f.phase === filterPhase);

  return (
    <div style={{padding:"16px 24px",display:"flex",flexDirection:"column",gap:14}}>
      {/* Drop zone + upload form */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{background:dragOver?G.blueBg:G.surface,border:"2px dashed "+(dragOver?G.blue:G.border2),borderRadius:12,padding:"22px 24px",transition:"all .15s",textAlign:"center"}}>
        <div style={{fontSize:32,marginBottom:6,opacity:0.6}}>⬆</div>
        <div style={{fontSize:14,fontWeight:700,color:G.text,marginBottom:5,fontFamily:"Syne,sans-serif"}}>
          Drop a file here or click to browse
        </div>
        <div style={{fontSize:11,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",marginBottom:14}}>
          Up to 5 MB · PDFs, images, spreadsheets, text
        </div>
        <input ref={inputRef} type="file" onChange={onPick} style={{display:"none"}}/>
        <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
          <select value={phase} onChange={e => setPhase(e.target.value)}
            title="Tag this upload to a phase (optional)"
            style={{background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"7px 10px",borderRadius:6,fontFamily:"Inter,system-ui,sans-serif",fontSize:11}}>
            <option value="">No phase</option>
            {PHASE_ORDER.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={taskId} onChange={e => setTaskId(e.target.value)}
            title="Tag this upload to a task (optional)"
            style={{background:G.bg,border:"1px solid "+G.border,color:G.text,padding:"7px 10px",borderRadius:6,fontFamily:"Inter,system-ui,sans-serif",fontSize:11,maxWidth:260}}>
            <option value="">No task</option>
            {tasks.map(t => <option key={t.id} value={t.id}>{t.phase} · {t.name}</option>)}
          </select>
          <button onClick={() => inputRef.current?.click()} disabled={handlers.uploading}
            style={{background:G.blue,color:"#fff",border:"1px solid "+G.blue,padding:"7px 18px",borderRadius:6,cursor:handlers.uploading?"wait":"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:11,fontWeight:700,letterSpacing:"0.05em"}}>
            {handlers.uploading ? "UPLOADING…" : "CHOOSE FILE"}
          </button>
        </div>
        {handlers.progress > 0 && (
          <div style={{height:4,background:G.border,borderRadius:2,overflow:"hidden",maxWidth:340,margin:"6px auto 0"}}>
            <div style={{width:handlers.progress+"%",height:"100%",background:G.blue,transition:"width .2s"}}/>
          </div>
        )}
      </div>

      {/* Filter chips */}
      {files.length > 0 && (
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:10,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",letterSpacing:"0.1em",marginRight:4}}>FILTER BY PHASE</span>
          <button onClick={() => setFilterPhase("all")}
            style={{background:filterPhase==="all"?G.blueBg:"transparent",border:"1px solid "+(filterPhase==="all"?G.blue:G.border),color:filterPhase==="all"?G.blue:G.muted,padding:"4px 10px",borderRadius:5,cursor:"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:10,fontWeight:600}}>
            ALL ({files.length})
          </button>
          {PHASE_ORDER.map(p => {
            const n = files.filter(f => f.phase === p).length;
            if (!n) return null;
            return (
              <button key={p} onClick={() => setFilterPhase(p)}
                style={{background:filterPhase===p?G.blueBg:"transparent",border:"1px solid "+(filterPhase===p?PHASE_COLOR[p]:G.border),color:filterPhase===p?PHASE_COLOR[p]:G.muted,padding:"4px 10px",borderRadius:5,cursor:"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:10,fontWeight:600}}>
                {p.toUpperCase()} ({n})
              </button>
            );
          })}
        </div>
      )}

      {/* File list */}
      {shown.length === 0 ? (
        <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:12,padding:"36px 24px",textAlign:"center",color:G.muted,fontFamily:"Inter,system-ui,sans-serif",fontSize:13}}>
          {files.length === 0
            ? "No files yet. Drop docs, screenshots, or spreadsheets here so the team can find them later."
            : "No files in this phase."}
        </div>
      ) : (
        <div style={{background:G.surface,border:"1px solid "+G.border,borderRadius:12,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{borderBottom:"1px solid "+G.border,background:G.surface2}}>
                {["File","Phase","Task","Size","Uploaded","Uploaded By",""].map(h => (
                  <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:10,color:G.muted,fontFamily:"Inter,system-ui,sans-serif",fontWeight:500,letterSpacing:"0.07em",whiteSpace:"nowrap"}}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((f, i) => (
                <tr key={f.id} style={{borderBottom:i<shown.length-1?"1px solid #0c1828":"none",background:i%2===1?G.surface2:"transparent"}}>
                  <td style={{padding:"11px 12px",maxWidth:280}}>
                    <button onClick={() => handlers.downloadFile(f)}
                      style={{background:"none",border:"none",padding:0,color:G.blue,fontFamily:"inherit",fontSize:13,fontWeight:600,cursor:"pointer",textAlign:"left",textDecoration:"underline",textDecorationColor:G.blue+"55",textUnderlineOffset:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}
                      title={f.file_name}>
                      {f.file_name}
                    </button>
                    {f.mime_type && <div style={{fontSize:10,color:G.faint,fontFamily:"Inter,system-ui,sans-serif",marginTop:2}}>{f.mime_type}</div>}
                  </td>
                  <td style={{padding:"11px 12px",fontSize:11,fontFamily:"Inter,system-ui,sans-serif",color:f.phase?(PHASE_COLOR[f.phase]||G.muted):G.faint,whiteSpace:"nowrap"}}>
                    {f.phase || "—"}
                  </td>
                  <td style={{padding:"11px 12px",fontSize:12,fontFamily:"Inter,system-ui,sans-serif",color:G.muted,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {f.task_id && taskById[f.task_id] ? taskById[f.task_id].name : "—"}
                  </td>
                  <td style={{padding:"11px 12px",fontSize:11,fontFamily:"Inter,system-ui,sans-serif",color:G.muted,whiteSpace:"nowrap"}}>
                    {fmtBytes(f.size_bytes)}
                  </td>
                  <td style={{padding:"11px 12px",fontSize:11,fontFamily:"Inter,system-ui,sans-serif",color:G.muted,whiteSpace:"nowrap"}}>
                    {fmtDate(f.created_at)}
                  </td>
                  <td style={{padding:"11px 12px",fontSize:11,fontFamily:"Inter,system-ui,sans-serif",color:G.muted,whiteSpace:"nowrap"}}>
                    {f.uploaded_by || "—"}
                  </td>
                  <td style={{padding:"11px 12px",textAlign:"right",whiteSpace:"nowrap"}}>
                    <button onClick={() => handlers.downloadFile(f)}
                      title="Download"
                      style={{background:"transparent",border:"1px solid "+G.border,color:G.muted,padding:"4px 10px",borderRadius:5,cursor:"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:10,marginRight:4}}>
                      ↓
                    </button>
                    <button onClick={() => handlers.deleteFile(f)}
                      title="Delete"
                      style={{background:"transparent",border:"1px solid "+G.border,color:G.faint,padding:"4px 10px",borderRadius:5,cursor:"pointer",fontFamily:"Inter,system-ui,sans-serif",fontSize:10}}
                      onMouseEnter={e => { e.currentTarget.style.color = G.red; e.currentTarget.style.borderColor = G.red; }}
                      onMouseLeave={e => { e.currentTarget.style.color = G.faint; e.currentTarget.style.borderColor = G.border; }}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}
