import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { createAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stream a recording from Sarvam without exposing the Sarvam API key or
 * requiring a public recording URL to be stored in the browser.
 */
export async function GET(req: NextRequest) {
  try {
    await requireOwner();

    const interactionId = req.nextUrl.searchParams.get('interactionId')?.trim();
    if (!interactionId) return NextResponse.json({ error: 'Missing interactionId' }, { status: 400 });

    const { SARVAM_API_KEY, SARVAM_ORG_ID, SARVAM_WORKSPACE_ID, SARVAM_APP_ID } = process.env;
    if (!SARVAM_API_KEY || !SARVAM_ORG_ID || !SARVAM_WORKSPACE_ID || !SARVAM_APP_ID) {
      return NextResponse.json({ error: 'Sarvam recording access is not configured' }, { status: 503 });
    }

    // Only proxy recordings for calls present in this private owner's dashboard.
    const db = createAdmin();
    const { data: call, error: callError } = await db
      .from('lyra_calls')
      .select('interaction_id')
      .eq('interaction_id', interactionId)
      .maybeSingle();
    if (callError) throw callError;
    if (!call) return NextResponse.json({ error: 'Call not found' }, { status: 404 });

    const recordingUrl = new URL(
      `https://apps.sarvam.ai/api/analytics/v1/${encodeURIComponent(SARVAM_ORG_ID)}/${encodeURIComponent(SARVAM_WORKSPACE_ID)}/${encodeURIComponent(SARVAM_APP_ID)}/recordings/${encodeURIComponent(interactionId)}`
    );
    const response = await fetch(recordingUrl, {
      headers: { 'X-API-Key': SARVAM_API_KEY },
      cache: 'no-store',
    });

    if (!response.ok) {
      if (response.status === 404) return NextResponse.json({ error: 'Sarvam has no recording for this call' }, { status: 404 });
      if (response.status === 401 || response.status === 403) {
        console.error('[Sarvam recording] Sarvam rejected recording access', { status: response.status });
        return NextResponse.json({ error: 'Sarvam denied recording access; check the API key and workspace permissions' }, { status: 502 });
      }
      console.error('[Sarvam recording] Sarvam request failed', { status: response.status });
      return NextResponse.json({ error: 'Could not retrieve recording from Sarvam' }, { status: 502 });
    }

    if (!response.body) return NextResponse.json({ error: 'Sarvam returned an empty recording' }, { status: 502 });
    const headers = new Headers({
      'Content-Type': response.headers.get('content-type') || 'audio/wav',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    const length = response.headers.get('content-length');
    if (length) headers.set('Content-Length', length);
    const range = response.headers.get('accept-ranges');
    if (range) headers.set('Accept-Ranges', range);
    return new Response(response.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && error.message === 'OWNER_ONLY') return NextResponse.json({ error: 'This account is not authorized to access call recordings' }, { status: 403 });
    if (error instanceof Error && error.message === 'OWNER_NOT_CONFIGURED') return NextResponse.json({ error: 'Owner access is not configured' }, { status: 503 });
    console.error('[Sarvam recording] Failed to proxy recording', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not retrieve recording' }, { status: 500 });
  }
}
