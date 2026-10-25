/** Normalize connector 2.x raw protobuf events; never invent counts or identities. */
const positiveId = (...values) => values.map(v => String(v ?? '')).find(v => /^[1-9]\d{0,39}$/.test(v)) || '';
export const senderId = d => positiveId(d.user?.userId, d.user?.idStr, d.user?.id, d.userId);
export const messageId = d => positiveId(d.msgId, d.common?.msgId);
export function liveLike(d) {
  // Raw v3 uses count (delta), total is the room total and must not be added.
  const count = Number(d.count ?? d.likeCount);
  if (!Number.isSafeInteger(count) || count <= 0 || count > 10000000) return null;
  const eventId = messageId(d);
  return { count, eventId, sender: senderId(d) };
}
export function giftStreakId(d, roomId) {
  const group = positiveId(d.groupId), sender = senderId(d);
  return group && sender && roomId ? `${roomId}:${sender}:${group}` : '';
}