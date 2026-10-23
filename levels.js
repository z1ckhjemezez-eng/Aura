// Verified against tiktok-live-connector 2.5.0 / tiktok-live-proto 0.2.4.
import { mkdir,readFile,writeFile,rename,unlink,readdir } from 'node:fs/promises';
import { join } from 'node:path';
export function normalizeLevelBarrage(message,roomId){
 const kind=Number(message?.msgType)===10?'fan':Number(message?.msgType)===8?'gifter':null;
 if(!kind)return null; // 9/11 are entrances, never upgrades.
 const param=kind==='fan'?message.fansLevelParam:message.userGradeParam;
 const user=param?.user??message.user;
 const id=String(param?.userId??user?.userId??user?.idStr??user?.id??'');
 const eventId=String(message?.common?.msgId??message?.msgId??'');
 const username=user?.uniqueId||user?.displayId||user?.nickname;
 const level=Number(param?.currentGrade);
 if(!id||!eventId||!username||!/^\d{5,30}$/.test(String(roomId))||!Number.isInteger(level)||level<1||level>10000)return null;
 const avatar=user?.profilePicture?.urls?.[0]??user?.avatarThumb?.urlList?.[0];
 return {type:'level_up',level_event:{kind,level,sender_user_id:id,username:String(username),display_name:String(user?.nickname??username),...(avatar?{avatar_url:avatar}:{}),event_id:eventId,room_id:String(roomId),source:'native_upgrade',field:kind==='fan'?'fansLevelParam.currentGrade':'userGradeParam.currentGrade'}};
}
// Persist before HTTP delivery. Receipt IDs make retries safe; stale rooms are never replayed into a new LIVE.
export function createLevelDelivery({directory,send,log=()=>{}}){
 let activeRoom=null,closed=false,running=false;
 const flush=async()=>{if(running||closed||!activeRoom)return;running=true;try{await mkdir(directory,{recursive:true});const files=(await readdir(directory)).filter(f=>f.endsWith('.json')).sort();for(const file of files){if(closed)break;const path=join(directory,file);let body;try{body=JSON.parse(await readFile(path,'utf8'));}catch{log('Level retry file unreadable');continue;}if(body.level_event?.room_id!==activeRoom)continue;try{const status=await send(body);if(status>=200&&status<300)await unlink(path);else if(status===400)log('Level delivery rejected; retained for inspection');else break;}catch{break;}}}finally{running=false;}};
 const timer=setInterval(()=>void flush().catch(()=>log('Level retry unavailable')),10000);timer.unref?.();
 return {setRoom(room){activeRoom=String(room);void flush().catch(()=>log('Level retry unavailable'));},async enqueue(body){try{await mkdir(directory,{recursive:true});const event=body.level_event;const filename=Buffer.from(`${event.room_id}:${event.event_id}`).toString('hex').slice(0,450)+'.json';const path=join(directory,filename);await writeFile(path+'.tmp',JSON.stringify(body));await rename(path+'.tmp',path);void flush().catch(()=>log('Level retry unavailable'));}catch{log('Level event could not be persisted');}},close(){closed=true;clearInterval(timer);}};
}