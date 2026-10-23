import { createClient } from '@supabase/supabase-js';

// Public project configuration. Access is enforced by live membership checks and RLS.
export const supabase = createClient(
  'https://ikzqljwatewzqwezcuhl.supabase.co',
  'sb_publishable_2xym-2Or60cV-5oirDscWA_3ezdEPH4',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
);
