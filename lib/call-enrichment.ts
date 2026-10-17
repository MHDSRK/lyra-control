type UnknownRecord = Record<string, unknown>;

function firstString(source: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

export function canonicalOwnerAlias(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase('en').replace(/[.!?,]+$/g, '');
  if (['sharookh', 'sharu', 'shamon'].includes(normalized)) return 'Sharookh';
  return null;
}

export function ownerAliasesMentioned(text: string): string[] {
  return /\b(sharookh|sharu|shamon)\b/i.test(text) ? ['Sharookh'] : [];
}

export function extractCallEnrichment(vars: UnknownRecord, payload: UnknownRecord, transcriptText: string) {
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata as UnknownRecord : {};
  const messageFor = firstString(vars, ['message_for', 'message_recipient', 'recipient_name', 'for_whom', 'message_to']);
  const messageContent = firstString(vars, ['message_content', 'caller_message', 'message_to_owner', 'captured_message', 'message_text']);
  const urgencyRaw = firstString(vars, ['message_urgency', 'message_priority', 'priority']);
  const deadline = firstString(vars, ['message_deadline', 'deadline', 'requested_time', 'due_at']);
  const recordingUrl = validHttpUrl(payload.recording_url ?? payload.audio_url ?? payload.recording_link ?? metadata.recording_url ?? metadata.audio_url ?? vars.recording_url ?? vars.audio_url);
  const transcriptAvailable = transcriptText.trim().length > 0;
  const summaryAvailable = Boolean(firstString(vars, ['call_summary', 'message_summary', 'summary']));
  const aliases = ownerAliasesMentioned([messageFor ?? '', messageContent ?? '', transcriptText].join('\n'));
  const followUp = vars.follow_up_required === true || String(vars.follow_up_required ?? '').toLowerCase() === 'true';
  const urgent = vars.urgent === true || vars.is_urgent === true || (followUp && String(vars.priority ?? '').toLowerCase() === 'urgent');
  const failed = Number(payload.duration ?? payload.duration_in_seconds ?? 0) <= 0;
  const inboxStatus = urgent || failed ? 'needs_attention' : followUp ? 'follow_up_needed' : messageContent ? 'message_captured' : 'needs_attention';
  return {
    message_for: messageFor, message_for_canonical: canonicalOwnerAlias(messageFor), message_content: messageContent,
    message_saved: Boolean(messageContent), message_urgency: urgencyRaw, message_deadline: deadline,
    recording_url: recordingUrl, recording_available: Boolean(recordingUrl), transcript_available: transcriptAvailable,
    summary_available: summaryAvailable, processing_status: 'processed', processed_at: new Date().toISOString(),
    owner_aliases_mentioned: aliases, inbox_status: inboxStatus,
  };
}
