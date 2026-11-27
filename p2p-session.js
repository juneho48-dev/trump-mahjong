import {HostMatch,NetworkView,PROTOCOL} from './multiplayer.js?v=3';
const PREFIX='trump-mahjong-v3-';
const token=()=>crypto.randomUUID();
export class P2PSession{
  constructor(onChange){
    this.onChange=onChange;this.ready=false;this.role=null;this.code='';this.seat=0;this.peer=null;this.connection=null;
    this.connections=new Map();this.tokens=new Map();this.roster=Array.from({length:4},()=>({kind:'ai',connected:true}));
    this.view=null;this.match=null;this.busy=false;this.closed=false;this.message='';this.retries=0;this.retryTimer=null;
  }
  emit(message){if(message!==undefined)this.message=message;this.onChange?.(this);}
  makePeer(id){
    if(!globalThis.Peer)throw Error('통신 모듈을 불러오지 못했습니다. vendor 폴더를 확인하세요.');
    const peer=new Peer(id,{debug:0,config:{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]}});
    this.peer=peer;
    peer.on('error',error=>{if(this.closed)return;this.emit(error.type==='peer-unavailable'?'방을 찾지 못했습니다. 방 코드와 방장 접속을 확인하세요.':`연결 오류: ${error.type}. 다른 네트워크에서 다시 시도하세요.`);});
    peer.on('disconnected',()=>{if(!this.closed&&!peer.destroyed)setTimeout(()=>{if(peer.disconnected&&!this.closed)peer.reconnect();},1500);});
    return peer;
  }
  host(){
    this.role='host';const bytes=crypto.getRandomValues(new Uint8Array(10)),alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    this.code=[...bytes].map(b=>alphabet[b%32]).join('');this.roster[0]={kind:'human',connected:true};
    const peer=this.makePeer(PREFIX+this.code);this.emit('방을 만들고 있습니다…');
    peer.on('open',()=>{this.ready=true;this.emit('방 코드를 친구에게 보내세요. 참가 후 게임 시작을 누르세요.');});
    peer.on('connection',connection=>this.accept(connection));
  }
  join(code){
    this.role='guest';this.seat=null;this.code=code.toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!/^[A-Z0-9]{10}$/.test(this.code))throw Error('10자리 방 코드를 입력하세요.');
    const key='trump-mahjong-token-'+this.code;
    try{this.token=sessionStorage.getItem(key)||token();sessionStorage.setItem(key,this.token);}catch{this.token=token();}
    const peer=this.makePeer(PREFIX+'guest-'+token());this.emit('신호 교환 서버에 연결하고 있습니다…');peer.on('open',()=>{this.emit('방장에게 직접 연결하고 있습니다…');this.connect();});
  }
  send(connection,data){if(connection?.open)connection.send({protocol:PROTOCOL,...data});}
  valid(data){return data&&typeof data==='object'&&data.protocol===PROTOCOL&&JSON.stringify(data).length<60000;}
  accept(connection){
    let seat=null,welcomed=false;
    const helloTimer=setTimeout(()=>{if(!welcomed)connection.close();},60000);
    connection.on('data',data=>{
      if(!this.valid(data))return;
      if(!welcomed){
        if(data.kind!=='hello'||typeof data.token!=='string'||data.token.length>100)return;
        seat=this.tokens.get(data.token);
        if(seat===undefined){
          if(this.match){this.send(connection,{kind:'reject',message:'이미 시작한 방입니다. 기존 참가자만 재접속할 수 있습니다.'});return;}
          seat=this.roster.findIndex((m,i)=>i>0&&m.kind==='ai');
        }
        if(seat<1||this.connections.get(seat)?.open){this.send(connection,{kind:'reject',message:'빈자리가 없거나 같은 참가자가 이미 접속해 있습니다.'});return;}
        welcomed=true;clearTimeout(helloTimer);this.tokens.set(data.token,seat);this.connections.set(seat,connection);
        this.roster[seat]={kind:'human',connected:true};this.send(connection,{kind:'welcome',seat});
        if(this.match)this.match.changed();else this.broadcast();this.emit('참가자가 연결되었습니다.');return;
      }
      if(data.kind==='action'&&this.connections.get(seat)===connection){
        try{this.match?.apply(seat,data);this.send(connection,{kind:'ack',id:data.id});}
        catch(error){this.send(connection,{kind:'state',snapshot:this.match.snapshot(seat)});this.send(connection,{kind:'ack',id:data.id,error:error.message});}
      }
    });
    connection.on('close',()=>{
      clearTimeout(helloTimer);if(!welcomed||this.closed||this.connections.get(seat)!==connection)return;
      this.connections.delete(seat);
      if(this.match){this.roster[seat].connected=false;this.match.changed();this.emit('참가자 연결이 끊겨 게임을 잠시 멈췄습니다.');}
      else{this.roster[seat]={kind:'ai',connected:true};for(const [key,value]of this.tokens)if(value===seat)this.tokens.delete(key);this.broadcast();this.emit('참가자가 나갔습니다.');}
    });
    connection.on('error',()=>{});
  }
  connect(){
    if(this.closed||this.connection?.open)return;
    if(!this.peer?.open)return this.emit('신호 교환 서버 연결을 기다리고 있습니다.');
    const connection=this.peer.connect(PREFIX+this.code,{reliable:true,serialization:'json'});this.connection=connection;let welcomed=false;
    clearTimeout(this.retryTimer);
    const attempt=setTimeout(()=>{if(!welcomed){if(this.connection===connection)this.connection=null;connection.close();this.emit('직접 연결이 지연됩니다. 다른 네트워크가 필요할 수 있습니다.');this.retry();}},45000);
    connection.on('open',()=>{this.send(connection,{kind:'hello',token:this.token});});
    connection.on('data',data=>{
      if(!this.valid(data)||this.connection!==connection)return;
      if(data.kind==='welcome'){welcomed=true;clearTimeout(attempt);this.seat=data.seat;this.retries=0;this.busy=false;this.emit('연결되었습니다.');}
      else if(data.kind==='lobby'){this.roster=data.roster;this.emit('방장이 게임을 시작할 때까지 기다리세요.');}
      else if(data.kind==='state'){this.roster=data.snapshot.roster;this.update(data.snapshot);}
      else if(data.kind==='ack'){if(data.id===this.actionId){this.busy=false;clearTimeout(this.actionTimer);this.emit(data.error||'');}}
      else if(data.kind==='reject'){this.closed=true;this.busy=false;clearTimeout(this.retryTimer);this.emit(data.message);connection.close();this.peer.destroy();}
    });
    connection.on('close',()=>{clearTimeout(attempt);if(this.connection!==connection||this.closed)return;this.busy=true;this.emit('연결이 끊겼습니다. 방장에게 재접속하는 중…');this.retry();});
    connection.on('error',()=>{});
  }
  retry(){
    if(this.closed)return;clearTimeout(this.retryTimer);
    if(this.retries++<10)this.retryTimer=setTimeout(()=>this.connect(),2000);
    else{this.busy=true;this.emit('자동 재접속을 마쳤습니다. 방장 접속을 확인하고 재접속을 누르세요.');}
  }
  reconnect(){this.retries=0;if(this.closed)return this.emit('방에서 나간 뒤 다시 참가하세요.');this.connect();}
  update(snapshot){if(this.view)this.view.update(snapshot);else this.view=new NetworkView(this,snapshot);this.emit();}
  broadcast(){
    if(this.match){for(const[seat,connection]of this.connections)this.send(connection,{kind:'state',snapshot:this.match.snapshot(seat)});this.update(this.match.snapshot(0));}
    else{for(const connection of this.connections.values())this.send(connection,{kind:'lobby',roster:this.roster});this.emit();}
  }
  start(){
    if(this.role!=='host'||this.match)return;
    if(!this.ready||this.peer.disconnected)throw Error('방 연결이 준비될 때까지 기다리세요.');
    this.match=new HostMatch({roster:this.roster,onState:()=>this.broadcast()});try{this.match.start();}catch(error){this.match.close();this.match=null;throw error;}
  }
  act(action){
    if(this.busy||this.closed)return;
    if(!this.view)return this.emit('대기실에서 먼저 게임을 시작하세요.');
    const snapshot=this.view.snapshot;
    const packet={kind:'action',id:token(),epoch:snapshot.epoch,revision:snapshot.revision,offerId:snapshot.offer?.id,action};
    if(this.role==='host'){try{this.match.apply(0,packet);this.emit('');}catch(error){this.emit(error.message);}return;}
    if(!this.connection?.open)return this.emit('방장과의 연결을 기다리세요.');
    this.busy=true;this.actionId=packet.id;this.send(this.connection,packet);this.emit('');
    this.actionTimer=setTimeout(()=>{this.busy=false;this.emit('응답이 지연되었습니다. 연결 상태를 확인하세요.');},10000);
  }
  replace(seat){for(const[key,value]of this.tokens)if(value===seat)this.tokens.delete(key);this.match.replaceDisconnected(seat);}
  close(){this.closed=true;clearTimeout(this.retryTimer);clearTimeout(this.actionTimer);this.match?.close();for(const c of this.connections.values())c.close();this.connection?.close();this.peer?.destroy();}
}
