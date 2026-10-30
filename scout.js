// AuraTok Gift Scout — visits public LIVE rooms queued by an admin and reads
// each room's gift list into the shared catalog. One room at a time, short
// connections, no session cookies.
import { TikTokLiveConnection, UserOfflineError } from "tiktok-live-connector";
import { mapRoomGifts } from "./scout-gifts.js";
import { isSignRateLimit } from "./connect-budget.js";

export { mapRoomGifts };

export function createScout({ base, secret, signApiKey, log, budget, pollMs = 15000, connectTimeoutMs = 25000, connectImpl }) {
  let busy = false;
  const http = async (method, body) => {
    const r = await fetch(`${base}/api/public/gift-scout`, { method, headers: { "Content-Type": "application/json", "x-worker-secret": secret }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`gift-scout ${r.status}`);
    return r.json();
  };
  const connect = connectImpl ?? (async (username) => {
    const opts = { enableExtendedGiftInfo: true };
    if (signApiKey) opts.signApiKey = signApiKey;
    const conn = new TikTokLiveConnection(username, opts);
    await Promise.race([conn.connect(), new Promise((_, reject) => setTimeout(() => reject(new Error("Connect timeout")), connectTimeoutMs))]);
    return conn;
  });
  async function runJob(job) {
    let conn = null;
    try {
      conn = await connect(job.username);
      const state = conn.getState ? conn.getState() : conn.state;
      const gifts = mapRoomGifts(state?.availableGifts?.gifts ?? state?.availableGifts ?? []);
      await http("POST", { jobId: job.id, result: "done", roomId: String(state?.roomId ?? ""), gifts });
      log(`scout @${job.username}: ${gifts.length} gifts imported`);
    } catch (e) {
      if (isSignRateLimit(e)) budget?.noteRateLimit(e);
      const offline = e instanceof UserOfflineError || /offline|not live|isn't live/i.test(String(e?.message ?? ""));
      try { await http("POST", { jobId: job.id, result: offline ? "offline" : "error", error: String(e?.message ?? e).slice(0, 500) }); } catch {}
      log(`scout @${job.username} ${offline ? "not live" : "failed"}: ${e?.message ?? e}`);
    } finally {
      try { conn?.removeAllListeners(); await conn?.disconnect(); } catch {}
    }
  }
  async function tick() {
    if (busy || budget?.blocked()) return; // creator connections share the quota and come first
    busy = true;
    try { const { job } = await http("GET"); if (job) await runJob(job); }
    catch (e) { log("scout tick failed", e?.message ?? e); }
    finally { busy = false; }
  }
  return { tick, start: () => { void tick(); return setInterval(() => void tick(), pollMs); } };
}
