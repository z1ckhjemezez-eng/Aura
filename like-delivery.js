// Leading-edge, single-flight like batches with stable identities.
// Each batch gets its id before the first send and keeps id+count on every retry, so the server
// (add_goal_progress_batch) counts it exactly once even when a reply is lost. New likes accumulate
// into the next batch while one is pending. Unacknowledged batches stay in a bounded in-memory queue;
// the worker has no durable disk for likes, so a process restart still loses unacknowledged batches.
const MAX_PENDING = 50;
export function createLikeDelivery({ send, onError = () => {}, prefix = 'lk', delays = [1000, 3000, 8000, 20000], wait = ms => new Promise(r => setTimeout(r, ms)), makeId }) {
  let total = 0, running = false, closed = false, seq = 0;
  const session = makeId ? '' : Math.random().toString(36).slice(2, 10);
  const queue = [];
  const nextId = () => makeId ? makeId(++seq) : `${prefix}:${session}:${++seq}`;
  async function deliver(batch) {
    for (let attempt = 0; !closed; attempt++) {
      try { await send(batch.count, batch.id); return true; }
      catch { onError(); if (attempt >= delays.length) return false; await wait(delays[attempt]); }
    }
    return false;
  }
  async function flush() {
    if (running || closed) return;
    running = true;
    while (!closed && (queue.length || total > 0)) {
      if (!queue.length) {
        // Match the existing goal endpoint's 100000-per-request limit without losing overflow.
        const count = Math.min(total, 100000); total -= count;
        queue.push({ id: nextId(), count });
      }
      const batch = queue[0];
      if (await deliver(batch)) queue.shift();
      else break; // keep the batch (same id/count) for the next add() to retry
    }
    running = false;
  }
  return {
    add(count) {
      if (closed || !Number.isFinite(count) || count <= 0) return;
      total += Math.floor(count);
      while (queue.length > MAX_PENDING) queue.shift();
      void flush();
    },
    pending() { return queue.map(b => ({ ...b })); },
    close() { closed = true; total = 0; queue.length = 0; },
  };
}
