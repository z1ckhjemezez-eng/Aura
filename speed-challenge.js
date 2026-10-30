// Speed Challenge FX activation — fires only at TikTok's own targetStartTimestamp
// from WebcastLinkmicBattleTaskMessage start messages (taskMessageType 0).
// Never guesses activation time, never synthesizes events, dedupes per battle task.
export function createSpeedChallenge({ send, log = () => {}, now = Date.now }) {
  const seen = new Set();
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
      if (Number(payload.taskMessageType ?? 0) !== 0) return; // start announcements only
      // LIVE payloads nest the schedule under start.config; flat shapes kept for compatibility.
      const outer = payload.start;
      if (!outer || typeof outer !== 'object') return;
      const start = outer.config && typeof outer.config === 'object' ? outer.config : outer;
      const target = Number(start.targetConfig?.targetStartTimestamp ?? start.targetStartTimestamp ?? payload.targetStartTimestamp);
      if (!Number.isFinite(target) || target <= 0) return;
      // TikTok's own start message states the reward multiplier (x2/x3); never guessed.
      const rawMulti = Number(start.rewardConfig?.rewardMultiple);
      const multiplier = Number.isInteger(rawMulti) && rawMulti >= 2 && rawMulti <= 9 ? rawMulti : null;
      const battleId = String(payload.battleId ?? '') || `task-${target}`;
      const key = `${battleId}:${target}`;
      if (seen.has(key)) return;
      const atMs = target * 1000;
      const delay = atMs - now();
      // Implausibly far schedules or stale messages are never trusted.
      if (delay > 5 * 60_000 || delay < -60_000) return;
      remember(key);
      const timer = setTimeout(() => {
        timers.delete(timer);
        Promise.resolve()
          .then(() => send({ battleId, activatedAt: new Date(atMs).toISOString(), multiplier }))
          .then(() => log('Speed Challenge activation reported'))
          .catch(() => log('Speed Challenge delivery failed'));
      }, Math.max(0, delay));
      timer.unref?.();
      timers.add(timer);
    },
    close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
