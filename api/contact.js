import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
// Use a verified domain sender if you have one; defaults to Resend's shared sender.
const fromEmail = process.env.CONTACT_FROM_EMAIL || 'Leonistic <onboarding@resend.dev>';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Best-effort confirmation email. Never throws — a mail failure must not
// fail the submission, since the row is already saved.
async function sendConfirmation({ name, email }) {
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not set — skipping confirmation email.');
    return;
  }

  const firstName = name.split(/\s+/)[0] || name;
  const text =
    `Hi ${firstName},\n\n` +
    `Thanks for reaching out to Leonistic — your message just landed, and I'll get back to you personally soon.\n\n` +
    `Whatever you're building, measuring, or trying to understand, the aim is the same: one clear solution at a time.\n\n` +
    `Talk soon,\nLeo\nLeonistic — Build · Analyze · Explain`;

  const safeName = escapeHtml(firstName);
  const html =
    `<div style="font-family:Inter,Arial,sans-serif;color:#0B1F3A;line-height:1.6;font-size:16px">` +
    `<p>Hi ${safeName},</p>` +
    `<p>Thanks for reaching out to <strong>Leonistic</strong> — your message just landed, and I'll get back to you personally soon.</p>` +
    `<p>Whatever you're building, measuring, or trying to understand, the aim is the same: <em>one clear solution at a time.</em></p>` +
    `<p style="margin-top:24px">Talk soon,<br/>Leo</p>` +
    `<p style="color:#64748B;font-size:13px;letter-spacing:0.04em">Leonistic — Build · Analyze · Explain</p>` +
    `</div>`;

  try {
    const resend = new Resend(resendApiKey);
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: `Thanks for reaching out, ${name}`,
      text,
      html,
    });
    if (error) {
      console.error('Resend send error:', error);
    }
  } catch (err) {
    console.error('Resend threw while sending confirmation:', err);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables.');
    return res.status(500).json({ error: 'The contact form is not configured yet.' });
  }

  // Vercel parses JSON bodies automatically; fall back to {} for safety.
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { error } = await supabase
    .from('signups')
    .insert({ name, email, message: message || null });

  if (error) {
    console.error('Supabase insert error:', error);
    return res.status(500).json({ error: 'Something went wrong saving your message. Please try again.' });
  }

  // Row is saved — send the confirmation as a best-effort step.
  await sendConfirmation({ name, email });

  return res.status(200).json({ ok: true });
}
