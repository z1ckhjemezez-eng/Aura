/** Normalize connector 2.x raw protobuf events; never invent counts or identities. */
const positiveId = (...values) => values.map(v => typeof v === 'number' && !Number.isSafeInteger(v) ? '' : String(v ?? '')).find(v => /^[1-9]\d{0,39}$/.test(v)) || '';
/** v3 toUser and legacy receiverUserId are recipients, never the sending user. */
export function giftRecipientFields(d, hostId) {
  const recipient=positiveId(d.toUser?.userId,d.toUser?.idStr,d.toUser?.id,d.receiverUserId,d.giftExtra?.toUserId);
  const host=positiveId(hostId);
  const username=typeof d.toUser?.uniqueId==='string'?d.toUser.uniqueId.trim().slice(0,64):'';
  return {...(recipient?{recipient_user_id:recipient}:{}),...(host?{host_user_id:host}:{}),...(username?{recipient_username:username}:{})};
}
export const senderId = d => positiveId(d.user?.userId, d.user?.idStr, d.user?.id, d.userId);
export const messageId = d => positiveId(d.msgId, d.common?.msgId);
/** Connector raw and legacy images; only forward observed secure URLs. */
export function profileAvatar(user) {
  const images=[user?.avatarLarge,user?.avatarMedium,user?.profilePicture,user?.avatarThumb];
  const candidates=[user?.profilePictureUrl,...images.flatMap(image=>[...(Array.isArray(image?.urlList)?image.urlList:[]),...(Array.isArray(image?.urls)?image.urls:[])])];
  for(const url of candidates){
    if(typeof url!=='string'||url.length>1000)continue;
    try{if(new URL(url).protocol==='https:')return url;}catch{/* Ignore malformed image candidates. */}
  }
  return '';
}
export function likeMetadata(d) {
  const name=String(d.user?.nickname||d.nickname||d.user?.uniqueId||'').slice(0,100);
  const avatar=profileAvatar(d.user)||profileAvatar(d);
  return {display_name:name,...(avatar?{avatar_url:avatar}:{})};
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