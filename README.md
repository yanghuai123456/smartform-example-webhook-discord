# Discord contact form webhook — Formspree alternative with AI spam filtering

Receive SmartForm webhook events and forward every new submission to a Discord channel
as a rich embed.

## What your webhook receives

SmartForm POSTs a JSON event to your webhook URL on every submission.
The body mirrors the same field structure as the public form endpoint:

**Your submission fields** — `name`, `email`, `message`, etc.
exactly as the form sent them.

**Reserved fields** — names starting with `_` are stripped before
the webhook fires (they are control fields, not user data). The
honeypot drop (`_gotcha` filled) means the webhook is **not** called
— the submission is silently discarded.

| Field | In webhook payload? | Notes |
|---|---|---|
| ``_gotcha`` | No | Drop trigger — never sent. |
| ``_next`` | No | UX control, stripped. |
| ``_subject`` | No | UX control, stripped. |
| `submission_id` | Yes (added) | Server-generated UUID for idempotency. |
| `is_spam` | Yes (added) | AI classification result. |
| `intent` | Yes (added) | `sales` / `support` / `inquiry` / `spam` (Pro). |
| `timestamp` | Yes (added) | Server time in ISO 8601. |

Field names are Formspree-compatible — the SmartForm form
endpoint and your webhook use the same conventions.

## How it works

```
Browser  →  SmartForm AI  →  POST this Vercel function  →  Discord webhook
                                       │
                                       └─ verifies X-SmartForm-Signature
                                          before forwarding
```

1. You create a form in https://usesmartform.com/dashboard.
2. In the form settings, set **Webhook URL** to your deployed Vercel function URL
   (e.g. `https://smartform-discord.vercel.app/api/webhook`).
3. SmartForm posts every new submission to that URL (signed with HMAC-SHA256).
4. This function verifies the signature, builds a Discord embed, and forwards to your
   Discord channel webhook.

## Setup

1. Get a Discord webhook URL: in your Discord server, channel settings → Integrations
   → Webhooks → New webhook → Copy URL.
2. Clone, install, configure, deploy:
   ```bash
   git clone https://github.com/yanghuai123456/smartform-example-webhook-discord.git
   cd smartform-example-webhook-discord
   npm install
   vercel link
   vercel env add DISCORD_WEBHOOK_URL      # paste the URL from step 1
   vercel env add SMARTFORM_HMAC_SECRET    # contact SmartForm support or check your workspace settings
   vercel deploy --prod
   ```
3. In SmartForm dashboard, set the form's Webhook URL to
   `https://<your-deployment>.vercel.app/api/webhook`.

## The function

```ts
// api/webhook.ts — Vercel Edge Function
export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await req.text();

  if (!verifySignature(body, req.headers.get('X-SmartForm-Signature'))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(body);
  if (event.event !== 'submission.created') return new Response('ok', { status: 200 });

  const s = event.submission;
  const fields = Object.entries(s.data || {}).map(([k, v]) => ({
    name: k, value: String(v).slice(0, 1024), inline: true,
  }));

  const embed = {
    title:       s.is_high_value ? '🔥 High-value lead' : 'New form submission',
    description: s.ai_summary || '_(no AI summary)_',
    color:       s.is_spam ? 0x991b1b : s.is_high_value ? 0x7c3aed : 0x2563eb,
    fields:      fields.slice(0, 25),                    // Discord limit
    footer:      { text: `intent=${s.intent_label} spam=${s.spam_confidence.toFixed(2)}` },
    timestamp:   event.submitted_at,
  };

  await fetch(process.env.DISCORD_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  return new Response('ok', { status: 200 });
}
```

`verifySignature()` is in `lib/verify.ts` — it recomputes HMAC-SHA256 with your shared secret
and compares it to the `X-SmartForm-Signature: sha256=<hex>` header.

## Webhook payload (from SmartForm)

```json
{
  "event": "submission.created",
  "submitted_at": "2026-09-28T07:54:00Z",
  "form": { "id": "...", "form_id": "f_abc12345", "name": "Contact form" },
  "submission": {
    "id": "01HXXX...",
    "data": { "name": "Ada", "email": "ada@example.com", "message": "Hello!" },
    "is_spam": false,
    "spam_confidence": 0.02,
    "intent_label": "sales",
    "intent_confidence": 0.93,
    "is_high_value": true,
    "ai_summary": "Visitor asks about pricing; mentions a 5-person team.",
    "ip_address": "203.0.113.5",
    "user_agent": "Mozilla/5.0 ..."
  }
}
```

Header: `X-SmartForm-Signature: sha256=<hmac_hex>`

## Local test

```bash
npx vercel dev
# POST a fake payload to http://localhost:3000/api/webhook
curl -X POST http://localhost:3000/api/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-SmartForm-Signature: sha256=<compute locally with your secret>' \
  -d @sample-payload.json
```


## FAQ

### Why use this instead of Formspree?

At the basic level, SmartForm and Formspree are very similar: get a
form ID, POST a plain HTML form to a hosted endpoint with `_gotcha`
for spam filtering, and the API delivers the submission. The reserved
fields (`_gotcha`, `_next`, `_subject`, honeypot aliases) are
Formspree-compatible — a migration does not require renaming
anything.

The differences are operational, not API surface:

- **No email confirmation flow.** Formspree requires verifying your
  domain before submissions reach your inbox; SmartForm submissions
  land in your dashboard immediately.
- **AI spam filtering on the free tier.** Formspree's free tier uses
  only a honeypot field, which catches naive bots but lets semantic
  spam through. SmartForm applies AI-based classification by default,
  free of charge.
- **AI intent classification** (`sales` / `support` / `inquiry`
  / `spam`) on the Pro tier, for routing submissions without writing
  rules yourself.
- **No per-submission metering** on the basic plan.

### Is there a free tier?

Yes. AI spam filtering is enabled by default on every plan. AI intent
classification and high-value lead detection require a paid plan (Pro
or Business) — the dashboard enforces this and returns HTTP 402 if
you try to enable them on a free workspace.

### Do I need an API key?

No. The form posts directly to a public endpoint using only an 8-char
form ID, which is non-enumerable. The example also includes a hidden
`_gotcha` honeypot field so naive bots cannot submit.

### Does it verify the Discord signature?
No. This is a Discord-format *sender*, not a Discord event receiver.

## Related examples
[Slack webhook example](https://github.com/yanghuai123456/smartform-example-webhook-slack) | [SmartForm JS SDK](https://github.com/yanghuai123456/smartform-js)


## License

MIT.

