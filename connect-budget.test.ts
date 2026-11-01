import { expect, it } from 'vitest';
import { createConnectBudget, isSignRateLimit, rateLimitMessage } from './connect-budget.js';

class SignatureRateLimitError extends Error {}

it('recognizes the signing service hourly limit', () => {
  expect(isSignRateLimit(new SignatureRateLimitError('x'))).toBe(true);
  expect(isSignRateLimit(new Error('[Rate Limited] (rate_limit_account_hour) Too many connections started'))).toBe(true);
  expect(isSignRateLimit(new Error("The requested user isn't online"))).toBe(false);
});

it('pauses all new connects until the reset time reported by the service', () => {
  let t = 1_000_000;
  const b = createConnectBudget({ now: () => t });
  b.noteRateLimit({ resetTime: t + 20 * 60_000 });
  expect(b.take()).toBe(false);
  t += 20 * 60_000 - 1; expect(b.take()).toBe(false);
  t += 1; expect(b.take()).toBe(true);
});

it('uses retry-after, then a 15 minute default, capped at 65 minutes', () => {
  let t = 0;
  const b = createConnectBudget({ now: () => t });
  expect(b.noteRateLimit({ retryAfter: 90_000 })).toBe(90_000);
  const c = createConnectBudget({ now: () => t });
  expect(c.noteRateLimit({})).toBe(15 * 60_000);
  const d = createConnectBudget({ now: () => t });
  expect(d.noteRateLimit({ resetTime: 5 * 60 * 60_000 })).toBe(65 * 60_000);
});

it('allows at most 2 connection attempts per 5 seconds', () => {
  let t = 0;
  const b = createConnectBudget({ now: () => t });
  expect([b.take(), b.take(), b.take()]).toEqual([true, true, false]);
  t = 5_000; expect(b.take()).toBe(true);
});

it('tells the creator when it retries instead of blaming the username', () => {
  expect(rateLimitMessage(10 * 60_000, 0)).toContain('about 10 min');
  expect(rateLimitMessage(10 * 60_000, 0)).not.toMatch(/username/i);
});
