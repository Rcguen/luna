import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && key && !url.includes('YOUR_PROJECT')
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export const supabaseConfigured = Boolean(supabase);
export const supabaseSetupMessage = 'Cloud saves require VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.';
