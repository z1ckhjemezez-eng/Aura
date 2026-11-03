import {giftStreakId,senderId,giftRecipientFields,profileAvatar} from './live-events.js';
/** Separate active reports; completed gifts keep their original route and accounting. */
export function activeStreakEvent(d,roomId,hostId){
 const gift=d.giftDetails||d.gift||{};
 if(Number(d.giftType??gift.type??gift.giftType)!==1||d.repeatEnd===true||Number(d.repeatEnd)===1)return null;
 const streak=giftStreakId(d,roomId),sender=senderId(d),id=String(d.giftId??gift.id??'');
 const quantity=Number(d.repeatCount??d.comboCount??1);
 if(!streak||!sender||!id||!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000000)return null;
 return {type:'gift',username:String(d.user?.uniqueId||d.user?.displayId||'viewer'),sender_user_id:sender,...giftRecipientFields(d,hostId),gift_id:id,gift:String(d.giftName||gift.name||gift.giftName||'Gift'),quantity,diamonds:Math.max(0,Math.floor(Number(d.diamondCount??gift.diamondCount??0))),display_name:String(d.user?.nickname||''),...(profileAvatar(d.user)?{avatar_url:profileAvatar(d.user)}:{}),...(d.giftPictureUrl?.startsWith('https://')?{gift_icon:d.giftPictureUrl}:{}),streak_id:streak,gift_type:1,repeat_end:false};
}