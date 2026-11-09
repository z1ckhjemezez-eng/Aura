// Serial lifecycle/gift barriers; only redundant pending cumulative scores coalesce.
export function createBattleDelivery({ onError = () => {} } = {}) {
  const queue = [];
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue.shift();
      try { await job.send(); } catch { onError(); }
      for (const resolve of job.waiters) resolve();
    }
    running = false;
  }
  return {
    enqueue(send, scoreKey = null) {
      return new Promise(resolve => {
        const last = queue[queue.length - 1];
        if (scoreKey && last?.scoreKey === scoreKey) {
          last.send = send;
          last.waiters.push(resolve);
        } else queue.push({ send, scoreKey, waiters: [resolve] });
        void drain();
      });
    },
  };
}