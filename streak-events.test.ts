import {it,expect} from 'vitest';
import {activeStreakEvent} from './streak-events.js';
const raw={giftType:1,repeatEnd:false,repeatCount:125,groupId:'777',giftId:5655,diamondCount:1,user:{userId:'12345',uniqueId:'viewer'},toUser:{userId:'99999'}};
it('forwards cumulative active x125 with real sender, recipient and group',()=>expect(activeStreakEvent(raw,'room','99999')).toMatchObject({quantity:125,streak_id:'room:12345:777',recipient_user_id:'99999',repeat_end:false}));
it('does not duplicate final gift delivery',()=>expect(activeStreakEvent({...raw,repeatEnd:true},'room','99999')).toBeNull());
it('missing group identity never fabricates a streak',()=>expect(activeStreakEvent({...raw,groupId:null},'room','99999')).toBeNull());