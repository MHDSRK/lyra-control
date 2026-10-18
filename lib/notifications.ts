import webpush from 'web-push';
import { Resend } from 'resend';
import { createAdmin } from '@/lib/supabase-admin';

export type DeliveryResult = { status: 'accepted_by_provider' | 'failed' | 'not_configured'; acceptedCount: number; error?: string };
let configured = false;

function setupPush() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !sub) return false;
  webpush.setVapidDetails(sub, pub, priv);
  configured = true;
  return true;
}

export async function sendPush(title: string, body: string, url = '/', tag?: string): Promise<DeliveryResult> {
  if (!setupPush()) return { status: 'not_configured', acceptedCount: 0, error: 'VAPID keys are not configured' };
  const db = createAdmin();
  const { data: rows, error: queryError } = await db.from('lyra_push_subscriptions').select('id,endpoint,subscription');
  if (queryError) return { status: 'failed', acceptedCount: 0, error: 'Could not load push subscriptions' };
  if (!rows?.length) return { status: 'not_configured', acceptedCount: 0, error: 'No push subscriptions are registered' };
  let acceptedCount = 0;
  const failures: string[] = [];
  for (const row of rows) {
    try {
      await webpush.sendNotification(row.subscription, Buffer.from(JSON.stringify({ title, body, url, tag, icon: '/icon.svg', badge: '/icon.svg' })));
      acceptedCount += 1;
    } catch (error: any) {
      failures.push(String(error?.statusCode ?? error?.message ?? 'Push provider error'));
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        const { error: deleteError } = await db.from('lyra_push_subscriptions').delete().eq('id', row.id);
        if (deleteError) console.error('[Lyra push] Could not remove expired subscription', deleteError.message);
      }
    }
  }
  if (acceptedCount > 0) return { status: 'accepted_by_provider', acceptedCount };
  return { status: 'failed', acceptedCount: 0, error: failures.slice(0, 3).join('; ') || 'Push provider rejected all subscriptions' };
}

export async function sendFailureEmail(subject: string, body: string): Promise<DeliveryResult> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM;
  if (!key || !to || !from) return { status: 'not_configured', acceptedCount: 0, error: 'Resend or alert email settings are not configured' };
  try {
    const resend = new Resend(key);
    const { data, error } = await resend.emails.send({
      from, to, subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h2>Lyra Control alert</h2><p>${escapeHtml(body).replace(/\n/g, '<br/>')}</p><p style="color:#778195;font-size:12px">Provider acceptance does not confirm that the email was opened or read.</p></div>`,
    });
    if (error || !data?.id) return { status: 'failed', acceptedCount: 0, error: error?.message ?? 'Email provider did not return an accepted message ID' };
    return { status: 'accepted_by_provider', acceptedCount: 1 };
  } catch (error) {
    return { status: 'failed', acceptedCount: 0, error: error instanceof Error ? error.message : 'Email provider error' };
  }
}

export async function notifyOwner(title: string, body: string, url = '/', tag?: string) {
  return sendPush(title, body, url, tag);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
