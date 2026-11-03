import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpeedChallenge } from './speed-challenge.js';

const task = (over: Record<string, unknown> = {}) => ({
  taskMessageType: 0,
  battleId: 'b1',
  start: { targetStartTimestamp: 1030, rewardConfig: { rewardMultiple: 2 } },
  ...over,
});

const settle = (over: Record<string, unknown> = {}) => ({ taskMessageType: 2, battleId: 'b1', taskSettle: { result: 2, rewardStartTimestamp: 1090 }, ...over });
const report = (battleId = 'b1', reward = 1090, multiplier: number | null = 2, result = 2) => ({ battleId, activatedAt: new Date(reward * 1000).toISOString(), multiplier, evidence: 'task_settle_reward', taskResult: result, rewardStartTimestamp: reward });

describe('Speed Challenge earned reward activation', () => {
 afterEach(() => vi.useRealTimers());
 it('never activates from announcement or target/unlock start alone', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000); const send = vi.fn(); const sc = createSpeedChallenge({send});
  sc.observe('WebcastLinkmicBattleTaskMessage', task());
  await vi.advanceTimersByTimeAsync(120_000); expect(send).not.toHaveBeenCalled(); sc.close();
 });
 it('waits for the official reward timestamp after successful settlement, not target start', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000); const send = vi.fn(); const sc = createSpeedChallenge({send});
  sc.observe('WebcastLinkmicBattleTaskMessage', task()); sc.observe('WebcastLinkmicBattleTaskMessage', settle());
  await vi.advanceTimersByTimeAsync(89_999); expect(send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(send).toHaveBeenCalledWith(report()); sc.close();
 });
 it('rejects failed tasks, missing/zero reward timestamps, progress and reward summaries', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000); const send = vi.fn(); const sc = createSpeedChallenge({send});
  for (const taskSettle of [{result:1,rewardStartTimestamp:1090},{result:0,rewardStartTimestamp:0},{result:2},{rewardStartTimestamp:1090}]) sc.observe('WebcastLinkmicBattleTaskMessage',settle({taskSettle}));
  sc.observe('WebcastLinkmicBattleTaskMessage',settle({taskMessageType:1}));sc.observe('WebcastLinkmicBattleTaskMessage',settle({taskMessageType:3}));
  await vi.advanceTimersByTimeAsync(120_000); expect(send).not.toHaveBeenCalled(); sc.close();
 });
 it('keeps official nested x3 config and accepts taskResult schema without inventing multipliers', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000); const send = vi.fn(); const sc = createSpeedChallenge({send});
  sc.observe('WebcastLinkmicBattleTaskMessage', task({start:{config:{targetConfig:{targetStartTimestamp:1030},rewardConfig:{rewardMultiple:3}}}}));
  sc.observe('WebcastLinkmicBattleTaskMessage',settle({taskSettle:{taskResult:0,rewardStartTimestamp:1090}}));
  sc.observe('WebcastLinkmicBattleTaskMessage',settle({battleId:'unknown'}));
  await vi.advanceTimersByTimeAsync(90_000); expect(send.mock.calls.map(c=>c[0])).toEqual([report('b1',1090,3,0),report('unknown',1090,null)]); sc.close();
 });
 it('deduplicates settlement, rejects stale/future evidence and cancels stopped sessions', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000); const send = vi.fn(); const sc = createSpeedChallenge({send});
  sc.observe('WebcastLinkmicBattleTaskMessage',settle());sc.observe('WebcastLinkmicBattleTaskMessage',settle());
  await vi.advanceTimersByTimeAsync(90_000);expect(send).toHaveBeenCalledTimes(1);
  sc.observe('WebcastLinkmicBattleTaskMessage',settle({battleId:'stale',taskSettle:{result:2,rewardStartTimestamp:1000}}));
  sc.observe('WebcastLinkmicBattleTaskMessage',settle({battleId:'future',taskSettle:{result:2,rewardStartTimestamp:1500}}));
  sc.observe('WebcastLinkmicBattleTaskMessage',settle({battleId:'stopped',taskSettle:{result:2,rewardStartTimestamp:1100}}));sc.close();
  await vi.advanceTimersByTimeAsync(600_000); expect(send).toHaveBeenCalledTimes(1);
 });
 it('uses actual successful LIVE settlement timestamp, never its earlier target schedule', async () => {
  vi.useFakeTimers();vi.setSystemTime(1793525828_000);const send=vi.fn();const sc=createSpeedChallenge({send});
  sc.observe('WebcastLinkmicBattleTaskMessage',settle({taskSettle:{result:2,rewardStartTimestamp:1793525858}}));
  await vi.advanceTimersByTimeAsync(29_999);expect(send).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);
  expect(send).toHaveBeenCalledWith(report('b1',1793525858,null));sc.close();
 });
});
