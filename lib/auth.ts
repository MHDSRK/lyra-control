import { createClient } from '@/lib/supabase-server';

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('UNAUTHORIZED');
  return { supabase, user };
}

export async function requireOwner() {
  const result = await requireUser();
  const ownerId = process.env.OWNER_USER_ID?.trim();
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerId && !ownerEmail) throw new Error('OWNER_NOT_CONFIGURED');
  const allowed = (ownerId && result.user.id === ownerId) ||
    (ownerEmail && result.user.email?.toLowerCase() === ownerEmail);
  if (!allowed) throw new Error('OWNER_ONLY');
  return result;
}
