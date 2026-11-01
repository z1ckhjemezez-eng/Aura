import {it,expect} from 'vitest';
import {createBattleTracker} from './battle.js';
it('confirms video victory only from normal finish with explicit scores on both sides',()=>{
 const posts:any[]=[];const t=createBattleTracker({username:'host',interval:0,endDelay:0,post:async b=>{posts.push(b);}});t.setHostId('111');
 const open=(id:string)=>t.onBattleMessage({action:4,battleId:id});
 const armies={111:{anchorIdStr:'111',hostscore:900},222:{anchorIdStr:'222',hostscore:10}};
 open('normal');t.onBattleMessage({action:5,battleId:'normal',armies});expect(posts.find(p=>p.event==='end'&&p.battleId==='normal').resultConfirmed).toBe(true);
 open('cut');t.onBattleMessage({action:6,battleId:'cut',armies});expect(posts.find(p=>p.event==='end'&&p.battleId==='cut').resultConfirmed).toBe(false);
 open('hidden');t.onBattleMessage({action:5,battleId:'hidden',armies:{111:armies[111],222:{userArmies:[{score:10}]}}});expect(posts.find(p=>p.event==='end'&&p.battleId==='hidden').resultConfirmed).toBe(false);t.stop();
});
