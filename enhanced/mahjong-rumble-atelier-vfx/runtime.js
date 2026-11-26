import {createMahjongAudio} from './audio.js';
import {createFeedbackDirector} from './events.js';
import {paintTileFeedback,paintTrail,paintReceiver} from './material-fx.js';
const VERSION='mahjong-atelier-vfx-20261126-v3';
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const TAU=Math.PI*2;
// Solid painted area inside the source P1 texture; its surrounding glow is padding.
const WINNER_ROW={x:83,y:49,w:704,h:103,textureW:867,textureH:209};
const media=matchMedia('(prefers-reduced-motion: reduce)');
const storage={read(k,f){try{return localStorage.getItem('mr-'+k)??f}catch{return f}},write(k,v){try{localStorage.setItem('mr-'+k,String(v))}catch{}}};
const state={version:VERSION,ready:false,reducedMotion:storage.read('motion',media.matches?'1':'0')==='1',muted:storage.read('muted','0')==='1',decorativeTime:0,time:0,frameCount:0,loaded:[],errors:[],eventCounts:{},events:[],articulationSamples:[],textureUpdates:0,effectTime:0,epoch:0,peakEffects:0,flightSamples:[]};
const images={},tiles=new Map(),effects=[],trailHistory=new Map();
const wall=()=>performance.now()/1000;
let A,audio,music,musicGain,director,lastAudioUnlock=false,quietTexture;
const mascots=[];let endingAt=-100;
const ASSET_NAMES=['tile','fa','flower','bamboo','dots','bird-body','bird-head','bird-wing','bird-crest','hud','cta','coin','table','dog-body','dog-head','cat-body','cat-head','mouse-body','mouse-head','ending-panel','banknotes'];
let presentationTextureSerial=0;
const sourceDecorOverrides=[],spineDisplayClocks=new WeakMap();
const fx=document.createElement('canvas');fx.id='mahjong-fx';fx.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';document.body.appendChild(fx);const f=fx.getContext('2d');
function record(event,detail={}){const at=detail.at??wall();state.eventCounts[event]=(state.eventCounts[event]||0)+1;state.events.push({event,t:+at.toFixed(4),performanceAtMs:at*1000,audioTime:A?.context?.currentTime??null,...detail});if(state.events.length>320)state.events.shift()}
function err(e){const s=String(e);if(!state.errors.includes(s))state.errors.push(s)}
function setReducedMotion(v){state.reducedMotion=Boolean(v);effects.length=0;trailHistory.clear();for(const t of tiles.values()){t.selectedAt=t.commitAt=t.landAt=-100}storage.write('motion',state.reducedMotion?'1':'0');for(const t of tiles.values())t.key='';refreshSettings();return state.reducedMotion}
function setMuted(v){state.muted=Boolean(v);storage.write('muted',state.muted?'1':'0');audio?.setMuted(state.muted);if(A)A.sound.isAudioMute=state.muted;if(musicGain&&A.context)musicGain.gain.setTargetAtTime(state.muted?0:.115,A.context.currentTime,.02);refreshSettings();return state.muted}
function diagnostics(){return {...state,loaded:[...state.loaded],errors:[...new Set([...state.errors,...(director?.diagnostics().errors??[])])],eventCounts:{...state.eventCounts},events:state.events.slice(),articulationSamples:state.articulationSamples.slice(-40),tiles:tiles.size,effects:effects.length+trailHistory.size,director:director?.diagnostics()??null,audio:audio?.diagnostics()??null,gameplayRandomUntouched:true,artDirection:'Jade Atelier',mascotArticulation:mascots.map(m=>({id:m.id,angle:m.angle??0,anchor:m.anchor}))}}
window.__mahjongPresentation={get ready(){return state.ready},beforeRender(){},afterRender(){},diagnostics,setReducedMotion,setMuted,get audio(){return audio}};

