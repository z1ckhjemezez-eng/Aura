/** Normalize connector 2.x raw protobuf events; never invent counts or identities. */
const positiveId = (...values) => values.map(v => String(v ?? '')).find(v => /^[1-9]\d{0,39}$/.test(v)) || '';
export const senderId = d => positiveId(d.user?.userId, d.user?.idStr, d.user?.id, d.userId);
export const messageId = d => positiveId(d.msgId, d.common?.msgId);
export function likeMetadata(d) {
  const name=String(d.user?.nickname||d.nickname||d.user?.uniqueId||'').slice(0,100);
  const avatar=d.user?.profilePicture?.urls?.[0]||d.user?.avatarThumb?.urlList?.[0];
  let valid=false;
  if(typeof avatar==='string'&&avatar.length<=1000){try{valid=new URL(avatar).protocol==='https:';}catch{}}
  return {display_name:name,...(valid?{avatar_url:avatar}:{})};
}
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