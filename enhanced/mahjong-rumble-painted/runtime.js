import {createMahjongAudio} from './audio.js';
const VERSION='mahjong-painted-20261126-v1';
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const TAU=Math.PI*2;
const media=matchMedia('(prefers-reduced-motion: reduce)');
const storage={read(k,f){try{return localStorage.getItem('mr-'+k)??f}catch{return f}},write(k,v){try{localStorage.setItem('mr-'+k,String(v))}catch{}}};
const state={version:VERSION,ready:false,reducedMotion:storage.read('motion',media.matches?'1':'0')==='1',muted:storage.read('muted','0')==='1',decorativeTime:0,time:0,frameCount:0,loaded:[],errors:[],eventCounts:{},events:[],articulationSamples:[],textureUpdates:0};
const images={},tiles=new Map(),effects=[];
let A,audio,music,musicGain,sceneIdentity,lastAudioUnlock=false;
let presentationTextureSerial=0;
const sourceDecorOverrides=[],spineDisplayClocks=new WeakMap();
const fx=document.createElement('canvas');fx.id='mahjong-fx';fx.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';document.body.appendChild(fx);const f=fx.getContext('2d');
function record(event,detail={}){state.eventCounts[event]=(state.eventCounts[event]||0)+1;state.events.push({event,t:+state.time.toFixed(4),audioTime:A?.context?.currentTime??null,...detail});if(state.events.length>160)state.events.shift()}
function err(e){const s=String(e);if(!state.errors.includes(s))state.errors.push(s)}
function setReducedMotion(v){state.reducedMotion=Boolean(v);effects.length=0;storage.write('motion',state.reducedMotion?'1':'0');for(const t of tiles.values())t.key='';refreshSettings();return state.reducedMotion}
function setMuted(v){state.muted=Boolean(v);storage.write('muted',state.muted?'1':'0');audio?.setMuted(state.muted);if(A)A.sound.isAudioMute=state.muted;if(musicGain&&A.context)musicGain.gain.setTargetAtTime(state.muted?0:.115,A.context.currentTime,.02);refreshSettings();return state.muted}
function diagnostics(){return {...state,loaded:[...state.loaded],errors:[...state.errors],eventCounts:{...state.eventCounts},events:state.events.slice(),articulationSamples:state.articulationSamples.slice(-40),tiles:tiles.size,effects:effects.length,audio:audio?.diagnostics()??null,gameplayRandomUntouched:true}}
window.__mahjongPresentation={get ready(){return state.ready},beforeRender(){},afterRender(){},diagnostics,setReducedMotion,setMuted,get audio(){return audio}};

