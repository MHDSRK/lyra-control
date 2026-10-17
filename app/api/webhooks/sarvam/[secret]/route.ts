import { NextRequest, NextResponse } from 'next/server';
import { createAdmin } from '@/lib/supabase-admin';
import { notifyOwner, sendFailureEmail, type DeliveryResult } from '@/lib/notifications';
import { extractCallEnrichment } from '@/lib/call-enrichment';

export const runtime = 'nodejs';
type Turn = { role?: string; en_text?: string | null; indic_text?: string | null };
type Payload = {
  app_id?: string; interaction_id?: string; user_phone_number?: string; agent_phone_number?: string;
  duration?: number; start_datetime?: string | null; end_datetime?: string | null;
  final_agent_variables?: Record<string, unknown> | null; output_agent_variables?: Record<string, unknown> | null;
  interaction_transcript?: Turn[] | null; metadata?: Record<string, unknown> | null;
  recording_url?: string | null; audio_url?: string | null; recording_link?: string | null;
};
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    return ['name','message','code','details','hint'].filter((key) => e[key] != null).map((key) => `${key}: ${String(e[key])}`).join('\n') || 'Unknown object error';
  }
  return String(error || 'Unknown error');
}
async function recordDelivery(db: ReturnType<typeof createAdmin>, interactionId: string, channel: 'push'|'email', eventType: string, result: DeliveryResult) {
  const dedupeKey = `${interactionId}:${channel}:v1`;
  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await db.from('lyra_notification_events').upsert({
    interaction_id: interactionId, dedupe_key: dedupeKey, channel, event_type: eventType, status: result.status,
    provider_accepted_count: result.acceptedCount, attempted_at: now, error_message: result.error ?? null,
  }, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id').maybeSingle();
  if (insertError) throw insertError;
  if (inserted) return;
  // A webhook retry must not send a second alert after the provider has accepted the first.
  const { data: existing, error: readError } = await db.from('lyra_notification_events').select('status').eq('dedupe_key', dedupeKey).maybeSingle();
  if (readError) throw readError;
  if (existing?.status === 'accepted_by_provider') return;
  const { error: updateError } = await db.from('lyra_notification_events').update({ event_type: eventType, status: result.status, provider_accepted_count: result.acceptedCount, attempted_at: now, error_message: result.error ?? null }).eq('dedupe_key', dedupeKey);
  if (updateError) throw updateError;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const expected = process.env.SARVAM_WEBHOOK_SECRET;
  if (!expected || secret !== expected) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let payload: Payload;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!payload.interaction_id) return NextResponse.json({ error: 'Missing interaction_id' }, { status: 400 });

  let stage = 'initialization';
  try {
    const db = createAdmin();
    const vars = { ...(payload.final_agent_variables ?? {}), ...(payload.output_agent_variables ?? {}) };
    const transcript = payload.interaction_transcript ?? [];
    const transcriptText = transcript.map((turn) => `${turn.role === 'agent' ? 'Lyra' : 'Caller'}: ${turn.en_text ?? turn.indic_text ?? ''}`).join('\n');
    const summary = String(vars.call_summary ?? vars.message_summary ?? vars.summary ?? '');
    const outcome = String(vars.call_outcome ?? vars.call_disposition ?? '');
    const duration = Number(payload.duration ?? 0);
    const failed = duration <= 0;
    const urgent = Boolean(vars.urgent || vars.is_urgent || (vars.follow_up_required && String(vars.priority ?? '').toLowerCase() === 'urgent'));
    const enrichment = extractCallEnrichment(vars, { ...payload, duration }, transcriptText);
    const row = {
      interaction_id: payload.interaction_id, caller_number: payload.user_phone_number ?? null,
      agent_number: payload.agent_phone_number ?? null, started_at: payload.start_datetime ?? null,
      ended_at: payload.end_datetime ?? null, duration_seconds: duration, summary: summary || null,
      outcome: outcome || null, transcript, transcript_text: transcriptText || null, agent_variables: vars,
      urgent, failed, end_reason: String(vars.end_reason ?? '') || null, raw_payload: payload,
      received_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...enrichment,
    };
    stage = 'saving call to Supabase';
    const { error } = await db.from('lyra_calls').upsert(row, { onConflict: 'interaction_id' });
    if (error) throw error;

    const caller = payload.user_phone_number ?? 'Unknown caller';
    const message = enrichment.message_content;
    const eventType = urgent || failed ? 'technical_failure_or_urgent' : message ? 'message' : 'routine';
    const title = urgent ? 'Lyra: urgent call' : failed ? 'Lyra: call failed' : message ? 'Lyra: message captured' : 'Lyra: call completed';
    const reason = String(vars.urgent_reason ?? vars.urgency_reason ?? outcome ?? vars.end_reason ?? 'Urgent call needs review');
    const action = String(vars.requested_action ?? vars.action_required ?? (message ? 'Review the captured message' : 'Review this call'));
    const body = urgent
      ? `${caller} · ${reason} · Action: ${action}`
      : failed
        ? `${caller} · Call failed or ended before a duration was recorded. Call record saved in Lyra. ${String(vars.end_reason ?? outcome ?? 'Reason unavailable')}`
        : message
          ? `${caller} · Message for ${enrichment.message_for_canonical ?? enrichment.message_for ?? 'Sharookh'}: ${message}`
          : `${caller} · ${Math.round(duration)} seconds${summary ? ` · ${summary}` : ''}`;
    stage = 'sending push notification';
    const pushResult = await notifyOwner(title, body, `/?call=${encodeURIComponent(payload.interaction_id)}`, `call-${payload.interaction_id}`);
    await recordDelivery(db, payload.interaction_id, 'push', eventType, pushResult);

    if (urgent || failed) {
      stage = 'sending attention email';
      const emailResult = await sendFailureEmail(`Lyra alert: ${caller}`, `A call may need your attention.\nCaller: ${caller}\nReason: ${reason}\nRequested action: ${action}\nCall record saved in Lyra: yes\nDuration: ${duration}s\nOutcome: ${outcome || 'Not provided'}\nSummary: ${summary || 'No summary available'}\nInteraction: ${payload.interaction_id}`);
      await recordDelivery(db, payload.interaction_id, 'email', eventType, emailResult);
    }
    return NextResponse.json({ ok: true, call_saved: true, push_status: pushResult.status, push_provider_accepted_count: pushResult.acceptedCount });
  } catch (error) {
    const errorDetails = describeError(error);
    console.error('[Sarvam webhook] Processing failed', { interactionId: payload.interaction_id, stage, error: errorDetails });
    try {
      const emailResult = await sendFailureEmail('Lyra Control: webhook processing failed', `Sarvam webhook processing failed.\nInteraction ID: ${payload.interaction_id}\nStage: ${stage}\nError:\n${errorDetails}`);
      console.error('[Sarvam webhook] Failure email result', { interactionId: payload.interaction_id, status: emailResult.status });
    } catch (emailError) {
      console.error('[Sarvam webhook] Failure alert email also failed', { interactionId: payload.interaction_id, error: describeError(emailError) });
    }
    return NextResponse.json({ error: 'Webhook processing failed', stage }, { status: 500 });
  }
}
