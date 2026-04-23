// Monument — Afternoon Task Reminders (4pm CT / 21:00 UTC, weekdays)
// Sends individual emails to each CSM with upcoming tasks for next 5 business days.
// Sends an executive summary to notification_rules(event_type='task.upcoming')
// recipients, with EXEC_EMAIL as a legacy fallback.

import { resolveRecipients } from '../_lib/notifications.js';

const SB_URL = () => process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY;
const sbHeaders = () => ({
  'apikey': SB_KEY(),
  'Authorization': 'Bearer ' + SB_KEY(),
  'Content-Type': 'application/json',
});

async function sbGet(table, params = {}) {
  const qs = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const res = await fetch(SB_URL() + '/' + table + (qs ? '?' + qs : ''), { headers: sbHeaders() });
  if (!res.ok) throw new Error('Supabase error: ' + res.status);
  return res.json();
}

async function sendEmail(to, subject, html, cc) {
  const body = {
    from: process.env.FROM_EMAIL || 'Monument <onboarding@resend.dev>',
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (cc && cc.length) body.cc = cc;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

function emailShell(title, subtitle, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#060c14;color:#e8f0f8;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060c14;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="padding:0 0 20px 0;border-bottom:1px solid #192d40;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:12px;vertical-align:middle;">
        <div style="width:36px;height:36px;background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:8px;text-align:center;line-height:36px;font-size:18px;font-weight:900;color:#fff;">M</div>
      </td>
      <td style="vertical-align:middle;">
        <div style="font-size:18px;font-weight:800;color:#e8f0f8;letter-spacing:0.03em;">Monument</div>
        <div style="font-size:11px;color:#8fa3b8;letter-spacing:0.1em;margin-top:1px;">PS OPERATIONS</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:24px 0 8px 0;">
    <div style="font-size:20px;font-weight:800;color:#60a5fa;letter-spacing:0.02em;">${title}</div>
    <div style="font-size:13px;color:#8fa3b8;margin-top:4px;">${subtitle}</div>
  </td></tr>
  <tr><td style="padding:16px 0 0 0;">${body}</td></tr>
  <tr><td style="padding:28px 0 0 0;border-top:1px solid #192d40;margin-top:24px;">
    <div style="font-size:11px;color:#4a6480;text-align:center;line-height:1.8;">
      Monument PS Operations Platform &middot; Automated Reminder<br>
      <a href="${process.env.APP_URL || 'https://milesdemo-beta.vercel.app'}" style="color:#60a5fa;text-decoration:none;">Open Monument Dashboard &rarr;</a>
    </div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function priorityStyle(p) {
  const map = {
    critical: { color: '#ef4444', bg: '#1e0505', bd: '#3d0a0a' },
    high:     { color: '#f59e0b', bg: '#1e1400', bd: '#3d2800' },
    medium:   { color: '#60a5fa', bg: '#0d1e38', bd: '#1a3a5f' },
    low:      { color: '#8fa3b8', bg: '#0b1521', bd: '#192d40' },
  };
  const s = map[p] || map.medium;
  return `color:${s.color};background:${s.bg};border:1px solid ${s.bd};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.05em;display:inline-block;`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getNextBusinessDays(n) {
  const days = [];
  const d = new Date();
  while (days.length < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      days.push(new Date(d));
    }
  }
  return days;
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET not configured.' });
  const auth = req.headers['authorization'];
  if (auth !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const summaryTargets = await resolveRecipients('task.upcoming', { envFallbackTo: 'EXEC_EMAIL' });
    if (!summaryTargets.enabled) {
      return res.status(200).json({ message: 'task.upcoming notifications disabled via rule.' });
    }

    const bizDays = getNextBusinessDays(5);
    const startDate = bizDays[0].toISOString().split('T')[0];
    const endDate = bizDays[bizDays.length - 1].toISOString().split('T')[0];

    const [allTasks, projects, csms] = await Promise.all([
      sbGet('tasks', { select: '*', status: 'neq.complete', order: 'proj_date.asc' }),
      sbGet('projects', { select: 'id,name,csm_id' }),
      sbGet('csms', { is_active: 'eq.true', select: 'id,name,email' }),
    ]);

    // Filter tasks in the date range
    const upcoming = allTasks.filter(t => t.proj_date >= startDate && t.proj_date <= endDate);

    if (!upcoming.length) {
      return res.status(200).json({ message: 'No upcoming tasks in next 5 business days.' });
    }

    const projectMap = {};
    projects.forEach(p => { projectMap[p.id] = p; });
    const csmMap = {};
    csms.forEach(c => { csmMap[c.id] = c; });

    // Group by CSM
    const byCsm = {};
    upcoming.forEach(t => {
      const proj = projectMap[t.project_id];
      if (!proj) return;
      const csm = csmMap[proj.csm_id];
      if (!csm) return;
      if (!byCsm[csm.id]) byCsm[csm.id] = { csm, tasks: [] };
      byCsm[csm.id].tasks.push({ ...t, customerName: proj.name });
    });

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const dateRange = fmtDate(startDate) + ' — ' + fmtDate(endDate);
    const results = [];

    // Send individual CSM emails
    for (const entry of Object.values(byCsm)) {
      const { csm, tasks: csmTasks } = entry;
      if (!csm.email) continue;

      // Group by date
      const byDate = {};
      csmTasks.forEach(t => {
        const d = t.proj_date;
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(t);
      });

      const customers = new Set(csmTasks.map(t => t.customerName));
      let body = `<div style="font-size:14px;color:#e8f0f8;margin-bottom:16px;">Week ahead: <strong style="color:#60a5fa;">${csmTasks.length}</strong> task${csmTasks.length !== 1 ? 's' : ''} across <strong>${customers.size}</strong> account${customers.size !== 1 ? 's' : ''}.</div>`;

      const sortedDates = Object.keys(byDate).sort();
      sortedDates.forEach(date => {
        const dayTasks = byDate[date];
        body += `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1521;border:1px solid #192d40;border-radius:12px;margin-bottom:10px;">
          <tr><td style="padding:10px 16px;border-bottom:1px solid #192d40;font-size:13px;font-weight:700;color:#60a5fa;letter-spacing:0.05em;">${fmtDate(date)}</td></tr>`;

        dayTasks.forEach((t, i) => {
          body += `<tr><td style="padding:8px 16px;${i < dayTasks.length - 1 ? 'border-bottom:1px solid #0f1e2d;' : ''}">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td>
                <div style="font-size:13px;font-weight:600;color:#e8f0f8;">${t.name}</div>
                <div style="font-size:11px;color:#4a6480;margin-top:2px;">${t.customerName} &middot; ${t.phase || '—'}</div>
              </td>
              <td style="text-align:right;vertical-align:top;">
                <span style="${priorityStyle(t.priority)}">${(t.priority || 'medium').toUpperCase()}</span>
              </td>
            </tr></table>
          </td></tr>`;
        });
        body += '</table>';
      });

      const result = await sendEmail(
        csm.email,
        `Upcoming Tasks — ${csmTasks.length} due in the next 5 days`,
        emailShell('Upcoming Task Reminder', dateRange, body)
      );
      results.push({ csm: csm.name, email: csm.email, tasks: csmTasks.length, result });
    }

    // Executive summary — recipients from notification_rules (env fallback)
    if (summaryTargets.to.length) {
      let execBody = `<div style="font-size:14px;color:#e8f0f8;margin-bottom:16px;">Team-wide: <strong style="color:#60a5fa;">${upcoming.length}</strong> tasks due in the next 5 business days.</div>`;

      for (const entry of Object.values(byCsm)) {
        const { csm, tasks: csmTasks } = entry;
        const byDate = {};
        csmTasks.forEach(t => {
          if (!byDate[t.proj_date]) byDate[t.proj_date] = [];
          byDate[t.proj_date].push(t);
        });

        execBody += `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1521;border:1px solid #192d40;border-radius:12px;margin-bottom:12px;">
          <tr><td style="padding:12px 16px;border-bottom:1px solid #192d40;">
            <span style="font-size:15px;font-weight:700;color:#e8f0f8;">${csm.name}</span>
            <span style="font-size:12px;color:#8fa3b8;margin-left:8px;">${csmTasks.length} task${csmTasks.length !== 1 ? 's' : ''}</span>
          </td></tr>`;

        Object.keys(byDate).sort().forEach(date => {
          byDate[date].forEach(t => {
            execBody += `<tr><td style="padding:6px 16px;">
              <div style="font-size:12px;color:#e8f0f8;">
                &bull; <span style="color:#8fa3b8;">${fmtDate(date)}</span> — ${t.name}
                <span style="color:#4a6480;">(${t.customerName})</span>
                <span style="${priorityStyle(t.priority)};margin-left:4px;">${(t.priority || '').toUpperCase()}</span>
              </div>
            </td></tr>`;
          });
        });
        execBody += '</table>';
      }

      const execResult = await sendEmail(
        summaryTargets.to,
        `Executive Summary — ${upcoming.length} Upcoming Tasks This Week`,
        emailShell('Executive Summary — Upcoming Tasks', dateRange, execBody),
        summaryTargets.cc
      );
      results.push({ exec: true, to: summaryTargets.to, cc: summaryTargets.cc, source: summaryTargets.source, result: execResult });
    }

    return res.status(200).json({ success: true, emailsSent: results.length, results });
  } catch (err) {
    console.error('Afternoon reminders error:', err);
    return res.status(500).json({ error: err.message });
  }
}