// Settings live in the otherwise empty side margin, outside tile and CTA targets.
const settings=document.createElement('div');settings.className='mr-settings';settings.innerHTML='<button class="mr-settings-open" aria-label="Sound and motion settings" title="Sound and motion settings">⚙</button><div class="mr-settings-panel" hidden><strong>Playback settings</strong><button class="mr-sound"></button><button class="mr-motion"></button></div>';
const css=document.createElement('style');css.textContent='.mr-settings{position:fixed;right:8px;bottom:62px;z-index:5;font:13px/1.3 Arial,sans-serif;color:#f7f1dd}.mr-settings button{font:inherit;color:inherit;cursor:pointer;border:1px solid #829b8b;background:#113b32}.mr-settings-open{width:29px;height:29px;border-radius:50%;opacity:.76;font-size:18px!important}.mr-settings-open:hover,.mr-settings-open:focus-visible{opacity:1}.mr-settings-panel{position:absolute;right:0;bottom:38px;width:176px;padding:13px;border-radius:12px;background:#092c26;box-shadow:0 5px 20px #0008}.mr-settings-panel strong{display:block;margin-bottom:9px}.mr-settings-panel button{display:block;border-radius:7px;width:100%;padding:8px;margin-top:6px;text-align:left}.mr-settings [hidden]{display:none}';document.head.appendChild(css);document.body.appendChild(settings);
settings.addEventListener('pointerdown',e=>e.stopPropagation());settings.querySelector('.mr-settings-open').onclick=()=>{const panel=settings.querySelector('.mr-settings-panel');panel.hidden=!panel.hidden};settings.querySelector('.mr-sound').onclick=()=>{audio?.unlock();setMuted(!state.muted)};settings.querySelector('.mr-motion').onclick=()=>setReducedMotion(!state.reducedMotion);
function refreshSettings(){settings.querySelector('.mr-sound').textContent=state.muted?'Sound: off':'Sound: on';settings.querySelector('.mr-sound').setAttribute('aria-pressed',String(!state.muted));settings.querySelector('.mr-motion').textContent=state.reducedMotion?'Motion: reduced':'Motion: full';settings.querySelector('.mr-motion').setAttribute('aria-pressed',String(state.reducedMotion))}refreshSettings();
media.addEventListener('change',e=>setReducedMotion(e.matches));document.addEventListener('visibilitychange',()=>{effects.length=0});
function round(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function fit(ctx,img,x,y,w,h){const s=Math.min(w/img.width,h/img.height),iw=img.width*s,ih=img.height*s;ctx.drawImage(img,x+(w-iw)/2,y+(h-ih)/2,iw,ih)}
function part(ctx,img,x,y,w,h,px,py,angle=0,sx=1,sy=1){ctx.save();ctx.translate(px,py);ctx.rotate(angle);ctx.scale(sx,sy);ctx.drawImage(img,x-px,y-py,w,h);ctx.restore()}
function texture(canvas,key){
 // Three's Texture and Source constructors allocate UUIDs from Math.random.
 // Copy a loaded texture's structure instead, keeping the source random stream
 // completely untouched and giving this canvas its own GPU/source identity.
 const template=Object.values(A.textures).find(t=>t?.isTexture&&t.source);
 if(!template)throw Error('No loaded texture is available for presentation art');
 const serial=++presentationTextureSerial,descriptors=Object.getOwnPropertyDescriptors(template);
 delete descriptors.id;delete descriptors._listeners;
 const t=Object.create(Object.getPrototypeOf(template));Object.defineProperties(t,descriptors);
 Object.defineProperty(t,'id',{value:-serial});t.uuid=`mr-presentation-texture-${serial}`;
 const sourceDescriptors=Object.getOwnPropertyDescriptors(template.source);delete sourceDescriptors.id;
 const source=Object.create(Object.getPrototypeOf(template.source));Object.defineProperties(source,sourceDescriptors);
 Object.defineProperty(source,'id',{value:-serial});source.uuid=`mr-presentation-source-${serial}`;source.data=canvas;source.dataReady=true;source.version=0;t.source=source;
 for(const name of ['offset','repeat','center','matrix'])if(template[name]?.clone)t[name]=template[name].clone();
 t.mipmaps=[];t.updateRanges=[];t.userData={};t.version=0;t.onUpdate=null;t.isCanvasTexture=true;
 t.flipY=false;t.generateMipmaps=false;t.minFilter=t.magFilter=A.filter;t.premultiplyAlpha=false;t.image_w=canvas.width;t.image_h=canvas.height;t.needsUpdate=true;A.textures[key]=t;return t
}
function world(node){const p=node.convertToWorldSpaceAR({x:0,y:0});return{x:innerWidth/2+p.x*A.layout.scale,y:innerHeight/2-p.y*A.layout.scale}}
function play(name,node,strength=1){if(!state.muted&&!A.sound.isAudioMute)audio?.play(name,{x:node?clamp(world(node).x/innerWidth*2-1,-1,1):0,strength})}
function wrap(game,name,fn){const original=game[name];if(!original||original._mrWrapped)return;const w=function(...args){return fn.call(this,original,args)};w._mrWrapped=true;game[name]=w}
function attachHooks(){const g=A.game;if(sceneIdentity===g.cardLayer)return;sceneIdentity=g.cardLayer;effects.length=0;for(const t of tiles.values())t.tex.dispose();tiles.clear();audio?.stop();
 wrap(g,'onCreateLight',function(original,args){const node=args[0],r=original.apply(this,args),tile=tiles.get(node);if(tile){tile.selectedAt=state.time;tile.badAt=-100;tile.key=''}record('select',{id:tile?.id,type:node.name});play('tap',node);return r});
 wrap(g,'onError',function(original,args){const nodes=this.selectBoxArr.slice();for(const node of nodes){const tile=tiles.get(node);if(tile){tile.badAt=state.time;tile.key=''}}record('mismatch',{types:nodes.map(n=>n.name)});play('mismatch',nodes.at(-1));return original.apply(this,args)});
 wrap(g,'onSuccess',function(original,args){const nodes=this.selectBoxArr.slice();record('match',{ids:nodes.map(n=>tiles.get(n)?.id),types:nodes.map(n=>n.name),match:this.matchCount+1});for(const node of nodes){const t=tiles.get(node);if(t){t.selectedAt=state.time-.10;t.key=''}effects.push({type:'match',at:state.time,p:world(node),target:world(this.moneyLabel.node),index:effects.length%3})}play('match',nodes[1]);return original.apply(this,args)});
 wrap(g,'onAddMoney',function(original,args){if(args[0]===this.moneyLabel){record('winnings',{amount:args[1]});play('winnings',this.moneyLabel.node);effects.push({type:'arrival',at:state.time,p:world(this.moneyLabel.node)})}return original.apply(this,args)});
 wrap(g,'showOverScene',function(original,args){if(!this.isShowOver){record('adComplete',{matches:this.matchCount});effects.length=0;play('final');effects.push({type:'final',at:state.time,p:{x:innerWidth/2,y:innerHeight*.28}})}return original.apply(this,args)});
 if(state.ready)installTiles();
}
function installTiles(){for(const [id,node]of Object.entries(A.nodes)){if(!node.isCard||!node.sprite||tiles.has(node))continue;const canvas=document.createElement('canvas');canvas.width=200;canvas.height=248;const key=`mr-tile-${id}`;const tex=texture(canvas,key),uuid=`mr-frame-${id}`;A.assets.frames[uuid]={name:key,tex:key,rect:[0,0,200,248],offset:[0,0],orig:[200,248]};node.sprite.frame=uuid;const t={id:+id,node,canvas,ctx:canvas.getContext('2d'),tex,key:'',selectedAt:-100,badAt:-100,landAt:-100,lastY:node.y,moving:false,still:0,phase:(+id*1.618)%13};tiles.set(node,t);drawTile(t,0,0,false)}}
function pulse(age,duration=.74){return age>=0&&age<duration?Math.sin(Math.PI*age/duration)**2:0}
function drawTile(t,p,idle,selected){const c=t.ctx;c.clearRect(0,0,200,248);c.drawImage(images.tile,0,0,200,248);
 const errorAge=state.time-t.badAt,bad=errorAge>=0&&errorAge<.36;let q=p+idle*.35;if(state.reducedMotion)q=0;
 // All art moves within the unchanged logical tile. No hit-area or rule transforms.
 c.save();
 switch(t.node.name){
  case 'card':{
   const wing=-.46*q,crest=.16*q;
   part(c,images['bird-crest'],70,27,86,48,80,48,crest);
   c.drawImage(images['bird-body'],39,47,123,174);
   part(c,images['bird-wing'],97,83,61,97,111,99,wing,1+q*.05,1);
   if(q>.15&&state.frameCount%12===0){state.articulationSamples.push({id:t.id,t:+state.time.toFixed(3),wing:+wing.toFixed(3),crest:+crest.toFixed(3),anchor:[111,99]});if(state.articulationSamples.length>80)state.articulationSamples.shift()}
   break;
  }
  case 'K':{
   // Five independent painted petals hinge around the fixed flower centre.
   const im=images.flower,sz=146,x=27,y=53,cx=100,cy=126;
   for(let k=0;k<5;k++){const a=-Math.PI/2+k*TAU/5,spread=q*3.8*Math.sin(k*.8+1.1);c.save();c.translate(Math.cos(a)*spread,Math.sin(a)*spread);c.translate(cx,cy);c.rotate(q*.055*Math.sin(k+1));c.translate(-cx,-cy);c.beginPath();c.moveTo(cx,cy);c.arc(cx,cy,110,a-Math.PI/5-.015,a+Math.PI/5+.015);c.closePath();c.clip();c.drawImage(im,x,y,sz,sz);c.restore()}
   c.save();c.beginPath();c.arc(cx,cy,22,0,TAU);c.clip();c.drawImage(im,x,y,sz,sz);c.restore();break;
  }
  case 'C':{
   const im=images.bamboo;const boxes=[[0,0,.34,.50],[.66,0,.34,.50],[.34,.23,.32,.54],[0,.50,.34,.50],[.66,.50,.34,.50]];
   for(let k=0;k<boxes.length;k++){const [x,y,w,h]=boxes[k],dx=41+x*118,dy=43+y*160,dw=w*118,dh=h*160;const a=q*.075*Math.sin(k*1.7+1);c.save();c.translate(dx+dw*.5,dy+dh);c.rotate(a);c.drawImage(im,x*im.width,y*im.height,w*im.width,h*im.height,-dw*.5,-dh,dw,dh);c.restore()}break;
  }
  case 'A':{
   const im=images.dots;for(let r=0;r<3;r++)for(let col=0;col<3;col++){const k=r*3+col,pp=state.reducedMotion?0:pulse(state.time-t.selectedAt-k*.035,.38),sz=43*(1+pp*.12);c.drawImage(im,col*im.width/3,r*im.height/3,im.width/3,im.height/3,36+col*43+(43-sz)/2,58+r*47+(43-sz)/2,sz,sz)}break;
  }
  default:fit(c,images.fa,29,43,143,166);
 }
 c.restore();
 if(selected){c.save();c.shadowColor='#a7ffe0';c.shadowBlur=12;round(c,7,5,186,235,26);c.strokeStyle='#c8ffdd';c.lineWidth=4;c.stroke();c.restore();}
 if(bad){c.save();const a=state.reducedMotion?.85:Math.min(1,(.36-errorAge)*6);round(c,7,5,186,235,26);c.strokeStyle=`rgba(182,48,37,${a})`;c.lineWidth=6;c.stroke();c.fillStyle=`rgba(111,16,10,${.13*a})`;c.fill();c.lineCap='round';c.strokeStyle=`rgba(250,225,188,${a})`;c.lineWidth=6;c.beginPath();c.moveTo(78,106);c.lineTo(122,150);c.moveTo(122,106);c.lineTo(78,150);c.stroke();c.restore()}
 const land=pulse(state.time-t.landAt,.24);if(land&&!state.reducedMotion){c.save();c.globalAlpha=land*.55;c.strokeStyle='#fff3b9';c.lineWidth=3;c.beginPath();c.moveTo(32,232);c.quadraticCurveTo(100,240,168,232);c.stroke();c.restore()}
 t.tex.needsUpdate=true;state.textureUpdates++;
}
function updateTiles(){const selected=new Set(A.game.selectBoxArr||[]);let contacts=[];
 for(const t of tiles.values()){const n=t.node;if(!n.isValid||n._destroyed)continue;
  const dy=n.y-t.lastY;if(Math.abs(dy)>.03){t.moving=true;t.still=0}else if(t.moving&&++t.still>=1){t.moving=false;t.landAt=state.time;contacts.push(n)}t.lastY=n.y;
  const age=state.time-t.selectedAt,p=state.reducedMotion?0:pulse(age),local=(state.decorativeTime+t.phase)%13,idle=local<.82?pulse(local,.82):0;
  const bad=Math.max(0,.36-(state.time-t.badAt)),land=Math.max(0,.24-(state.time-t.landAt));const isSelected=selected.has(n);
  const key=[Math.round(p*100),Math.round(idle*100),Math.round(bad*100),Math.round(land*100),isSelected,state.reducedMotion].join(',');
  if(key!==t.key){drawTile(t,p,idle,isSelected);t.key=key}
 }
 if(contacts.length){record('contact',{count:contacts.length});play('settle',contacts[Math.floor(contacts.length/2)],Math.min(1,.65+contacts.length*.04))}
}
function drawFX(){const dpr=Math.min(devicePixelRatio||1,2),w=innerWidth,h=innerHeight;if(fx.width!==Math.round(w*dpr)||fx.height!==Math.round(h*dpr)){fx.width=Math.round(w*dpr);fx.height=Math.round(h*dpr)}f.setTransform(dpr,0,0,dpr,0,0);f.clearRect(0,0,w,h);
 for(let i=effects.length-1;i>=0;i--){const e=effects[i],age=state.time-e.at;if(age>1.5){effects.splice(i,1);continue}if(state.reducedMotion)continue;
  if(e.type==='match'){
   const p=clamp(age/.52);if(age<.42){const a=1-age/.42;f.save();f.strokeStyle=`rgba(243,232,169,${a*.9})`;f.lineWidth=2;f.beginPath();f.arc(e.p.x,e.p.y,12+age*45,0,TAU);f.stroke();f.restore()}
   if(p<1){const sx=e.p.x,sy=e.p.y,tx=e.target.x,ty=e.target.y;const point=u=>{const v=1-u,cx=(sx+tx)/2+(e.index-1)*35,cy=sy-110;return{x:v*v*sx+2*v*u*cx+u*u*tx,y:v*v*sy+2*v*u*cy+u*u*ty}};const now=point(p);f.save();f.lineCap='round';f.strokeStyle='rgba(237,226,160,.7)';f.lineWidth=2.5;f.beginPath();for(let j=0;j<=10;j++){const z=point(Math.max(0,p-.12)+j/10*Math.min(p,.12));j?f.lineTo(z.x,z.y):f.moveTo(z.x,z.y)}f.stroke();const g=f.createRadialGradient(now.x,now.y,0,now.x,now.y,9);g.addColorStop(0,'#fffbe9');g.addColorStop(.35,'#efdfa1b0');g.addColorStop(1,'#efdfa100');f.fillStyle=g;f.fillRect(now.x-9,now.y-9,18,18);f.restore()}
  }else if(e.type==='arrival'&&age<.36){f.save();f.strokeStyle=`rgba(255,235,168,${(1-age/.36)*.7})`;f.lineWidth=2;f.beginPath();f.ellipse(e.p.x,e.p.y,35+age*30,16+age*15,0,0,TAU);f.stroke();f.restore()}
  else if(e.type==='final'&&age<1.15){f.save();f.globalAlpha=Math.sin(Math.PI*age/1.15)*.65;for(let k=0;k<10;k++){const a=k/10*TAU,rad=40+age*80,x=e.p.x+Math.cos(a)*rad,y=e.p.y+Math.sin(a)*rad;f.fillStyle=k%2?'#ead49c':'#d1eee1';f.beginPath();f.ellipse(x,y,3,7,a,0,TAU);f.fill()}f.restore()}
 }
}
function restoreSourceDecor(){
 for(let i=sourceDecorOverrides.length-1;i>=0;i--){const item=sourceDecorOverrides[i];if(item.sk){item.sk.time=item.time;item.sk.apply();item.sk.updateWorldTransform()}else{item.node.scaleX=item.scaleX;item.node.scaleY=item.scaleY}}
 sourceDecorOverrides.length=0;
}
function renderSourceDecor(dt){
 // Only the rendered pose is changed. Source animation time and CTA hit-area
 // transforms are restored immediately after the renderer has consumed them.
 const hand=A.nodes[47],sk=hand?.spine?.sk;
 if(sk){let display=spineDisplayClocks.get(sk);if(!display){display={time:sk.time};spineDisplayClocks.set(sk,display)}else if(!state.reducedMotion&&!document.hidden)display.time+=clamp(dt,0,.10);
  sourceDecorOverrides.push({sk,time:sk.time});sk.time=display.time;sk.apply();sk.updateWorldTransform();
 }
 if(state.reducedMotion)for(const id of [57,58]){const node=A.nodes[id];if(!node)continue;sourceDecorOverrides.push({node,scaleX:node.scaleX,scaleY:node.scaleY});node.scaleX=node.scaleY=1}
}
async function boot(){while(!window.__MR)await new Promise(r=>setTimeout(r,10));A=window.__MR;await A.ready;
 if(A.context){audio=createMahjongAudio(A.context);audio.setMuted(state.muted);musicGain=A.context.createGain();musicGain.gain.value=state.muted?0:.115;musicGain.connect(A.context.destination)}
 document.addEventListener('pointerdown',()=>{lastAudioUnlock=true;audio?.unlock()},{passive:true});
 A.stopMusic();A.sound.playSound=()=>{};A.sound.playBGM=function(){if(music){try{music.stop()}catch{}}if(A.context&&A.audioBuffers.bgm){music=A.context.createBufferSource();music.buffer=A.audioBuffers.bgm;music.loop=true;music.connect(musicGain);music.start();this.bgmPlaying=true}};A.sound.isAudioMute=state.muted;
 attachHooks();
 window.__mahjongPresentation.beforeRender=dt=>{try{restoreSourceDecor();state.frameCount++;if(!document.hidden){state.time+=Math.max(0,dt);if(!state.reducedMotion)state.decorativeTime+=clamp(dt,0,.10)}attachHooks();if(state.ready)updateTiles();renderSourceDecor(dt)}catch(e){restoreSourceDecor();err(e)}};
 window.__mahjongPresentation.afterRender=()=>{try{restoreSourceDecor();drawFX()}catch(e){err(e)}};
 const names=['tile','fa','flower','bamboo','dots','bird-body','bird-wing','bird-crest','header-labels'];
 await Promise.all(names.map(async name=>{try{const im=new Image();im.src=new URL(`./assets/${name}.png`,import.meta.url);await im.decode();images[name]=im;state.loaded.push(name)}catch(e){err(`asset ${name}: ${e}`)}}));
 if(state.loaded.length!==names.length)return;
 const panel=document.createElement('canvas');panel.width=758;panel.height=132;const pc=panel.getContext('2d');const pg=pc.createLinearGradient(0,0,0,132);pg.addColorStop(0,'#2b5949');pg.addColorStop(.45,'#143f35');pg.addColorStop(1,'#082a24');round(pc,2,2,754,128,63);pc.fillStyle=pg;pc.globalAlpha=.18;pc.fill();pc.globalAlpha=1;pc.strokeStyle='#afbc94';pc.lineWidth=2;pc.stroke();pc.beginPath();pc.moveTo(51,10);pc.quadraticCurveTo(379,2,707,10);pc.strokeStyle='#e0e0b84d';pc.lineWidth=2;pc.stroke();
 // Exact source words, spacing and dividers are baked into this retained image.
 // Its black interior is only 77/255 alpha, so the emerald material remains visible.
 pc.drawImage(images['header-labels'],0,0,758,132);
 const panelKey=A.assets.frames[A.nodes[48].sprite.frame].tex;texture(panel,panelKey);
 state.ready=true;installTiles();record('artReady',{assets:state.loaded.length});
}
boot().catch(err);
