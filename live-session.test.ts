import { expect, it } from 'vitest';
import { createLiveGate } from './live-session.js';
it('holds events until LIVE initialization succeeds', async () => {
  const gate = createLiveGate(); const attempt = gate.begin();
  let sent = false; const pending = gate.wait().then(ok => { sent = ok; });
  await Promise.resolve(); expect(sent).toBe(false);
  gate.confirm(attempt); await pending; expect(sent).toBe(true);
});
it('discards buffered old-room events and ignores stale confirmation', async () => {
  const gate = createLiveGate(); const old = gate.begin(); const pending = gate.wait();
  const current = gate.begin(); gate.confirm(old);
  expect(await pending).toBe(false);
  gate.confirm(current); expect(await gate.wait()).toBe(true);
});
it('stops delivery on disconnect', async () => {
  const gate = createLiveGate(); const attempt = gate.begin(); gate.confirm(attempt);
  gate.cancel(); expect(await gate.wait()).toBe(false);
});
it('queued battle work cannot cross into the next connection attempt', async () => {
  const gate = createLiveGate(); const old = gate.begin(); gate.confirm(old);
  const next = gate.begin(); gate.confirm(next);
  expect(await gate.wait(old)).toBe(false);
  expect(await gate.wait(next)).toBe(true);
});