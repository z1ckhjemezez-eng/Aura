import { expect, it, vi } from 'vitest';
import { createStatusDelivery } from './status-delivery.js';
it('delivers status immediately and serializes a newer transition behind an in-flight report', async () => {
  const first = {user_id:'owner',status:'connecting'}; const latest={user_id:'owner',status:'live'};
  const pending=new Map([['owner',first]]); let release: (()=>void) | undefined;
  const send=vi.fn().mockImplementationOnce(()=>new Promise<void>(r=>{release=r;})).mockResolvedValue(undefined);
  const flush=createStatusDelivery({pending,send}); const task=flush();
  expect(send).toHaveBeenCalledWith([first]); pending.set('owner',latest); await flush(); expect(send).toHaveBeenCalledTimes(1);
  release?.(); await task; expect(send).toHaveBeenNthCalledWith(2,[latest]); expect(pending.size).toBe(0);
});
it('retains failed reports for retry rather than falsely acknowledging them', async () => {
  const report={user_id:'owner',status:'live'};const pending=new Map([['owner',report]]);
  const send=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const flush=createStatusDelivery({pending,send}); await flush();expect(pending.get('owner')).toBe(report);await flush();expect(pending.size).toBe(0);
});