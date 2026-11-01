import {describe,it,expect} from 'vitest';
import {createOfflineTimeout,OFFLINE_TIMEOUT_MS} from './offline-timeout.js';
describe('offline disconnect deadline',()=>{
 it('waits exactly 10 minutes of confirmed offline',()=>{let now=0;const clock=createOfflineTimeout(()=>now);clock.observe(false);now=599999;expect(clock.due()).toBe(false);now=600000;expect(clock.due()).toBe(true);expect(OFFLINE_TIMEOUT_MS).toBe(600000);});
 it('repeated offline checks never extend the deadline',()=>{let now=0;const clock=createOfflineTimeout(()=>now);clock.observe(false);now=60000;clock.observe(false);now=600000;expect(clock.since()).toBe(0);expect(clock.due()).toBe(true);});
 it('returning LIVE cancels the deadline',()=>{let now=0;const clock=createOfflineTimeout(()=>now);clock.observe(false);now=599999;clock.observe(true);now=600000;expect(clock.due()).toBe(false);});
 it('uncertain network errors never qualify as continuous offline',()=>{let now=0;const clock=createOfflineTimeout(()=>now);clock.observe(false);now=599999;clock.observe(null);now=600000;expect(clock.due()).toBe(false);clock.observe(false);now=1200000;expect(clock.due()).toBe(true);});
});