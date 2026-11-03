// Target/start is only the unlock phase. Activate only from a successful task
// settlement carrying TikTok's positive rewardStartTimestamp. No schedule fallback.
export function createSpeedChallenge({ send, log = () => {}, now = Date.now }) {
  const seen = new Set();
  const announced = new Map();
  const timers = new Set();
  const remember = key => {
    seen.add(key);
    if (seen.size > 50) {
      const first = seen.values().next().value;
      if (first !== undefined) seen.delete(first);
    }
  };
  return {
    observe(type, payload) {
      if (type !== 'WebcastLinkmicBattleTaskMessage' || !payload || typeof payload !== 'object') return;
      const battleId = String(payload.battleId ?? '');
      if (!battleId) return;
      const phase = Number(payload.taskMessageType);
      if (phase === 0) {
        const outer = payload.start;
        if (!outer || typeof outer !== 'object') return;
        const start = outer.config && typeof outer.config === 'object' ? outer.config : outer;
        const rawMulti = Number(start.rewardConfig?.rewardMultiple);
        announced.set(battleId, { multiplier: Number.isInteger(rawMulti) && rawMulti >= 2 && rawMulti <= 9 ? rawMulti : null, at: now() });
        if (announced.size > 50) announced.delete(announced.keys().next().value);
        return;
      }
      if (phase !== 2) return; // progress and reward summaries never activate FX
      const settle = payload.taskSettle;
      if (!settle || typeof settle !== 'object') return;
      const result = Number(settle.result ?? settle.taskResult);
      // Connector enum: 0=SUCCEED, 1=FAILED, 2=BOTH_SUCCEED.
      if (result !== 0 && result !== 2) return;
      const reward = Number(settle.rewardStartTimestamp);
      if (!Number.isFinite(reward) || reward <= 0) return;
      const announcement = announced.get(battleId);
      const multiplier = announcement && now() - announcement.at <= 5 * 60_000 ? announcement.multiplier : null;
      const key = `${battleId}:${reward}`;
      if (seen.has(key)) return;
      const atMs = reward * 1000;
      const delay = atMs - now();
      // Implausibly far schedules or stale messages are never trusted.
      if (delay > 5 * 60_000 || delay < -60_000) return;
      remember(key);
      const timer = setTimeout(() => {
        timers.delete(timer);
        Promise.resolve()
          .then(() => send({ battleId, activatedAt: new Date(atMs).toISOString(), multiplier, evidence: 'task_settle_reward', taskResult: result, rewardStartTimestamp: reward }))
          .then(() => log('Speed Challenge activation reported'))
          .catch(() => log('Speed Challenge delivery failed'));
      }, Math.max(0, delay));
      timer.unref?.();
      timers.add(timer);
    },
    close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      announced.clear();
    },
  };
}
