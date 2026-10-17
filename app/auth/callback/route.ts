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

// Next normalizes request.url to the server's local URL, which can differ from the host the
// browser used. Redirects must stay on the browser's host or the session cookies are dropped.
function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return host ? `${proto}://${host}` : url.origin;
}

// Supabase Auth callback: exchanges the PKCE code and forwards to the app. It works
// no matter which page the player started from, because every redirect URL points here.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const code = url.searchParams.get('code');
  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  const next = safeNext(url.searchParams.get('next'));

  if (providerError) return errorRedirect(origin, providerError);
  if (!code) return errorRedirect(origin, 'The sign-in link is missing its code.');

  const supabase = await createServerSupabase();
  if (!supabase) return errorRedirect(origin, 'Sign in is not configured on this deployment.');

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return errorRedirect(origin, error.message);

  return NextResponse.redirect(new URL(next, origin));
}
