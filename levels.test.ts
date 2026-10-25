import { describe,it,expect } from 'vitest';
import { normalizeLevelBarrage } from './levels.js';
import { nativeLevelSchema } from '../src/lib/auralevel/types';
const user={userId:'supporter-1',uniqueId:'viewer',nickname:'Viewer'};
describe('Native level normalization',()=>{
 it('accepts actual decoded empty userGradeParam.userId with a valid nested ID',()=>{const event=normalizeLevelBarrage({msgType:8,common:{msgId:'101'},userGradeParam:{userId:'',currentGrade:30,user:{id:'123456789',displayId:'viewer',nickname:'Viewer'}}},'123456');expect(event?.level_event.sender_user_id).toBe('123456789');expect(nativeLevelSchema.safeParse(event?.level_event).success).toBe(true);});
 it('never uses the protobuf zero viewer ID',()=>{expect(normalizeLevelBarrage({msgType:8,common:{msgId:'101'},userGradeParam:{userId:'',currentGrade:30,user:{id:'0',nickname:'Viewer'}}},'123456')).toBeNull();});
 it('uses top-level user only when identity matches, not another viewers name',()=>{const data={msgType:8,common:{msgId:'101'},userGradeParam:{userId:'123',currentGrade:30,user:{id:'0'}},user:{id:'123',displayId:'viewer'}};expect(normalizeLevelBarrage(data,'123456')?.level_event.username).toBe('viewer');expect(normalizeLevelBarrage({...data,user:{id:'999',displayId:'someone_else'}},'123456')).toBeNull();});
 it('logs rejection categories without personal names or IDs',()=>{const logs:string[]=[];normalizeLevelBarrage({msgType:8,common:{msgId:'private-message'},userGradeParam:{currentGrade:30,user:{id:'0',nickname:'private-name'}}},'123456',v=>logs.push(v));expect(logs).toEqual(['AuraLevel native gifter rejected: missing_or_invalid_viewer_identity']);});
 it('recognizes fan upgrade 10 using currentGrade',()=>{expect(normalizeLevelBarrage({msgType:10,common:{msgId:'100'},fansLevelParam:{currentGrade:20,user}},'123456')?.level_event).toMatchObject({kind:'fan',level:20,sender_user_id:'supporter-1',field:'fansLevelParam.currentGrade'});});
 it('recognizes user grade upgrade 8',()=>expect(normalizeLevelBarrage({msgType:8,common:{msgId:'101'},userGradeParam:{currentGrade:30,user}},'123456')?.level_event.kind).toBe('gifter'));
 it('never celebrates entrance types 9 and 11',()=>{for(const msgType of [9,11])expect(normalizeLevelBarrage({msgType,common:{msgId:'100'},fansLevelParam:{currentGrade:20,user},userGradeParam:{currentGrade:20,user}},'123456')).toBeNull();});
 it('requires provider message identity, viewer identity and positive grade',()=>{expect(normalizeLevelBarrage({msgType:10,fansLevelParam:{currentGrade:20,user}},'123456')).toBeNull();expect(normalizeLevelBarrage({msgType:10,common:{msgId:'100'},fansLevelParam:{currentGrade:0,user}},'123456')).toBeNull();expect(normalizeLevelBarrage({msgType:10,common:{msgId:'100'},fansLevelParam:{currentGrade:20,user:{nickname:'Viewer'}}},'123456')).toBeNull();});
});import { createLevelSnapshots } from './levels.js';
describe('Badge level snapshots',()=>{
 const viewer=(fan:number,grade=0,anchor='7001')=>({userId:'555',uniqueId:'fan1',nickname:'Fan',fansClub:{data:{level:fan,anchorId:anchor}},payGrade:{level:String(grade)}});
 it('sends a fan level only for this creators club, once per level',()=>{const s=createLevelSnapshots();s.setRoom('123456');const a=s.observe(viewer(5),'123456','7001');expect(a).toHaveLength(1);expect(nativeLevelSchema.safeParse(a[0].level_event).success).toBe(true);expect(a[0].level_event).toMatchObject({kind:'fan',level:5,source:'snapshot',anchor_id:'7001'});expect(s.observe(viewer(5),'123456','7001')).toHaveLength(0);expect(s.observe(viewer(6),'123456','7001')[0].level_event.level).toBe(6);});
 it('ignores another creators fan club and waits for the creator id',()=>{const s=createLevelSnapshots();expect(s.observe(viewer(5,0,'9999'),'123456','7001')).toHaveLength(0);expect(s.observe(viewer(5),'123456',null)).toHaveLength(0);});
 it('reads gifter level from payGrade',()=>{const s=createLevelSnapshots();const a=s.observe(viewer(0,27),'123456','7001');expect(a[0].level_event).toMatchObject({kind:'gifter',level:27,field:'user.payGrade.level'});expect(nativeLevelSchema.safeParse(a[0].level_event).success).toBe(true);});
 it('logs counts without names or ids',()=>{const logs:string[]=[];const s=createLevelSnapshots({log:v=>logs.push(v)});s.observe(viewer(5),'123456','7001');s.noteBarrage(10);s.flushStats();expect(logs[0]).toBe('AuraLevel last minute: barrage_type_10=1 fan_sent=1 messages_with_viewer=1 viewers_seen=1');});
});
describe('Room badge levels',()=>{
 it('reads fan scene 10 and gifter scene 8 from TikTok badges',()=>{const s=createLevelSnapshots();const u={userId:'777',uniqueId:'v',badgeList:[{badgeSceneType:10,privilegeLogExtra:{level:'7'}},{badgeSceneType:8,privilegeLogExtra:{level:'31'}}]};const a=s.observe(u,'123456',null);expect(a.map(b=>[b.level_event.kind,b.level_event.level])).toEqual([['fan',7],['gifter',31]]);for(const b of a)expect(nativeLevelSchema.safeParse(b.level_event).success).toBe(true);});
});
describe('Current TikTok badge format',()=>{
 it('reads sceneType badges and numeric payGrade',()=>{const s=createLevelSnapshots();const a=s.observe({userId:'888',uniqueId:'w',payGrade:{level:12},badgeList:[{sceneType:10,privilegeLogExtra:{level:'4'}}]},'123456',null);expect(a.map(b=>[b.level_event.kind,b.level_event.level])).toEqual([['fan',4],['gifter',12]]);});
 it('reads level from combine text when no privilege level',()=>{const s=createLevelSnapshots();expect(s.observe({userId:'889',uniqueId:'w',badgeList:[{sceneType:10,combine:{str:'9'}}]},'123456',null)[0].level_event.level).toBe(9);});
});
