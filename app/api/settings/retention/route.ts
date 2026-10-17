import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { createAdmin } from '@/lib/supabase-admin';

const allowed = new Set(['never', '30', '90', '180', '365']);
const key = 'retention_days';

export async function GET() {
  try {
    await requireOwner();
    const { data, error } = await createAdmin().from('lyra_settings').select('setting_value').eq('setting_key', key).maybeSingle();
    if (error) throw error;
    const value = typeof data?.setting_value === 'string' ? data.setting_value : 'never';
    return NextResponse.json({ retentionDays: allowed.has(value) ? value : 'never' });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && error.message === 'OWNER_ONLY') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error instanceof Error && error.message === 'OWNER_NOT_CONFIGURED') return NextResponse.json({ error: 'Owner access is not configured' }, { status: 503 });
    return NextResponse.json({ error: 'Could not load retention setting' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireOwner();
    const body = await req.json();
    const value = String(body.retentionDays ?? '');
    if (!allowed.has(value)) return NextResponse.json({ error: 'Choose never, 30, 90, 180, or 365 days' }, { status: 400 });
    const { error } = await createAdmin().from('lyra_settings').upsert({ setting_key: key, setting_value: JSON.stringify(value), updated_at: new Date().toISOString() }, { onConflict: 'setting_key' });
    if (error) throw error;
    return NextResponse.json({ ok: true, retentionDays: value });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && error.message === 'OWNER_ONLY') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error instanceof Error && error.message === 'OWNER_NOT_CONFIGURED') return NextResponse.json({ error: 'Owner access is not configured' }, { status: 503 });
    return NextResponse.json({ error: 'Could not save retention setting' }, { status: 500 });
  }
}
