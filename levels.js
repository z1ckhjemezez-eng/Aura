// Verified against tiktok-live-connector 2.5.0 / tiktok-live-proto 0.2.4.
import { mkdir,readFile,writeFile,rename,unlink,readdir } from 'node:fs/promises';
import { join } from 'node:path';
export function normalizeLevelBarrage(message,roomId,log=()=>{}){
 const kind=Number(message?.msgType)===10?'fan':Number(message?.msgType)===8?'gifter':null;
 if(!kind)return null; // 9/11 are entrances, never upgrades.
 const reject=reason=>{log(`AuraLevel native ${kind} rejected: ${reason}`);return null;};
 const param=kind==='fan'?message.fansLevelParam:message.userGradeParam;
 const users=[param?.user,message?.user].filter(Boolean);
 const identity=values=>values.map(v=>String(v??'').trim()).find(v=>v!==''&&v!=='0');
 // Empty/zero protobuf defaults must not mask a valid identity fallback.
 const id=identity([param?.userId,...users.flatMap(u=>[u.userId,u.idStr,u.id])]);
 const eventId=identity([message?.common?.msgId,message?.msgId]);
 const user=users.find(u=>identity([u.userId,u.idStr,u.id])===id);
 const username=user?.uniqueId||user?.displayId||user?.nickname;
 const level=Number(param?.currentGrade);
 if(!id||id.length>80)return reject('missing_or_invalid_viewer_identity');
 if(!eventId||eventId.length>200)return reject('missing_or_invalid_message_identity');
 if(!username||String(username).length>100)return reject('missing_or_invalid_viewer_name');
 if(!/^\d{5,30}$/.test(String(roomId)))return reject('missing_live_room');
 if(!Number.isInteger(level)||level<1||level>10000)return reject('invalid_authoritative_grade');
 const avatar=user?.profilePicture?.urls?.[0]??user?.avatarThumb?.urlList?.[0];
 log(`AuraLevel native ${kind} accepted`);
 return {type:'level_up',level_event:{kind,level,sender_user_id:id,username:String(username),display_name:String(user?.nickname??username),...(avatar?{avatar_url:avatar}:{}),event_id:eventId,room_id:String(roomId),source:'native_upgrade',field:kind==='fan'?'fansLevelParam.currentGrade':'userGradeParam.currentGrade'}};
}
// Persist before HTTP delivery. Receipt IDs make retries safe; stale rooms are never replayed into a new LIVE.
export function createLevelDelivery({directory,send,log=()=>{}}){
 let activeRoom=null,closed=false,running=false;
 const flush=async()=>{if(running||closed||!activeRoom)return;running=true;try{await mkdir(directory,{recursive:true});const files=(await readdir(directory)).filter(f=>f.endsWith('.json')).sort();for(const file of files){if(closed)break;const path=join(directory,file);let body;try{body=JSON.parse(await readFile(path,'utf8'));}catch{log('Level retry file unreadable');continue;}if(body.level_event?.room_id!==activeRoom)continue;try{const status=await send(body);log(`AuraLevel delivery HTTP ${status}`);if(status>=200&&status<300)await unlink(path);else if(status===400)log('Level delivery rejected; retained for inspection');else break;}catch{log('AuraLevel delivery network failure; retained');break;}}}finally{running=false;}};
 const timer=setInterval(()=>void flush().catch(()=>log('Level retry unavailable')),10000);timer.unref?.();
 return {setRoom(room){activeRoom=String(room);void flush().catch(()=>log('Level retry unavailable'));},async enqueue(body){try{await mkdir(directory,{recursive:true});const event=body.level_event;const filename=Buffer.from(`${event.room_id}:${event.event_id}`).toString('hex').slice(0,450)+'.json';const path=join(directory,filename);await writeFile(path+'.tmp',JSON.stringify(body));await rename(path+'.tmp',path);void flush().catch(()=>log('Level retry unavailable'));}catch{log('Level event could not be persisted');}},close(){closed=true;clearInterval(timer);}};
}