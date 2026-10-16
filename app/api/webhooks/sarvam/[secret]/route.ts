import { NextRequest, NextResponse } from 'next/server';
import { createAdmin } from '@/lib/supabase-admin';
import { notifyOwner, sendFailureEmail } from '@/lib/notifications';

export const runtime = 'nodejs';

type Turn = {
  role?: string;
  en_text?: string | null;
  indic_text?: string | null;
};

type Payload = {
  app_id?: string;
  interaction_id?: string;
  user_phone_number?: string;
  agent_phone_number?: string;
  duration?: number;
  start_datetime?: string | null;
  end_datetime?: string | null;
  final_agent_variables?: Record<string, unknown> | null;
  output_agent_variables?: Record<string, unknown> | null;
  interaction_transcript?: Turn[] | null;
  metadata?: Record<string, unknown> | null;
};

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    const fields = ['name', 'message', 'code', 'details', 'hint'];

    const description = fields
      .filter((key) => e[key] !== undefined && e[key] !== null)
      .map((key) => `${key}: ${String(e[key])}`)
      .join('\n');

    return description || 'An object error was thrown without details.';
  }

  return String(error || 'Unknown error');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ secret: string }> }
) {
  const { secret } = await params;
  const expected = process.env.SARVAM_WEBHOOK_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let payload: Payload;

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!payload.interaction_id) {
    return NextResponse.json(
      { error: 'Missing interaction_id' },
      { status: 400 }
    );
  }

  let stage = 'initialization';

  try {
    const db = createAdmin();

    const vars = {
      ...(payload.final_agent_variables ?? {}),
      ...(payload.output_agent_variables ?? {}),
    };

    const transcript = payload.interaction_transcript ?? [];

    const transcriptText = transcript
      .map(
        (turn) =>
          `${turn.role === 'agent' ? 'Lyra' : 'Caller'}: ${
            turn.en_text ?? turn.indic_text ?? ''
          }`
      )
      .join('\n');

    const summary = String(
      vars.call_summary ?? vars.message_summary ?? vars.summary ?? ''
    );

    const outcome = String(
      vars.call_outcome ?? vars.call_disposition ?? ''
    );

    const urgent = Boolean(
      vars.urgent ||
        vars.is_urgent ||
        (vars.follow_up_required &&
          String(vars.priority ?? '').toLowerCase() === 'urgent')
    );

    const duration = Number(payload.duration ?? 0);
    const failed = duration <= 0;

    const row = {
      interaction_id: payload.interaction_id,
      caller_number: payload.user_phone_number ?? null,
      agent_number: payload.agent_phone_number ?? null,
      started_at: payload.start_datetime ?? null,
      ended_at: payload.end_datetime ?? null,
      duration_seconds: duration,
      summary: summary || null,
      outcome: outcome || null,
      transcript,
      transcript_text: transcriptText || null,
      agent_variables: vars,
      urgent,
      failed,
      end_reason: String(vars.end_reason ?? '') || null,
      raw_payload: payload,
      updated_at: new Date().toISOString(),
    };

    stage = 'saving call to Supabase';

    const { error } = await db
      .from('lyra_calls')
      .upsert(row, { onConflict: 'interaction_id' });

    if (error) {
      throw error;
    }

    const caller = payload.user_phone_number ?? 'Unknown caller';
    const attention =
      urgent ||
      failed ||
      /urgent|failed|error|unable|exception/i.test(outcome);

    stage = 'sending call notification';

    await notifyOwner(
      attention ? 'Lyra: call needs attention' : 'Lyra: call completed',
      `${caller} · ${Math.round(duration)} seconds${
        summary ? `\n${summary}` : ''
      }`,
      `/?call=${encodeURIComponent(payload.interaction_id)}`
    );

    if (attention) {
      stage = 'sending attention alert';

      await sendFailureEmail(
        `Lyra alert: ${caller}`,
        `A call may need your attention.
Caller: ${caller}
Duration: ${duration}s
Outcome: ${outcome || 'Not provided'}
Summary: ${summary || 'No summary available'}
Interaction: ${payload.interaction_id}`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const errorDetails = describeError(error);

    // Do not log the webhook URL, secret, or full call payload.
    console.error('[Sarvam webhook] Processing failed', {
      interactionId: payload.interaction_id,
      stage,
      error: errorDetails,
    });

    try {
      await sendFailureEmail(
        'Lyra Control: webhook processing failed',
        `Sarvam webhook processing failed.
Interaction ID: ${payload.interaction_id}
Stage: ${stage}
Error:
${errorDetails}`
      );
    } catch (emailError) {
      console.error('[Sarvam webhook] Failure alert email also failed', {
        interactionId: payload.interaction_id,
        error: describeError(emailError),
      });
    }

    return NextResponse.json(
      { error: 'Webhook processing failed', stage },
      { status: 500 }
    );
  }
}
