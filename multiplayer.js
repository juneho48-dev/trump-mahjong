import {Game,typeOf,countTypes,winningHand,waits,chooseDiscard,chooseClaim} from './engine.js?v=3';
export const PROTOCOL='trump-mahjong-p2p-1';
export const CALL_WINDOW_MS=15000;
const clone=value=>JSON.parse(JSON.stringify(value));
export const memberName=(seat,roster)=>roster[seat]?.kind==='human'?(seat===0?'방장':`플레이어 ${seat+1}`):`AI ${seat+1}`;

// The host sends each viewer their own cards and public information only.
export function privateSnapshot(game,viewer,roster,metadata={}){
  const pendingRon=game.phase==='humanRon'&&game.pendingRon.includes(viewer);
  const pending=game.pending?{
    seat:game.pending.seat,
    chi:game.pending.chi,
    options:game.pending.seat===viewer?clone(game.pending.options):[],
  }:null;
  return {
    ...metadata,
    viewer,
    players:game.players.map((p,seat)=>({
      hand:seat===viewer?p.hand.slice():Array(p.hand.length).fill(null),
      melds:clone(p.melds),river:p.river.slice(),riichi:p.riichi,
    })),
    dealer:game.dealer,turn:game.turn,round:game.round,rounds:game.rounds,
    scores:game.scores.slice(),phase:game.phase,dora:game.dora.slice(),
    wallRemaining:game.wall.length,
    drawn:game.turn===viewer?game.drawn:null,
    offer:game.offer?{from:game.offer.from,id:game.offer.id}:null,
    pending,pendingRon,
    // Never serialize the engine, call queue, observations, RNG, or wall order.
    result:game.result?clone(game.result):null,
    lastDiscard:game.lastDiscard?{...game.lastDiscard}:null,
    log:game.log.slice(-60),
    roster:roster.map(m=>({kind:m.kind,connected:m.connected})),
  };
}

