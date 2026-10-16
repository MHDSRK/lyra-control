import webpush from 'web-push';
import { Resend } from 'resend';
import { createAdmin } from '@/lib/supabase-admin';

let configured = false;

function setupPush() {
  if (configured) return;

  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT;

  if (pub && priv && sub) {
    webpush.setVapidDetails(sub, pub, priv);
    configured = true;
  }
}

export async function sendPush(
  title: string,
  body: string,
  url = '/',
) {
  setupPush();
  if (!configured) return;

  const db = createAdmin();
  const { data: rows } = await db
    .from('lyra_push_subscriptions')
    .select('id, endpoint, subscription');

  for (const row of rows ?? []) {
    try {
      await webpush.sendNotification(
        row.subscription,
        Buffer.from(
          JSON.stringify({
            title,
            body,
            url,
            icon: '/icon.svg',
            badge: '/icon.svg',
          }),
        ),
      );
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await db
          .from('lyra_push_subscriptions')
          .delete()
          .eq('id', row.id);
      }
    }
  }
}

export async function sendFailureEmail(
  subject: string,
  body: string,
) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM;

  if (!key || !to || !from) return;

  const resend = new Resend(key);

  await resend.emails.send({
    from,
    to,
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h2>Lyra Control alert</h2><p>${escapeHtml(body).replace(/\n/g, '<br/>')}</p><p style="color:#778195;font-size:12px">This is an automated alert from Lyra Control.</p></div>`,
  });
}

export async function notifyOwner(
  title: string,
  body: string,
  url = '/',
) {
  await sendPush(title, body, url);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]!,
  );
}