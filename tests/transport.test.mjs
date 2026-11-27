import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {P2PSession} from '../p2p-session.js';
const peers=new Map();
class Channel extends EventEmitter{
 constructor(){super();this.open=false;}
 send(data){const copy=structuredClone(data);queueMicrotask(()=>{if(this.other.open)this.other.emit('data',copy);});}
 close(){if(!this.open)return;this.open=false;this.emit('close');if(this.other.open){this.other.open=false;this.other.emit('close');}}
}
class FakePeer extends EventEmitter{
 constructor(id){super();this.id=id;this.open=false;this.disconnected=false;peers.set(id,this);queueMicrotask(()=>{this.open=true;this.emit('open',id);});}
 connect(id){const a=new Channel(),b=new Channel();a.other=b;b.other=a;queueMicrotask(()=>{const remote=peers.get(id);if(!remote)return;remote.emit('connection',b);a.open=b.open=true;a.emit('open');b.emit('open');});return a;}
 destroy(){this.destroyed=true;peers.delete(this.id);}
}
globalThis.Peer=FakePeer;
globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('four players join; private hands sync; guests cannot restart; reconnect restores seat',async()=>{
 const host=new P2PSession(()=>{}),guests=[1,2,3].map(()=>new P2PSession(()=>{}));
 try{
 host.host();await flush();for(const g of guests){g.join(host.code);await flush();}
 assert.deepEqual(host.roster.map(m=>m.kind),['human','human','human','human']);
 assert.deepEqual(guests.map(g=>g.seat),[1,2,3]);host.start();await flush();
 for(const g of guests){assert.ok(g.view);assert.deepEqual(g.view.players[0].hand,host.match.game.players[g.seat].hand);assert.ok(g.view.players[1].hand.every(x=>x===null));}
 host.match.stepAI();await flush();const actor=host.match.game.turn,client=actor===0?host:guests[actor-1];
 const card=client.view.players[0].hand[0];client.act({type:'discard',id:card,declare:false});await flush();
 assert.equal(host.match.game.lastDiscard.id,card);for(const g of guests)assert.equal(g.view.lastDiscard.id,card);
 const epoch=host.match.epoch;guests[0].act({type:'restart'});await flush();assert.equal(host.match.epoch,epoch);assert.match(guests[0].message,/방장만/);assert.equal(guests[0].busy,false);
 const guest=guests[1],seat=guest.seat,hand=guest.view.players[0].hand.slice();guest.connection.close();await flush();assert.equal(host.match.paused,true);guest.reconnect();await flush();assert.equal(guest.seat,seat);assert.equal(host.match.paused,false);assert.deepEqual(guest.view.players[0].hand,hand);
 }finally{guests.forEach(g=>g.close());host.close();}
});
test('late new guest is rejected after game starts',async()=>{
 const host=new P2PSession(()=>{}),late=new P2PSession(()=>{});
 try{host.host();await flush();host.start();late.join(host.code);await flush();assert.equal(late.closed,true);assert.match(late.message,/이미 시작/);}finally{late.close();host.close();}
});
