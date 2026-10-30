// AuraTok Cloud Worker — keeps TikTok LIVE connections open for every creator
// who entered their username on AuraTok, and forwards events to the AuraTok API.
// Battles (start/end, real team scores, opponent, contributors) and league
// fragments are tracked here too, so a cloud connection needs no extra program.
import { TikTokLiveConnection, WebcastEvent, ControlEvent, UserOfflineError, IsLiveRouteConfig } from "tiktok-live-connector";
import { createBattleTracker } from "./battle.js";
import { createBoosterCollector } from "./boosters.js";
import { verifiedLive, connectionFailure, ownerObserved } from './connection-status.js';
import { createLiveGate } from './live-session.js';
import { normalizeLevelBarrage,createLevelDelivery,createLevelSnapshots } from './levels.js';
import { WORKER_BUILD } from './build-info.js';
import { liveLike, giftStreakId, senderId } from './live-events.js';
import { createScout } from './scout.js';
import { createBattleDiagnostics } from './battle-diagnostics.js';
import { createSpeedChallenge } from './speed-challenge.js';
import { createStatusDelivery } from './status-delivery.js';
import { createConnectBudget, isSignRateLimit, rateLimitMessage } from './connect-budget.js';

const base = String(process.env.AURATOK_URL || "https://auratok.com").replace(/\/+$/, "");
const secret = process.env.WORKER_SECRET || "";
const signApiKey = process.env.SIGN_API_KEY || undefined;
if (secret.length < 16) { console.error("Set WORKER_SECRET"); process.exit(1); }
const log = (...a) => console.log(new Date().toISOString(), ...a);
// The LIVE pre-check only asks TikTok directly, so offline creators never use signing quota.
if (IsLiveRouteConfig) IsLiveRouteConfig.skipFetchRoomIdFromEulerRoute = true;
const budget = createConnectBudget();
const OFFLINE_FULL_CHECK_MS = 5 * 60_000;

const sessions = new Map(); // user_id -> session
const pending = new Map();  // user_id -> {status,message}
const flushStatus = createStatusDelivery({ pending, send: statuses => api('POST', { statuses }), log });
const setStatus = (id, status, message = "") => {
  const x = sessions.get(id); if (!x || x.stopped) return;
  x.status = { user_id: id, username: x.job.username, revision: x.job.revision, status, message };
  pending.set(id, x.status);
  void flushStatus();
};

