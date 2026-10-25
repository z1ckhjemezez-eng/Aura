import { describe, expect, it } from 'vitest';
import { liveLike, giftStreakId, senderId } from './live-events.js';
describe('LIVE Tower event normalization', () => {
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