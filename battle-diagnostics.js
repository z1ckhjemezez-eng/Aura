// Passive, opt-in research only. Never emits a gameplay event or schedules a challenge.
const BATTLE = /^Webcast(?:LinkmicBattleTaskMessage|LinkMicBattle.*|LinkMicArmies|LinkMicMethod|LinkMicFanTicketMethod)$/;
const NUMERIC = /^(taskMessageType|msgType|status|result|taskStatus|targetType|promptType|progress|progressTarget|currentProgress|duration|rewardMultiple|previewStartTime|previewStartTimestamp|targetStartTime|targetStartTimestamp|rewardStartTime|rewardStartTimestamp|createTime|finishTime|startTime|endTime)$/;
const BRANCH = /^(start|config|targetConfig|rewardConfig|previewConfig|prompt|elems|taskUpdate|taskSettle|reward|common|rewardPreparePrompt|rewardingPrompt|clickPrompt|giftAmountGuide|task|tasks|teams|results|progressDetails)$/;
export function battleDiagnosticPayload(value, depth = 0) {
  if (depth > 10 || !value || typeof value !== 'object') return {};
  if (Array.isArray(value)) return value.slice(0, 20).map(v => battleDiagnosticPayload(v, depth + 1));
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (NUMERIC.test(key) && /^\d{1,13}$/.test(String(v))) out[key] = String(v);
    else if (key === 'promptKey' && typeof v === 'string' && /^pm_mt_[a-zA-Z0-9_]{1,100}$/.test(v)) out[key] = v;
    else if (key === 'promptField' && typeof v === 'string' && /^(dur|multi|sum)$/.test(v)) out[key] = v;
    else if (key === 'value' && /^\d{1,9}$/.test(String(v))) out[key] = String(v);
    else if (BRANCH.test(key)) out[key] = battleDiagnosticPayload(v, depth + 1);
  }
  return out;
}
export function createBattleDiagnostics({ until, send, now = Date.now, log = () => {} }) {
  const deadline = Date.parse(until || '');
  // Misconfigured far-future dates must not produce permanent capture.
  const expires = Number.isFinite(deadline) ? Math.min(deadline, now() + 30 * 60_000) : 0;
  const seen = new Set(); let taskCount = 0, otherCount = 0, inFlight = 0;
  return {
    observe(type, payload) {
      if (now() >= expires || !BATTLE.test(type) || !payload || typeof payload !== 'object' || inFlight >= 2) return;
      const task = type === 'WebcastLinkmicBattleTaskMessage';
      if (task ? taskCount >= 80 : otherCount >= 40) return;
      const safe = battleDiagnosticPayload(payload);
      const messageId = payload.common?.msgId ?? payload.msgId;
      const key = `${type}:${messageId ? String(messageId) : JSON.stringify(safe)}`;
      if (seen.has(key)) return;
      seen.add(key); if (task) taskCount++; else otherCount++;
      inFlight++;
      Promise.resolve().then(() => send({ sourceEvent: type, reason: 'battle_task_v1', payload: safe }))
        .then(() => log('Battle diagnostics sample stored'))
        .catch(() => log('Battle diagnostics delivery failed'))
        .finally(() => { inFlight--; });
    },
  };
}