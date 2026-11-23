import {Game,typeOf,imageOf,labelOfType,chooseDiscard,chooseClaim} from './engine.js';
const $=selector=>document.querySelector(selector);
let game=new Game(),selected=null,riichiMode=false,hintCard=null,generation=0,aiJob=null,timer=null,requestId=0;
let worker=null;
const pending=new Map();
try{
  worker=new Worker(new URL('./ai-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    const task=pending.get(data.id);if(!task)return;pending.delete(data.id);clearTimeout(task.timer);
    if(data.error)task.reject(Error(data.error));else task.resolve(data.result);
  };
  worker.onerror=()=>{for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('AI 계산을 다시 시도합니다.'));}pending.clear();worker.terminate();worker=null;};
}catch{worker=null;}
function analyze(kind,view,extra={}){
  if(!worker)return Promise.resolve(kind==='claim'?chooseClaim(view,extra.offered,extra.options):chooseDiscard(view));
  return new Promise((resolve,reject)=>{
    const id=++requestId;
    const timeout=setTimeout(()=>{pending.delete(id);reject(Error('AI 응답이 지연되었습니다. 다시 시도하세요.'));},20000);
    pending.set(id,{resolve,reject,timer:timeout});worker.postMessage({id,kind,view,...extra});
  });
}
function cardImage(id,className=''){
  const img=document.createElement('img');img.src=imageOf(id);img.alt=labelOfType(typeOf(id));img.className=className;img.draggable=false;return img;
}
function activeSeat(){return ['humanRon','humanClaim'].includes(game.phase)?0:['aiClaim'].includes(game.phase)?game.pending.seat:game.turn;}
function windLabel(seat){return ['조커','J','Q','K'][game.position(seat)];}
function sortedHand(seat){return game.players[seat].hand.slice().sort((a,b)=>typeOf(a)-typeOf(b)||a-b);}
function meldNode(meld){const div=document.createElement('div');div.className='meld';for(const id of meld)div.append(cardImage(id));return div;}
function renderSeats(){
  for(const seat of [1,2,3]){
    const root=$(`#seat-${seat}`),p=game.players[seat];root.classList.toggle('active',activeSeat()===seat&&!game.result);
    root.replaceChildren();
    const name=document.createElement('div');name.className='player-label';name.innerHTML=`<strong>${game.name(seat)}</strong><span class="wind-chip">${windLabel(seat)}</span>${seat===game.dealer?'<span class="dealer-tag">오야</span>':''}${p.riichi?'<span class="riichi-tag">리치</span>':''}`;root.append(name);
    const backs=document.createElement('div');backs.className='backs';backs.setAttribute('aria-label',`비공개 카드 ${p.hand.length}장`);
    p.hand.forEach((_,i)=>{const img=document.createElement('img');img.src='cards/Card-back.png';img.alt='카드 뒷면';img.className='back-card';img.style.setProperty('--i',i);backs.append(img);});root.append(backs);
    if(p.melds.length){const groups=document.createElement('div');groups.className='melds';for(const meld of p.melds)groups.append(meldNode(meld));root.append(groups);}
  }
  const meta=$('#human-meta');meta.innerHTML=`<strong>나</strong><span class="wind-chip">자풍 ${windLabel(0)}</span>${game.dealer===0?'<span class="dealer-tag">오야</span>':''}<span>${game.players[0].melds.length?'치·퐁 사용':'멘젠 유지'}</span>${game.players[0].riichi?'<span class="riichi-tag">리치</span>':''}`;
  $('#human-melds').replaceChildren(...game.players[0].melds.map(meldNode));
}
function renderRivers(){
  for(let seat=0;seat<4;seat++){
    const root=$(`#river-${seat}`);root.replaceChildren();
    const label=document.createElement('div');label.className='river-label';label.textContent=`${game.name(seat)} 버림패`;root.append(label);
    const cards=document.createElement('div');cards.className='river-cards';
    for(const id of game.players[seat].river){const latest=game.lastDiscard?.id===id;cards.append(cardImage(id,latest?'latest':''));}root.append(cards);
  }
}
function renderHand(){
  const root=$('#human-hand'),p=game.players[0],humanTurn=game.phase==='humanDiscard';
  if(p.riichi&&humanTurn)selected=game.drawn;
  const eligible=riichiMode?game.riichiDiscards(0):[];
  root.replaceChildren();
  for(const id of sortedHand(0)){
    const button=document.createElement('button');button.className='hand-card';
    button.setAttribute('aria-label',`${labelOfType(typeOf(id))}${id===game.drawn&&game.turn===0?' 뽑은 카드':''}`);
    button.setAttribute('aria-pressed',String(selected===id));
    button.classList.toggle('selected',selected===id);button.classList.toggle('hint',hintCard===id);button.classList.toggle('ineligible',riichiMode&&!eligible.includes(id));
    button.classList.toggle('drawn',id===game.drawn&&game.turn===0&&humanTurn);
    button.disabled=!humanTurn||(p.riichi&&id!==game.drawn)||(riichiMode&&!eligible.includes(id));
    button.append(cardImage(id));
    button.onclick=()=>{selected=id;hintCard=null;renderHand();renderActions();};
    button.ondblclick=()=>{if(!button.disabled){selected=id;discardSelected();}};
    root.append(button);
  }
}
function action(text,className,handler,disabled=false){const button=document.createElement('button');button.textContent=text;button.className=className;button.onclick=handler;button.disabled=disabled;$('#actions').append(button);return button;}
function setNotice(message){$('#notice').textContent=message;}
function renderActions(){
  $('#actions').replaceChildren();const message=$('#action-message'),p=game.players[0];
  if(game.phase==='humanDiscard'){
    message.innerHTML=riichiMode?'리치 후 기다릴 카드를 정하려면<br><strong>강조된 카드 중 한 장을 선택하세요.</strong>':p.riichi?'리치 상태입니다.<br>뽑은 패를 버리거나 쯔모하세요.':selected!==null?`<strong>${labelOfType(typeOf(selected))}</strong> 선택됨`:'내 차례입니다.<br>버릴 카드를 선택하세요.';
    if(game.canWin(0))action('쯔모','primary-button',()=>run(()=>game.humanTsumo()));
    if(!p.riichi){
      action('추천','secondary-button',hint);
      const b=action('리치','secondary-button',()=>{riichiMode=!riichiMode;selected=null;hintCard=null;renderHand();renderActions();},!game.riichiDiscards(0).length);b.classList.toggle('toggled',riichiMode);
    }
    action(riichiMode?'리치하고 버리기':'버리기','primary-button',discardSelected,selected===null);
  }else if(game.phase==='humanRon'){
    message.innerHTML=`${game.name(game.offer.from)}의 <strong>${labelOfType(typeOf(game.offer.id))}</strong>로 화료할 수 있어요.`;
    action('넘기기','secondary-button',()=>run(()=>game.humanRon(false)));action('론','primary-button',()=>run(()=>game.humanRon(true)));
  }else if(game.phase==='humanClaim'){
    const actionName=game.pending.chi?'치':'퐁';message.innerHTML=`<strong>${labelOfType(typeOf(game.offer.id))}</strong>를 가져와 ${actionName}할 수 있어요.`;
    action('넘기기','secondary-button',()=>run(()=>game.resolveClaim(null)));
    game.pending.options.forEach(meld=>action(`${actionName} · ${meld.map(t=>labelOfType(t).replace(/검정|빨강/g,'')).join(' ')}`,'primary-button',()=>run(()=>game.resolveClaim(meld))));
  }else if(game.result){message.textContent=game.result.draw?'중앙 카드를 모두 사용했습니다.':'세트가 끝났습니다.';action('결과 보기','primary-button',showResult);}
  else{message.textContent=`${game.name(activeSeat())}의 차례입니다.`;const wait=action('생각 중','secondary-button',()=>{},true);wait.classList.add('busy');}
}
function renderSidebar(){
  const doraCounts=Array(27).fill(0);game.dora.forEach(id=>doraCounts[typeOf(id)]++);
  $('#dora-cards').replaceChildren(...game.dora.map(id=>{const d=document.createElement('div');d.className='dora-item';d.append(cardImage(id));const count=doraCounts[typeOf(id)];if(count>1){const mult=document.createElement('span');mult.className='dora-mult';mult.textContent=`${count}배`;d.append(mult);}return d;}));
  $('#score-list').replaceChildren(...[0,1,2,3].map(seat=>{const row=document.createElement('div');row.className=`score-row ${seat===0?'me':''}`;row.innerHTML=`<div class="score-person"><span class="score-name">${game.name(seat)}</span><span class="score-role">${seat===game.dealer?'오야':'자'} · 자풍 ${windLabel(seat)}</span></div><strong class="score-number">${game.scores[seat]>0?'+':''}${game.scores[seat]}</strong>`;return row;}));
  $('#game-log').replaceChildren(...game.log.slice(-7).map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));$('#game-log').scrollTop=$('#game-log').scrollHeight;
}
function render(){
  $('#round-label').textContent=`${game.round} / ${game.rounds} 세트`;$('#dealer-label').textContent=`${game.name(game.dealer)} 오야`;
  $('#wall-count').textContent=game.wall.length;
  const status=game.phase==='humanRon'?'론을 선언하세요':game.phase==='humanClaim'?'버림패를 가져올까요?':game.result?(game.result.draw?'유국':'화료'):activeSeat()===0?'내 차례':`${game.name(activeSeat())} 생각 중`;
  $('#turn-status').textContent=status;$('#turn-status').classList.toggle('busy',!game.result&&activeSeat()!==0);
  $('#last-discard').textContent=game.lastDiscard?`${game.name(game.lastDiscard.seat)} · ${labelOfType(typeOf(game.lastDiscard.id))}`:'첫 카드를 기다리는 중';
  renderSeats();renderRivers();renderHand();renderActions();renderSidebar();
}
function resetSelection(){selected=null;hintCard=null;riichiMode=false;setNotice('');}
function run(operation){try{operation();resetSelection();pump();}catch(error){setNotice(error.message);}}
function discardSelected(){if(selected===null)return;run(()=>game.discard(selected,riichiMode));}
async function hint(){
  if(game.phase!=='humanDiscard')return;
  const capturedGame=game,handKey=game.players[0].hand.join(',');setNotice('공개 정보로 추천 카드를 계산하고 있어요.');
  try{
    const choice=await analyze('discard',game.observation(0));
    if(game!==capturedGame||game.phase!=='humanDiscard'||handKey!==game.players[0].hand.join(','))return;
    hintCard=game.players[0].hand.find(id=>typeOf(id)===choice.tile);selected=hintCard;riichiMode=false;
    setNotice(choice.retained<0?'현재 공개 몸통으로는 화료 조건을 충족할 수 없습니다.':`추천 ${labelOfType(choice.tile)} · 완성까지 필요한 카드 ${11-choice.retained}장 · 공개 정보 기준 유효패 ${choice.effective}장`);
    renderHand();renderActions();
  }catch(error){setNotice(error.message);}
}
function pump(){
  clearTimeout(timer);render();
  if(game.result){showResult();return;}
  if(game.phase==='draw'){
    const current=generation;
    timer=setTimeout(()=>{if(current!==generation)return;run(()=>game.drawTurn());},280);return;
  }
  if(!['aiDiscard','aiClaim'].includes(game.phase)||aiJob)return;
  const currentJob={},currentGame=game,phase=game.phase;aiJob=currentJob;
  timer=setTimeout(async()=>{
    try{
      const seat=phase==='aiClaim'?game.pending.seat:game.turn;
      const view=game.observation(seat);
      const extra=phase==='aiClaim'?{offered:typeOf(game.offer.id),options:game.pending.options}:{};
      const choice=await analyze(phase==='aiClaim'?'claim':'discard',view,extra);
      if(aiJob!==currentJob||game!==currentGame)return;
      aiJob=null;
      run(()=>phase==='aiClaim'?game.resolveClaim(choice):game.aiDiscard(choice));
    }catch(error){
      if(aiJob!==currentJob||game!==currentGame)return;
      aiJob=null;setNotice(error.message);
      $('#actions').replaceChildren();action('다시 계산','primary-button',()=>pump());
    }
  },420);
}
function showResult(){
  if(!game.result||$('#result-dialog').open)return;
  const {winners,delta,discarder,draw}=game.result,root=$('#result-content');root.replaceChildren();
  const heading=document.createElement('div');heading.innerHTML=`<p class="result-kicker">${game.round}세트 결과</p><h2 class="result-title">${draw?'유국':winners.length>1?`동시 론 · ${winners.length}명`:discarder===null?'쯔모 화료':'론 화료'}</h2><p class="result-caption">${draw?'점수 이동 없이 다음 세트로 진행합니다.':discarder===null?'다른 플레이어들이 점수를 나눠 부담합니다.':`${game.name(discarder)}가 화료자 모두의 점수를 부담합니다.`}</p>`;root.append(heading);
  for(const winner of winners){
    const section=document.createElement('div');section.className='winner-result';section.innerHTML=`<div class="winner-name"><span>${game.name(winner.seat)}${winner.seat===game.dealer?' · 오야':''}</span><strong>+${winner.delta[winner.seat]}점</strong></div>`;
    const cards=document.createElement('div');cards.className='winner-cards';winner.cards.slice().sort((a,b)=>typeOf(a)-typeOf(b)).forEach(id=>cards.append(cardImage(id)));section.append(cards);
    const details=document.createElement('p');details.className='winner-detail';details.textContent=`화료 점수 ${winner.score}점 · 도라 가산 ${winner.bonus}개 · ${winner.closed?'멘젠 1.5배':'치·퐁 사용'}${winner.riichi?' · 리치 +30점':''}`;section.append(details);root.append(section);
  }
  const scores=document.createElement('div');scores.className='result-scores';scores.innerHTML=[0,1,2,3].map(seat=>`<div><span>${game.name(seat)}</span><strong class="${delta[seat]>0?'positive':delta[seat]<0?'negative':''}">${delta[seat]>0?'+':''}${delta[seat]}</strong><span>누적 ${game.scores[seat]}</span></div>`).join('');root.append(scores);
  const buttons=document.createElement('div');buttons.className='dialog-buttons';const button=document.createElement('button');button.className='primary-button';button.textContent=game.phase==='matchEnd'?'새 게임 시작':'다음 세트';button.onclick=()=>{$('#result-dialog').close();if(game.phase==='matchEnd')newGame();else run(()=>game.nextRound());};buttons.append(button);root.append(buttons);$('#result-dialog').showModal();
}
function newGame(){generation++;clearTimeout(timer);aiJob=null;game=new Game();resetSelection();pump();}
$('#rules-button').onclick=()=>$('#rules-dialog').showModal();$('#close-rules').onclick=()=>$('#rules-dialog').close();
$('#dora-help').onclick=()=>{$('#rules-dialog').showModal();$('#rules-dialog h3:nth-of-type(5)')?.scrollIntoView();};
$('#new-button').onclick=()=>$('#new-dialog').showModal();$('#cancel-new').onclick=()=>$('#new-dialog').close();$('#confirm-new').onclick=()=>{$('#new-dialog').close();if($('#result-dialog').open)$('#result-dialog').close();newGame();};
document.addEventListener('keydown',event=>{if(event.key==='Enter'&&!document.querySelector('dialog[open]')&&game.phase==='humanDiscard'&&selected!==null&&event.target===document.body)discardSelected();});
pump();
