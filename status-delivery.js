// One serialized sender for immediate transitions and periodic heartbeats.
export function createStatusDelivery({ pending, send, log = () => {} }) {
  let running = false;
  return async function flush() {
    if (running || !pending.size) return;
    running = true;
    try {
      while (pending.size) {
        const statuses = [...pending.values()];
        await send(statuses);
        for (const report of statuses) if (pending.get(report.user_id) === report) pending.delete(report.user_id);
      }
    } catch { log('Status delivery pending; retrying'); }
    finally { running = false; }
  };
}