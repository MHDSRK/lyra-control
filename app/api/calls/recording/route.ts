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
    if (!call) return NextResponse.json({ error: 'Call not found in Lyra' }, { status: 404 });

    // Sarvam requires interaction IDs in YYYYMMDD/identifier form. Keep the
    // slash as a path separator (the API also accepts %2F).
    if (!/^\\d{8}\\/.+/.test(interactionId)) {
      return NextResponse.json({
        error: 'This call ID is not in Sarvam’s required YYYYMMDD/identifier format.',
        interaction_id_format_valid: false,
      }, { status: 422 });
    }

    const encodedInteractionId = interactionId.split('/').map(encodeURIComponent).join('/');
    const recordingUrl = new URL(
      `https://apps.sarvam.ai/api/analytics/v1/${encodeURIComponent(SARVAM_ORG_ID)}/${encodeURIComponent(SARVAM_WORKSPACE_ID)}/${encodeURIComponent(SARVAM_APP_ID)}/recordings/${encodedInteractionId}`
    );
    const diagnostic = req.nextUrl.searchParams.get('check') === '1';
    const requestHeaders: Record<string, string> = { 'X-API-Key': SARVAM_API_KEY };
    const rangeRequest = diagnostic ? 'bytes=0-0' : req.headers.get('range');
    if (rangeRequest) requestHeaders.Range = rangeRequest;
    const response = await fetch(recordingUrl, {
      headers: requestHeaders,
      cache: 'no-store',
    });

    if (!response.ok) {
      let providerDetail = '';
      try {
        const body = await response.clone().text();
        providerDetail = body.slice(0, 500);
      } catch {}
      const message = response.status === 400 || response.status === 422
        ? 'Sarvam rejected the interaction ID format.'
        : response.status === 401
          ? 'Sarvam rejected the API key.'
          : response.status === 403
            ? 'Sarvam denied access. Check that the API key belongs to this workspace and can access this agent.'
            : response.status === 404
              ? 'Sarvam did not find a recording for this interaction ID.'
              : response.status === 429
                ? 'Sarvam rate-limited recording retrieval. Try again later.'
                : `Sarvam recording API returned HTTP ${response.status}.`;
      console.error('[Sarvam recording] Provider request failed', { status: response.status, interactionId, detail: providerDetail });
      if (diagnostic) return NextResponse.json({ ok: false, provider_status: response.status, error: message, provider_detail: providerDetail }, { status: 200 });
      return NextResponse.json({ error: message, provider_status: response.status }, { status: response.status === 404 ? 404 : 502 });
    }

    if (diagnostic) {
      try { await response.body?.cancel(); } catch {}
      return NextResponse.json({
        ok: true,
        provider_status: response.status,
        content_type: response.headers.get('content-type') || 'unknown',
        message: 'Sarvam accepted the recording request.',
      });
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
    const acceptRanges = response.headers.get('accept-ranges');
    if (acceptRanges) headers.set('Accept-Ranges', acceptRanges);
    const contentRange = response.headers.get('content-range');
    if (contentRange) headers.set('Content-Range', contentRange);
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && error.message === 'OWNER_ONLY') return NextResponse.json({ error: 'This account is not authorized to access call recordings' }, { status: 403 });
    if (error instanceof Error && error.message === 'OWNER_NOT_CONFIGURED') return NextResponse.json({ error: 'Owner access is not configured' }, { status: 503 });
    console.error('[Sarvam recording] Failed to proxy recording', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not retrieve recording' }, { status: 500 });
  }
}
