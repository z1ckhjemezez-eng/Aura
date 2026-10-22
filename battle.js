// AuraTok battle tracking — pure logic, no imports, safe to unit test.
// Turns raw TikTok LIVE battle messages into AuraTok battle/league posts.
// Nothing is guessed: scores and contributors only come from TikTok's own battle fields.

const ACTION_OPEN = 4, ACTION_FINISH = 5, ACTION_CUT_SHORT = 6;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** TikTok sends armies either as a { key: value } map or as [{ key, value }] pairs — normalize to a map. */
export function toArmyMap(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  if (Array.isArray(input)) {
    for (const w of input) {
      if (!w || typeof w !== "object") continue;
      const value = w.value && typeof w.value === "object" ? w.value : null;
      if (!value) continue;
      const key = String(w.key ?? value.anchorIdStr ?? value.anchorId ?? "");
      if (key) out[key] = value;
    }
    return out;
  }
  for (const [k, v] of Object.entries(input)) if (v && typeof v === "object") out[k] = v;
  return out;
}

/** TikTok does not document league data. Scan decoded messages for league/fragment fields — never invent. */
export function scanLeague(obj, out = {}, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 8) return out;
  for (const [k, v] of Object.entries(obj)) {
    const kl = k.toLowerCase();
    if (v && typeof v === "object") { scanLeague(v, out, depth + 1); continue; }
    if (out.league == null && /(league|division|tier)(name|title|text)?$/.test(kl) && typeof v === "string" && v.trim()) out.league = v.trim();
    if (out.fragments == null && /fragment(s|count|num|score)?$/.test(kl) && Number.isFinite(Number(v))) out.fragments = Number(v);
    if (out.promotion == null && /(promot|upgrade|nextlevel|levelup)\w*(score|threshold|fragment|need)/.test(kl) && Number.isFinite(Number(v))) out.promotion = Number(v);
    if (out.rank == null && /^(league)?(rank|ranking|position)$/.test(kl) && Number.isFinite(Number(v)) && Number(v) > 0) out.rank = Number(v);
    if (out.demotion == null && /(demot|downgrade|relegat)\w*(score|threshold|fragment)/.test(kl) && Number.isFinite(Number(v))) out.demotion = Number(v);
  }
  return out;
}

/**
 * Creates one battle tracker per LIVE connection.
 * options: { username, log, post, postLeague, interval, endDelay }
 *  - post(body)       → battle endpoint body ({ event: "start" | "update" | "end", ... })
 *  - postLeague(body) → league endpoint body
 */
