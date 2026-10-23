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
}// TikTok often omits the fan-upgrade barrage. Every chat/gift/like/join still carries the viewer's
// authoritative badge levels; a level above the stored baseline is a real upgrade. Fan-club levels
// count only when the club's anchorId is this creator, never another creator's club.
export function createLevelSnapshots({log=()=>{}}={}){
 const seen=new Map(),stats={};let room=null;
 const bump=k=>{stats[k]=(stats[k]??0)+1;};
 const identity=u=>[u?.userId,u?.idStr,u?.id].map(v=>String(v??'').trim()).find(v=>/^\d{1,30}$/.test(v)&&v!=='0');
 const make=(kind,u,id,level,roomId,extra)=>{
  const key=`${kind}:${id}`;if(seen.get(key)===level){bump(`${kind}_unchanged`);return null;}
  seen.set(key,level);if(seen.size>20000)seen.delete(seen.keys().next().value);
  const username=u.uniqueId||u.displayId||u.nickname;if(!username||String(username).length>100){bump(`${kind}_no_name`);return null;}
  const avatar=u?.profilePicture?.urls?.[0]??u?.avatarThumb?.urlList?.[0];
  bump(`${kind}_sent`);
  return {type:'level_up',level_event:{kind,level,sender_user_id:id,username:String(username).slice(0,100),display_name:String(u.nickname||username).slice(0,100),...(avatar?{avatar_url:avatar}:{}),event_id:`snapshot:${kind}:${id}:${level}`,room_id:String(roomId),source:'snapshot',field:kind==='fan'?'user.fansClub.data.level':'user.payGrade.level',...extra}};
 };
 return {
  setRoom(r){if(String(r)!==room){room=String(r);seen.clear();}},
  observe(u,roomId,hostId){
   const out=[];if(!u||typeof u!=='object'||!/^\d{5,30}$/.test(String(roomId??'')))return out;
   bump('messages_with_viewer');const id=identity(u);if(!id){bump('viewer_without_id');return out;}
   bump('viewers_seen');for(const b of Array.isArray(u.badgeList)?u.badgeList:[])bump(`badge_scene_${Number(b?.badgeSceneType)||0}`);
   // TikTok's room badges: scene 8 = user grade, scene 10 = this room's fan club (shown only in its creator's LIVE).
   const badge=scene=>{for(const b of Array.isArray(u.badgeList)?u.badgeList:[]){if(Number(b?.badgeSceneType)!==scene)continue;const l=Number(b?.privilegeLogExtra?.level??b?.combine?.str??0);if(Number.isInteger(l)&&l>0)return l;}return 0;};
   const club=u.fansClub?.data;let fan=Number(club?.level);const anchor=String(club?.anchorId??'').trim();
   if(Number.isInteger(fan)&&fan>0&&fan<=10000&&anchor&&hostId&&anchor===String(hostId)){const b=make('fan',u,id,fan,roomId,{anchor_id:anchor});if(b)out.push(b);}
   else if((fan=badge(10))>0&&fan<=10000){bump('fan_from_room_badge');const b=make('fan',u,id,fan,roomId,{anchor_id:String(hostId||`room:${roomId}`)});if(b)out.push(b);}
   else if(Number.isInteger(Number(club?.level))&&Number(club?.level)>0)bump(hostId?'fan_other_creator_club':'fan_waiting_for_creator_id');
   let grade=Number(u.payGrade?.level);if(!(grade>0))grade=badge(8);
   if(Number.isInteger(grade)&&grade>0&&grade<=10000){const b=make('gifter',u,id,grade,roomId,{});if(b)out.push(b);}
   return out;
  },
  noteBarrage(type){bump(`barrage_type_${Number(type)||0}`);},
  flushStats(){const keys=Object.keys(stats);if(!keys.length)return;log(`AuraLevel last minute: ${keys.sort().map(k=>`${k}=${stats[k]}`).join(' ')}`);for(const k of keys)delete stats[k];},
 };
}
