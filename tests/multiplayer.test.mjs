import test from 'node:test';
import assert from 'node:assert/strict';
import {HostMatch,NetworkView,privateSnapshot,CALL_WINDOW_MS} from '../multiplayer.js';
import {Game,typeOf,chooseDiscard,chooseClaim} from '../engine.js';
function setup(humans=[0,1,2,3],seed=35){
 let now=1000,next=0;const jobs=new Map();
 const roster=Array.from({length:4},(_,i)=>({kind:humans.includes(i)?'human':'ai',connected:true}));
 const match=new HostMatch({roster,seed,now:()=>now,schedule:(f,ms)=>{jobs.set(++next,{f,at:now+ms});return next;},cancel:id=>jobs.delete(id)});
 const advance=()=>{const [id,j]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0]||[];assert.ok(j,'scheduled job');jobs.delete(id);now=j.at;j.f();};
 match.start();return {match,roster,advance,jobs};
}
let serial=0;
const packet=(m,action)=>({id:'test-'+(++serial),epoch:m.epoch,revision:m.revision,offerId:m.game.offer?.id,action});
test('all views hide other hands, wall, call queue and secret metadata',()=>{
 const {match:m}=setup();m.stepAI();
 for(let seat=0;seat<4;seat++){
  const s=m.snapshot(seat);assert.deepEqual(s.players[seat].hand,m.game.players[seat].hand);
  s.players.forEach((p,i)=>{if(i!==seat)assert.ok(p.hand.every(id=>id===null));});
  assert.equal(s.wall,undefined);assert.equal(s.random,undefined);assert.equal(s.callQueue,undefined);assert.equal(s.roster[0].token,undefined);
  const v=new NetworkView({},s);assert.deepEqual(v.players[0].hand,m.game.players[seat].hand);assert.equal(v.position(0),m.game.position(seat));
 }
});
test('ownership, stale actions and duplicate retries',()=>{
 const {match:m}=setup();m.stepAI();const seat=m.game.turn,id=m.game.players[seat].hand[0];
 assert.throws(()=>m.apply((seat+1)%4,packet(m,{type:'discard',id,declare:false})),/자기 차례/);
 assert.throws(()=>m.apply(seat,packet(m,{type:'discard',id:m.game.players[(seat+1)%4].hand[0],declare:false})),/손에 없는/);
 const p=packet(m,{type:'discard',id,declare:false});m.apply(seat,p);const n=m.revision;
 assert.deepEqual(m.apply(seat,p),{duplicate:true});assert.equal(m.revision,n);
 assert.throws(()=>m.apply(seat,{...p,id:'new'}),/갱신/);
});
// Build real, disjoint hands with two simultaneous waits on black A.
function doubleRon(m){
 const g=m.game;const used=new Set(),take=t=>{const id=Array.from({length:108},(_,i)=>i).find(id=>!used.has(id)&&typeOf(id)===t);assert.notEqual(id,undefined);used.add(id);return id;};
 const hand=types=>types.map(take);
 g.players=Array.from({length:4},()=>({hand:[],melds:[],river:[],riichi:false}));
 g.players[0].hand=hand([0,4,5,6,7,8,9,10,11,12,13]);
 g.players[1].hand=hand([0,1,2,3,4,5,6,10,11,12]);
 g.players[2].hand=hand([0,1,2,3,7,8,9,14,15,16]);
 const rest=Array.from({length:108},(_,i)=>i).filter(id=>!used.has(id));
 g.players[3].hand=rest.splice(0,10);g.dora=rest.splice(0,4);g.wall=rest;g.turn=0;g.phase='humanDiscard';g.drawn=g.players[0].hand.at(-1);
 g.discard(g.players[0].hand[0]);m.changed();assert.deepEqual(g.pendingRon,[1,2]);
}
test('concurrent ron packets at same revision both accepted; score zero sum',()=>{
 const {match:m}=setup();doubleRon(m);const a=packet(m,{type:'ron',accept:true}),b=packet(m,{type:'ron',accept:true});
 m.apply(1,a);assert.equal(m.game.result,null);m.apply(2,b);
 assert.deepEqual(m.game.result.winners.map(w=>w.seat),[1,2]);assert.equal(m.game.scores.reduce((a,b)=>a+b,0),0);m.game.assertCards();
});
test('ron timeout preserves accepted winners; deadline not renewed on first response',()=>{
 const {match:m,advance}=setup();doubleRon(m);const deadline=m.deadline;m.apply(1,packet(m,{type:'ron',accept:true}));assert.equal(m.deadline,deadline);assert.equal(deadline,1000+CALL_WINDOW_MS);advance();assert.deepEqual(m.game.result.winners.map(w=>w.seat),[1]);
});
test('disconnect pauses all actions and timers; AI replacement resumes',()=>{
 const {match:m,roster,jobs}=setup();m.stepAI();const seat=m.game.turn===0?1:m.game.turn;roster[seat].connected=false;m.changed();assert.equal(m.paused,true);assert.equal(jobs.size,0);
 assert.throws(()=>m.apply(0,packet(m,{type:'restart'})),/재접속/);m.replaceDisconnected(seat);assert.equal(m.paused,false);assert.equal(m.game.humanSeats.has(seat),false);assert.equal(roster[seat].kind,'ai');
});
test('100 complete games preserve all physical cards and scores, including 4 humans',()=>{
 for(let seed=1;seed<=100;seed++){
 const {match:m,advance}=setup(seed%2?[0]:[0,1,2,3],seed);let steps=0;
 while(m.game.phase!=='matchEnd'){
  assert.ok(++steps<3000);const g=m.game;g.assertCards();
  if(g.phase==='roundEnd'){m.apply(0,packet(m,{type:'next'}));continue;}
  if(g.phase==='humanDiscard'){const seat=g.turn;if(g.canWin(seat))m.apply(seat,packet(m,{type:'tsumo'}));else{const choice=chooseDiscard(g.observation(seat));const id=g.players[seat].riichi?g.drawn:g.players[seat].hand.find(id=>typeOf(id)===choice.tile);m.apply(seat,packet(m,{type:'discard',id,declare:false}));}}
  else if(g.phase==='humanRon'){for(const seat of [...g.pendingRon])m.apply(seat,packet(m,{type:'ron',accept:true}));}
  else if(g.phase==='humanClaim'){const meld=chooseClaim(g.observation(g.pending.seat),typeOf(g.offer.id),g.pending.options);m.apply(g.pending.seat,packet(m,{type:'claim',meld}));}
  else advance();
 }
 assert.equal(m.game.scores.reduce((a,b)=>a+b,0),0);m.close();
 }
});
