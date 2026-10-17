import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { createAdmin } from '@/lib/supabase-admin';

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireOwner();
    const subscription = await req.json();
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    const { error } = await createAdmin().from('lyra_push_subscriptions').upsert({ user_id: user.id, endpoint: subscription.endpoint, subscription, updated_at: new Date().toISOString() }, { onConflict: 'endpoint' });
    if (error) throw error;
    return NextResponse.json({ ok: true, status: 'subscription_saved' });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && error.message === 'OWNER_ONLY') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error instanceof Error && error.message === 'OWNER_NOT_CONFIGURED') return NextResponse.json({ error: 'Owner access is not configured' }, { status: 503 });
    return NextResponse.json({ error: 'Could not save subscription' }, { status: 500 });
  }
}
