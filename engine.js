export const TYPE_COUNT = 27;
export function typeOf(id) {
  const card = id % 54;
  if (card >= 52) return 26;
  const suit = Math.floor(card / 13), rank = card % 13;
  const color = suit === 0 || suit === 2 ? 0 : 1;
  return rank < 10 ? color * 10 + rank : 20 + (rank - 10) * 2 + color;
}
export function imageOf(id) {
  const card = id % 54;
  if (card >= 52) return 'cards/Joker.png';
  return `cards/${['A','2','3','4','5','6','7','8','9','10','J','Q','K'][card % 13]}${['S','H','C','D'][Math.floor(card / 13)]}.png`;
}
export function labelOfType(type) {
  if (type === 26) return '조커';
  if (type < 20) return `${type < 10 ? '검정' : '빨강'}${type % 10 === 0 ? 'A' : type % 10 + 1}`;
  return `${type % 2 === 0 ? '검정' : '빨강'}${'JQK'[Math.floor((type - 20) / 2)]}`;
}
export const countTypes = cards => {
  const counts = Array(27).fill(0);
  for (const card of cards) counts[typeOf(card)]++;
  return counts;
};
const countMelds = melds => {
  const counts = Array(27).fill(0);
  for (const meld of melds) for (const type of meld) counts[type]++;
  return counts;
};
export const isWind = (type, position) => type === 26 || (position > 0 && type >= 20 && Math.floor((type - 20) / 2) === position - 1);
function splitGroups(counts, needed) {
  const first = counts.findIndex(c => c > 0);
  if (first < 0) return needed === 0 ? [] : null;
  if (!needed) return null;
  if (counts[first] >= 3) {
    counts[first] -= 3;
    const result = splitGroups(counts, needed - 1);
    counts[first] += 3;
    if (result) return [[first, first, first], ...result];
  }
  if (first < 20 && first % 10 <= 7 && counts[first + 1] && counts[first + 2]) {
    counts[first]--; counts[first + 1]--; counts[first + 2]--;
    const result = splitGroups(counts, needed - 1);
    counts[first]++; counts[first + 1]++; counts[first + 2]++;
    if (result) return [[first, first + 1, first + 2], ...result];
  }
  return null;
}
export function winningHand(hand, melds, position) {
  if (hand.reduce((a,b) => a+b, 0) !== 11 - melds.length * 3 || melds.length > 3) return null;
  const exposed = countMelds(melds), total = hand.map((n,i) => n + exposed[i]);
  if (total.some(n => n < 0 || n > 4)) return null;
  if (melds.length && total.slice(20).some(Boolean) && !total.some((n,i) => i >= 20 && n >= 3 && isWind(i, position))) return null;
  for (let pair = 0; pair < 27; pair++) {
    if (hand[pair] < 2) continue;
    const rest = hand.slice(); rest[pair] -= 2;
    const groups = splitGroups(rest, 3 - melds.length);
    if (groups) return { melds: [...melds, ...groups], pair };
  }
  return null;
}
export function waits(hand, melds, position) {
  const exposed = countMelds(melds), result = [];
  for (let type = 0; type < 27; type++) {
    if (hand[type] + exposed[type] >= 4) continue;
    const test = hand.slice(); test[type]++;
    if (winningHand(test, melds, position)) result.push(type);
  }
  return result;
}
export function claimOptions(hand, melds, offered, chi, riichi) {
  if (riichi || melds.length >= 3) return [];
  if (!chi) return hand[offered] >= 2 ? [[offered, offered, offered]] : [];
  if (offered >= 20) return [];
  const options = [];
  for (let start = offered - 2; start <= offered; start++) {
    if (start < 0 || start + 2 >= 20 || Math.floor(start / 10) !== Math.floor(offered / 10) || Math.floor((start + 2) / 10) !== Math.floor(offered / 10)) continue;
    const meld = [start, start + 1, start + 2];
    if (meld.every(t => t === offered || hand[t] > 0)) options.push(meld);
  }
  return options;
}
export function scoreHand(hand, melds, dora, riichi) {
  const exposed = countMelds(melds), bonuses = Array(27).fill(0);
  for (const type of dora) bonuses[type]++;
  const bonus = hand.reduce((sum,n,i) => sum + (n + exposed[i]) * bonuses[i], 0);
  const base = 30 + 30 * bonus;
  return { score: base * (melds.length ? 1 : 1.5) + (riichi ? 30 : 0), bonus, closed: !melds.length, riichi };
}
export function settle(score, winner, dealer, discarder = null) {
  const delta = [0,0,0,0];
  const payers = discarder === null ? [0,1,2,3].filter(s => s !== winner) : [discarder];
  for (const payer of payers) {
    const amount = (discarder === null ? score / 3 : score) * (winner === dealer || payer === dealer ? 2 : 1);
    delta[payer] -= amount; delta[winner] += amount;
  }
  return delta;
}

