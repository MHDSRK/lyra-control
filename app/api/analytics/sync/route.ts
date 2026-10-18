import { NextRequest, NextResponse } from 'next/server';
import { createAdmin } from '@/lib/supabase-admin';
import { extractCallEnrichment } from '@/lib/call-enrichment';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { SARVAM_API_KEY, SARVAM_ORG_ID, SARVAM_WORKSPACE_ID, SARVAM_APP_ID } = process.env;
  if (!SARVAM_API_KEY || !SARVAM_ORG_ID || !SARVAM_WORKSPACE_ID || !SARVAM_APP_ID) return NextResponse.json({ error: 'Sarvam analytics environment is incomplete' }, { status: 503 });
  const end = new Date(); const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const base = `https://apps.sarvam.ai/api/analytics/v1/${SARVAM_ORG_ID}/${SARVAM_WORKSPACE_ID}/${SARVAM_APP_ID}/interactions`;
  const url = new URL(base); url.searchParams.set('start_datetime', start.toISOString()); url.searchParams.set('end_datetime', end.toISOString()); url.searchParams.set('include_transcript', 'true');
  try {
    const response = await fetch(url, { headers: { 'X-API-Key': SARVAM_API_KEY }, cache: 'no-store' });
    if (!response.ok) return NextResponse.json({ error: 'Sarvam analytics request failed', status: response.status }, { status: 502 });
    const result = await response.json();
    const items = Array.isArray(result.items) ? result.items : [];
    const db = createAdmin(); let synced = 0; let failed = 0;
    for (const item of items) {
      const id = String(item.interaction_id ?? ''); if (!id) continue;
      const { data: existing, error: readError } = await db.from('lyra_calls').select('*').eq('interaction_id', id).maybeSingle();
      if (readError) { failed++; continue; }
      const vars = item.agent_variables ?? item.final_agent_variables ?? existing?.agent_variables ?? {};
      const incomingTranscript = item.interaction_transcript ?? item.transcript;
      const transcript = Array.isArray(incomingTranscript) && incomingTranscript.length ? incomingTranscript : existing?.transcript ?? null;
      const text = Array.isArray(transcript) ? transcript.map((t: any) => `${t.role === 'agent' ? 'Lyra' : 'Caller'}: ${t.en_text ?? t.indic_text ?? t.text ?? ''}`).join('\n') : existing?.transcript_text ?? '';
      const summary = vars.call_summary ?? vars.message_summary ?? vars.summary ?? existing?.summary ?? null;
      const outcome = vars.call_outcome ?? vars.call_disposition ?? existing?.outcome ?? null;
      const duration = Number(item.duration_in_seconds ?? item.duration ?? existing?.duration_seconds ?? 0);
      const enrichment = extractCallEnrichment(vars, item, text);
      const row = {
        interaction_id: id,
        caller_number: item.user_identifier ?? item.user_contact_identifier ?? item.user_phone_number ?? existing?.caller_number ?? null,
        agent_number: item.bot_contact ?? item.agent_phone_number ?? existing?.agent_number ?? null,
        started_at: item.start_datetime ?? existing?.started_at ?? null,
        ended_at: item.end_datetime ?? existing?.ended_at ?? null,
        duration_seconds: duration, summary, outcome, transcript, transcript_text: text || null,
        agent_variables: vars, urgent: Boolean(vars.urgent || vars.is_urgent || existing?.urgent),
        failed: String(item.connectivity_status ?? '').toLowerCase().includes('fail') || Boolean(existing?.failed),
        end_reason: item.end_reason ?? existing?.end_reason ?? null,
        raw_payload: item, received_at: existing?.received_at ?? new Date().toISOString(), updated_at: new Date().toISOString(),
        ...enrichment,
        // Backfill must not erase a richer webhook record or overwrite the owner's manual inbox status.
        inbox_status: existing?.inbox_status ?? enrichment.inbox_status,
        message_for: enrichment.message_for ?? existing?.message_for ?? null,
        message_for_canonical: enrichment.message_for_canonical ?? existing?.message_for_canonical ?? null,
        message_content: enrichment.message_content ?? existing?.message_content ?? null,
        message_saved: Boolean(enrichment.message_content || existing?.message_saved),
        message_urgency: enrichment.message_urgency ?? existing?.message_urgency ?? null,
        message_deadline: enrichment.message_deadline ?? existing?.message_deadline ?? null,
        recording_url: enrichment.recording_url ?? existing?.recording_url ?? null,
        recording_available: Boolean(enrichment.recording_url || existing?.recording_available),
        transcript_available: Boolean(text || existing?.transcript_available),
        summary_available: Boolean(summary || existing?.summary_available),
        reviewed_at: existing?.reviewed_at ?? null,
        message_reviewed_at: existing?.message_reviewed_at ?? null,
      };
      const { error } = await db.from('lyra_calls').upsert(row, { onConflict: 'interaction_id' });
      if (error) failed++; else synced++;
    }
    return NextResponse.json({ ok: true, synced, failed, window_days: 7 });
  } catch {
    return NextResponse.json({ error: 'Analytics sync failed' }, { status: 500 });
  }
}
