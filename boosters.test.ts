import { describe,it,expect,vi } from 'vitest';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoosterCollector,isBoosterEvent } from './boosters.js';
describe('existing-connection booster collector',()=>{
  it('only collects battle card/buff messages, never gifts',()=>{
    expect(isBoosterEvent('WebcastLinkMicBattleItemCard',{})).toBe(true);
    expect(isBoosterEvent('WebcastGift',{giftId:'123'})).toBe(false);
    expect(isBoosterEvent('WebcastLinkMicArmies',{powerUp:{id:1}})).toBe(true);
    expect(isBoosterEvent('WebcastLinkMicBattle',{battleId:'123'})).toBe(false);
  });
  it('persists failed sends, tracks gaps and redacts credentials before disk write',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'booster-test-'));const post=vi.fn().mockRejectedValue(new Error('offline'));
    const collector=createBoosterCollector({post,spoolDir:dir});
    collector.setCreator('123');collector.connected();collector.disconnected();collector.observe('WebcastLinkMicBattleItemCard',{msgType:4,token:'secret',common:{msgId:'1'}});
    await new Promise(r=>setTimeout(r,20));collector.close();
    const spool=JSON.parse(readFileSync(join(dir,'pending.json'),'utf8'));
    expect(spool.some(([,b])=>b.status==='ended'&&b.gapCount===1)).toBe(true);
    expect(spool.some(([,b])=>b.payload?.common.msgId==='1')).toBe(true);
    expect(readFileSync(join(dir,'pending.json'),'utf8')).not.toContain('secret');
    rmSync(dir,{recursive:true,force:true});
  });
});