import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { createAdmin } from '@/lib/supabase-admin';
import Dashboard from './ui/dashboard';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const admin = createAdmin();
  const { data: calls } = await admin.from('lyra_calls').select('*').order('started_at', { ascending: false }).limit(30);
  return <Dashboard initialCalls={calls ?? []} email={user.email ?? ''} />;
}
