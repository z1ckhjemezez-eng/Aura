// AuraTok Cloud Worker — keeps TikTok LIVE connections open for every creator
// who entered their username on AuraTok, and forwards events to the AuraTok API.
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from "tiktok-live-connector";

const base = String(process.env.AURATOK_URL || "https://auratok.com").replace(/\/+$/, "");
const secret = process.env.WORKER_SECRET || "";
const signApiKey = process.env.SIGN_API_KEY || undefined;
if (secret.length < 16) { console.error("Set WORKER_SECRET"); process.exit(1); }
const log = (...a) => console.log(new Date().toISOString(), ...a);

const sessions = new Map(); // user_id -> session
const pending = new Map();  // user_id -> {status,message}
const setStatus = (id, status, message = "") => pending.set(id, { user_id: id, status, message });

async function api(method, body) {
  const r = await fetch(`${base}/api/public/cloud-worker`, { method, headers: { "Content-Type": "application/json", "x-worker-secret": secret }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`AuraTok ${r.status}`);
  return r.json();
}
const avatarOf = (u) => u?.profilePicture?.urls?.[0] || u?.avatarThumb?.urlList?.[0] || "";
const handleOf = (d) => { const u = d.user || {}; return u.uniqueId || u.displayId || u.username || d.uniqueId || u.nickname || d.nickname || "viewer"; };

function start(job) {
  const s = { job, conn: null, retryAt: 0, likeBuf: 0, likeTimer: null, stopped: false };
  sessions.set(job.user_id, s);
  connect(s);
}
function stop(id) {
  const s = sessions.get(id); if (!s) return;
  s.stopped = true; try { s.conn?.disconnect(); } catch {}
  sessions.delete(id); setStatus(id, "off", "");
}
async function get(s, path, params) {
  try { await fetch(`${base}${path}?${new URLSearchParams({ key: s.job.api_key, ...params })}`); } catch (e) { log("forward failed", e.message); }
}
async function post(s, path, body) {
  try { await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": s.job.api_key }, body: JSON.stringify(body) }); } catch (e) { log("forward failed", e.message); }
}

function connect(s) {
  if (s.stopped) return;
  const { username } = s.job;
  setStatus(s.job.user_id, "connecting", "");
  const opts = { enableExtendedGiftInfo: false }; if (signApiKey) opts.signApiKey = signApiKey;
  const c = new TikTokLiveConnection(username, opts); s.conn = c;
  c.connect().then(() => { log(`live @${username}`); setStatus(s.job.user_id, "live", ""); }).catch((err) => {
    const m = String(err?.message ?? err);
    const offline = /offline|not.*live|LIVE has ended|isn't online|UserOfflineError/i.test(m);
    setStatus(s.job.user_id, offline ? "waiting" : "error", offline ? "" : m.slice(0, 280));
    s.retryAt = Date.now() + (offline ? 60_000 : 120_000);
  });
  c.on(ControlEvent.DISCONNECTED, () => { if (!s.stopped) { setStatus(s.job.user_id, "waiting", ""); s.retryAt = Date.now() + 30_000; } });
  c.on(WebcastEvent.CHAT, (d) => {
    const msg = String(d.comment || "").trim(); if (!msg) return;
    get(s, "/api/public/chat", { user: handleOf(d), msg, avatar: avatarOf(d.user), isFollower: Number(d.user?.followRole ?? 0) >= 1 ? "1" : "0", isSubscriber: d.user?.isSubscriber ? "1" : "0", isModerator: d.user?.isModerator ? "1" : "0" });
  });
  c.on(WebcastEvent.GIFT, (d) => {
    const g = d.giftDetails || d.gift || {};
    const giftType = Number(d.giftType ?? g.type ?? g.giftType ?? 0);
    const repeatEnd = d.repeatEnd === true || Number(d.repeatEnd) === 1;
    if (giftType === 1 && !repeatEnd) return;
    const qty = Math.max(1, Number(d.repeatCount || d.comboCount || 1));
    const per = d.diamondCount ?? g.diamondCount;
    get(s, "/api/public/gift", {
      user: handleOf(d), nickname: d.user?.nickname || "", gift: d.giftName || g.name || g.giftName || "",
      gift_id: String(d.giftId ?? g.id ?? ""), quantity: String(qty), coins: String(Number(per ?? 1) * qty),
      diamonds: per !== undefined ? String(per) : "", avatar: avatarOf(d.user), event_id: String(d.msgId ?? d.common?.msgId ?? ""),
      gift_icon: d.giftPictureUrl || g.image?.urlList?.[0] || "", gift_type: String(giftType), repeat_end: repeatEnd ? "true" : "false",
    });
  });
  c.on(WebcastEvent.LIKE, (d) => {
    s.likeBuf += Number(d.likeCount || 1); if (s.likeTimer) return;
    s.likeTimer = setTimeout(() => { s.likeTimer = null; const n = s.likeBuf; s.likeBuf = 0; get(s, "/api/public/goal", { type: "like", count: String(n) }); }, 3000);
  });
  c.on(WebcastEvent.FOLLOW, () => get(s, "/api/public/goal", { type: "follow", count: "1" }));
  c.on(WebcastEvent.SHARE, (d) => post(s, "/api/public/events", { type: "share", username: handleOf(d) }));
}

async function tick() {
  try {
    const { jobs } = await api("GET");
    const want = new Map(jobs.map((j) => [j.user_id, j]));
    for (const id of [...sessions.keys()]) {
      const j = want.get(id), s = sessions.get(id);
      if (!j || j.username !== s.job.username || j.api_key !== s.job.api_key) stop(id);
    }
    for (const j of jobs) if (!sessions.has(j.user_id)) start(j);
    for (const s of sessions.values()) if (s.retryAt && Date.now() >= s.retryAt) { s.retryAt = 0; try { s.conn?.disconnect(); } catch {} connect(s); }
  } catch (e) { log("tick failed", e.message); }
  if (pending.size) { const statuses = [...pending.values()]; pending.clear(); api("POST", { statuses }).catch((e) => log("status failed", e.message)); }
}
log(`AuraTok Cloud Worker → ${base}`);
tick(); setInterval(tick, 20_000);
// tiny health server so it can also run as a Render web service
import("node:http").then(({ createServer }) => { if (process.env.PORT) createServer((_, r) => r.end("ok")).listen(process.env.PORT); });
