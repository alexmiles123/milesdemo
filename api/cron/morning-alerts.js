// Monument — Morning Late Task Alert (8am CT / 13:00 UTC, weekdays)
// Sends individual emails to each CSM with their late tasks.
// Sends an executive summary to the notification_rules(event_type='task.late')
// recipients, with EXEC_EMAIL as a legacy fallback if the rules table is
// empty or missing.

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
  <!-- Header -->
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
  <!-- Title -->
  <tr><td style="padding:24px 0 8px 0;">
    <div style="font-size:20px;font-weight:800;color:#ef4444;letter-spacing:0.02em;">${title}</div>
    <div style="font-size:13px;color:#8fa3b8;margin-top:4px;">${subtitle}</div>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:16px 0 0 0;">${body}</td></tr>
  <!-- Footer -->
  <tr><td style="padding:28px 0 0 0;border-top:1px solid #192d40;margin-top:24px;">
    <div style="font-size:11px;color:#4a6480;text-align:center;line-height:1.8;">
      Monument PS Operations Platform &middot; Automated Alert<br>
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
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

export default async function handler(req, res) {
  // Fail closed: without CRON_SECRET set the endpoint is an open emailer.
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET not configured.' });
  const auth = req.headers['authorization'];
  if (auth !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Resolve exec-summary recipients (DB rule > EXEC_EMAIL env fallback)
    const summaryTargets = await resolveRecipients('task.late', { envFallbackTo: 'EXEC_EMAIL' });
    if (!summaryTargets.enabled) {
      return res.status(200).json({ message: 'task.late notifications disabled via rule.' });
    }

    // Fetch data
    const [tasks, projects, csms] = await Promise.all([
      sbGet('tasks', { status: 'eq.late', select: '*' }),
      sbGet('projects', { select: 'id,name,csm_id' }),
      sbGet('csms', { is_active: 'eq.true', select: 'id,name,email' }),
    ]);

    if (!tasks.length) {
      return res.status(200).json({ message: 'No late tasks — no emails sent.' });
    }

    // Build lookup maps
    const projectMap = {};
    projects.forEach(p => { projectMap[p.id] = p; });

    const csmMap = {};
    csms.forEach(c => { csmMap[c.id] = c; });

    // Group late tasks by CSM
    const byCsm = {};
    tasks.forEach(t => {
      const proj = projectMap[t.project_id];
      if (!proj) return;
      const csm = csmMap[proj.csm_id];
      if (!csm) return;

      if (!byCsm[csm.id]) byCsm[csm.id] = { csm, tasks: [] };
      const daysLate = Math.max(0, Math.round((Date.now() - new Date(t.proj_date).getTime()) / 86400000));
      byCsm[csm.id].tasks.push({ ...t, customerName: proj.name, daysLate });
    });

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const results = [];

    // Send individual CSM emails
    for (const entry of Object.values(byCsm)) {
      const { csm, tasks: csmTasks } = entry;
      if (!csm.email) continue;

      // Group tasks by customer
      const byCustomer = {};
      csmTasks.forEach(t => {
        if (!byCustomer[t.customerName]) byCustomer[t.customerName] = [];
        byCustomer[t.customerName].push(t);
      });

      let body = `<div style="font-size:14px;color:#e8f0f8;margin-bottom:16px;">You have <strong style="color:#ef4444;">${csmTasks.length}</strong> late task${csmTasks.length !== 1 ? 's' : ''} across <strong>${Object.keys(byCustomer).length}</strong> account${Object.keys(byCustomer).length !== 1 ? 's' : ''}.</div>`;

      for (const [customer, custTasks] of Object.entries(byCustomer)) {
        body += `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1521;border:1px solid #192d40;border-radius:12px;margin-bottom:12px;">
          <tr><td style="padding:12px 16px;border-bottom:1px solid #192d40;font-size:15px;font-weight:700;color:#e8f0f8;">${customer}</td></tr>`;

        custTasks.sort((a, b) => b.daysLate - a.daysLate);
        custTasks.forEach((t, i) => {
          body += `<tr><td style="padding:10px 16px;${i < custTasks.length - 1 ? 'border-bottom:1px solid #0f1e2d;' : ''}">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:13px;font-weight:600;color:#e8f0f8;">${t.name}</td>
              <td style="text-align:right;white-space:nowrap;">
                <span style="color:#ef4444;font-weight:800;font-size:13px;margin-right:8px;">+${t.daysLate}d late</span>
                <span style="${priorityStyle(t.priority)}">${(t.priority || 'medium').toUpperCase()}</span>
              </td>
            </tr><tr>
              <td colspan="2" style="font-size:11px;color:#4a6480;padding-top:3px;">Due: ${fmtDate(t.proj_date)} &middot; Phase: ${t.phase || '—'}</td>
            </tr></table>
          </td></tr>`;
        });
        body += '</table>';
      }

      body += `<div style="margin-top:16px;padding:12px 16px;background:#0d1e38;border:1px solid #1a3a5f;border-radius:8px;font-size:12px;color:#60a5fa;">Please review and update projected dates in <a href="${process.env.APP_URL || 'https://milesdemo-beta.vercel.app'}" style="color:#60a5fa;font-weight:700;">Monument</a>.</div>`;

      const result = await sendEmail(
        csm.email,
        `Late Task Alert — ${csmTasks.length} task${csmTasks.length !== 1 ? 's' : ''} need attention`,
        emailShell('Late Task Alert', today, body)
      );
      results.push({ csm: csm.name, email: csm.email, tasks: csmTasks.length, result });
    }

    // Send executive summary to the recipients resolved above
    if (summaryTargets.to.length) {
      let execBody = `<div style="font-size:14px;color:#e8f0f8;margin-bottom:16px;">Portfolio-wide: <strong style="color:#ef4444;">${tasks.length}</strong> late tasks across <strong>${new Set(tasks.map(t => t.project_id)).size}</strong> accounts.</div>`;

      for (const entry of Object.values(byCsm)) {
        const { csm, tasks: csmTasks } = entry;
        const byCustomer = {};
        csmTasks.forEach(t => {
          if (!byCustomer[t.customerName]) byCustomer[t.customerName] = [];
          byCustomer[t.customerName].push(t);
        });

        execBody += `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1521;border:1px solid #192d40;border-radius:12px;margin-bottom:12px;">
          <tr><td style="padding:12px 16px;border-bottom:1px solid #192d40;">
            <span style="font-size:15px;font-weight:700;color:#e8f0f8;">${csm.name}</span>
            <span style="font-size:12px;color:#8fa3b8;margin-left:8px;">${csmTasks.length} late task${csmTasks.length !== 1 ? 's' : ''}</span>
          </td></tr>`;

        for (const [customer, custTasks] of Object.entries(byCustomer)) {
          execBody += `<tr><td style="padding:8px 16px;">
            <div style="font-size:13px;font-weight:600;color:#8fa3b8;margin-bottom:4px;">${customer}</div>`;
          custTasks.forEach(t => {
            execBody += `<div style="font-size:12px;color:#e8f0f8;padding:3px 0;">
              &bull; ${t.name} <span style="color:#ef4444;font-weight:700;">(${t.daysLate}d late)</span>
              <span style="${priorityStyle(t.priority)};margin-left:4px;">${(t.priority || 'medium').toUpperCase()}</span>
            </div>`;
          });
          execBody += '</td></tr>';
        }
        execBody += '</table>';
      }

      const execResult = await sendEmail(
        summaryTargets.to,
        `Executive Summary — ${tasks.length} Late Tasks Across Portfolio`,
        emailShell('Executive Summary — Late Tasks', today, execBody),
        summaryTargets.cc
      );
      results.push({ exec: true, to: summaryTargets.to, cc: summaryTargets.cc, source: summaryTargets.source, result: execResult });
    }

    return res.status(200).json({ success: true, emailsSent: results.length, results });
  } catch (err) {
    console.error('Morning alerts error:', err);
    return res.status(500).json({ error: err.message });
  }
}
