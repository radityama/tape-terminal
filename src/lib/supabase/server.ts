import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Server client for server components and route handlers. The anon key is client-safe;
// the service role key is never used here or anywhere in this app.
export async function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a server component where cookies cannot be written.
          // The proxy refreshes the session on every request instead.
        }
      },
    },
  });
}
