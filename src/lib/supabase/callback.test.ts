import { describe, expect, test } from 'vitest';
import { authErrorMessage, callbackOrigin, safeNext } from './callback';

const origin = 'https://tape.example';

describe('safeNext', () => {
  test.each([
    ['/terminal', '/terminal'],
    ['/terminal?tab=positions#latest', '/terminal?tab=positions#latest'],
    ['//evil.com', '/terminal'],
    ['/\\evil.com', '/terminal'],
    ['/%2F%2Fevil.com', '/terminal'],
    ['/%2e%2e//evil.com', '/terminal'],
    ['/x/..//evil.com', '/terminal'],
    ['/%5Cevil.com', '/terminal'],
    ['/%09/evil.com', '/terminal'],
    ['/%00evil.com', '/terminal'],
    ['/%ZZ', '/terminal'],
    [' /terminal', '/terminal'],
    [' /terminal ', '/terminal'],
    [' /terminal\n', '/terminal'],
    ['/\t/evil.com', '/terminal'],
    ['/terminal\r', '/terminal'],
    ['https://evil.com', '/terminal'],
    ['https://tape.example/terminal', '/terminal'],
    ['', '/terminal'],
    [null, '/terminal'],
  ])('%s resolves to %s', (value, expected) => {
    expect(safeNext(value, origin)).toBe(expected);
  });
});

test('configured origin ignores forwarded host and accepts only an HTTP site URL', () => {
  const request = new Request('http://127.0.0.1:3100/auth/callback', {
    headers: { host: 'attacker.test', 'x-forwarded-host': 'attacker.test' },
  });

  expect(callbackOrigin(request, 'https://tape.example/app')).toBe(origin);
  expect(() => callbackOrigin(request, 'javascript:alert(1)')).toThrow();
  expect(() => callbackOrigin(request, 'https://user:password@tape.example')).toThrow();
  expect(() => callbackOrigin(request, 'https://tape.example\\@attacker.test')).toThrow();
  expect(() => callbackOrigin(request, '   ')).toThrow();
});

test('without a configured URL the local forwarded-host behavior remains', () => {
  const request = new Request('http://127.0.0.1:3100/auth/callback', {
    headers: { 'x-forwarded-host': 'localhost:3100', 'x-forwarded-proto': 'http' },
  });

  expect(callbackOrigin(request)).toBe('http://localhost:3100');
  expect(callbackOrigin(request, '')).toBe('http://localhost:3100');
});

test('provider errors never echo attacker-supplied descriptions', () => {
  expect(authErrorMessage('access_denied')).toBe('Sign in was cancelled.');
  expect(authErrorMessage('otp_expired')).toBe('This sign-in link has expired. Request a new one.');
  expect(authErrorMessage('<script>alert(1)</script>')).toBe('Sign in could not be completed. Please try again.');
  expect(authErrorMessage(null)).toBe('Sign in could not be completed. Please try again.');
});
