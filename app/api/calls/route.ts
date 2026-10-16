import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createAdmin } from '@/lib/supabase-admin';
export async function GET(){try{await requireUser();const admin=createAdmin();const {data,error}=await admin.from('lyra_calls').select('*').order('started_at',{ascending:false}).limit(100);if(error)throw error;return NextResponse.json({calls:data??[]});}catch(e){if(e instanceof Error&&e.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});return NextResponse.json({error:'Could not load call records'},{status:500});}}
