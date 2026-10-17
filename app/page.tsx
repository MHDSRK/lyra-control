import { redirect } from 'next/navigation';
import { requireOwner } from '@/lib/auth';
import Dashboard from './ui/dashboard';
export const dynamic = 'force-dynamic';
export default async function Home() {
  try {
    const { user } = await requireOwner();
    return <Dashboard initialCalls={[]} email={user.email ?? ''} />;
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') redirect('/login');
    if (error instanceof Error && error.message === 'OWNER_ONLY') redirect('/login?error=owner');
    throw error;
  }
}
