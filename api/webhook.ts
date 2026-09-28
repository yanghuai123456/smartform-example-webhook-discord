// api/webhook.ts — Vercel Edge Function. Forwards SmartForm submissions to Discord.
import type { NextRequest } from 'next/server';
import { verifySignature } from '../lib/verify';

export const config = { runtime: 'edge' };

interface SmartFormPayload {
  event: 'submission.created';
  submitted_at: string;
  form:    { id: string; form_id: string; name: string };
  submission: {
    id: string;
    data: Record<string, unknown>;
    is_spam: boolean;
    spam_confidence: number;
    intent_label: string;
    intent_confidence: number;
    is_high_value: boolean;
    ai_summary: string;
    ip_address: string;
    user_agent: string;
  };
}

export default async function handler(req: NextRequest) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const body    = await req.text();
  const sig     = req.headers.get('X-SmartForm-Signature');
  const secret  = process.env.SMARTFORM_HMAC_SECRET || '';
  const discord = process.env.DISCORD_WEBHOOK_URL;

  if (!discord)              return new Response('DISCORD_WEBHOOK_URL not set', { status: 500 });
  if (!verifySignature(body, sig, secret)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event: SmartFormPayload = JSON.parse(body);
  if (event.event !== 'submission.created') return new Response('ok', { status: 200 });

  const s = event.submission;
  const fields = Object.entries(s.data || {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([name, value]) => ({ name, value: String(value).slice(0, 1024), inline: true }));

  const embed = {
    title:       s.is_high_value ? '🔥 High-value lead' : (s.is_spam ? '🛡️ Spam submission' : 'New form submission'),
    description: s.ai_summary || '_(no AI summary)_',
    color:       s.is_spam ? 0x991b1b : s.is_high_value ? 0x7c3aed : 0x2563eb,
    fields:      fields.slice(0, 25),
    footer:      { text: `form=${event.form.form_id}  intent=${s.intent_label} (${s.intent_confidence.toFixed(2)})  spam=${s.spam_confidence.toFixed(2)}` },
    timestamp:   event.submitted_at,
  };

  const r = await fetch(discord, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ embeds: [embed] }),
  });

  if (!r.ok) {
    return new Response(`Discord ${r.status}: ${await r.text()}`, { status: 502 });
  }
  return new Response('ok', { status: 200 });
}
