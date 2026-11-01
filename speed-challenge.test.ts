import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpeedChallenge } from './speed-challenge.js';

const task = (over: Record<string, unknown> = {}) => ({
  taskMessageType: 0,
  battleId: 'b1',
  start: { targetStartTimestamp: 1030, rewardConfig: { rewardMultiple: 2 } },
  ...over,
});

describe('Speed Challenge activation', () => {
  afterEach(() => vi.useRealTimers());

  it("fires at TikTok's official targetStartTimestamp, not before", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    const send = vi.fn(); const sc = createSpeedChallenge({ send, now: () => Date.now() });
    sc.observe('WebcastLinkmicBattleTaskMessage', task());
    await vi.advanceTimersByTimeAsync(29_999); expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({ battleId: 'b1', activatedAt: new Date(1_030_000).toISOString(), multiplier: 2 });
    sc.close();
  });

  it('carries TikTok\'s official reward multiplier, never a guessed one', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    const send = vi.fn(); const sc = createSpeedChallenge({ send, now: () => Date.now() });
    sc.observe('WebcastLinkmicBattleTaskMessage', task({ battleId: 'b2', start: { targetStartTimestamp: 1030, rewardConfig: { rewardMultiple: 3 } } }));
    sc.observe('WebcastLinkmicBattleTaskMessage', task({ battleId: 'b3', start: { targetStartTimestamp: 1030, targetConfig: { progressTarget: 2 } } }));
    sc.observe('WebcastLinkmicBattleTaskMessage', task({ battleId: 'b4', start: { targetStartTimestamp: 1030 } }));
    sc.observe('WebcastLinkmicBattleTaskMessage', task({ battleId: 'b5', start: { targetStartTimestamp: 1030, rewardConfig: { rewardMultiple: 99 } } }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls.map(c => c[0].multiplier)).toEqual([3, null, null, null]);
    sc.close();
  });

  it('reads the real LIVE shape nested under start.config', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    const send = vi.fn(); const sc = createSpeedChallenge({ send, now: () => Date.now() });
    sc.observe('WebcastLinkmicBattleTaskMessage', task({ battleId: 'live', start: { config: {
      targetConfig: { targetStartTimestamp: 1025, progressTarget: 3 }, rewardConfig: { rewardMultiple: 2 } } } }));
    await vi.advanceTimersByTimeAsync(24_000);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(send).toHaveBeenCalledWith({ battleId: 'live', activatedAt: new Date(1_025_000).toISOString(), multiplier: 2 });
    sc.close();
  });

  it('deduplicates the same battle task and ignores updates/settles', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    const send = vi.fn(); const sc = createSpeedChallenge({ send, now: () => Date.now() });
    sc.observe('WebcastLinkmicBattleTaskMessage', task());
    sc.observe('WebcastLinkmicBattleTaskMessage', task());
    sc.observe('WebcastLinkmicBattleTaskMessage', task({ taskMessageType: 1 }));
    sc.observe('WebcastLinkmicBattleTaskMessage', task({ taskMessageType: 2 }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
    sc.close();
  });

  it('ignores other events, missing start data and implausible schedules', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    const send = vi.fn(); const sc = createSpeedChallenge({ send, now: () => Date.now() });
    sc.observe('WebcastLinkMicArmies', task());
    sc.observe('WebcastLinkmicBattleTaskMessage', { taskMessageType: 0, battleId: 'b2' });
    sc.observe('WebcastLinkmicBattleTaskMessage', task({ battleId: 'b3', start: { targetStartTimestamp: 1400 } })); // >5 min ahead
    sc.observe('WebcastLinkmicBattleTaskMessage', task({ battleId: 'b4', start: { targetStartTimestamp: 900 } })); // >60 s stale
    await vi.advanceTimersByTimeAsync(600_000);
    expect(send).not.toHaveBeenCalled();
    sc.close();
  });

  it('reports immediately when the official start time has just passed', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    const send = vi.fn(); const sc = createSpeedChallenge({ send, now: () => Date.now() });
    sc.observe('WebcastLinkmicBattleTaskMessage', task({ start: { targetStartTimestamp: 990 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    sc.close();
  });

  it('close() cancels a pending activation so stopped sessions never report', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    const send = vi.fn(); const sc = createSpeedChallenge({ send, now: () => Date.now() });
    sc.observe('WebcastLinkmicBattleTaskMessage', task());
    sc.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).not.toHaveBeenCalled();
  });
});
