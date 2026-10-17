import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { createAdmin } from '@/lib/supabase-admin';
const key = 'routine_push_enabled';

export async function GET() {
  try {
    await requireOwner();
    const { data, error } = await createAdmin().from('lyra_settings').select('setting_value').eq('setting_key', key).maybeSingle();
    if (error) throw error;
    const value = typeof data?.setting_value === 'boolean' ? data.setting_value : false;
    return NextResponse.json({ routinePushEnabled: value });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && error.message === 'OWNER_ONLY') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error instanceof Error && error.message === 'OWNER_NOT_CONFIGURED') return NextResponse.json({ error: 'Owner access is not configured' }, { status: 503 });
    return NextResponse.json({ error: 'Could not load notification preferences' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireOwner();
    const body = await req.json();
    if (typeof body.routinePushEnabled !== 'boolean') return NextResponse.json({ error: 'routinePushEnabled must be boolean' }, { status: 400 });
    const { error } = await createAdmin().from('lyra_settings').upsert({ setting_key: key, setting_value: JSON.stringify(body.routinePushEnabled), updated_at: new Date().toISOString() }, { onConflict: 'setting_key' });
    if (error) throw error;
    return NextResponse.json({ ok: true, routinePushEnabled: body.routinePushEnabled });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && error.message === 'OWNER_ONLY') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error instanceof Error && error.message === 'OWNER_NOT_CONFIGURED') return NextResponse.json({ error: 'Owner access is not configured' }, { status: 503 });
    return NextResponse.json({ error: 'Could not save notification preferences' }, { status: 500 });
  }
}
