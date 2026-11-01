import { describe, expect, it } from 'vitest';
import { liveLike, giftStreakId, senderId, likeMetadata, giftRecipientFields } from './live-events.js';
describe('gift recipient forwarding', () => {
  it('forwards the guest recipient independently of ano sending the gift', () => {
    expect(giftRecipientFields({user:{id:'333'},toUser:{id:'222',uniqueId:'Milo'}},'111')).toEqual({recipient_user_id:'222',host_user_id:'111',recipient_username:'Milo'});
  });
  it('supports legacy receiver identities without inventing missing recipients', () => {
    expect(giftRecipientFields({receiverUserId:'222'},'111')).toEqual({recipient_user_id:'222',host_user_id:'111'});
    expect(giftRecipientFields({user:{id:'333'}},null)).toEqual({});
  });
});
describe('LIVE Tower event normalization', () => {
  it.each(['avatarThumb','avatarMedium','avatarLarge','profilePicture'])('reads observed %s protobuf urlList images',field=>{
    expect(likeMetadata({user:{nickname:'Nova',[field]:{urlList:['https://example.com/nova.jpg']}}})).toEqual({display_name:'Nova',avatar_url:'https://example.com/nova.jpg'});
  });
  it('reads legacy flattened profile pictures',()=>{
    expect(likeMetadata({nickname:'Nova',profilePictureUrl:'https://example.com/nova.jpg'})).toEqual({display_name:'Nova',avatar_url:'https://example.com/nova.jpg'});
  });
  it('tries remaining observed image URLs when the first candidate is invalid',()=>{
    expect(likeMetadata({user:{avatarThumb:{urlList:['javascript:alert(1)','https://example.com/nova.jpg']}}}).avatar_url).toBe('https://example.com/nova.jpg');
  });
  it('never invents an avatar for viewers without images',()=>{expect(likeMetadata({user:{nickname:'Nova'}})).toEqual({display_name:'Nova'});});
  it('prefers the largest observed avatar for sharp 4K overlay rendering',()=>{
    expect(likeMetadata({user:{nickname:'Nova',avatarThumb:{urlList:['https://example.com/thumb.jpg']},avatarLarge:{urlList:['https://example.com/large.jpg']}}}).avatar_url).toBe('https://example.com/large.jpg');
  });
  it('preserves real display/avatar metadata without sending invalid URLs',()=>{
    expect(likeMetadata({user:{nickname:'Nova',avatarThumb:{urlList:['https://example.com/avatar.jpg']}}})).toEqual({display_name:'Nova',avatar_url:'https://example.com/avatar.jpg'});
    expect(likeMetadata({user:{nickname:'Nova',avatarThumb:{urlList:['javascript:alert(1)']}}})).toEqual({display_name:'Nova'});
  });
  it('uses raw count as delta, not the cumulative room total', () => {
    expect(liveLike({count:42,total:'100000',common:{msgId:'123'},user:{idStr:'',id:'987'}})).toEqual({count:42,eventId:'123',sender:'987'});
  });
  it('supports legacy likeCount without inventing missing likes', () => {
    expect(liveLike({likeCount:7,msgId:'456'})?.count).toBe(7);
    for (const count of [undefined,0,-1,NaN,Infinity,1.5]) expect(liveLike({count})).toBeNull();
  });
  it('keeps completed streak identity across different message deliveries', () => {
    expect(giftStreakId({groupId:'55',msgId:'101',user:{id:'987'}},'77001')).toBe('77001:987:55');
    expect(giftStreakId({groupId:'55',msgId:'102',user:{id:'987'}},'77001')).toBe('77001:987:55');
    expect(giftStreakId({groupId:'55',user:{id:'987'}},'77002')).not.toBe('77001:987:55');
  });
  it('skips empty and zero placeholder identities', () => {
    expect(senderId({user:{userId:'0',idStr:'',id:'987'}})).toBe('987');
    expect(giftStreakId({groupId:'0',user:{id:'987'}},'77001')).toBe('');
  });
});