// All numeric target combinations. Two 20-bit masks preserve exact bit operations.
let numericTargets;
const suitCache = new Map(), retainedCache = new Map();
function masks(counts) {
  let low = 0, high = 0;
  for (let i = 0; i < 5; i++) {
    low |= ((1 << counts[i]) - 1) << (i * 4);
    high |= ((1 << counts[i + 5]) - 1) << (i * 4);
  }
  return [low, high];
}
function popcount(value) {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function targets() {
  if (numericTargets) return numericTargets;
  numericTargets = Array.from({length:8}, () => []);
  const melds = [...Array.from({length:10},(_,i) => [i,i,i]), ...Array.from({length:8},(_,i) => [i,i+1,i+2])];
  const counts = Array(10).fill(0);
  function visit(left, start, total) {
    if (!left) {
      for (let pair = -1; pair < 10; pair++) {
        if (pair >= 0) counts[pair] += 2;
        if (counts.every(n => n <= 4)) numericTargets[total * 2 + Number(pair >= 0)].push(masks(counts));
        if (pair >= 0) counts[pair] -= 2;
      }
      return;
    }
    for (let i = start; i < melds.length; i++) {
      for (const type of melds[i]) counts[type]++;
      if (counts.every(n => n <= 4)) visit(left - 1, i, total);
      for (const type of melds[i]) counts[type]--;
    }
  }
  for (let m = 0; m <= 3; m++) visit(m, 0, m);
  return numericTargets;
}
function cacheSet(cache, key, value, max) {
  if (cache.size >= max) cache.clear();
  cache.set(key, value);
  return value;
}
function suitProfile(hand, exposed) {
  const key = hand.join('') + exposed.join('');
  if (suitCache.has(key)) return suitCache.get(key);
  const [h1,h2] = masks(hand), [c1,c2] = masks(exposed.map(n => 4-n)), count = hand.reduce((a,b) => a+b,0);
  const profile = targets().map((patterns,slot) => {
    const upper = Math.min(count, 3 * Math.floor(slot/2) + 2 * (slot%2));
    let best = -100;
    for (const [a,b] of patterns) {
      if ((a & c1) !== a || (b & c2) !== b) continue;
      best = Math.max(best, popcount(a & h1) + popcount(b & h2));
      if (best === upper) break;
    }
    return best;
  });
  return cacheSet(suitCache,key,profile,30000);
}
export function retainedCards(hand, melds, position) {
  const exposed = countMelds(melds), key = hand.join('') + exposed.join('') + position;
  if (retainedCache.has(key)) return retainedCache.get(key);
  const needed = 3-melds.length, black = suitProfile(hand.slice(0,10),exposed.slice(0,10)), red = suitProfile(hand.slice(10,20),exposed.slice(10,20));
  const wind = exposed.some((n,i) => i>=20 && n>=3 && isWind(i,position)), honor = exposed.slice(20).some(Boolean);
  const index = (m,p,w,h) => m*8 + p*4 + Number(w)*2 + Number(h);
  let dp = Array(32).fill(-100);
  for (let m=0;m<=needed;m++) for (let p=0;p<=1;p++) {
    let best=-100;
    for (let mb=0;mb<=m;mb++) for (let pb=0;pb<=p;pb++) best=Math.max(best,black[2*mb+pb]+red[2*(m-mb)+p-pb]);
    dp[index(m,p,wind,honor)]=best;
  }
  for (let t=20;t<27;t++) {
    const next=dp.slice();
    for (let m=0;m<=needed;m++) for (let p=0;p<=1;p++) for(let w=0;w<=1;w++) for(let h=0;h<=1;h++) {
      const value=dp[index(m,p,w,h)]; if(value<0) continue;
      if(m<needed && exposed[t]+3<=4) {
        const at=index(m+1,p,w||isWind(t,position),true);
        next[at]=Math.max(next[at],value+Math.min(hand[t],3));
      }
      if(!p && exposed[t]+2<=4) {
        const at=index(m,1,w,true); next[at]=Math.max(next[at],value+Math.min(hand[t],2));
      }
    }
    dp=next;
  }
  let best=-100;
  for(let w=0;w<=1;w++) for(let h=0;h<=1;h++) if(!melds.length || w || !h) best=Math.max(best,dp[index(needed,1,w,h)]);
  return cacheSet(retainedCache,key,best+3*melds.length,50000);
}
function structure(hand,view) {
  let value=0;
  const dora=Array(27).fill(0); for(const t of view.dora)dora[t]++;
  hand.forEach((count,t) => {
    if(!count)return;
    value+=count>=3 ? 3.2*count : count===2 ? 4 : 0;
    if(t<20) for(const [gap,weight] of [[1,1.5],[2,0.7]]) {
      const other=t+gap;
      if(other<20 && Math.floor(other/10)===Math.floor(t/10))value+=weight*Math.min(count,hand[other]);
    }
    else if(isWind(t,view.position))value+=0.45*count;
    value+=0.12*dora[t]*count;
  });
  return value;
}
export function chooseDiscard(view,lookahead=3) {
  const choices=[];
  view.hand.forEach((count,tile) => {
    if(!count)return;
    const hand=view.hand.slice();hand[tile]--;
    choices.push({tile,hand,retained:retainedCards(hand,view.melds,view.position),structure:structure(hand,view)});
  });
  choices.sort((a,b)=>b.retained-a.retained||b.structure-a.structure||a.tile-b.tile);
  const distance=choices[0].retained, closest=choices.filter(c=>c.retained===distance).slice(0,lookahead);
  for(const choice of closest) {
    choice.effective=0;
    for(let draw=0;draw<27;draw++) {
      const available=4-view.public[draw]-choice.hand[draw]-Number(draw===choice.tile);
      if(available<=0)continue;
      const after=choice.hand.slice();after[draw]++;
      if(retainedCards(after,view.melds,view.position)>choice.retained)choice.effective+=available;
    }
  }
  closest.sort((a,b)=>b.effective-a.effective||b.structure-a.structure||a.tile-b.tile);
  const {tile,retained,effective}=closest[0];return {tile,retained,effective};
}
export function chooseClaim(view,offered,options) {
  const baseline=retainedCards(view.hand,view.melds,view.position); let best=null;
  for(const meld of options) {
    const hand=view.hand.slice(),publicCounts=view.public.slice();hand[offered]++;
    for(const t of meld){hand[t]--;publicCounts[t]++;}publicCounts[offered]--;
    const after={...view,hand,public:publicCounts,melds:[...view.melds,meld]};
    const choice=chooseDiscard(after);
    if(choice.retained>baseline && (!best || choice.retained>best.choice.retained || (choice.retained===best.choice.retained&&choice.effective>best.choice.effective))) best={meld,choice};
  }
  return best?.meld??null;
}

export class Game {
  constructor(seed=null, {humanSeats=[0]} = {}) {
    this.humanSeats=new Set(humanSeats);
    this.random=seed===null ? Math.random : (()=>{let s=seed>>>0;return ()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};})();
    this.dealer=Math.floor(this.random()*4);this.round=1;this.rounds=4;this.scores=[0,0,0,0];this.log=[];this.startRound();
  }
  position(seat){return(seat-this.dealer+4)%4;}
  name(seat){return seat===0?'나':`AI ${seat}`;}
  meldTypes(seat){return this.players[seat].melds.map(m=>m.map(typeOf));}
  addLog(text){this.log.push(text);if(this.log.length>100)this.log.shift();}
  startRound(){
    const deck=Array.from({length:108},(_,i)=>i);
    for(let i=deck.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
    this.dora=deck.splice(0,4);this.players=Array.from({length:4},()=>({hand:[],melds:[],river:[],riichi:false}));
    for(let i=0;i<10;i++)for(let s=0;s<4;s++)this.players[s].hand.push(deck.shift());
    this.wall=deck;this.turn=this.dealer;this.phase='draw';this.drawn=null;this.offer=null;this.result=null;this.lastDiscard=null;this.pendingRon=[];this.acceptedRon=[];
    this.addLog(`${this.round}세트 시작 · ${this.name(this.dealer)} 오야`);this.assertCards();
  }
  observation(seat){
    const publicCounts=countTypes([...this.dora,...this.players.flatMap(p=>[...p.river,...p.melds.flat()])]);
    return {hand:countTypes(this.players[seat].hand),melds:this.meldTypes(seat),position:this.position(seat),public:publicCounts,dora:this.dora.map(typeOf),riichi:this.players[seat].riichi,wallRemaining:this.wall.length};
  }
  canWin(seat,card=null){const hand=this.players[seat].hand.slice();if(card!==null)hand.push(card);return winningHand(countTypes(hand),this.meldTypes(seat),this.position(seat));}
  drawTurn(){
    if(this.phase!=='draw')throw Error('뽑기 순서가 아닙니다.');
    if(!this.wall.length){this.finishDraw();return;}
    this.drawn=this.wall.pop();this.players[this.turn].hand.push(this.drawn);
    if(!this.humanSeats.has(this.turn)&&this.canWin(this.turn)){this.finish([this.turn],null);return;}
    this.phase=this.humanSeats.has(this.turn)?'humanDiscard':'aiDiscard';this.assertCards();
  }
  riichiDiscards(seat=0){
    const p=this.players[seat];if(p.riichi||p.melds.length)return [];
    return p.hand.filter(id=>{const rest=p.hand.slice();rest.splice(rest.indexOf(id),1);return waits(countTypes(rest),[],this.position(seat)).length>0;});
  }
  discard(id,declare=false){
    if(!['humanDiscard','aiDiscard'].includes(this.phase))throw Error('카드를 버릴 순서가 아닙니다.');
    const player=this.players[this.turn],at=player.hand.indexOf(id);if(at<0)throw Error('손에 없는 카드입니다.');
    if(player.riichi&&id!==this.drawn)throw Error('리치 후에는 뽑은 패를 버려야 합니다.');
    if(declare&&!this.riichiDiscards(this.turn).includes(id))throw Error('리치 조건을 충족하지 않습니다.');
    if(declare){player.riichi=true;this.addLog(`${this.name(this.turn)} 리치`);}
    player.hand.splice(at,1);player.river.push(id);this.lastDiscard={seat:this.turn,id};
    this.addLog(`${this.name(this.turn)} · ${labelOfType(typeOf(id))} 버림`);
    const seats=[];for(let offset=1;offset<4;offset++){const seat=(this.turn+offset)%4;if(this.canWin(seat,id))seats.push(seat);}
    this.offer={from:this.turn,id,ronSeats:seats};
    this.pendingRon=seats.filter(seat=>this.humanSeats.has(seat));
    this.acceptedRon=seats.filter(seat=>!this.humanSeats.has(seat));
    if(this.pendingRon.length)this.phase='humanRon';else if(seats.length)this.finish(seats,this.turn);else this.beginClaims();
    this.assertCards();
  }
  aiDiscard(choice){
    if(this.phase!=='aiDiscard')return;
    const p=this.players[this.turn];const id=p.riichi?this.drawn:p.hand.find(id=>typeOf(id)===choice.tile);
    const declare=!p.riichi&&!p.melds.length&&this.riichiDiscards(this.turn).includes(id);
    this.discard(id,declare);
  }
  humanRon(accept,seat=0){
    if(this.phase!=='humanRon'||!this.pendingRon.includes(seat))return;
    this.pendingRon=this.pendingRon.filter(player=>player!==seat);
    if(accept)this.acceptedRon.push(seat);
    if(this.pendingRon.length)return;
    const winners=this.offer.ronSeats.filter(player=>this.acceptedRon.includes(player));
    if(winners.length)this.finish(winners,this.offer.from);else this.beginClaims();
  }
  humanTsumo(seat=0){if(this.phase!=='humanDiscard'||this.turn!==seat||!this.canWin(seat))return;this.finish([seat],null);}

  beginClaims(){
    this.callQueue=[];this.callIndex=0;
    if(this.wall.length) for(const chi of [false,true])for(let offset=1;offset<4;offset++){
      if(chi&&offset!==1)continue;
      const seat=(this.offer.from+offset)%4,p=this.players[seat];
      const options=claimOptions(countTypes(p.hand),this.meldTypes(seat),typeOf(this.offer.id),chi,p.riichi);
      if(options.length)this.callQueue.push({seat,chi,options});
    }
    this.nextClaim();
  }
  nextClaim(){
    if(this.callIndex>=this.callQueue.length){this.turn=(this.offer.from+1)%4;this.phase='draw';return;}
    this.pending=this.callQueue[this.callIndex++];this.phase=this.humanSeats.has(this.pending.seat)?'humanClaim':'aiClaim';
  }
  resolveClaim(meld){
    if(!['humanClaim','aiClaim'].includes(this.phase))return;
    if(!meld){this.nextClaim();return;}
    if(!this.pending.options.some(option=>option.join(',')===meld.join(',')))throw Error('허용되지 않은 몸통입니다.');
    const {seat,chi}=this.pending,p=this.players[seat],id=this.offer.id;
    if(this.players[this.offer.from].river.pop()!==id)throw Error('버림패 상태가 일치하지 않습니다.');
    p.hand.push(id);const physical=[];
    for(const t of meld){const at=p.hand.findIndex(card=>typeOf(card)===t);if(at<0)throw Error('몸통 카드가 부족합니다.');physical.push(p.hand.splice(at,1)[0]);}
    p.melds.push(physical);this.turn=seat;this.drawn=null;this.phase=this.humanSeats.has(seat)?'humanDiscard':'aiDiscard';
    this.addLog(`${this.name(seat)} ${chi?'치':'퐁'} · ${meld.map(labelOfType).join(' ')}`);this.assertCards();
  }
  finish(winners,discarder){
    const results=[],delta=[0,0,0,0];
    for(const winner of winners){
      const cards=this.players[winner].hand.slice();if(discarder!==null)cards.push(this.offer.id);
      const melds=this.meldTypes(winner),judgment=winningHand(countTypes(cards),melds,this.position(winner));
      if(!judgment)throw Error('화료 조건을 충족하지 않습니다.');
      const scored=scoreHand(countTypes(cards),melds,this.dora.map(typeOf),this.players[winner].riichi);
      const change=settle(scored.score,winner,this.dealer,discarder);change.forEach((n,i)=>delta[i]+=n);
      results.push({seat:winner,cards:[...cards,...this.players[winner].melds.flat()],...scored,delta:change});
    }
    delta.forEach((n,i)=>this.scores[i]+=n);
    this.result={winners:results,delta,discarder,draw:false};this.phase=this.round===this.rounds?'matchEnd':'roundEnd';
    this.addLog(`${winners.map(s=>this.name(s)).join(' · ')} ${discarder===null?'쯔모':'론'} 화료`);this.assertCards();
  }
  finishDraw(){this.result={winners:[],delta:[0,0,0,0],draw:true};this.phase=this.round===this.rounds?'matchEnd':'roundEnd';this.addLog('유국 · 점수 이동 없음');}
  nextRound(){if(this.phase!=='roundEnd')return;this.dealer=(this.dealer+3)%4;this.round++;this.startRound();}
  assertCards(){
    const cards=[...this.dora,...this.wall,...this.players.flatMap(p=>[...p.hand,...p.river,...p.melds.flat()])];
    if(cards.length!==108||new Set(cards).size!==108)throw Error('카드 보존 검사에 실패했습니다.');
    if(this.scores.reduce((a,b)=>a+b,0)!==0)throw Error('점수 정산이 일치하지 않습니다.');
  }
}
