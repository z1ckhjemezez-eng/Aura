// Shared guard for the signed-connection quota of TikTok's LIVE signing service.
// One rate-limit answer pauses every NEW connection attempt (creators and Gift
// Scout) until the service's own reset time, instead of hammering it per creator.
// Open LIVE sockets are never touched.
const MAX_PAUSE_MS = 65 * 60_000;

export function isSignRateLimit(err) {
  return err?.constructor?.name === 'SignatureRateLimitError' || err?.name === 'SignatureRateLimitError' ||
    /\[Rate Limited\]|rate_limit_/i.test(String(err?.message ?? ''));
}

export function createConnectBudget({ now = () => Date.now(), defaultPauseMs = 15 * 60_000, perWindow = 2, windowMs = 5_000 } = {}) {
  let blockedUntil = 0;
  let windowStart = 0, used = 0;
  return {
    blockedUntil: () => blockedUntil,
    blocked: () => now() < blockedUntil,
    // Server-provided reset/retry-after wins; otherwise a fixed pause. Never longer than ~1 hour.
    noteRateLimit(err) {
      const t = now();
      const reset = Number(err?.resetTime);
      const retry = Number(err?.retryAfter);
      let until = reset > t ? reset : retry > 0 ? t + retry : t + defaultPauseMs;
      until = Math.min(until, t + MAX_PAUSE_MS);
      if (until > blockedUntil) blockedUntil = until;
      return blockedUntil;
    },
    // Spreads attempts so a resumed queue doesn't burst into a new limit.
    take() {
      const t = now();
      if (t < blockedUntil) return false;
      if (t - windowStart >= windowMs) { windowStart = t; used = 0; }
      if (used >= perWindow) return false;
      used++;
      return true;
    },
  };
}

export function rateLimitMessage(until, t = Date.now()) {
  const minutes = Math.max(1, Math.ceil((until - t) / 60_000));
  return `TikTok's connection limit for this hour is reached. Retrying automatically in about ${minutes} min — not connected.`;
}
