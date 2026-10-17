import { NextResponse } from 'next/server';
import { createServerSupabase } from '../../../src/lib/supabase/server';

// Only allow local paths after sign in, so a crafted `next` cannot redirect off-site.
function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/terminal';
  return value;
}

function errorRedirect(origin: string, message: string) {
  return NextResponse.redirect(new URL(`/terminal?auth_error=${encodeURIComponent(message)}`, origin));
}

// Supabase Auth callback: exchanges the PKCE code and forwards to the app. It works
// no matter which page the player started from, because every redirect URL points here.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  const next = safeNext(url.searchParams.get('next'));

  if (providerError) return errorRedirect(url.origin, providerError);
  if (!code) return errorRedirect(url.origin, 'The sign-in link is missing its code.');

  const supabase = await createServerSupabase();
  if (!supabase) return errorRedirect(url.origin, 'Sign in is not configured on this deployment.');

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return errorRedirect(url.origin, error.message);

  return NextResponse.redirect(new URL(next, url.origin));
}
