import { describe, expect, it } from "vitest";
import { createBattleTracker, scanLeague, toArmyMap } from "./battle.js";

const open = (battleId = "555") => ({
  action: 4,
  battleId,
  battleSetting: { battleMode: 2 },
  users: [
    { userId: "111", uniqueId: "host" },
    { userId: "222", uniqueId: "opponent_account", nickname: "Opponent", avatarThumb: { urlList: ["https://cdn/opp.png"] } },
  ],
});

const armies = (battleId, ourScore, oppScore) => ({
  battleId,
  armies: {
    111: { anchorIdStr: "111", hostscore: ourScore, userArmies: [{ userIdStr: "u1", nickname: "alice", score: 900 }] },
    222: { anchorIdStr: "222", hostscore: oppScore, userArmies: [{ userIdStr: "u2", nickname: "bob", score: 100 }] },
  },
});

const finish = (battleId = "555") => ({ action: 5, battleId, armies: armies(battleId, 300, 900).armies });

function harness(options = {}) {
  const posts = [];
  const leagues = [];
  const tracker = createBattleTracker({
    username: "host",
    interval: 0,
    endDelay: 0,
    post: async (b) => { posts.push(b); },
    postLeague: async (b) => { leagues.push(b); },
    ...options,
  });
  const of = (event) => posts.filter((p) => p.event === event);
  return { tracker, posts, leagues, of };
}

