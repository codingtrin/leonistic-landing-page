import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import Groq from 'groq-sdk';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;
const fromEmail = process.env.CONTACT_FROM_EMAIL || 'Leonistic <onboarding@resend.dev>';
const summaryTo = process.env.SUMMARY_TO_EMAIL || 'professional.leonicholas@gmail.com';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPrompt(signups) {
  const lines = signups
    .map((s, i) => {
      const when = s.created_at ? new Date(s.created_at).toISOString() : 'unknown time';
      const msg = s.message && s.message.trim() ? s.message.trim() : '(no message)';
      return `${i + 1}. ${s.name} <${s.email}> — ${when}\n   Message: ${msg}`;
    })
    .join('\n');

  return (
    `You are the assistant for Leonistic, a studio that builds software, analyzes data, and explains technology. ` +
    `Below are the contact-form submissions from the last 24 hours. ` +
    `Write a concise daily briefing for the founder: start with a one-line headline, then 2-5 short bullet points ` +
    `covering who reached out, what they seem to want, and any common themes or high-priority leads. ` +
    `Be clear and direct, no filler. If a message is empty, just note the contact.\n\n` +
    `Submissions (${signups.length}):\n${lines}`
  );
}

async function summarize(signups) {
  if (!groqApiKey) {
    console.warn('GROQ_API_KEY not set — sending summary without an AI overview.');
    return '';
  }
  try {
    const groq = new Groq({ apiKey: groqApiKey });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: buildPrompt(signups) }],
    });
    return completion.choices[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('Groq summary error:', err);
    return '';
  }
}

/**
 * Read the last 24h of signups, summarize them with Groq, and email the
 * briefing via Resend. Best-effort on the email; throws only on hard
 * configuration / query failures so callers can map them to a status.
 * Returns { ok, count, emailed }.
 */
export async function runBriefing() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables.');
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase
    .from('signups')
    .select('name, email, message, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }

  const signups = data || [];

  // Nothing came in — skip the LLM call and the email entirely.
  if (signups.length === 0) {
    console.log('No signups in the last 24h; skipping summary email.');
    return { ok: true, count: 0, emailed: false };
  }

  const summaryText = await summarize(signups);

  const dateLabel = new Date().toISOString().slice(0, 10);
  const plural = signups.length === 1 ? '' : 's';
  const subject = `Leonistic daily summary — ${signups.length} new submission${plural}`;

  const listText = signups
    .map((s) => `• ${s.name} <${s.email}>${s.message && s.message.trim() ? ` — ${s.message.trim()}` : ''}`)
    .join('\n');
  const text = (summaryText ? summaryText + '\n\n' : '') + `Raw submissions (${signups.length}):\n${listText}`;

  const summaryHtml = summaryText
    ? `<div style="white-space:pre-wrap">${escapeHtml(summaryText)}</div>`
    : `<p style="color:#64748B">(AI summary unavailable — raw list below.)</p>`;
  const listHtml = signups
    .map(
      (s) =>
        `<li style="margin-bottom:6px"><strong>${escapeHtml(s.name)}</strong> &lt;${escapeHtml(s.email)}&gt;` +
        `${s.message && s.message.trim() ? ' — ' + escapeHtml(s.message.trim()) : ''}</li>`,
    )
    .join('');
  const html =
    `<div style="font-family:Inter,Arial,sans-serif;color:#0B1F3A;line-height:1.6;font-size:15px">` +
    `<h2 style="font-size:18px;margin:0 0 12px">Daily summary — ${dateLabel}</h2>` +
    summaryHtml +
    `<h3 style="font-size:12px;color:#64748B;margin:22px 0 8px;text-transform:uppercase;letter-spacing:0.1em">Submissions (${signups.length})</h3>` +
    `<ul style="padding-left:18px;margin:0">${listHtml}</ul>` +
    `<p style="color:#64748B;font-size:12px;letter-spacing:0.04em;margin-top:24px">Leonistic — Build · Analyze · Explain</p>` +
    `</div>`;

  let emailed = false;
  if (resendApiKey) {
    try {
      const resend = new Resend(resendApiKey);
      const { error: mailError } = await resend.emails.send({
        from: fromEmail,
        to: summaryTo,
        subject,
        text,
        html,
      });
      if (mailError) console.error('Resend summary error:', mailError);
      else emailed = true;
    } catch (err) {
      console.error('Resend threw while sending summary:', err);
    }
  } else {
    console.warn('RESEND_API_KEY not set — summary not emailed.');
  }

  return { ok: true, count: signups.length, emailed };
}