async function api(method, body) {
  const r = await fetch(`${base}/api/public/cloud-worker`, { method, headers: { "Content-Type": "application/json", "x-worker-secret": secret }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`AuraTok ${r.status}`);
  return r.json();
}
const avatarOf = (u) => u?.profilePicture?.urls?.[0] || u?.avatarThumb?.urlList?.[0] || "";
const handleOf = (d) => { const u = d.user || {}; return u.uniqueId || u.displayId || u.username || d.uniqueId || u.nickname || d.nickname || "viewer"; };
const BATTLE = WebcastEvent.LINK_MIC_BATTLE ?? "linkMicBattle";
const ARMIES = WebcastEvent.LINK_MIC_ARMIES ?? "linkMicArmies";

function start(job) {
  const s = { job, conn: null, tracker: null, retryAt: 0, likeBuf: 0, likeTimer: null, stopped: false, booster: null, battleDelivery: Promise.resolve(), gate: createLiveGate(), inFlight: new Set(), levels:null, roomId:null, hostId:null };
  const tag=`@${String(job.tiktok_username||job.username||'').replace(/^@/,'')}`;
  s.levelSnaps=createLevelSnapshots({log:m=>log(`${tag} ${m}`)});
  s.levelStats=setInterval(()=>s.levelSnaps.flushStats(),60000); s.levelStats.unref?.();
  s.levels=createLevelDelivery({directory:`${process.env.LEVEL_SPOOL_DIR||'/tmp/auratok-level-spool'}/${job.user_id}`,log,send:async body=>{if(s.stopped||!await s.gate.wait())return 503;const r=await fetch(`${base}/api/public/events`,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':job.api_key},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return r.status;}});
  s.booster = createBoosterCollector({ spoolDir: `${process.env.BOOSTER_SPOOL_DIR || '/tmp/auratok-booster-spool'}/${job.user_id}`, post: async body => {
    const response = await fetch(`${base}/api/public/boosters`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': job.api_key }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Booster delivery failed');
  }, log });
  s.battleDiagnostics = createBattleDiagnostics({ until: process.env.BATTLE_DIAGNOSTICS_UNTIL, log, send: async body => {
    if (s.stopped) return;
    const response = await fetch(`${base}/api/public/booster-probe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': job.api_key }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Battle diagnostic delivery failed');
  } });
  s.speedChallenge = createSpeedChallenge({ log, send: async body => {
    if (s.stopped) return;
    const response = await fetch(`${base}/api/public/booster-task`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': job.api_key }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Speed Challenge delivery failed');
  } });
  sessions.set(job.user_id, s);
  connect(s);
}
function stop(id) {
  const s = sessions.get(id); if (!s) return;
  s.stopped = true; try { s.conn?.disconnect(); } catch {}
  s.gate.cancel();
  s.booster?.close();
  s.speedChallenge?.close();
  s.levels?.close(); clearInterval(s.levelStats);
  try { s.tracker?.stop(); } catch {}
  try { s.conn?.removeAllListeners(); s.conn?.disconnect(); } catch {}
  if (s.likeTimer) clearTimeout(s.likeTimer);
  sessions.delete(id); pending.delete(id);
}
async function get(s, path, params) {
  return forward(s, () => fetch(`${base}${path}?${new URLSearchParams({ key: s.job.api_key, ...params, live_generation:s.generation })}`));
}
async function post(s, path, body) {
  return forward(s, () => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": s.job.api_key }, body: JSON.stringify({...body, ...(path === '/api/public/events' ? {live_generation: s.generation} : {})}) }));
}
async function forward(s, send) {
  if (s.stopped || !await s.gate.wait()) return;
  const task = send(); s.inFlight.add(task);
  try { const r = await task; if (!r.ok) log(`Event delivery replied ${r.status}`); }
  catch { log('Event delivery failed'); }
  finally { s.inFlight.delete(task); }
}
/** Battle/league endpoints read the creator key from the payload — the tracker only builds bodies. */
async function postAs(s, path, body) {
  return forward(s, () => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: s.job.api_key, ...body,live_generation:s.generation }) }));
}

// Preserve socket order: start persists before gifts; end waits for all received battle gifts.
function deliverBattle(s, send) {
  const token = s.gate.token();
  s.battleDelivery = s.battleDelivery.then(async () => s.stopped || !await s.gate.wait(token) ? undefined : send()).catch(() => log('Battle delivery failed'));
  return s.battleDelivery;
}

function connect(s) {
  if (s.stopped) return;
  if (!budget.take()) {
    if (budget.blocked()) {
      setStatus(s.job.user_id, 'waiting', rateLimitMessage(budget.blockedUntil()));
      s.retryAt = budget.blockedUntil() + Math.floor(Math.random() * 30_000);
    } else s.retryAt = Date.now() + 5_000;
    return;
  }
  const attempt = s.gate.begin();
  if (s.likeTimer) clearTimeout(s.likeTimer);
  s.likeTimer = null; s.likeBuf = 0;
  s.booster.disconnected();
  const { username } = s.job;
  setStatus(s.job.user_id, "connecting", "");
  try { s.tracker?.stop(); } catch {}
  try { s.conn?.removeAllListeners(); s.conn?.disconnect(); } catch {}
  s.tracker = createBattleTracker({
    username,
    log: (m) => log(`@${username}`, m),
    post: (body) => deliverBattle(s, () => postAs(s, "/api/public/battle", body)),
    postLeague: (body) => postAs(s, "/api/public/league", body),
  });
  const tracker = s.tracker;
  const opts = { enableExtendedGiftInfo: false }; if (signApiKey) opts.signApiKey = signApiKey;
  const c = new TikTokLiveConnection(username, opts); s.conn = c;
  const run = async () => {
    // Cheap pre-check without the signing service; a full connect still runs at least every 5 min.
    const live = await c.fetchIsLive().catch(() => null);
    if (live === false && Date.now() - (s.lastFullConnectAt ?? 0) < OFFLINE_FULL_CHECK_MS) throw new UserOfflineError("The requested user isn't online :(");
    s.lastFullConnectAt = Date.now();
    return c.connect();
  };
  run().then(async (state) => {
    if (s.stopped || s.conn !== c) return;
    if (!verifiedLive(username, c, state)) {
      if (ownerObserved(state?.roomInfo ?? c.roomInfo)) {
        s.gate.cancel();
        setStatus(s.job.user_id, 'error', 'TikTok account identity could not be confirmed. Not connected.');
        s.retryAt = Date.now() + 300_000;
        c.removeAllListeners(); void c.disconnect();
        return;
      }
      // TikTok resolved connect() for this exact username to a live room but omitted owner
      // details from the payload. Retry once for the full payload, then accept the connect
      // resolution itself as the observed identity (connect throws for offline/unknown users).
      if ((s.identityRetries = (s.identityRetries ?? 0) + 1) <= 1) {
        s.gate.cancel();
        setStatus(s.job.user_id, 'connecting', 'Confirming the TikTok account — retrying. Not connected yet.');
        s.retryAt = Date.now() + 15_000;
        c.removeAllListeners(); void c.disconnect();
        return;
      }
      log(`live @${username} (owner details omitted by TikTok; identity accepted from connect resolution)`);
    }
    s.identityRetries = 0;
    if (!c.isConnected || !state?.roomId) throw new Error('LIVE room is not open');
    await Promise.allSettled([...s.inFlight]);
    if (s.stopped || s.conn !== c || !c.isConnected) return;
    const initialized = await api('POST', { beginLive: { user_id: s.job.user_id, room_id: String(state.roomId), username, revision: s.job.revision } });
    if (s.stopped || s.conn !== c || !c.isConnected) return;
    s.generation = initialized?.session?.generation;
    if (!s.generation) throw new Error('LIVE initialization missing generation');
    s.roomId=String(state?.roomId??c.roomId??'');
    s.gate.confirm(attempt);
    s.levels?.setRoom(s.roomId); s.levelSnaps.setRoom(s.roomId);
    log(`live @${username}`);
    const room = state?.roomInfo || c.roomInfo || {};
    const owner = room?.owner?.id_str || room?.owner?.id || room?.owner_user_id || room?.data?.owner?.id_str || "";
    tracker.setHostId(String(owner || ""));
    tracker.setHostId(room);
    s.booster.setCreator(tracker.status().hostId);
    s.booster.connected();
    setStatus(s.job.user_id, "live", "");
  }).catch((err) => {
    if (s.stopped || s.conn !== c) return;
    s.gate.cancel();
    s.booster.disconnected();
    if (isSignRateLimit(err)) {
      const until = budget.noteRateLimit(err);
      log(`@${username} connect paused: signing service hourly limit; all new connects resume ${new Date(until).toISOString()}`);
      setStatus(s.job.user_id, 'waiting', rateLimitMessage(until));
      s.retryAt = until + Math.floor(Math.random() * 30_000);
      return;
    }
    log(`@${username} connect failed:`, err?.constructor?.name, String(err?.message ?? err).slice(0, 200));
    const result = connectionFailure(err, username, c.roomInfo, err instanceof UserOfflineError);
    setStatus(s.job.user_id, result.status, result.message);
    s.retryAt = Date.now() + result.retryMs;
  });
  c.on(ControlEvent.DISCONNECTED, () => { if (!s.stopped && s.conn === c) { s.gate.cancel(); s.booster.disconnected(); setStatus(s.job.user_id, "connecting", "LIVE disconnected. Reconnecting — not connected."); s.retryAt = Date.now() + 30_000; } });
  c.on(WebcastEvent.CHAT, (d) => { seeViewer(d?.user);
    const msg = String(d.comment || "").trim(); if (!msg) return;
    get(s, "/api/public/chat", { user: handleOf(d), msg, event_id: String(d.msgId ?? d.common?.msgId ?? ""), avatar: avatarOf(d.user), isFollower: Number(d.user?.followRole ?? 0) >= 1 ? "1" : "0", isSubscriber: d.user?.isSubscriber ? "1" : "0", isModerator: d.user?.isModerator ? "1" : "0" });
  });
  c.on(WebcastEvent.BARRAGE??'barrage',d=>{if(s.stopped||s.conn!==c||!c.isConnected)return;s.levelSnaps.noteBarrage(d?.msgType);const body=normalizeLevelBarrage(d,c.roomId??s.roomId,log);if(body)void s.levels?.enqueue(body);});
  c.on(WebcastEvent.GIFT, (d) => { seeViewer(d?.user);
    if (s.stopped || s.conn !== c || !c.isConnected) return;
    const g = d.giftDetails || d.gift || {};
    const giftType = Number(d.giftType ?? g.type ?? g.giftType ?? 0);
    const repeatEnd = d.repeatEnd === true || Number(d.repeatEnd) === 1;
    if (giftType === 1 && !repeatEnd) return;
    const qty = Math.max(1, Number(d.repeatCount || d.comboCount || 1));
    const per = d.diamondCount ?? g.diamondCount;
    const battleId = tracker.status().battleId;
    const giftParams = {
      user: handleOf(d), nickname: d.user?.nickname || "", gift: d.giftName || g.name || g.giftName || "",
      sender_user_id: senderId(d),
      gift_id: String(d.giftId ?? g.id ?? ""), quantity: String(qty), coins: String(Number(per ?? 1) * qty),
      diamonds: per !== undefined ? String(per) : "", avatar: avatarOf(d.user), event_id: String(d.msgId ?? d.common?.msgId ?? ""),
      gift_icon: d.giftPictureUrl || g.image?.urlList?.[0] || "", gift_type: String(giftType), repeat_end: repeatEnd ? "true" : "false",
      streak_id: giftStreakId(d, c.roomId || s.roomId),
      live_generation: s.generation || '',
      ...(battleId ? { battleId } : {}),
    };
    if (battleId) deliverBattle(s, () => get(s, "/api/public/gift", giftParams));
    else get(s, "/api/public/gift", giftParams);
  });
  c.on(WebcastEvent.LIKE, (d) => { seeViewer(d?.user);
    if (s.stopped || s.conn !== c || !c.isConnected) return;
    const like = liveLike(d); if (!like) return;
    if (like.eventId) post(s, "/api/public/events", { type: "like", username: handleOf(d), sender_user_id: like.sender, likes: like.count, event_id: like.eventId, live_generation: s.generation });
    s.likeBuf += like.count; if (s.likeTimer) return;
    s.likeTimer = setTimeout(() => { s.likeTimer = null; const n = s.likeBuf; s.likeBuf = 0; get(s, "/api/public/goal", { type: "like", count: String(n) }); }, 800);
  });
  c.on(WebcastEvent.MEMBER ?? 'member', (d) => {seeViewer(d?.user);if(s.stopped||s.conn!==c||!c.isConnected)return;const identity=senderId(d);const username=d.user?.uniqueId||d.user?.displayId||d.uniqueId;if(!identity&&!username)return;void post(s,'/api/public/events',{type:'join',username:String(username||''),sender_user_id:identity,event_id:String(d.msgId??d.common?.msgId??'')});});
  c.on(WebcastEvent.FOLLOW, (d) => get(s, "/api/public/goal", { type: "follow", count: "1", user: handleOf(d), event_id: String(d.msgId ?? d.common?.msgId ?? "") }));
  c.on(WebcastEvent.SHARE, (d) => post(s, "/api/public/events", { type: "share", username: handleOf(d), event_id: String(d.msgId ?? d.common?.msgId ?? "") }));
  c.on(BATTLE, (m) => tracker.onBattleMessage(m));
  c.on(ARMIES, (m) => tracker.onArmiesMessage(m));
  c.on(WebcastEvent.LINK_MIC_BATTLE_ITEM_CARD ?? 'linkMicBattleItemCard', m => { s.booster.setCreator(tracker.status().hostId); s.booster.observe('WebcastLinkMicBattleItemCard', m); probeMessage(s, 'WebcastLinkMicBattleItemCard', m); });
  c.on("decodedData", (raw, decoded) => {
    const type = decoded?.type ?? raw?.type ?? raw;
    const data = decoded?.data ?? decoded ?? raw?.data;
    tracker.onDecoded(type, data);
    if (data?.user) seeViewer(data.user);
  });
  const seeViewer = (u) => {
    if (!s.stopped && s.conn === c && c.isConnected && s.roomId && u && !(s.lastSeen === u)) {
      s.lastSeen = u;
      if (!s.hostId && String(u.uniqueId || u.displayId || '').toLowerCase() === username.toLowerCase()) s.hostId = [u.userId, u.idStr, u.id].map(v => String(v ?? '')).find(v => /^\d{5,30}$/.test(v)) || null;
      for (const body of s.levelSnaps.observe(u, s.roomId, tracker.status().hostId || s.hostId)) void s.levels?.enqueue(body);
    }
  };
  c.on("decodedData", (raw, decoded) => {
    const type = decoded?.type ?? raw?.type ?? raw;
    const data = decoded?.data ?? decoded ?? raw?.data;
    tracker.onDecoded(type, data);
    if (data?.user) seeViewer(data.user);
    s.booster.setCreator(tracker.status().hostId);
    if (String(type) !== 'WebcastLinkMicBattleItemCard') s.booster.observe(String(type), data);
    probeMessage(s, String(type), data, raw);
    if (!s.stopped && s.conn === c && c.isConnected) { s.battleDiagnostics?.observe(String(type), data); s.speedChallenge?.observe(String(type), data); }
  });
}

// Research capture: keep a rolling buffer of recent battle messages and, for 20 s after a power-up award, every
// non-noise message — plus the raw protobuf bytes — so we can document exactly which card fields TikTok delivers.
const PROBE_NOISE = /chat|gift|like|member|social|roomuserseq|roomrank|emote|envelope|subnotify|caption|barrage|hourlyrank|inroombanner/i;
const PROBE_HINT = /card|booster|powerup|power_up|buff|prop|item_?info|bag/i;
function rawBase64(raw) {
  try {
    const bytes = raw?.binary ?? raw?.data ?? raw?.payload;
    const buf = Buffer.isBuffer(bytes) ? bytes : bytes instanceof Uint8Array ? Buffer.from(bytes) : null;
    return buf && buf.length ? buf.toString("base64").slice(0, 40000) : null;
  } catch { return null; }
}
function sendProbe(s, type, data, reason, raw) {
  try {
    const json = JSON.stringify(data ?? {}, (k, v) => typeof v === 'bigint' ? v.toString() : v);
    if (json.length > 70000) return;
    const body = { sessionId: null, sourceEvent: type, reason, payload: JSON.parse(json) };
    const b64 = rawBase64(raw); if (b64) body.rawBase64 = b64;
    fetch(`${base}/api/public/booster-probe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': s.job.api_key }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }).catch(() => {});
  } catch {}
}
function probeMessage(s, type, data, raw) {
  try {
    const now = Date.now(), json = JSON.stringify(data ?? {}, (k, v) => typeof v === 'bigint' ? v.toString() : v);
    const noise = PROBE_NOISE.test(type);
    if (!noise) { (s.probeRing = s.probeRing ?? []).push({ type, json, raw }); if (s.probeRing.length > 30) s.probeRing.shift(); }
    if (type === 'WebcastLinkMicBattleItemCard' && /awardCardNotice/.test(json)) {
      for (const prior of s.probeRing ?? []) sendProbe(s, prior.type, JSON.parse(prior.json), 'before_award', prior.raw);
      s.probeRing = []; s.probeUntil = now + 20_000; s.probeCount = 0;
    }
    const inWindow = (s.probeUntil ?? 0) > now && !noise;
    const hinted = !noise && /battle|linkmic|match|card|prop/i.test(type) && PROBE_HINT.test(json) && type !== 'WebcastLinkMicBattleItemCard';
    if (!inWindow && !hinted) return;
    if ((s.probeCount = (s.probeCount ?? 0) + 1) > 60) return;
    sendProbe(s, type, data, inWindow ? 'after_award' : 'card_hint', raw);
  } catch {}
}

let ticking = false;
let lastHeartbeat = 0;
async function tick() {
  if (ticking) return; ticking = true;
  try {
  try {
    const { jobs } = await api("GET");
    const want = new Map(jobs.map((j) => [j.user_id, j]));
    for (const id of [...sessions.keys()]) {
      const j = want.get(id), s = sessions.get(id);
      if (!j || j.username !== s.job.username || j.api_key !== s.job.api_key || j.revision !== s.job.revision) stop(id);
    }
    for (const j of jobs) if (!sessions.has(j.user_id)) start(j);
    for (const s of sessions.values()) if (s.retryAt && Date.now() >= s.retryAt) { s.retryAt = 0; try { s.conn?.disconnect(); } catch {} connect(s); }
  } catch (e) { log("tick failed", e.message); }
  for (const x of sessions.values()) {
    if (x.status?.status === 'live' && !x.conn?.isConnected) {
      x.booster.disconnected(); setStatus(x.job.user_id, 'connecting', 'LIVE disconnected. Reconnecting — not connected.');
      x.retryAt ||= Date.now() + 30_000;
    }
    if (Date.now() - lastHeartbeat >= 20_000 && x.status && !pending.has(x.job.user_id)) pending.set(x.job.user_id, x.status);
  }
  if (Date.now() - lastHeartbeat >= 20_000) lastHeartbeat = Date.now();
  await flushStatus();
  } finally { ticking = false; }
}
log(`AuraTok Cloud Worker build ${WORKER_BUILD} → ${base} (SIGN_API_KEY ${signApiKey ? 'set' : 'NOT set'})`);
tick(); setInterval(tick, 5_000);
// Independent of LIVE sockets: Test Mode also needs an authoritative gameplay clock.
let towerTicking = false;
async function towerTick() {
  if (towerTicking) return;
  towerTicking = true;
  try {
    const response = await fetch(`${base}/api/public/tower-tick`, { method: 'POST', headers: { 'x-worker-secret': secret }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) log(`AuraTower service replied ${response.status}`);
  } catch { log('AuraTower service unavailable'); }
  finally { towerTicking = false; }
}
void towerTick(); setInterval(() => void towerTick(), 1000);
// Gift Scout: visits admin-queued public LIVE rooms one at a time and imports
// each room's gift list. Runs independently of creator connections.
createScout({ base, secret, signApiKey, log, budget }).start();
let raceTicking = false;
async function raceTick() {
  if (raceTicking) return;
  raceTicking = true;
  try {
    const response = await fetch(`${base}/api/public/race-tick`, { method: 'POST', headers: { 'x-worker-secret': secret }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) log(`AuraRace service replied ${response.status}`);
  } catch { log('AuraRace service unavailable'); }
  finally { raceTicking = false; }
}
void raceTick(); setInterval(() => void raceTick(), 1000);
// tiny health server so it can also run as a Render web service
import("node:http").then(({ createServer }) => { if (process.env.PORT) createServer((_, r) => r.end("ok")).listen(process.env.PORT); });
