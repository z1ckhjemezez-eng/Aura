// Provider battle points already include applied bonuses. Never use diamondScore.
export function officialArmyScore(army) {
  for (const value of [army?.hostscore, army?.hostScore]) {
    if (value === undefined || value === null || value === '') continue;
    const n = Number(value);
    if (Number.isSafeInteger(n) && n >= 0) return n;
  }
  return undefined;
}

export function armySupporters(army) {
  const list = army?.userArmies ?? army?.userArmy;
  return Array.isArray(list) ? list : [];
}

export function teamHasHost(team, hostId) {
  if (String(team?.userArmies?.anchorIdStr ?? '') === hostId) return true;
  const users = team?.teamUser ?? team?.teamUsers;
  return Array.isArray(users) && users.some(user =>
    String(typeof user === 'object' && user ? user.userIdStr || user.userId || '' : user) === hostId);
}