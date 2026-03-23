require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

let _resend;
function getResend() {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

const FROM = 'ByggSignal <hej@byggsignal.se>';
const SITE_URL = 'https://byggsignal.se';
const MAX_ITEMS = 5;

// ─── Helpers ───────────────────────────────────────────────────

function cutoffDate(frequency) {
  const now = new Date();
  if (frequency === 'daily') return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  // weekly
  return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('sv-SE');
}

function statusLabel(s) {
  const map = {
    'ansökt': 'Ansökt', 'beviljat': 'Beviljat', 'avslag': 'Avslag',
    'överklagat': 'Överklagat', 'startbesked': 'Startbesked', 'slutbesked': 'Slutbesked',
  };
  return map[s] || s || 'Okänd status';
}

function kommunLabel(kommuner) {
  if (kommuner.length === 1) return kommuner[0];
  if (kommuner.length <= 3) return kommuner.join(', ');
  return kommuner.length + ' kommuner';
}

// ─── Expand kommuner to full county ───────────────────────────

async function expandToCountyKommuner(kommuner) {
  // 1. Look up counties for the user's selected kommuner
  const { data: matches, error } = await supabase
    .from('municipalities')
    .select('county')
    .in('name', kommuner);

  if (error) {
    console.error('County lookup error:', error.message);
    return kommuner; // fallback to original list
  }

  const counties = [...new Set((matches || []).map(m => m.county))];
  if (counties.length === 0) return kommuner;

  // 2. Get all kommuner in those counties
  const { data: allInCounty, error: err2 } = await supabase
    .from('municipalities')
    .select('name')
    .in('county', counties);

  if (err2) {
    console.error('County expansion error:', err2.message);
    return kommuner;
  }

  const expanded = (allInCounty || []).map(m => m.name);
  console.log(`    County expansion: ${kommuner.join(', ')} → ${counties.join(', ')} (${expanded.length} kommuner)`);
  return expanded;
}

// ─── Fetch new permits ─────────────────────────────────────────

async function getNewPermits(kommuner, since) {
  const { data, error } = await supabase
    .from('permits_v2')
    .select('status, description, municipality, date, applicant')
    .in('municipality', kommuner)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) { console.error('Permit query error:', error.message); return []; }
  return data || [];
}

// ─── Fetch upcoming procurements ───────────────────────────────

async function getUpcomingProcurements(kommuner) {
  const today = new Date().toISOString().slice(0, 10);
  const weekOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('procurements')
    .select('title, municipality, deadline')
    .in('municipality', kommuner)
    .gte('deadline', today)
    .lte('deadline', weekOut)
    .order('deadline', { ascending: true })
    .limit(10);

  if (error) { console.error('Procurement query error:', error.message); return []; }
  return data || [];
}

// ─── Build HTML email ──────────────────────────────────────────

function buildEmail(user, permits, procurements) {
  const name = user.contact_name || 'du';
  const kommuner = user.selected_kommuner;
  const kommunStr = kommunLabel(kommuner);
  const count = permits.length;

  const subject = `${count} nya bygglov i ${kommunStr} — ByggSignal`;

  const permitRows = permits.slice(0, MAX_ITEMS).map(p => {
    const org = p.applicant ? ` — ${p.applicant}` : '';
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #f0ede8;">
        <strong>${statusLabel(p.status)}</strong> — ${p.description || 'Bygglovsärende'}${org}<br>
        <span style="color:#777;font-size:13px;">${p.municipality} · ${formatDate(p.date)}</span>
      </td>
    </tr>`;
  }).join('');

  const moreText = count > MAX_ITEMS
    ? `<p style="color:#666;font-size:14px;">...och ${count - MAX_ITEMS} till.</p>` : '';

  let procSection = '';
  if (procurements.length > 0) {
    const procRows = procurements.map(pr =>
      `<li style="margin-bottom:6px;"><strong>${pr.title}</strong> — ${pr.municipality} — Deadline ${formatDate(pr.deadline)}</li>`
    ).join('');
    procSection = `
      <div style="margin-top:24px;padding-top:16px;border-top:2px solid #f0ede8;">
        <p style="font-weight:600;color:#c47a20;margin-bottom:8px;">Upphandlingar som stänger snart:</p>
        <ul style="padding-left:18px;color:#333;font-size:14px;">${procRows}</ul>
      </div>`;
  }

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8f6f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">
  <div style="margin-bottom:24px;">
    <strong style="color:#1a2e1a;font-size:18px;">ByggSignal</strong>
  </div>
  <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e8e5df;">
    <p style="margin-top:0;color:#333;">Hej ${name},</p>
    <p style="color:#333;">Sedan senast har vi hittat <strong>${count} nya ärenden</strong> i dina bevakade kommuner:</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">${permitRows}</table>
    ${moreText}
    ${procSection}
    <div style="margin-top:24px;text-align:center;">
      <a href="${SITE_URL}" style="display:inline-block;padding:12px 28px;background:#4a7c59;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">Se alla leads på ByggSignal →</a>
    </div>
  </div>
  <p style="margin-top:20px;font-size:12px;color:#999;text-align:center;">
    Du får detta mail för att du bevakar ${kommunStr}.<br>
    <a href="${SITE_URL}/mitt-konto" style="color:#999;">Ändra inställningar i Mitt konto</a>
  </p>
</div>
</body></html>`;

  return { subject, html };
}

// ─── Send one notification ─────────────────────────────────────

async function sendNotification(user, permits, procurements) {
  const { subject, html } = buildEmail(user, permits, procurements);

  const { error } = await getResend().emails.send({
    from: FROM,
    to: user.email,
    subject,
    html,
  });

  if (error) {
    console.error(`  ✗ Failed to send to ${user.email}:`, error.message);
    return false;
  }

  // Update last_notified_at (or last_seen_at as fallback)
  const ts = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ last_notified_at: ts })
    .eq('id', user.id);
  if (updateErr) {
    await supabase.from('profiles').update({ last_seen_at: ts }).eq('id', user.id);
  }

  return true;
}

