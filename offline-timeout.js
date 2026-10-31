export const OFFLINE_TIMEOUT_MS = 10 * 60_000;
/** Only explicit TikTok offline observations start the clock. Unknown/live resets it. */
export function createOfflineTimeout(now = Date.now) {
  let since = null;
  return {
    observe(live) { if (live === false) since ??= now(); else since = null; },
    due() { return since !== null && now() - since >= OFFLINE_TIMEOUT_MS; },
    since() { return since; },
  };
}