// Settings live in the otherwise empty side margin, outside tile and CTA targets.
const settings=document.createElement('div');settings.className='mr-settings';settings.innerHTML='<button class="mr-settings-open" aria-label="Sound and motion settings" title="Sound and motion settings">⚙</button><div class="mr-settings-panel" hidden><strong>Playback settings</strong><button class="mr-sound"></button><button class="mr-motion"></button></div>';
const css=document.createElement('style');css.textContent='.mr-settings{position:fixed;right:8px;bottom:62px;z-index:5;font:13px/1.3 Arial,sans-serif;color:#f7f1dd}.mr-settings button{font:inherit;color:inherit;cursor:pointer;border:1px solid #c0a266;background:#123d32}.mr-settings-open{width:29px;height:29px;border-radius:50%;opacity:.76;font-size:18px!important}.mr-settings-open:hover,.mr-settings-open:focus-visible{opacity:1}.mr-settings-panel{position:absolute;right:0;bottom:38px;width:176px;padding:13px;border-radius:12px;background:#102b27;box-shadow:0 5px 20px #0008}.mr-settings-panel strong{display:block;margin-bottom:9px}.mr-settings-panel button{display:block;border-radius:7px;width:100%;padding:8px;margin-top:6px;text-align:left}.mr-settings [hidden]{display:none}';document.head.appendChild(css);document.body.appendChild(settings);
settings.addEventListener('pointerdown',e=>e.stopPropagation());settings.querySelector('.mr-settings-open').onclick=()=>{const panel=settings.querySelector('.mr-settings-panel');panel.hidden=!panel.hidden};settings.querySelector('.mr-sound').onclick=()=>{audio?.unlock();setMuted(!state.muted)};settings.querySelector('.mr-motion').onclick=()=>setReducedMotion(!state.reducedMotion);
function refreshSettings(){settings.querySelector('.mr-sound').textContent=state.muted?'Sound: off':'Sound: on';settings.querySelector('.mr-sound').setAttribute('aria-pressed',String(!state.muted));settings.querySelector('.mr-motion').textContent=state.reducedMotion?'Motion: reduced':'Motion: full';settings.querySelector('.mr-motion').setAttribute('aria-pressed',String(state.reducedMotion))}refreshSettings();
media.addEventListener('change',e=>setReducedMotion(e.matches));document.addEventListener('visibilitychange',()=>{effects.length=0;trailHistory.clear()});
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
function opacityOf(node){let alpha=1;for(let n=node;n;n=n.parent){if(n.active===false||n._active===false||n.isValid===false||n._destroyed)return 0;alpha*=Number.isFinite(n.opacity)?n.opacity/255:1}return alpha}
function worldPoint(node,local={x:0,y:0}){const p=node.convertToWorldSpaceAR(local);return{x:p.x,y:p.y}}
function projectPoint(p){return{x:A.layout.W/2+p.x*A.layout.scale,y:A.layout.H/2-p.y*A.layout.scale}}
function world(node){return projectPoint(worldPoint(node))}
function rectOf(node){if(!node||opacityOf(node)<=.01||!(node.width>0&&node.height>0))return null;const points=[[-node.width*node.anchorX,-node.height*node.anchorY],[node.width*(1-node.anchorX),-node.height*node.anchorY],[-node.width*node.anchorX,node.height*(1-node.anchorY)],[node.width*(1-node.anchorX),node.height*(1-node.anchorY)]].map(([x,y])=>projectPoint(worldPoint(node,{x,y})));const left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y));return{left,top,width:Math.max(...points.map(p=>p.x))-left,height:Math.max(...points.map(p=>p.y))-top}}
function flightFade(node,receiver){const a=world(node),b=world(receiver);return clamp(Math.hypot(a.x-b.x,a.y-b.y)/28,.12,1)}
function play(name,node,strength=1){if(!state.muted&&!A.sound.isAudioMute)audio?.play(name,{x:node?clamp(world(node).x/innerWidth*2-1,-1,1):0,strength})}
function addReceiver(kind,node,at,duration){if(!state.ready||state.reducedMotion)return;const recent=effects.find(e=>e.kind===kind&&e.node===node&&at-e.at<.05);if(recent)return;effects.push({kind,node,at,duration});if(effects.length>24)effects.splice(0,effects.length-24)}
function configureDirector(){
 director=createFeedbackDirector(A,{
  now:wall,
  record(type,detail){record(type==='ending'?'adComplete':type,detail)},
  reset(epoch){state.epoch=epoch;effects.length=0;trailHistory.clear();endingAt=-100;for(const t of tiles.values())t.tex.dispose();tiles.clear();audio?.stop();for(const m of mascots){m.riseAt=m.landAt=-100;m.lastKey='';m.angle=0}if(state.ready)installTiles()},
  select(node,at){const t=tiles.get(node);if(t){t.selectedAt=at;t.commitAt=t.badAt=-100;t.key=''}play('tap',node)},
  mismatch(nodes,at){for(const n of nodes){const t=tiles.get(n);if(t){t.badAt=at;t.selectedAt=t.commitAt=-100;t.key=''}}play('mismatch',nodes.at(-1))},
  match(nodes,at){for(const n of nodes){const t=tiles.get(n);if(t){t.commitAt=at;t.badAt=-100;t.key=''}}play('match',nodes[1])},
  contact(nodes,at){for(const n of nodes){const t=tiles.get(n);if(t){t.landAt=at;t.key=''}}if(!A.game.isShowOver)play('settle',nodes[Math.floor(nodes.length/2)],Math.min(1,.65+nodes.length*.04))},
  winnings(node,at){if(!A.game.isShowOver&&opacityOf(node)>.01){play('winnings',node);addReceiver('money',A.nodes[48],at,.30)}},
  ending(at){endingAt=state.decorativeTime;effects.length=0;trailHistory.clear();play('final');for(const m of mascots){m.riseAt=m.landAt=-100}},
  ranking(at){if(!state.reducedMotion)for(const m of mascots)m.riseAt=state.decorativeTime;addReceiver('ranking',A.nodes[70],at,.70)},
  actorArrival(node){if(!state.reducedMotion){const m=mascots.find(m=>A.nodes[m.id]===node);if(m)m.landAt=state.decorativeTime}},
  panelLanding(node,at){addReceiver('panel',A.nodes[101],at,.48);play('panel',node,.85)}
 });
 director.attach();
}
function installTiles(){for(const [id,node]of Object.entries(A.nodes)){if(!node.isCard||!node.sprite||node.isValid===false||node._destroyed||tiles.has(node))continue;const canvas=document.createElement('canvas');canvas.width=200;canvas.height=248;const key=`mr-tile-${id}`;const tex=texture(canvas,key),uuid=`mr-frame-${id}`;A.assets.frames[uuid]={name:key,tex:key,rect:[0,0,200,248],offset:[0,0],orig:[200,248]};node.sprite.frame=uuid;const t={id:+id,node,canvas,ctx:canvas.getContext('2d'),tex,key:'',selectedAt:-100,commitAt:-100,badAt:-100,landAt:-100,phase:(+id*1.618)%13};tiles.set(node,t);drawTile(t,0,0,false)}}
function pulse(age,duration=.74){return age>=0&&age<duration?Math.sin(Math.PI*age/duration)**2:0}
function accent(age,duration,peak){if(age<0||age>=duration)return 0;return age<peak?Math.sin(age/peak*Math.PI/2):Math.pow(1-(age-peak)/(duration-peak),2)}
function drawTile(t,p,idle,selected){const c=t.ctx;c.clearRect(0,0,200,248);c.drawImage(images.tile,0,0,200,248);
 const errorAge=state.effectTime-t.badAt;const reject=errorAge>=0&&errorAge<.20?(state.reducedMotion?1:accent(errorAge,.20,.025)):0;const commit=accent(state.effectTime-t.commitAt,.20,.055),tap=accent(state.effectTime-t.selectedAt,.24,.045),contact=accent(state.effectTime-t.landAt,.22,.025);let q=clamp(Math.max(p,commit*1.30)+idle*.25,0,1.35);if(state.reducedMotion||reject>0)q=0;
 // All art moves within the unchanged logical tile. No hit-area or rule transforms.
 c.save();
 switch(t.node.name){
  case 'card':{
   // Body, feet and perch stay fixed. Each joint rotates around a local socket.
   const wing=-.68*q,crest=.19*q,head=-.15*q+.045*idle;
   c.drawImage(images['bird-body'],45,107,115,106);
   part(c,images['bird-wing'],95,104,61,75,108,117,wing,1+q*.06,1);
   c.save();c.translate(105,119);c.rotate(head);c.translate(-105,-119);
   c.drawImage(images['bird-head'],39,57,103,83);
   // A small articulated pupil makes the existing carved eye readable at phone scale.
   c.fillStyle='#172d39';c.beginPath();c.ellipse(88.3-q*1.5,85.7,3.8,4.5,0,0,TAU);c.fill();
   c.fillStyle='#fff7da';c.beginPath();c.arc(87.4-q*1.5,84.1,1.2,0,TAU);c.fill();
   part(c,images['bird-crest'],64,37,104,53,79,64,crest);
   c.restore();
   if(q>.10&&state.frameCount%3===0){state.articulationSamples.push({id:t.id,t:+state.time.toFixed(3),wing:+wing.toFixed(3),crest:+crest.toFixed(3),head:+head.toFixed(3),anchor:[111,117],feet:[100,202]});if(state.articulationSamples.length>80)state.articulationSamples.shift()}
   break;
  }
  case 'K':{
   // Five independent painted petals hinge around the fixed flower centre.
   const im=images.flower,sz=145,x=27.5,y=51,cx=100,cy=123.5;
   for(let k=0;k<5;k++){const a=-Math.PI/2+k*TAU/5,spread=q*5.4*Math.sin(k*.8+1.1);c.save();c.translate(Math.cos(a)*spread,Math.sin(a)*spread);c.translate(cx,cy);c.rotate(q*.07*Math.sin(k+1));c.translate(-cx,-cy);c.beginPath();c.moveTo(cx,cy);c.arc(cx,cy,110,a-Math.PI/5-.015,a+Math.PI/5+.015);c.closePath();c.clip();c.drawImage(im,x,y,sz,sz);c.restore()}
   c.save();c.beginPath();c.arc(cx,cy,22,0,TAU);c.clip();c.drawImage(im,x,y,sz,sz);c.restore();break;
  }
  case 'C':{
   const im=images.bamboo;const boxes=[[0,0,.34,.50],[.66,0,.34,.50],[.34,.23,.32,.54],[0,.50,.34,.50],[.66,.50,.34,.50]];
   for(let k=0;k<boxes.length;k++){const [x,y,w,h]=boxes[k],dx=41+x*118,dy=43+y*160,dw=w*118,dh=h*160;const a=q*.11*Math.sin(k*1.7+1);c.save();c.translate(dx+dw*.5,dy+dh);c.rotate(a);c.drawImage(im,x*im.width,y*im.height,w*im.width,h*im.height,-dw*.5,-dh,dw,dh);c.restore()}break;
  }
  case 'A':{
   const im=images.dots;for(let r=0;r<3;r++)for(let col=0;col<3;col++){const k=r*3+col,pp=state.reducedMotion?0:Math.max(pulse(state.effectTime-t.selectedAt-k*.018,.30),commit*(1-r*.08)),sz=43*(1+pp*.12);c.drawImage(im,col*im.width/3,r*im.height/3,im.width/3,im.height/3,36+col*43+(43-sz)/2,58+r*47+(43-sz)/2,sz,sz)}break;
  }
  default:fit(c,images.fa,26,48,148,151);
   if(p>.03){c.save();c.globalAlpha=p*.12;c.globalCompositeOperation='screen';fit(c,images.fa,26,48,148,151);c.restore()}
 }
 c.restore();
 paintTileFeedback(c,{selected,tap,commit,reject,contact,lowMotion:state.reducedMotion});
 t.tex.needsUpdate=true;state.textureUpdates++;
}
function updateTiles(){const selected=new Set(A.game.selectBoxArr||[]);
 for(const t of tiles.values()){const n=t.node;if(n.isValid===false||n._destroyed)continue;
  const age=state.effectTime-t.selectedAt,p=state.reducedMotion?0:.85*accent(age,.46,.095)+.16*pulse(age,.64);
  const local=(state.decorativeTime+t.phase)%13,idle=state.reducedMotion?0:local<.82?pulse(local,.82):0;
  const values=[p,idle,accent(age,.24,.045),accent(state.effectTime-t.commitAt,.2,.055),Math.max(0,.2-(state.effectTime-t.badAt)),accent(state.effectTime-t.landAt,.22,.025)];
  const key=[...values.map(v=>Math.round(v*120)),selected.has(n),state.reducedMotion].join(',');
  if(key!==t.key){drawTile(t,p,idle,selected.has(n));t.key=key}
 }
}
function drawFX(){
 const dpr=Math.min(devicePixelRatio||1,2),w=innerWidth,h=innerHeight;if(fx.width!==Math.round(w*dpr)||fx.height!==Math.round(h*dpr)){fx.width=Math.round(w*dpr);fx.height=Math.round(h*dpr)}f.setTransform(dpr,0,0,dpr,0,0);f.clearRect(0,0,w,h);
 if(!state.ready||document.hidden||state.reducedMotion){trailHistory.clear();return}
 const live=new Set();
 if(!A.game.isShowOver)for(const flight of director.flights){const n=flight.node;if(opacityOf(n)<=.01)continue;live.add(flight.serial);
  const p=worldPoint(n,{x:(107/220-n.anchorX)*n.width,y:(n.anchorY-100/220)*n.height});
  let history=trailHistory.get(flight.serial);if(!history){history=[];trailHistory.set(flight.serial,history)}history.push({...p,at:state.effectTime});while(history.length>12||history[0]?.at<state.effectTime-.14)history.shift();
  const points=history.map(projectPoint);paintTrail(f,points,opacityOf(n)*flightFade(n,flight.receiver));
  if(state.frameCount%4===0){const head=points.at(-1);state.flightSamples.push({serial:flight.serial,epoch:flight.epoch,at:state.effectTime,head,sourceCenter:projectPoint(p),historyLength:history.length});if(state.flightSamples.length>160)state.flightSamples.shift()}
 }
 for(const key of trailHistory.keys())if(!live.has(key))trailHistory.delete(key);
 for(let i=effects.length-1;i>=0;i--){const e=effects[i],age=state.effectTime-e.at;if(age>=e.duration||e.node.isValid===false||e.node._destroyed){effects.splice(i,1);continue}if(e.kind==='money'&&A.game.isShowOver)continue;const rect=rectOf(e.node);if(!rect)continue;if(e.kind==='ranking'){const b=WINNER_ROW;rect.left+=rect.width*b.x/b.textureW;rect.top+=rect.height*b.y/b.textureH;rect.width*=b.w/b.textureW;rect.height*=b.h/b.textureH}paintReceiver(f,rect,{kind:e.kind,progress:age/e.duration,alpha:opacityOf(e.node),lowMotion:false});}
 state.peakEffects=Math.max(state.peakEffects,effects.length+trailHistory.size);
}
function restoreSourceDecor(){
 for(let i=sourceDecorOverrides.length-1;i>=0;i--){const item=sourceDecorOverrides[i];if(item.sk){item.sk.time=item.time;item.sk.apply();item.sk.updateWorldTransform()}else if(item.textureKey){A.textures[item.textureKey]=item.texture;const mat=item.node.r?.mesh?.material;if(mat)mat.map=item.map??item.texture}else if('opacity' in item){item.node.opacity=item.opacity}else{item.node.scaleX=item.scaleX;item.node.scaleY=item.scaleY}}
 sourceDecorOverrides.length=0;
}
function renderSourceDecor(dt){
 const hand=A.nodes[47],sk=hand?.spine?.sk;
 if(sk){let display=spineDisplayClocks.get(sk);if(!display){display={time:sk.time};spineDisplayClocks.set(sk,display)}else if(!state.reducedMotion&&!document.hidden)display.time+=clamp(dt,0,.10);sourceDecorOverrides.push({sk,time:sk.time});sk.time=display.time;sk.apply();sk.updateWorldTransform()}
 const originalParticleMaps=new Map();
 if(state.ready)for(const flight of director.flights){const node=flight.node;sourceDecorOverrides.push({node,opacity:node.opacity});node.opacity*=flightFade(node,flight.receiver)}
 if(state.ready)for(const id of [64,93,94]){const node=A.nodes[id];if(!node?.particle)continue;
  if(state.reducedMotion){const key=node.particle.tex,original=originalParticleMaps.get(key)??A.textures[key],map=node.r?.mesh?.material?.map;originalParticleMaps.set(key,original);sourceDecorOverrides.push({node,textureKey:key,texture:original,map});A.textures[key]=quietTexture;if(node.r?.mesh?.material)node.r.mesh.material.map=quietTexture}
  else{sourceDecorOverrides.push({node,opacity:node.opacity});node.opacity*=id===64?.24:.16}
 }
 if(state.reducedMotion)for(const id of [57,58,105,109]){const node=A.nodes[id];if(!node)continue;sourceDecorOverrides.push({node,scaleX:node.scaleX,scaleY:node.scaleY});node.scaleX=node.scaleY=1}
}
function canvasArt(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),c);return c}
function replaceNodeTexture(id,canvas){const node=A.nodes[id];if(!node?.sprite)return;const key=A.assets.frames[node.sprite.frame].tex;texture(canvas,key)}
function installSurfaces(){
 quietTexture=texture(canvasArt(1,1,()=>{}),'mr-quiet-particle');
 for(const frameId of ['c9A7bD1mVLH4IQ3JqjkIJ5','3bjM2tI/JM5amnOi5BQ6gv']){const frame=A.assets.frames[frameId];if(frame)texture(canvasArt(273,271,()=>{}),frame.tex)}
 const bomKey=A.assets.particleTex?.bom||'particle_bom.png';texture(canvasArt(64,64,()=>{}),bomKey);
 for(const item of director.boms){if(item.node.r?.mesh?.material)item.node.r.mesh.material.map=A.textures[bomKey]}
 replaceNodeTexture(5,images.table);
 const hud=canvasArt(758,132,c=>{c.drawImage(images.hud,0,0,758,132);c.textAlign='center';c.textBaseline='middle';c.font='bold 40px Georgia,serif';c.shadowColor='#000b';c.shadowBlur=2;c.shadowOffsetY=2;c.fillStyle='#fff5d5';['Level','Winnings','Match'].forEach((s,i)=>c.fillText(s,126+i*253,31))});replaceNodeTexture(48,hud);
 const cta=canvasArt(688,236,c=>{c.drawImage(images.cta,0,0,688,236);c.textAlign='center';c.textBaseline='middle';c.fillStyle='#fff7db';c.shadowColor='#08241d';c.shadowBlur=2;c.shadowOffsetY=4;c.font='bold 64px Georgia,serif';c.fillText('Play Now',344,118)});replaceNodeTexture(58,cta);
 replaceNodeTexture(101,images['ending-panel']);
 const win=canvasArt(718,184,c=>{c.drawImage(images.cta,0,0,718,184);c.fillStyle='#fff7dd';c.textAlign='center';c.textBaseline='middle';c.font='bold 55px Georgia,serif';c.fillText('WIN MONEY',359,92)});replaceNodeTexture(105,win);
 for(const id of [75,76,81,82,87,88,102])replaceNodeTexture(id,images.banknotes);
 for(const key of [A.assets.particleTex.overCoin,A.assets.particleTex.overCoin2])texture(images.coin,key);
 const billsFrame=A.assets.frames['17A5dxR81LWqY3+4CGuC7I'];if(billsFrame)texture(images.banknotes,billsFrame.tex);
 // Source ranking text/amounts are exact. Only the supporting material changes.
 for(const [id,rank,name,amount] of [[66,'2','Lucy','$20.00'],[67,'3','Ben','$6.00'],[68,'4','Yoyoo','$0.00'],[69,'5','Sime123','$0.00'],[70,'1','You',null]]){
  const first=id===70,w=first?867:692,h=first?209:102;
  const panel=canvasArt(w,h,c=>{
   if(first){const b=WINNER_ROW;c.drawImage(images.cta,b.x,b.y,b.w,b.h);c.textBaseline='middle';c.textAlign='center';c.fillStyle='#f6dfa2';c.font='bold 44px Georgia,serif';c.strokeStyle='#173d2d';c.lineWidth=3;c.lineJoin='round';c.strokeText(rank,136,102);c.fillText(rank,136,102);c.textAlign='left';c.fillStyle='#fff6df';c.font='bold 48px Georgia,serif';c.fillText(name,214,102);c.font='bold 27px Georgia,serif';c.fillText('Prize:',495,105);return}
   c.drawImage(images.cta,0,0,w,h);const sy=h/102;c.save();c.scale(1,sy);c.textBaseline='middle';c.fillStyle='#f6dfa2';c.font='bold 44px Georgia,serif';c.textAlign='center';c.fillText(rank,49,51);c.textAlign='left';c.fillStyle='#fff6df';c.font='bold 45px Georgia,serif';c.fillText(name,123,51);c.font='bold 27px Georgia,serif';c.fillText('Prize:',399,54);if(amount){c.fillStyle=rank==='2'||rank==='3'?'#8df0a2':'#d0d3c6';c.font='bold 44px Georgia,serif';c.fillText(amount,489,51)}c.restore()
  });replaceNodeTexture(id,panel);
 }
 // Restyle the existing flight animation; no added flight, payout or changed timing.
 for(const frame of Object.values(A.assets.frames)){if(!/^2_\d{4}$/.test(frame.name||''))continue;const n=+frame.name.slice(2),a=n/68*Math.PI*2;const c=canvasArt(220,220,c=>{c.save();c.translate(107,100);c.scale(Math.max(.16,Math.abs(Math.cos(a))),1);c.drawImage(images.coin,-30,-30,60,60);c.restore()});texture(c,frame.tex)}
}
function refreshExistingParticleMaps(){for(const id of [64,93,94]){const n=A.nodes[id];if(n?.particle&&n.r?.mesh?.material)n.r.mesh.material.map=A.textures[n.particle.tex]}}
function installMascots(){
 for(const spec of [{id:77,name:'dog',w:300,h:357,body:[45,119,210,235],head:[8,28,218,169],anchor:[154,185]},{id:83,name:'cat',w:260,h:560,body:[6,192,248,362],head:[8,8,244,231],anchor:[141,225]},{id:89,name:'mouse',w:300,h:340,body:[2,137,296,201],head:[41,6,224,204],anchor:[177,177]}]){
  const c=canvasArt(spec.w,spec.h,ctx=>ctx.drawImage(images[spec.name+'-body'],...spec.body)),bodyPixels=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,spec.w,spec.h),n=A.nodes[spec.id];if(!n?.sprite)continue;const key=A.assets.frames[n.sprite.frame].tex,tex=texture(c,key);mascots.push({...spec,canvas:c,ctx:c.getContext('2d'),bodyPixels,tex,lastKey:'',angle:0,riseAt:-100,landAt:-100});
 }
 updateMascots();
}
function updateMascots(){for(const m of mascots){if(state.reducedMotion&&m.lastKey!=='')continue;
 const visible=opacityOf(A.nodes[m.id])>.01&&A.game.isShowOver;
 const riseAge=state.decorativeTime-m.riseAt,landAge=state.decorativeTime-m.landAt;
 const duration=m.name==='dog'?.70:m.name==='cat'?.35:.15;
 const lead=visible&&riseAge>=0&&riseAge<duration?.035*Math.sin(Math.PI*clamp(riseAge/duration)):0;
 const follow=visible?accent(landAge,m.name==='dog'?.62:.48,m.name==='mouse'?.07:.10):0;
 const hold=visible&&landAge>=0?.009*Math.exp(-landAge*1.5):0;
 const angle=state.reducedMotion?m.angle:clamp((m.name==='cat'?-1:1)*(lead+follow*.064+hold),-.075,.075),key=Math.round(angle*1000);
 if(m.lastKey===key)continue;m.lastKey=key;m.angle=angle;const c=m.ctx;c.putImageData(m.bodyPixels,0,0);part(c,images[m.name+'-head'],...m.head,...m.anchor,angle);m.tex.needsUpdate=true;
}}
async function boot(){while(!window.__MR)await new Promise(r=>setTimeout(r,10));A=window.__MR;await A.ready;
 if(A.context){audio=createMahjongAudio(A.context);audio.setMuted(state.muted);musicGain=A.context.createGain();musicGain.gain.value=state.muted?0:.115;musicGain.connect(A.context.destination)}
 document.addEventListener('pointerdown',()=>{lastAudioUnlock=true;audio?.unlock()},{passive:true});
 A.stopMusic();A.sound.playSound=()=>{};A.sound.playBGM=function(){if(music){try{music.stop()}catch{}}if(A.context&&A.audioBuffers.bgm){music=A.context.createBufferSource();music.buffer=A.audioBuffers.bgm;music.loop=true;music.connect(musicGain);music.start();this.bgmPlaying=true}};A.sound.isAudioMute=state.muted;
 configureDirector();
 window.__mahjongPresentation.beforeRender=dt=>{try{restoreSourceDecor();state.frameCount++;if(!document.hidden){state.time+=Math.max(0,dt);if(!state.reducedMotion)state.decorativeTime+=clamp(dt,0,.10)}director.tick();state.effectTime=wall();if(state.ready){updateTiles();updateMascots()}renderSourceDecor(dt)}catch(e){restoreSourceDecor();err(e)}};
 window.__mahjongPresentation.afterRender=()=>{try{restoreSourceDecor();drawFX()}catch(e){err(e)}};
 const names=ASSET_NAMES;
 await Promise.all(names.map(async name=>{try{const im=new Image();im.src=new URL(`./assets/${name}.png`,import.meta.url);await im.decode();images[name]=im;state.loaded.push(name)}catch(e){err(`asset ${name}: ${e}`)}}));
 if(state.loaded.length!==names.length)return;
 installSurfaces();refreshExistingParticleMaps();installMascots();
 state.ready=true;installTiles();record('artReady',{assets:state.loaded.length});
}
boot().catch(err);
