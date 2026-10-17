import { NextRequest, NextResponse } from 'next/server';
import { createAdmin } from '@/lib/supabase-admin';
export const runtime = 'nodejs';
async function cleanup(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const db = createAdmin();
    const { data, error } = await db.from('lyra_settings').select('setting_value').eq('setting_key', 'retention_days').maybeSingle();
    if (error) throw error;
    const raw = data?.setting_value;
    const value = typeof raw === 'string' ? raw : 'never';
    const days = Number(value);
    if (!Number.isFinite(days) || days <= 0) return NextResponse.json({ ok: true, deleted: 0, retention: 'never' });
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data: deleted, error: deleteError } = await db.from('lyra_calls').delete().lt('started_at', cutoff).select('interaction_id');
    if (deleteError) throw deleteError;
    return NextResponse.json({ ok: true, deleted: deleted?.length ?? 0, cutoff });
  } catch { return NextResponse.json({ error: 'Retention cleanup failed' }, { status: 500 }); }
}
export async function GET(req: NextRequest) { return cleanup(req); }
export async function POST(req: NextRequest) { return cleanup(req); }
