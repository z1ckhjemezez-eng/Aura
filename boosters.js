// One observer per existing connection. No gift IDs, no extra socket, no simulated outcomes.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export function isBoosterEvent(type, payload) {
  if (/battleitemcard|battle.*(powerup|card|buff|specialeffect)/i.test(type)) return true;
  if (!/battle|armies/i.test(type)) return false;
  return /"(?:useCardInfo|awardCardInfo|itemCard|powerUp|buffInfo|specialEffect)"\s*:/.test(JSON.stringify(payload));
}
export function createBoosterCollector({ post, source = 'cloud', spoolDir = '/tmp/auratok-booster-spool', log = () => {} }) {
  const sessionId = randomUUID(), startedAt = new Date().toISOString();
  let creatorId = null, gapCount = 0, status = 'gap', running = false, closed = false;
  const pending = new Map(); mkdirSync(spoolDir, { recursive: true, mode: 0o700 });
  const file = join(spoolDir, 'pending.json');
  try { for (const [id, body] of JSON.parse(readFileSync(file,'utf8'))) pending.set(id,body); } catch {}
  function save() { try { const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify([...pending]), { mode: 0o600 }); renameSync(tmp,file); } catch { log('Booster disk persistence unavailable; session incomplete'); } }
  async function drain() {
    if (running) return; running = true;
    try { for (const [id, body] of pending) { await post(body); if (pending.get(id) === body) pending.delete(id); save(); } }
    catch { log('Booster delivery pending; retrying'); }
    finally { running = false; }
  }
  function enqueue(body) { pending.set(randomUUID(), body); save(); void drain(); }
  function health(next) { if (next === 'gap' && status !== 'gap') gapCount++; status = next; pending.set(`health:${sessionId}`,{ sessionId, startedAt, source, creatorId, status, gapCount }); save(); void drain(); }
  const timer = setInterval(() => { if (!closed) health(status); void drain(); }, 15000);
  return {
    setCreator(id) { creatorId = typeof id === 'string' && id ? id : null; },
    connected() { health('observing'); }, disconnected() { health('gap'); },
    observe(type, payload) {
      if (!isBoosterEvent(String(type), payload)) return;
      // String serialization preserves protobuf int64 strings; never turn IDs into JS numbers.
      const safe = JSON.parse(JSON.stringify(payload, (key,value) => /token|secret|password|cookie|authorization|api.?key|signature/i.test(key) ? undefined : typeof value === 'bigint' ? value.toString() : value));
      enqueue({ sessionId, source, creatorId, sourceEvent: String(type), observedAt: new Date().toISOString(), payload: safe });
      log('Battle power-up event detected · awaiting classification');
    },
    close() { closed = true; clearInterval(timer); health('ended'); },
    pendingCount() { return pending.size; },
  };
}