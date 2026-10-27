// Only observed room identity and an open socket can confirm the requested creator.
export function roomOwner(room) {
  return room?.data?.owner ?? room?.owner ?? room?.data?.user ?? room?.user ?? null;
}
// TikTok sometimes answers connect() with a truncated room payload (no owner at all).
export function ownerObserved(room) {
  return roomOwner(room) != null;
}
export function roomUsername(room) {
  const owner = roomOwner(room);
  const name = owner?.unique_id ?? owner?.uniqueId ?? owner?.display_id ?? owner?.displayId;
  return typeof name === 'string' ? name.trim().replace(/^@/, '').toLowerCase() : '';
}
export function verifiedLive(username, connection, state) {
  return connection?.isConnected === true && state?.isConnected === true &&
    Boolean(state?.roomId) && roomUsername(state?.roomInfo ?? connection?.roomInfo) === username.toLowerCase();
}
export function connectionFailure(error, username, room, isOffline) {
  if (isOffline && roomUsername(room) === username.toLowerCase()) {
    return { status: 'waiting', message: 'Account found. Not LIVE — not connected.', retryMs: 60_000 };
  }
  // TikTok often omits room data for offline creators; a typed offline error is not a failure.
  if (isOffline) return { status: 'waiting', message: 'Not LIVE right now. Connects automatically when you go LIVE.', retryMs: 60_000 };
  return { status: 'error', message: 'Could not verify this TikTok username or connect. Check the exact @username and try again when LIVE.', retryMs: 120_000 };
}