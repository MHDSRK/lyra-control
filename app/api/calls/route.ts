import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { createAdmin } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  try {
    await requireOwner();
    const url = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100));
    const db = createAdmin();
    let query = db.from('lyra_calls').select('*').order('started_at', { ascending: false }).limit(limit);
    const caller = url.searchParams.get('caller');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const status = url.searchParams.get('status');
    if (caller) query = query.ilike('caller_number', `%${caller.replace(/[%_]/g, '')}%`);
    if (from) query = query.gte('started_at', from);
    if (to) query = query.lte('started_at', to);
    if (status && ['needs_attention', 'message_captured', 'follow_up_needed', 'reviewed'].includes(status)) query = query.eq('inbox_status', status);
    const { data, error } = await query;
    if (error) throw error;
    const ids = (data ?? []).map((call) => call.interaction_id);
    let events: any[] = [];
    if (ids.length) {
      const { data: notificationRows, error: notificationError } = await db.from('lyra_notification_events')
        .select('interaction_id,channel,event_type,status,provider_accepted_count,attempted_at,error_message')
        .in('interaction_id', ids).order('attempted_at', { ascending: false });
      if (notificationError) throw notificationError;
      events = notificationRows ?? [];
    }
    const notificationsByCall = new Map<string, any[]>();
    for (const event of events) {
      const key = event.interaction_id as string;
      notificationsByCall.set(key, [...(notificationsByCall.get(key) ?? []), event]);
    }
    return NextResponse.json({ calls: (data ?? []).map((call) => ({ ...call, notifications: notificationsByCall.get(call.interaction_id) ?? [] })) });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && error.message === 'OWNER_ONLY') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error instanceof Error && error.message === 'OWNER_NOT_CONFIGURED') return NextResponse.json({ error: 'Owner access is not configured. Set OWNER_USER_ID or OWNER_EMAIL.' }, { status: 503 });
    return NextResponse.json({ error: 'Could not load call records' }, { status: 500 });
  }
}
