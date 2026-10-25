import { expect, it } from 'vitest';
import { connectionFailure, ownerObserved, verifiedLive } from './connection-status.js';
const room = { data: { owner: { display_id: 'creator' } } };
it('only confirms an open LIVE socket for the exact requested username', () => {
  const state = { isConnected: true, roomId: '123', roomInfo: room };
  expect(verifiedLive('creator', { isConnected: true }, state)).toBe(true);
  expect(verifiedLive('nonexistent_name', { isConnected: true }, state)).toBe(false);
});
it('does not confirm an unresolved username or a closed socket', () => {
  expect(verifiedLive('creator', { isConnected: true }, { isConnected: true, roomId: '123', roomInfo: {} })).toBe(false);
  expect(verifiedLive('creator', { isConnected: false }, { isConnected: true, roomId: '123', roomInfo: room })).toBe(false);
});
it('detects when TikTok omits owner details from the room payload', () => {
  expect(ownerObserved({ data: { prompts: {} } })).toBe(false);
  expect(ownerObserved({})).toBe(false);
  expect(ownerObserved(room)).toBe(true);
});
it('does not infer a valid offline account from free-form errors', () => {
  expect(connectionFailure(new Error("User isn't online"), 'nonexistent_name', {}, false).status).toBe('error');
  expect(connectionFailure(new Error('offline'), 'nonexistent_name', {}, true).status).toBe('waiting');
});
it('only marks offline when the typed offline error has a matching account identity', () => {
  expect(connectionFailure(new Error('offline'), 'creator', room, true).status).toBe('waiting');
});