const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 8080);
const MAX_PLAYERS = 8;
const WORLD = { w: 2200, h: 1600 };
const TICK_MS = 50;
const clients = new Map();
const players = new Map();
const nodes = [];
const monsters = [];
let nextId = 1;
let lastTick = Date.now();

function rand(min, max) { return min + Math.random() * (max - min); }
function dist(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); }
function clamp(v,min,max) { return Math.max(min,Math.min(max,v)); }
function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function broadcast(data) {
  const raw = JSON.stringify(data);
  for (const ws of clients.keys()) if (ws.readyState === WebSocket.OPEN) ws.send(raw);
}
function makeNode(type, x, y, amount) {
  return { id: "n"+nextId++, type, x, y, amount, maxAmount: amount, respawnAt: 0 };
}
for (let i=0;i<75;i++) {
  let x=rand(80,WORLD.w-80), y=rand(80,WORLD.h-80);
  if (Math.hypot(x-WORLD.w/2,y-WORLD.h/2)<260) { i--; continue; }
  const type=Math.random()<.62?"wood":"stone";
  nodes.push(makeNode(type,x,y,type==="wood"?3:2));
}
for (let i=0;i<7;i++) monsters.push({id:"m"+i,x:rand(150,WORLD.w-150),y:rand(150,WORLD.h-150),hp:60,maxHp:60,attackAt:0,aggro:null});
const lootChoices = [
  {id:"ember_blade",name:"Ember Blade",kind:"weapon",description:"Close-range hit deals 28 damage",icon:"⚔️"},
  {id:"storm_burst",name:"Storm Burst",kind:"ability",description:"Ranged energy burst deals 22 damage",icon:"⚡"},
  {id:"bark_skin",name:"Bark Skin",kind:"ability",description:"Absorb the next 35 damage",icon:"🌿"},
  {id:"swift_step",name:"Swift Step",kind:"ability",description:"Brief speed boost",icon:"💨"},
  {id:"healing_surge",name:"Healing Surge",kind:"ability",description:"Restore 35 health",icon:"💚"},
  {id:"stone_hammer",name:"Stone Hammer",kind:"weapon",description:"Heavy close hit deals 38 damage",icon:"🔨"}
];
function safePlayer(p) {
  return {id:p.id,name:p.name,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,wood:p.wood,stone:p.stone,level:p.level,
    xp:p.xp,weapon:p.weapon,ability:p.ability,shield:p.shield,alive:p.alive,color:p.color,score:p.score};
}
function stateFor(p) {
  return {type:"state",you:p.id,world:WORLD,pool:{x:WORLD.w/2,y:WORLD.h/2,r:105,energy:poolEnergy},
    players:[...players.values()].map(safePlayer),nodes:nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,amount:n.amount})),
    monsters:monsters.map(m=>({id:m.id,x:m.x,y:m.y,hp:m.hp,maxHp:m.maxHp})),poolEnergy};
}
let poolEnergy=0;
function nearestNode(p) {
  let best=null,bd=100;
  for(const n of nodes) if(n.amount>0) {const d=dist(p,n);if(d<bd){best=n;bd=d;}}
  return best;
}
function spawnPlayer(id,name) {
  const colors=["#f0c66a","#76d6d0","#e98b77","#b5a1ed","#a6d66f","#e5a9d5","#8eb9f4","#f0a95e"];
  return {id,name:name.slice(0,16),x:WORLD.w/2+rand(-70,70),y:WORLD.h/2+rand(160,230),hp:100,maxHp:100,wood:0,stone:0,level:1,xp:0,
    weapon:null,ability:null,shield:0,alive:true,color:colors[(Number(id.replace(/\D/g,""))||0)%colors.length],score:0,
    lastAttack:0,lastGather:0,lastMove:Date.now(),respawnAt:0};
}
function sendNotice(p,msg) { const ws=clients.get(p.id); if(ws) send(ws,{type:"notice",message:msg}); }
function dropInventory(p) {
  if(p.wood>0) nodes.push(makeNode("wood",p.x+rand(-20,20),p.y+rand(-20,20),p.wood));
  if(p.stone>0) nodes.push(makeNode("stone",p.x+rand(-20,20),p.y+rand(-20,20),p.stone));
  p.wood=0;p.stone=0;
}
function damagePlayer(target, amount, attacker) {
  if(!target.alive) return;
  let dmg=amount;
  if(target.shield>0){const absorbed=Math.min(target.shield,dmg);target.shield-=absorbed;dmg-=absorbed;}
  target.hp-=dmg;
  if(target.hp<=0){target.hp=0;target.alive=false;target.respawnAt=Date.now()+5000;dropInventory(target);
    if(attacker){attacker.score+=1;attacker.xp+=30;sendNotice(attacker,`You defeated ${target.name}! +30 XP`);}
    sendNotice(target,"You were knocked out. Respawning in 5 seconds; some carried resources were dropped.");
  }
}
function chooseReward(p,id) {
  const offer=p.offers;
  if(!offer||!offer.some(x=>x.id===id)){sendNotice(p,"That reward is not available.");return;}
  const reward=offer.find(x=>x.id===id);p.offers=null;
  if(reward.id==="healing_surge")p.hp=Math.min(p.maxHp,p.hp+35);
  else if(reward.id==="bark_skin")p.shield=35;
  else if(reward.id==="swift_step")p.speedUntil=Date.now()+12000;
  else if(reward.kind==="weapon")p.weapon=reward.id;
  else p.ability=reward.id;
  p.xp+=20;p.level=1+Math.floor(p.xp/100);
  sendNotice(p,`Pool blessing received: ${reward.name}`);
  send(clients.get(p.id),{type:"reward",offers:[]});
}
function handleMessage(p, msg) {
  if(!msg||typeof msg!=="object")return;
  if(msg.type==="move"){
    let dx=clamp(Number(msg.dx)||0,-1,1),dy=clamp(Number(msg.dy)||0,-1,1);
    const len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;
    const speed=(p.speedUntil>Date.now()?230:165);
    p.x=clamp(p.x+dx*speed*.05,25,WORLD.w-25);p.y=clamp(p.y+dy*speed*.05,25,WORLD.h-25);p.lastMove=Date.now();
  } else if(msg.type==="gather"){
    if(Date.now()-p.lastGather<350)return;p.lastGather=Date.now();
    const n=nearestNode(p);
    if(!n){sendNotice(p,"No resource node nearby. Move closer to a tree or rock.");return;}
    const got=Math.min(1,n.amount);
    if(n.type==="wood")p.wood+=got;else p.stone+=got;
    n.amount-=got;if(n.amount<=0)n.respawnAt=Date.now()+12000;
    p.xp+=2;p.level=1+Math.floor(p.xp/100);
    sendNotice(p,`Collected ${got} ${n.type}.`);
  } else if(msg.type==="deposit"){
    if(dist(p,{x:WORLD.w/2,y:WORLD.h/2})>145){sendNotice(p,"Get closer to the central pool to deposit resources.");return;}
    const total=p.wood+p.stone;
    if(total<3){sendNotice(p,"Bring at least 3 total resources to the pool.");return;}
    const spend=Math.min(total,Math.max(3,Math.floor(Number(msg.amount)||total)));
    let left=spend;const useWood=Math.min(p.wood,left);p.wood-=useWood;left-=useWood;const useStone=Math.min(p.stone,left);p.stone-=useStone;
    const energy=useWood+useStone*2;poolEnergy+=energy;
    const shuffled=[...lootChoices].sort(()=>Math.random()-.5);
    p.offers=shuffled.slice(0,3);
    send(clients.get(p.id),{type:"reward",offers:p.offers,poolEnergy});
    sendNotice(p,`You fed ${spend} resources to the pool. Choose one of 3 blessings!`);
    broadcast({type:"pool",poolEnergy});
  } else if(msg.type==="chooseReward")chooseReward(p,String(msg.id||""));
  else if(msg.type==="attack"){
    if(Date.now()-p.lastAttack<700)return;p.lastAttack=Date.now();
    if(!p.alive)return;
    if(msg.mode==="ability"&&p.ability!=="storm_burst"){sendNotice(p,"No attack ability equipped. Pick a Storm Burst blessing first.");return;}
    const now=Date.now();
    if(p.ability==="storm_burst"&&msg.mode==="ability"){
      let target=null,bd=310;
      for(const q of players.values())if(q.id!==p.id&&q.alive){const d=dist(p,q);if(d<bd){target=q;bd=d;}}
      let monster=null;for(const m of monsters)if(m.hp>0){const d=dist(p,m);if(d<bd){monster=m;target=null;bd=d;}}
      if(target)damagePlayer(target,22,p);else if(monster){monster.hp-=22;if(monster.hp<=0){p.xp+=20;p.score+=1;monster.hp=0;setTimeout(()=>{monster.x=rand(100,WORLD.w-100);monster.y=rand(100,WORLD.h-100);monster.hp=monster.maxHp},10000)}}
      sendNotice(p,target?`Storm Burst hit ${target.name}.`:monster?"Storm Burst struck a monster.":"No target in range.");
      return;
    }
    let best=null,bd=p.weapon==="stone_hammer"?105:80;
    for(const q of players.values())if(q.id!==p.id&&q.alive){const d=dist(p,q);if(d<bd){best={kind:"player",obj:q};bd=d;}}
    for(const m of monsters)if(m.hp>0){const d=dist(p,m);if(d<bd){best={kind:"monster",obj:m};bd=d;}}
    if(!best){sendNotice(p,"No enemy in range.");return;}
    const dmg=p.weapon==="stone_hammer"?38:p.weapon==="ember_blade"?28:12;
    if(best.kind==="player")damagePlayer(best.obj,dmg,p);
    else {best.obj.hp-=dmg;if(best.obj.hp<=0){best.obj.hp=0;p.xp+=15;p.score+=1;sendNotice(p,"Monster defeated! +15 XP");setTimeout(()=>{best.obj.x=rand(100,WORLD.w-100);best.obj.y=rand(100,WORLD.h-100);best.obj.hp=best.obj.maxHp},10000)}else sendNotice(p,`Hit monster for ${dmg} damage.`);}
  }
}
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json"};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
  const rel=pathname==="/"?"index.html":pathname.replace(/^\/+/,"");
  const file=path.resolve(path.join(__dirname,"public",rel));
  if(!file.startsWith(path.resolve(path.join(__dirname,"public")))){res.writeHead(403);return res.end("Forbidden");}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end("Not found");}
    res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});res.end(data);});
});
const wss=new WebSocket.Server({server});
wss.on("connection",(ws,req)=>{
  if(players.size>=MAX_PLAYERS){send(ws,{type:"full",message:"This room is full (8/8)."});ws.close();return;}
  const id="p"+nextId++;
  const url=new URL(req.url,"http://localhost");
  const name=(url.searchParams.get("name")||"Survivor").replace(/[<>]/g,"").slice(0,16)||"Survivor";
  const p=spawnPlayer(id,name);players.set(id,p);clients.set(id,ws);
  send(ws,{type:"welcome",id,maxPlayers:MAX_PLAYERS,world:WORLD});
  send(ws,stateFor(p));broadcast({type:"noticeAll",message:`${p.name} joined the arena (${players.size}/${MAX_PLAYERS}).`});
  ws.on("message",buf=>{try{handleMessage(p,JSON.parse(buf.toString()));}catch(e){console.error("Bad client message",e.message);}});
  ws.on("close",()=>{players.delete(id);clients.delete(id);broadcast({type:"leave",id,name:p.name});});
  ws.on("error",()=>{});
});
setInterval(()=>{
  const now=Date.now();
  for(const n of nodes)if(n.amount<=0&&n.respawnAt&&now>=n.respawnAt){n.amount=n.maxAmount;n.respawnAt=0;}
  // Basic monster AI: wander toward the closest living player when nearby, damage at close range.
  for(const m of monsters)if(m.hp>0){
    let target=null,bd=360;for(const p of players.values())if(p.alive){const d=dist(m,p);if(d<bd){target=p;bd=d;}}
    if(target){const dx=target.x-m.x,dy=target.y-m.y,l=Math.hypot(dx,dy)||1;m.x+=dx/l*1.8;m.y+=dy/l*1.8;
      if(bd<34&&now-m.attackAt>1300){m.attackAt=now;damagePlayer(target,7,null);sendNotice(target,"A forest monster hit you for 7 damage.");}}
  }
  for(const p of players.values())if(!p.alive&&now>=p.respawnAt){p.alive=true;p.hp=p.maxHp;p.x=WORLD.w/2+rand(-100,100);p.y=WORLD.h/2+rand(150,240);sendNotice(p,"You are back in the arena!");}
  const snapshot={type:"state",world:WORLD,pool:{x:WORLD.w/2,y:WORLD.h/2,r:105,energy:poolEnergy},players:[...players.values()].map(safePlayer),
    nodes:nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,amount:n.amount})),monsters:monsters.map(m=>({id:m.id,x:m.x,y:m.y,hp:m.hp,maxHp:m.maxHp})),poolEnergy};
  broadcast(snapshot);
},TICK_MS);
server.listen(PORT,"0.0.0.0",()=>console.log(`WILDBOUND: POOL WARS running on http://localhost:${PORT} (max ${MAX_PLAYERS} players)`));
