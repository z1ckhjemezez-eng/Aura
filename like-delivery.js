// Leading-edge, single-flight goal deltas. Source-identified game/like events remain separate.
export function createLikeDelivery({ send, onError = () => {} }) {
  let total = 0, running = false, closed = false;
  async function flush() {
    if(running || closed) return;
    running = true;
    while(total > 0 && !closed) {
      // Match the existing goal endpoint's 100000-per-request limit without losing overflow.
      const count = Math.min(total,100000); total -= count;
      try { await send(count); } catch { onError(); }
    }
    running = false;
  }
  return {
    add(count) { if(closed || !Number.isFinite(count) || count <= 0) return; total += Math.floor(count); void flush(); },
    close() { closed = true; total = 0; },
  };
}