import { expect, type Page } from '@playwright/test';
import { mailpitUrl } from './env';

export interface MagicLinkMessage {
  id: string;
  to: string;
  subject: string;
}

async function mailpitJson<T>(path: string): Promise<T> {
  const response = await fetch(`${mailpitUrl()}${path}`);
  if (!response.ok) throw new Error(`Mailpit request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  Created: string;
  To: Array<{ Address: string }>;
}

async function findMessages(email: string): Promise<MailpitMessageSummary[]> {
  const data = await mailpitJson<{ messages?: MailpitMessageSummary[] }>('/api/v1/messages?limit=100');
  return (data.messages ?? [])
    .filter((message) => (message.To ?? []).some((to) => to.Address.toLowerCase() === email.toLowerCase()))
    .sort((left, right) => Date.parse(right.Created) - Date.parse(left.Created));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Poll the disposable local Mailpit inbox for the magic link actually sent by GoTrue. */
export async function waitForMagicLink(email: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await findMessages(email);
    for (const message of messages) {
      const detail = await mailpitJson<{ HTML?: string; Text?: string }>(`/api/v1/message/${message.ID}`);
      const haystack = decodeEntities(`${detail.Text ?? ''}\n${detail.HTML ?? ''}`);
      const match = haystack.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/);
      if (match) return match[0].replace(/&amp;/g, '&');
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No magic link arrived for ${email}. Is the local Supabase stack running?`);
}

let emailCounter = 0;

/** Unique, disposable test identity. Never used against a hosted project. */
export function testEmail(label: string): string {
  emailCounter += 1;
  return `e2e-${Date.now()}-${process.pid}-${emailCounter}-${label}@example.test`;
}

export async function signInViaMagicLink(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign in link' }).click();
  await expect(page.getByText(/We sent a sign in link to/)).toBeVisible({ timeout: 20_000 });

  const link = await waitForMagicLink(email);
  await page.goto(link);
  // The verify URL redirects through /auth/callback, which exchanges the PKCE code.
  await page.waitForURL((url) => url.pathname === '/terminal', { timeout: 30_000 });
  await expect(page.locator('button[title="Account"]')).toBeVisible({ timeout: 20_000 });
}

export async function signedInEmail(page: Page): Promise<string | null> {
  const button = page.locator('button[title="Account"]');
  if (!(await button.count())) return null;
  return button.getAttribute('title');
}

/** Delay the Supabase token refresh and report whether it was actually attempted. */
export async function delayAuthRefresh(page: Page, delayMs = 2500): Promise<{ count: () => number }> {
  let attempts = 0;
  await page.route('**/auth/v1/token**', async (route) => {
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  });
  return { count: () => attempts };
}
