import { NextResponse } from 'next/server';
import { createServerSupabase } from '../../../src/lib/supabase/server';
import { authErrorMessage, callbackOrigin, safeNext } from '../../../src/lib/supabase/callback';

function errorRedirect(origin: string, message: string) {
  return NextResponse.redirect(new URL(`/terminal?auth_error=${encodeURIComponent(message)}`, origin));
}

// Supabase Auth callback: exchanges the PKCE code and forwards to the app. It works
// no matter which page the player started from, because every redirect URL points here.
export async function GET(request: Request) {
  const url = new URL(request.url);
  let origin: string;
  try {
    origin = callbackOrigin(request, process.env.NEXT_PUBLIC_SITE_URL);
  } catch {
    return new Response('Sign in is not configured on this deployment.', { status: 500 });
  }
  const code = url.searchParams.get('code');
  const providerCode = url.searchParams.get('error');
  const next = safeNext(url.searchParams.get('next'), origin);

  if (providerCode || url.searchParams.has('error_description')) {
    return errorRedirect(origin, authErrorMessage(providerCode));
  }
  if (!code) return errorRedirect(origin, 'The sign-in link is missing its code.');

  const supabase = await createServerSupabase();
  if (!supabase) return errorRedirect(origin, 'Sign in is not configured on this deployment.');

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return errorRedirect(origin, authErrorMessage(error.code ?? null));

  return NextResponse.redirect(new URL(next, origin));
}