describe("cloud battle tracker", () => {
  it('keeps showing the opponent score when Sky hides their total', () => {
    const { tracker } = harness();
    tracker.onBattleMessage(open());
    tracker.onArmiesMessage(armies('555', 300, 900));
    tracker.onArmiesMessage({ battleId: '555', armies: { 222: { anchorIdStr: '222', userArmies: [{ userIdStr: 'u2', score: 1200 }] } } });
    expect(tracker.status().opp).toBe(1200);
    expect(tracker.status().our).toBe(300);
    tracker.stop();
  });
  it('never drops the opponent score to 0 while Sky hides it completely', () => {
    const { tracker } = harness();
    tracker.onBattleMessage(open());
    tracker.onArmiesMessage(armies('555', 300, 900));
    tracker.onArmiesMessage({ battleId: '555', armies: { 111: { anchorIdStr: '111', hostscore: 500 } } });
    expect(tracker.status().opp).toBe(900);
    expect(tracker.status().our).toBe(500);
    tracker.stop();
  });
  it('never mixes an ended battle into the next battle', () => {
    const { tracker } = harness();
    tracker.onBattleMessage(open('old'));
    tracker.onArmiesMessage(armies('old', 100, 200));
    tracker.onBattleMessage(finish('old'));
    tracker.onBattleMessage(open('new'));
    tracker.onArmiesMessage(armies('new', 10, 20));
    tracker.onArmiesMessage(armies('old', 999999, 999999));
    expect(tracker.status().our).toBe(10);
    expect(tracker.status().battleId).toBe('new');
    tracker.stop();
  });
  it('includes the final army snapshot before posting end', () => {
    const { tracker, of } = harness();
    tracker.onBattleMessage(open());
    tracker.onArmiesMessage(armies('555', 10, 20));
    tracker.onBattleMessage(finish());
    expect(of('end')[0].ourScore).toBe(300);
    expect(of('end')[0].opponentScore).toBe(900);
  });
  it("opens a battle once and reports the opponent from real battle data", () => {
    const { tracker, of } = harness();
    tracker.onBattleMessage(open());
    tracker.onBattleMessage(open());
    expect(of("start")).toHaveLength(1);
    expect(of("start")[0]).toMatchObject({ battleId: "555" });
    expect(tracker.status().hostId).toBe("111");
    expect(tracker.status().opponent).toMatchObject({ username: "opponent_account", avatar: "https://cdn/opp.png" });
    expect(tracker.status().mode).toBe("2");
  });

  it("keeps our side by host id and the opponent as the highest other army", async () => {
    const { tracker, of } = harness();
    tracker.onBattleMessage(open());
    tracker.onArmiesMessage(armies("555", 300, 900));
    await new Promise((r) => setTimeout(r, 5));
    expect(of("update")).toHaveLength(1);
    expect(of("update")[0]).toMatchObject({ battleId: "555", ourScore: 300, opponentScore: 900 });
    expect(of("update")[0].contributors).toEqual([expect.objectContaining({ username: "alice", points: 900 })]);
  });

  it("never lowers scores when TikTok reports a smaller number", async () => {
    const { tracker, of } = harness();
    tracker.onBattleMessage(open());
    tracker.onArmiesMessage(armies("555", 800, 900));
    await new Promise((r) => setTimeout(r, 5));
    tracker.onArmiesMessage(armies("555", 200, 400));
    await new Promise((r) => setTimeout(r, 5));
    const last = of("update").at(-1);
    expect(last).toMatchObject({ ourScore: 800, opponentScore: 900 });
  });

  it("ends the battle with final scores, the top contributor and no duplicate end", async () => {
    const { tracker, of } = harness();
    tracker.onBattleMessage(open());
    tracker.onArmiesMessage(armies("555", 300, 900));
    tracker.onBattleMessage(finish());
    tracker.onBattleMessage(finish());
    await new Promise((r) => setTimeout(r, 5));
    expect(of("end")).toHaveLength(1);
    expect(of("end")[0]).toMatchObject({ battleId: "555", ourScore: 300, opponentScore: 900 });
    expect(of("end")[0].contributors[0]).toMatchObject({ username: "alice", points: 900 });
    expect(tracker.status().battleId).toBeNull();
  });

  it("sends no scores while our TikTok id is unknown", async () => {
    const { tracker, of } = harness({ username: "someone-else" });
    tracker.onBattleMessage(open());
    tracker.onArmiesMessage(armies("555", 300, 900));
    await new Promise((r) => setTimeout(r, 5));
    expect(tracker.status().hostId).toBeNull();
    expect(of("update")).toHaveLength(0);
    expect(of("end")).toHaveLength(0);
  });

  it("reads armies sent as [{key,value}] pairs, not only as a map", async () => {
    const { tracker, of } = harness();
    tracker.onBattleMessage(open());
    tracker.onArmiesMessage({
      battleId: "555",
      armies: [
        { key: "111", value: { anchorIdStr: "111", hostscore: 450, userArmies: [{ userIdStr: "u1", nickname: "alice", score: 450 }] } },
        { key: "222", value: { anchorIdStr: "222", hostscore: 600, userArmies: [{ userIdStr: "u2", nickname: "bob", score: 600 }] } },
      ],
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(of("update").at(-1)).toMatchObject({ ourScore: 450, opponentScore: 600 });
  });

  it("uses the team containing our host in 2v2 battles", async () => {
    const { tracker, of } = harness();
    tracker.onBattleMessage(open());
    tracker.onArmiesMessage({
      battleId: "555",
      armies: {},
      teamArmies: [
        { userArmies: { anchorIdStr: "111", hostscore: 500, userArmies: [{ userIdStr: "u1", nickname: "alice", score: 500 }] }, teamTotalScore: 780, teamUser: ["111", "333"] },
        { userArmies: { anchorIdStr: "222", hostscore: 700, userArmies: [{ userIdStr: "u2", nickname: "bob", score: 700 }] }, teamTotalScore: 990, teamUser: ["222", "444"] },
      ],
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(of("update").at(-1)).toMatchObject({ ourScore: 780, opponentScore: 990 });
  });

  it("posts league fragments once and never repeats the same payload", () => {
    const { tracker, leagues } = harness();
    const payload = { data: { leagueInfo: { leagueName: "A2", fragmentCount: 42 } } };
    tracker.onDecoded("roomUser", payload);
    tracker.onDecoded("roomUser", payload);
    tracker.onDecoded("roomUser", { data: { somethingElse: 1 } });
    expect(leagues).toHaveLength(1);
    expect(leagues[0]).toMatchObject({ league: "A2", fragments: 42, source: "helper" });
  });

  it("stops without leaving a pending end post", async () => {
    const { tracker, of } = harness({ interval: 50, endDelay: 50 });
    tracker.onBattleMessage(open());
    tracker.onArmiesMessage(armies("555", 300, 900));
    tracker.onBattleMessage(finish());
    tracker.stop();
    await new Promise((r) => setTimeout(r, 120));
    expect(of("end")).toHaveLength(0);
    expect(of("update")).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("normalizes army shapes", () => {
    expect(Object.keys(toArmyMap([{ key: "7", value: { anchorIdStr: "7" } }]))).toEqual(["7"]);
    expect(Object.keys(toArmyMap({ 8: { anchorIdStr: "8" } }))).toEqual(["8"]);
    expect(toArmyMap(null)).toEqual({});
    expect(toArmyMap([{ key: "9" }])).toEqual({});
  });

  it("only scans league fields that actually exist", () => {
    expect(scanLeague({ league: "D1", fragments: 3 })).toEqual({ league: "D1", fragments: 3 });
    expect(scanLeague({ nothing: "here" })).toEqual({});
    expect(scanLeague({ leagueName: "B3", fragmentCount: 12, promotionScore: 20 })).toEqual({ league: "B3", fragments: 12, promotion: 20 });
  });
});