export function createBattleTracker(options = {}) {
  const {
    username = "", log = () => {}, post = async () => {}, postLeague = async () => {},
    interval = 1000, endDelay = 300,
  } = options;
  const name = String(username).replace(/^@/, "").trim().toLowerCase();

  let hostId = null;              // our creator's TikTok user id
  let battle = null;              // { id, our, opp, contributors: Map }
  let sendTimer = null;
  let endTimer = null;
  let opponent = null;            // { username, displayName, avatar } — from real battle data only
  let mode = null;                // battle mode metadata, only if TikTok sends it
  let lastBattleMsg = null;
  let lastLeague = "";
  const endedIds = new Set();     // battles already closed — never reopened by a late army message


  /** Find a user object (uniqueId/nickname/avatar) anywhere in a message, excluding our host. */
  function findUser(obj, wantId, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 7) return null;
    const id = String(obj.userId ?? obj.id ?? obj.idStr ?? obj.userIdStr ?? obj.id_str ?? "");
    const uid = obj.uniqueId ?? obj.displayId;
    if (id && uid && (wantId ? id === wantId : id !== hostId) && String(uid).toLowerCase() !== name) {
      return {
        username: String(uid), displayName: obj.nickname || null,
        avatar: obj.avatarThumb?.urlList?.[0] || obj.profilePicture?.urls?.[0] || null,
      };
    }
    for (const v of Object.values(obj)) { const r = findUser(v, wantId, depth + 1); if (r) return r; }
    return null;
  }

  /** Search an object tree for a user whose uniqueId matches ours and return its id. */
  function findOwnId(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return null;
    const uid = obj.uniqueId ?? obj.displayId ?? obj.unique_id;
    if (typeof uid === "string" && uid.toLowerCase() === name) {
      const id = obj.userId ?? obj.id ?? obj.idStr ?? obj.userIdStr ?? obj.id_str;
      if (id) return String(id);
    }
    for (const v of Object.values(obj)) { const r = findOwnId(v, depth + 1); if (r) return r; }
    return null;
  }

  function readMode(m) {
    const b = m?.battleSetting || m?.battleSettings || {};
    const v = b.battleMode ?? b.gameType ?? b.battleType ?? m?.battleMode ?? m?.gameType ?? m?.layoutSubtype;
    return v != null && v !== "" && v !== 0 ? String(v) : null;
  }

  function contributorsOf(armies) {
    return (armies?.userArmies ?? []).map((u) => ({
      userId: String(u.userIdStr || u.userId || ""),
      username: u.nickname || String(u.userIdStr || u.userId),
      displayName: u.nickname || null,
      avatar: u.avatarThumb?.urlList?.[0] || null,
      points: num(u.score),
    })).filter((c) => c.points > 0);
  }

  function startBattle(id) {
    if (battle?.id === id || endedIds.has(id)) return;
    battle = { id, our: 0, opp: 0, contributors: new Map() };
    opponent = null; mode = null;
    log(`battle started (id ${id})`);
    void post({ event: "start", battleId: id });
  }

  function scheduleUpdate() {
    if (sendTimer) return;
    sendTimer = setTimeout(() => {
      sendTimer = null;
      if (!battle) return;
      void post({
        event: "update", battleId: battle.id, ourScore: battle.our, opponentScore: battle.opp,
        opponent, mode, contributors: [...battle.contributors.values()],
      });
    }, interval);
  }

  function applyArmies(battleId, armiesRaw, teamArmies) {
    if (!battleId) return;
    startBattle(String(battleId));
    if (!battle || battle.id !== String(battleId)) return; // Never mix a previous battle into the current one.

    const entries = Object.entries(toArmyMap(armiesRaw));
    let ours = null, oppScore = 0, oppId = null;
    for (const [key, a] of entries) {
      const id = String(a?.anchorIdStr || key);
      if (hostId && (id === hostId || key === hostId)) ours = a;
      else if (num(a?.hostscore) >= oppScore) { oppScore = num(a?.hostscore); oppId = id; }
    }
    if (!opponent && oppId && lastBattleMsg) opponent = findUser(lastBattleMsg, oppId);
    // Team (2v2) battles: use the team that contains our host.
    if (!ours && Array.isArray(teamArmies) && hostId) {
      for (const t of teamArmies) {
        const has = String(t?.userArmies?.anchorIdStr || "") === hostId || JSON.stringify(t?.teamUser || []).includes(hostId);
        if (has) ours = { ...t.userArmies, hostscore: t.teamTotalScore };
        else oppScore = Math.max(oppScore, num(t?.teamTotalScore));
      }
    }
    if (!ours) {
      if (!hostId) log("unknown TikTok id — cannot tell which side is ours");
      return;
    }
    battle.our = Math.max(battle.our, num(ours.hostscore));
    battle.opp = Math.max(battle.opp, oppScore);
    for (const c of contributorsOf(ours)) {
      const identity = c.userId || c.username;
      const old = battle.contributors.get(identity);
      if (!old || c.points >= old.points) battle.contributors.set(identity, c);
    }
    scheduleUpdate();
  }

  function endBattle(id) {
    const finish = () => {
      endTimer = null;
      if (!battle || (id && battle.id !== String(id))) return;
      const b = battle; battle = null;
      if (endedIds.size > 100) endedIds.delete(endedIds.values().next().value);
      endedIds.add(String(id ?? b.id));

      if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
      const top = [...b.contributors.values()].sort((x, y) => y.points - x.points)[0];
      log(`battle ended: ${b.our} vs ${b.opp} · MVP: ${top ? "@" + top.username + " (" + top.points + ")" : "no data"}`);
      void post({
        event: "end", battleId: b.id, ourScore: b.our, opponentScore: b.opp,
        opponent, mode, contributors: [...b.contributors.values()],
      });
    };
    if (endDelay > 0) { if (endTimer) clearTimeout(endTimer); endTimer = setTimeout(finish, endDelay); }
    else finish();
  }

  function onBattleMessage(m) {
    if (!m || typeof m !== "object") return;
    if (!hostId) hostId = findOwnId(m);
    lastBattleMsg = m;
    if (battle || m.action === ACTION_OPEN) {
      mode = mode || readMode(m);
      if (!opponent) opponent = findUser(m, null);
    }
    if (m.action === ACTION_OPEN && m.battleId) startBattle(String(m.battleId));
    const map = toArmyMap(m.armies);
    if (m.teamArmies?.length || Object.keys(map).length) applyArmies(m.battleId, map, m.teamArmies);
    if (m.action === ACTION_FINISH || m.action === ACTION_CUT_SHORT) endBattle(m.battleId);
  }

  function onArmiesMessage(m) {
    if (!m || typeof m !== "object") return;
    applyArmies(m.battleId, m.armies, m.teamArmies);
  }

  function onDecoded(type, data) {
    try {
      const found = scanLeague(data);
      if (found.league == null && found.fragments == null) return;
      const sig = JSON.stringify(found);
      if (sig === lastLeague || found.fragments == null) return;
      lastLeague = sig;
      log(`league data from TikTok: ${found.league ?? "(same league)"} · ${found.fragments} fragments`);
      void postLeague({ ...found, source: "helper" });
    } catch { /* ignore */ }
  }

  function setHostId(value) {
    if (hostId) return hostId;
    if (typeof value === "string" && value.trim()) { hostId = value.trim(); return hostId; }
    if (value && typeof value === "object") { const found = findOwnId(value); if (found) { hostId = found; return found; } }
    return null;
  }

  function stop() {
    if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
    if (endTimer) { clearTimeout(endTimer); endTimer = null; }
    battle = null; opponent = null; mode = null; lastBattleMsg = null;
  }

  const status = () => ({
    hostId, battleId: battle?.id ?? null, our: battle?.our ?? 0, opp: battle?.opp ?? 0,
    opponent, mode, contributors: battle ? [...battle.contributors.values()] : [],
  });

  return { setHostId, onBattleMessage, onArmiesMessage, onDecoded, stop, status };
}
