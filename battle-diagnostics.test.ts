import { describe, expect, it, vi } from 'vitest';
import { battleDiagnosticPayload, createBattleDiagnostics } from './battle-diagnostics.js';
const flush = async () => { await new Promise(r => setTimeout(r, 0)); };
describe('passive battle research capture', () => {
  it('retains task semantics but strips identities, credentials, text, URLs and protobuf bytes', () => {
    const result = battleDiagnosticPayload({taskMessageType:1,battleId:'private',common:{msgId:'private',createTime:'1793364067'},taskUpdate:{progress:12,status:0,user:{nickname:'private'},token:'private',prompt:{promptKey:'pm_mt_match_bonusMission',elems:[{promptField:'sum',value:'12'}]}},url:'private',rawBase64:'private'});
    expect(result).toEqual({taskMessageType:'1',common:{createTime:'1793364067'},taskUpdate:{progress:'12',status:'0',prompt:{promptKey:'pm_mt_match_bonusMission',elems:[{promptField:'sum',value:'12'}]}}});
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('is off by default and expires after at most 30 minutes', async () => {
    const send=vi.fn(); let clock=1_000;
    createBattleDiagnostics({send,now:()=>clock}).observe('WebcastLinkmicBattleTaskMessage',{taskMessageType:0});
    const capture=createBattleDiagnostics({send,now:()=>clock,until:new Date(clock+86400_000).toISOString()});
    clock+=30*60_000; capture.observe('WebcastLinkmicBattleTaskMessage',{taskMessageType:0}); await flush(); expect(send).not.toHaveBeenCalled();
  });
  it('deduplicates messages, ignores non-battle data and never emits activations', async () => {
    const send=vi.fn(); const capture=createBattleDiagnostics({send,now:()=>1_000,until:new Date(2000).toISOString()});
    const payload={common:{msgId:'1'},taskMessageType:0};
    capture.observe('WebcastLinkmicBattleTaskMessage',payload); capture.observe('WebcastLinkmicBattleTaskMessage',payload); capture.observe('WebcastGift',payload);
    await flush(); expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][0]).toEqual({sourceEvent:'WebcastLinkmicBattleTaskMessage',reason:'battle_task_v1',payload:{common:{},taskMessageType:'0'}});
  });
  it('bounds other samples at 40 and reserves up to 80 task samples', async () => {
    const send=vi.fn(); const capture=createBattleDiagnostics({send,now:()=>1_000,until:new Date(2000).toISOString()});
    for(let i=0;i<100;i++){capture.observe('WebcastLinkMicArmies',{common:{msgId:String(i+1)}});await flush();}
    for(let i=0;i<100;i++){capture.observe('WebcastLinkmicBattleTaskMessage',{common:{msgId:String(i+1)}});await flush();}
    expect(send).toHaveBeenCalledTimes(120);
  });
});