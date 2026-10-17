import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { createAdmin } from '@/lib/supabase-admin';

const statuses = new Set(['needs_attention', 'message_captured', 'follow_up_needed', 'reviewed']);

export async function PATCH(req: NextRequest, context: { params: Promise<{ interactionId: string }> }) {
  try {
    await requireOwner();
    const { interactionId } = await context.params;
    const body = await req.json();
    if (typeof body.status !== 'string' || !statuses.has(body.status)) {
      return NextResponse.json({ error: 'Invalid inbox status' }, { status: 400 });
    }
    const db = createAdmin();
    const now = new Date().toISOString();
    const update: Record<string, unknown> = { inbox_status: body.status, updated_at: now };
    if (body.status === 'reviewed') update.reviewed_at = now;
    if (body.status === 'message_captured') update.message_reviewed_at = now;
    const { data, error } = await db.from('lyra_calls').update(update).eq('interaction_id', interactionId).select('interaction_id,inbox_status,reviewed_at,message_reviewed_at').maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Call not found' }, { status: 404 });
    return NextResponse.json({ ok: true, call: data });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && error.message === 'OWNER_ONLY') return NextResponse.json({ error: 'This account is not authorized to access call records' }, { status: 403 });
    if (error instanceof Error && error.message === 'OWNER_NOT_CONFIGURED') return NextResponse.json({ error: 'Set OWNER_USER_ID or OWNER_EMAIL before using the private dashboard' }, { status: 503 });
    return NextResponse.json({ error: 'Could not update call' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ interactionId: string }> }) {
  try {
    await requireOwner();
    const { interactionId } = await context.params;
    const db = createAdmin();
    const { data, error } = await db.from('lyra_calls').delete().eq('interaction_id', interactionId).select('interaction_id').maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Call not found' }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: 'lyra_copy_only', provider_recording_deleted: false });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && error.message === 'OWNER_ONLY') return NextResponse.json({ error: 'This account is not authorized to access call records' }, { status: 403 });
    if (error instanceof Error && error.message === 'OWNER_NOT_CONFIGURED') return NextResponse.json({ error: 'Set OWNER_USER_ID or OWNER_EMAIL before using the private dashboard' }, { status: 503 });
    return NextResponse.json({ error: 'Could not delete Lyra call record' }, { status: 500 });
  }
}
