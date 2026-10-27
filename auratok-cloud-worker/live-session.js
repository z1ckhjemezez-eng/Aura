/** A connection attempt cannot forward until the durable room reset is acknowledged. */
export function createLiveGate() {
  let attempt = 0;
  let release = () => {};
  let ready = Promise.resolve(false);
  return {
    begin() {
      release(false);
      attempt++;
      ready = new Promise(resolve => { release = resolve; });
      return attempt;
    },
    confirm(token) { if (token === attempt) release(true); },
    cancel() { release(false); attempt++; ready = Promise.resolve(false); },
    token() { return attempt; },
    async wait(token = attempt) {
      if (token !== attempt) return false;
      return await ready && token === attempt;
    },
  };
}