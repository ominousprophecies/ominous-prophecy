import { createClient } from '@supabase/supabase-js';

// Public client — browser/frontend reads (safe to expose)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Admin client — server-side writes only (routines use this)
// NEVER expose SUPABASE_SERVICE_KEY to the browser
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