export class HostMatch{
  constructor({roster,onState,now=()=>Date.now(),schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id),seed=null}={}){
    this.roster=roster;
    this.onState=onState;
    this.now=now;this.schedule=schedule;this.cancel=cancel;this.seed=seed;
    this.revision=0;this.epoch='';this.game=null;this.timer=null;
    this.deadline=null;this.windowKey=null;this.closed=false;
    this.processed=Array.from({length:4},()=>new Set());
  }
  get paused(){return this.roster.some(m=>m.kind==='human'&&!m.connected);}
  start(){
    if(this.paused)throw Error('참가자의 재접속을 기다리고 있습니다.');
    this.cancel(this.timer);
    const humans=this.roster.flatMap((m,seat)=>m.kind==='human'?[seat]:[]);
    this.game=new Game(this.seed,{humanSeats:humans});
    this.game.name=seat=>memberName(seat,this.roster);
    this.game.log=[`1세트 시작 · ${this.game.name(this.game.dealer)} 오야`];
    this.epoch=`${this.now()}-${Math.random().toString(36).slice(2)}`;
    this.processed=Array.from({length:4},()=>new Set());this.windowKey=null;
    this.changed();
  }
  snapshot(seat){
    return privateSnapshot(this.game,seat,this.roster,{
      revision:this.revision,epoch:this.epoch,deadline:this.deadline,paused:this.paused,
    });
  }
  changed(){
    if(this.closed||!this.game)return;
    this.cancel(this.timer);this.timer=null;
    const g=this.game;
    const key=!this.paused&&['humanRon','humanClaim'].includes(g.phase)?
      `${g.round}:${g.offer?.id}:${g.phase}:${g.phase==='humanClaim'?g.pending.seat+'-'+g.pending.chi:'all'}`:null;
    if(key!==this.windowKey){this.windowKey=key;this.deadline=key?this.now()+CALL_WINDOW_MS:null;}
    this.revision++;
    this.onState?.(this);
    if(this.paused||g.result)return;
    if(this.deadline!==null){
      const window=this.windowKey;
      this.timer=this.schedule(()=>{
        if(this.closed||this.paused||this.windowKey!==window)return;
        if(g.phase==='humanRon'){
          for(const seat of [...g.pendingRon])g.humanRon(false,seat);
        }else if(g.phase==='humanClaim')g.resolveClaim(null);
        this.changed();
      },Math.max(0,this.deadline-this.now()));
    }else if(['draw','aiDiscard','aiClaim'].includes(g.phase)){
      this.timer=this.schedule(()=>this.stepAI(),350);
    }
  }
  stepAI(){
    if(this.closed||this.paused||this.game.result)return;
    const g=this.game;
    if(g.phase==='draw')g.drawTurn();
    else if(g.phase==='aiDiscard')g.aiDiscard(chooseDiscard(g.observation(g.turn)));
    else if(g.phase==='aiClaim')g.resolveClaim(chooseClaim(g.observation(g.pending.seat),typeOf(g.offer.id),g.pending.options));
    else return;
    this.changed();
  }
  apply(seat,packet){
    if(this.closed||!this.game)throw Error('게임이 시작되지 않았습니다.');
    if(!Number.isInteger(seat)||!this.roster[seat]||this.roster[seat].kind!=='human')throw Error('참가 권한이 없습니다.');
    if(typeof packet.id!=='string'||packet.id.length>100||!packet.id)throw Error('동작 번호가 올바르지 않습니다.');
    if(this.processed[seat].has(packet.id))return {duplicate:true};
    if(packet.epoch!==this.epoch||(packet.revision!==this.revision&&!(packet.action?.type==='ron'&&packet.offerId===this.game.offer?.id&&packet.revision<=this.revision&&this.game.pendingRon.includes(seat))))throw Error('상태가 갱신되었습니다. 현재 화면에서 다시 선택하세요.');
    if(this.paused)throw Error('참가자의 재접속을 기다리고 있습니다.');
    const g=this.game,a=packet.action;
    if(!a||typeof a!=='object')throw Error('동작이 올바르지 않습니다.');
    switch(a.type){
      case 'discard':
        if(g.phase!=='humanDiscard'||g.turn!==seat)throw Error('자기 차례에만 버릴 수 있습니다.');
        if(!Number.isInteger(a.id)||a.id<0||a.id>107||typeof a.declare!=='boolean')throw Error('카드 선택이 올바르지 않습니다.');
        g.discard(a.id,a.declare);break;
      case 'ron':
        if(g.phase!=='humanRon'||!g.pendingRon.includes(seat)||typeof a.accept!=='boolean')throw Error('론 응답 시간이 아닙니다.');
        g.humanRon(a.accept,seat);break;
      case 'tsumo':
        if(g.phase!=='humanDiscard'||g.turn!==seat||!g.canWin(seat))throw Error('쯔모 조건을 충족하지 않습니다.');
        g.humanTsumo(seat);break;
      case 'claim':
        if(g.phase!=='humanClaim'||g.pending.seat!==seat)throw Error('치·퐁 응답 시간이 아닙니다.');
        if(a.meld!==null&&(!Array.isArray(a.meld)||a.meld.length!==3||a.meld.some(t=>!Number.isInteger(t)||t<0||t>26)))throw Error('몸통이 올바르지 않습니다.');
        g.resolveClaim(a.meld);break;
      case 'next':
        if(seat!==0||g.phase!=='roundEnd')throw Error('방장만 다음 세트를 시작할 수 있습니다.');
        g.nextRound();break;
      case 'restart':
        if(seat!==0)throw Error('방장만 새 게임을 시작할 수 있습니다.');
        this.start();return {accepted:true};
      default:throw Error('지원하지 않는 동작입니다.');
    }
    this.processed[seat].add(packet.id);
    if(this.processed[seat].size>200)this.processed[seat].delete(this.processed[seat].values().next().value);
    g.assertCards();this.changed();return {accepted:true};
  }
  replaceDisconnected(seat){
    if(seat===0||this.roster[seat]?.kind!=='human'||this.roster[seat].connected)throw Error('연결이 끊긴 자리만 AI로 바꿀 수 있습니다.');
    this.roster[seat]={kind:'ai',connected:true};
    this.game.humanSeats.delete(seat);
    if(this.game.phase==='humanDiscard'&&this.game.turn===seat)this.game.phase='aiDiscard';
    if(this.game.phase==='humanClaim'&&this.game.pending.seat===seat)this.game.phase='aiClaim';
    if(this.game.pendingRon.includes(seat))this.game.humanRon(true,seat);
    this.game.addLog(`${seat+1}번 자리를 AI가 이어서 플레이합니다.`);
    this.changed();
  }
  close(){this.closed=true;this.cancel(this.timer);}
}

