const DEFAULT_NEXT = '/terminal';

export function safeNext(value: string | null, origin: string): string {
  if (!value || !value.startsWith('/') || /[\\\s\x00-\x1f\x7f]/.test(value)) return DEFAULT_NEXT;

  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\s\x00-\x1f\x7f]/.test(decoded)) return DEFAULT_NEXT;

    const target = new URL(value, origin);
    if (target.origin !== new URL(origin).origin || target.pathname.startsWith('//')) return DEFAULT_NEXT;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return DEFAULT_NEXT;
  }
}

export function callbackOrigin(request: Request, siteUrl?: string): string {
  if (siteUrl !== undefined && siteUrl !== '') {
    if (/[\\\s\x00-\x1f\x7f]/.test(siteUrl)) throw new Error('Invalid NEXT_PUBLIC_SITE_URL');
    const configured = new URL(siteUrl);
    if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password) {
      throw new Error('Invalid NEXT_PUBLIC_SITE_URL');
    }
    return configured.origin;
  }

  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return host ? `${proto}://${host}` : url.origin;
}

export function authErrorMessage(code: string | null): string {
  if (code === 'access_denied') return 'Sign in was cancelled.';
  if (code === 'otp_expired') return 'This sign-in link has expired. Request a new one.';
  return 'Sign in could not be completed. Please try again.';
}
