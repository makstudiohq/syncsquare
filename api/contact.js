const ALLOWED_TOPICS = new Set([
  'A private demo',
  'Early access',
  'Security & data handling',
  'Partnerships',
  'Something else'
]);

const recentRequests = globalThis.__syncsquareContactRequests || new Map();
globalThis.__syncsquareContactRequests = recentRequests;

function respond(response, status, payload) {
  response.status(status).json(payload);
}

function singleLine(value, limit) {
  return String(value || '').replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function multiLine(value, limit) {
  return String(value || '').replace(/\r\n?/g, '\n').replace(/\0/g, '').trim().slice(0, limit);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character]);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function sendEmail(apiKey, payload, idempotencyKey) {
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(payload)
  });
  const body = await result.text();
  if (!result.ok) throw new Error(`Resend returned ${result.status}: ${body.slice(0, 300)}`);
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return respond(response, 405, { ok: false, message: 'Method not allowed.' });
  }

  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > 32768) return respond(response, 413, { ok: false, message: 'That message is too large.' });

  const requestHost = String(request.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  const origin = String(request.headers.origin || '');
  if (origin && requestHost) {
    try {
      if (new URL(origin).hostname.toLowerCase() !== requestHost) {
        return respond(response, 403, { ok: false, message: 'Request origin was not accepted.' });
      }
    } catch {
      return respond(response, 403, { ok: false, message: 'Request origin was not accepted.' });
    }
  }

  let input = request.body || {};
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { input = {}; }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};

  if (singleLine(input.website, 200)) return respond(response, 200, { ok: true });
  const startedAt = Number(input.started_at || 0);
  if (startedAt > 0 && Date.now() - startedAt < 900) return respond(response, 200, { ok: true });

  const name = singleLine(input.name, 120);
  const email = singleLine(input.email, 254);
  const firm = singleLine(input.firm, 160);
  const requestedTopic = singleLine(input.topic || 'A private demo', 100);
  const topic = ALLOWED_TOPICS.has(requestedTopic) ? requestedTopic : 'Something else';
  const message = multiLine(input.message, 5000);
  if (!name || !message || !validEmail(email)) {
    return respond(response, 422, { ok: false, message: 'Please check your name, work email and message.' });
  }

  const apiKey = process.env.RESEND_API_KEY || '';
  const from = process.env.RESEND_FROM || '';
  const recipients = String(process.env.CONTACT_TO || '').split(',').map((item) => item.trim()).filter(validEmail);
  const replyTo = validEmail(process.env.CONTACT_REPLY_TO || '') ? process.env.CONTACT_REPLY_TO : recipients[0];
  if (!apiKey || !from || !recipients.length) {
    console.error('SyncSquare contact form is missing Resend environment variables.');
    return respond(response, 503, { ok: false, message: 'Message delivery is temporarily unavailable. Please try again shortly.' });
  }

  const clientAddress = String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const rateKey = `${clientAddress}:${email.toLowerCase()}`;
  const previousAttempt = recentRequests.get(rateKey) || 0;
  if (Date.now() - previousAttempt < 45000) {
    return respond(response, 429, { ok: false, message: 'Please wait a moment before sending another message.' });
  }
  recentRequests.set(rateKey, Date.now());

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeFirm = escapeHtml(firm || 'Not provided');
  const safeTopic = escapeHtml(topic);
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');
  const fingerprint = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    await sendEmail(apiKey, {
      from,
      to: recipients,
      reply_to: email,
      subject: `New SyncSquare enquiry from ${name}${firm ? ` - ${firm}` : ''}`,
      html: `<div style="font-family:Arial,sans-serif;color:#0B0C0E;max-width:640px"><h1 style="font-size:24px;margin:0 0 24px">New SyncSquare enquiry</h1><p><strong>Name:</strong> ${safeName}</p><p><strong>Work email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p><p><strong>Firm:</strong> ${safeFirm}</p><p><strong>Topic:</strong> ${safeTopic}</p><div style="margin-top:24px;padding:20px;background:#F4F4F2;border-left:3px solid #1F7A8C;line-height:1.6">${safeMessage}</div><p style="margin-top:24px;color:#7A7E87;font-size:13px">Reply to this email to answer ${safeName} directly.</p></div>`,
      text: `New SyncSquare enquiry\n\nName: ${name}\nWork email: ${email}\nFirm: ${firm || 'Not provided'}\nTopic: ${topic}\n\nMessage:\n${message}`
    }, `lead-${fingerprint}`);

    const firstNameRaw = name.split(/\s+/)[0] || name;
    const firstName = escapeHtml(firstNameRaw);
    const logoUrl = 'https://www.syncsquare.io/brand/syncsquare-email.png';
    await sendEmail(apiKey, {
      from,
      to: [email],
      reply_to: replyTo,
      subject: 'Your note is with us | SyncSquare',
      html: `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#F3F4F1;color:#0B0C0E;font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">A SyncSquare co-founder will be in touch within one business day.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#F3F4F1">
    <tr>
      <td align="center" style="padding:36px 16px">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#FFFFFF;border:1px solid #DDE0DB;border-collapse:separate">
          <tr><td style="height:5px;background:#1F7A8C;font-size:0;line-height:0">&nbsp;</td></tr>
          <tr>
            <td style="padding:34px 42px 24px">
              <img src="${logoUrl}" width="210" height="52" alt="SyncSquare" style="display:block;width:210px;max-width:100%;height:52px;border:0">
            </td>
          </tr>
          <tr>
            <td style="padding:8px 42px 42px">
              <p style="margin:0 0 18px;color:#1F7A8C;font-size:12px;font-weight:700;line-height:1.4;letter-spacing:1.6px;text-transform:uppercase">Message received</p>
              <h1 style="margin:0 0 26px;color:#0B0C0E;font-size:34px;font-weight:600;line-height:1.15;letter-spacing:0">Your note is with us.</h1>
              <p style="margin:0 0 18px;color:#30343A;font-size:16px;line-height:1.7">Hi ${firstName},</p>
              <p style="margin:0 0 18px;color:#30343A;font-size:16px;line-height:1.7">Thank you for reaching out to SyncSquare. One of our co-founders will read your note personally and be in touch within one business day.</p>
              <p style="margin:0 0 30px;color:#30343A;font-size:16px;line-height:1.7">If there is anything useful to add in the meantime, simply reply to this email.</p>
              <p style="margin:0;color:#0B0C0E;font-size:16px;font-weight:600;line-height:1.6">The SyncSquare co-founders</p>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 42px;background:#0B0C0E;color:#FAFAF9">
              <p style="margin:0;font-size:20px;font-weight:600;line-height:1.4;letter-spacing:0">Everything your company knows,<br><span style="color:#7FC4D4">in one square.</span></p>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0;color:#737870;font-size:12px;line-height:1.6">SyncSquare &middot; <a href="https://www.syncsquare.io" style="color:#737870;text-decoration:underline">syncsquare.io</a></p>
      </td>
    </tr>
  </table>
</body>
</html>`,
      text: `Hi ${firstNameRaw},\n\nThank you for reaching out to SyncSquare. One of our co-founders will read your note personally and be in touch within one business day.\n\nIf there is anything useful to add in the meantime, simply reply to this email.\n\nThe SyncSquare co-founders\n\nEverything your company knows, in one square.`
    }, `ack-${fingerprint}`);
  } catch (error) {
    recentRequests.delete(rateKey);
    console.error(error);
    return respond(response, 502, { ok: false, message: 'Your message could not be sent. Please try again.' });
  }

  return respond(response, 200, { ok: true });
}