// Rotate the public table so every participant sits at the bottom of their screen.
export class NetworkView{
  constructor(session,snapshot){this.session=session;this.update(snapshot);}
  relative(seat){return(seat-this.snapshot.viewer+4)%4;}
  actual(seat){return(seat+this.snapshot.viewer)%4;}
  update(snapshot){
    this.snapshot=snapshot;
    this.players=[0,1,2,3].map(seat=>snapshot.players[this.actual(seat)]);
    this.dealer=this.relative(snapshot.dealer);this.turn=this.relative(snapshot.turn);
    this.round=snapshot.round;this.rounds=snapshot.rounds;this.phase=snapshot.phase;
    this.scores=[0,1,2,3].map(seat=>snapshot.scores[this.actual(seat)]);
    this.dora=snapshot.dora;this.wall=Array(snapshot.wallRemaining).fill(null);this.drawn=snapshot.drawn;
    this.log=snapshot.log;
    this.offer=snapshot.offer?{...snapshot.offer,from:this.relative(snapshot.offer.from)}:null;
    this.pending=snapshot.pending?{...snapshot.pending,seat:this.relative(snapshot.pending.seat)}:null;
    this.lastDiscard=snapshot.lastDiscard?{...snapshot.lastDiscard,seat:this.relative(snapshot.lastDiscard.seat)}:null;
    if(this.phase==='humanDiscard'&&this.turn!==0)this.phase='remoteTurn';
    if(this.phase==='humanClaim'&&this.pending.seat!==0){this.phase='remoteTurn';this.turn=this.pending.seat;}
    if(this.phase==='humanRon'&&!snapshot.pendingRon)this.phase='remoteResponse';
    this.result=snapshot.result?{
      ...snapshot.result,
      discarder:snapshot.result.discarder==null?null:this.relative(snapshot.result.discarder),
      delta:[0,1,2,3].map(seat=>snapshot.result.delta[this.actual(seat)]),
      winners:snapshot.result.winners.map(w=>({...w,seat:this.relative(w.seat),delta:[0,1,2,3].map(seat=>w.delta[this.actual(seat)])})),
    }:null;
  }
  name(seat){return seat===0?'나':memberName(this.actual(seat),this.snapshot.roster);}
  position(seat){return(seat-this.dealer+4)%4;}
  meldTypes(seat){return this.players[seat].melds.map(m=>m.map(typeOf));}
  canWin(seat){return seat===0?winningHand(countTypes(this.players[0].hand),this.meldTypes(0),this.position(0)):null;}
  riichiDiscards(seat=0){
    if(seat!==0)return [];
    const p=this.players[0];if(p.riichi||p.melds.length)return [];
    return p.hand.filter(id=>{const hand=p.hand.slice();hand.splice(hand.indexOf(id),1);return waits(countTypes(hand),[],this.position(0)).length;});
  }
  observation(){
    return {hand:countTypes(this.players[0].hand),melds:this.meldTypes(0),position:this.position(0),
      riichi:this.players[0].riichi,wallRemaining:this.wall.length,public:countTypes([...this.dora,...this.players.flatMap(p=>[...p.river,...p.melds.flat()])]),dora:this.dora.map(typeOf)};
  }
  discard(id,declare=false){this.session.act({type:'discard',id,declare});}
  humanRon(accept){this.session.act({type:'ron',accept});}
  humanTsumo(){this.session.act({type:'tsumo'});}
  resolveClaim(meld){this.session.act({type:'claim',meld});}
  nextRound(){this.session.act({type:'next'});}
}