// ─── Main ──────────────────────────────────────────────────────

async function notifyUsers({ force = false, dryRun = false } = {}) {
  console.log('=== ByggSignal Notify ===', new Date().toISOString());

  // Fetch eligible users (try new column name, fall back to old)
  let users, error;
  ({ data: users, error } = await supabase
    .from('profiles')
    .select('id, email, contact_name, selected_kommuner, notification_frequency, last_notified_at')
    .neq('notification_frequency', 'none'));

  // Fallback if migration 008 hasn't been run yet
  if (error && error.message.includes('notification_frequency')) {
    console.log('Falling back to notis_frequency column');
    ({ data: users, error } = await supabase
      .from('profiles')
      .select('id, email, contact_name, selected_kommuner, notis_frequency, last_seen_at')
      .neq('notis_frequency', 'none'));
    // Map old column names
    if (users) users = users.map(u => ({
      ...u,
      notification_frequency: u.notis_frequency,
      last_notified_at: u.last_seen_at, // use last_seen_at as proxy
    }));
  }

  if (error) { console.error('Profile query error:', error.message); return { error: error.message }; }

  // Filter: must have email and non-empty selected_kommuner
  const eligible = (users || []).filter(u =>
    u.email &&
    Array.isArray(u.selected_kommuner) &&
    u.selected_kommuner.length > 0
  );

  console.log(`Found ${eligible.length} eligible users (of ${(users || []).length} total)`);

  const now = new Date();
  let sent = 0, skipped = 0, noMatch = 0;

  for (const user of eligible) {
    const freq = user.notification_frequency || 'weekly';

    // Check if enough time has passed since last notification
    if (!force && user.last_notified_at) {
      const last = new Date(user.last_notified_at);
      const hoursSince = (now - last) / (1000 * 60 * 60);
      if (freq === 'daily' && hoursSince < 20) { skipped++; continue; }
      if (freq === 'weekly' && hoursSince < 144) { skipped++; continue; } // ~6 days
    }

    const since = user.last_notified_at || cutoffDate(freq);
    const expandedKommuner = await expandToCountyKommuner(user.selected_kommuner);
    const permits = await getNewPermits(expandedKommuner, since);

    if (permits.length === 0) { noMatch++; continue; }

    const procurements = await getUpcomingProcurements(expandedKommuner);

    console.log(`  → ${user.email}: ${permits.length} permits, ${procurements.length} procurements`);

    if (dryRun) {
      const { subject, html } = buildEmail(user, permits, procurements);
      console.log(`    [DRY RUN] Subject: ${subject}`);
      console.log(`    [DRY RUN] Would send to: ${user.email}`);
      sent++;
      continue;
    }

    const ok = await sendNotification(user, permits, procurements);
    if (ok) sent++;
  }

  const summary = { sent, skipped, noMatch, total: eligible.length };
  console.log('Result:', JSON.stringify(summary));
  return summary;
}

// Run directly or export
// --force: bypass time check, --dry-run: show what would be sent without sending
if (require.main === module) {
  const force = process.argv.includes('--force');
  const dryRun = process.argv.includes('--dry-run');
  notifyUsers({ force, dryRun }).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { notifyUsers };
