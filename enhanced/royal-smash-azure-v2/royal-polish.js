/* Royal Smash: Azure Coast v2. This module only observes gameplay and renders presentation.
 * The original engine, random stream, colliders, shot vectors, counts and clocks stay intact. */
import {installAzureFinish} from './azure-finish.js';
import {createRoyalObjectFeedback} from './royal-object-feedback.js';
import {createRoyalCannonLight} from './royal-cannon-light.js';
import {drawContactAccent,drawContactSecondary,drawWaterFoam,drawClearAccent,FX_TIMING} from './royal-painted-fx.js';
const VERSION='royal-smash-azure-v2.1-fx3';
const state=window.__royalPolish={version:VERSION,ready:false,artReady:false,errors:[],events:[],audio:[],replaced:[],frames:0,ambientTime:0,lowMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
const waitForGame=()=>new Promise(resolve=>{const poll=()=>window.__royalSmashGame?resolve(window.__royalSmashGame):setTimeout(poll,20);poll()});
const g=await waitForGame();
const events=[];let serial=0,lastTime=performance.now(),ambientTime=0,lastWaterFx=-1000;
const canvas=document.createElement('canvas');canvas.id='royal-fx';document.getElementById('app').append(canvas);
const ctx=canvas.getContext('2d');let W=0,H=0,dpr=1;
function resize(){W=innerWidth;H=innerHeight;dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)}resize();addEventListener('resize',resize);
function mark(type,data={}){const e={type,t:performance.now(),level:g.levelIndex,balls:g.remainingMoves,...data};state.events.push(e);if(state.events.length>800)state.events.shift();return e}
function emit(type,position,extra={}){
 const now=performance.now();
 if(type==='water'){
  const counts=state.waterFxCounts??={observed:0,drawn:0,throttled:0,overlapCulled:0};counts.observed++;
  if(now-lastWaterFx<85){counts.throttled++;return}
  const live=events.filter(e=>e.type==='water'&&now-e.t<FX_TIMING.water.duration*1000);
  const next=point(position),near=live.some(e=>{const p=point(e.position);return now-e.t<110&&Math.hypot(p.x-next.x,p.y-next.y)<24*Math.min(W/390,H/694)});
  if(near||live.length>=(state.lowMotion?1:3)){counts.overlapCulled++;return}
  lastWaterFx=now;counts.drawn++;
 }
 const p=position?{x:position.x,y:position.y,z:position.z}:null,event={type,position:p,t:now,serial:serial++,...extra};
 events.push(event);if(events.length>30)events.shift();mark(type,extra);
 if(type==='level-clear'){azureTone('clear');pulse('royal-clear')}return event;
}
function point(p){if(!p||!g.camera)return {x:W/2,y:H/2};const v=g.camera.position.clone().set(p.x,p.y,p.z).project(g.camera);return{x:(v.x*.5+.5)*W,y:(.5-v.y*.5)*H}}
function hook(name,callback){const fn=g[name];if(typeof fn!=='function')return;g[name]=function(...args){return callback.call(this,fn,args)}}
function pulse(name){const p=g.ui.movesPanel;if(!p)return;p.classList.remove(name);void p.offsetWidth;p.classList.add(name);setTimeout(()=>p.classList.remove(name),name==='royal-clear'?650:250)}
function presentation(where,action){try{return action()}catch(error){if(state.errors.length<30)state.errors.push(`${where}: ${error}`);return null}}
let shotAt=-1,lastRejected=-1000,aimHeld=false,plume=null,plumeFrames=[],tableContacts=new WeakMap,pendingMuzzle=null;
const waterHooks=new WeakSet;
function installWaterHook(){const water=g.water;if(!water||waterHooks.has(water)||typeof water.enter!=='function')return;const enter=water.enter;water.enter=function(...a){const [object,body,options={}]=a,already=this.floaters.has(object);const contact=options.contactPoint||body?.position,position=contact?{x:contact.x,y:this.surfaceY,z:contact.z}:null;const r=enter.apply(this,a);presentation('water contact',()=>{if(!already&&this.floaters.has(object)&&g.levelShotFired)emit('water',position,{kind:options.kind,sizeClass:options.sizeClass})});return r};waterHooks.add(water)}
hook('onPointerDown',function(fn,a){const r=fn.apply(this,a);aimHeld=true;return r});
hook('onPointerUp',function(fn,a){aimHeld=false;return fn.apply(this,a)});
hook('createBall',function(fn,a){const before=this.balls.length,capturedMuzzle=pendingMuzzle;pendingMuzzle=null;const value=fn.apply(this,a);presentation('accepted launch',()=>{const ball=this.balls.length>before?this.balls[this.balls.length-1]:null;if(!ball?.active||ball.destroyed)return;shotAt=performance.now();const muzzle=capturedMuzzle?.fireSeq===this.fireSeq&&capturedMuzzle.expectedLaunch===ball.launchSeq?capturedMuzzle:null;emit('shot',muzzle?.position||a[0],{sourceMuzzle:!!muzzle,launch:ball.launchSeq,direction:muzzle?.direction||null});pendingMuzzle=null;objectFeedback.refineBallTrail(ball);pulse('royal-shot')});return value});
hook('shootFromPointer',function(fn,a){const unavailable=this.inputLocked||this.levelLoading||this.remainingMoves<=0;const r=fn.apply(this,a);presentation('ignored input feedback',()=>{if(unavailable&&(this.remainingMoves<=0||this.failureScheduled)&&performance.now()-lastRejected>500){lastRejected=performance.now();pulse('royal-empty');emit('unavailable',null,{reason:'no balls or result locked'})}});return r});
hook('handleBallObject',function(fn,a){const [ball,obj,,contact]=a;const before=ball?.obstacleHits||0;const token=presentation('capture contact',()=>objectFeedback.captureContact(ball,obj,contact));const position=contact||ball?.body?.position;const fixed=position?{x:position.x,y:position.y,z:position.z}:null;const r=fn.apply(this,a);if((ball?.obstacleHits||0)>before)presentation('accepted contact',()=>{const anchor=objectFeedback.acceptContact(token);const e=emit('impact',fixed,{category:obj.category,launch:ball.launchSeq,attached:!!anchor});if(e&&anchor)e.anchor=anchor});return r});
hook('handleBallTable',function(fn,a){const ball=a[0],accepted=ball?.active&&!ball.destroyed,launch=ball?.launchSeq;const contact=a[1]||ball?.body?.position,position=contact?{x:contact.x,y:contact.y,z:contact.z}:null;const r=fn.apply(this,a);presentation('support contact',()=>{if(accepted&&tableContacts.get(ball)!==launch){tableContacts.set(ball,launch);emit('table',position,{launch})}});return r});
hook('checkForComplete',function(fn,a){const before=this.completionScheduled;const r=fn.apply(this,a);presentation('committed clear',()=>{if(!before&&this.completionScheduled)emit('level-clear',null,{next:this.completionNextLevelId,remaining:this.objects.filter(o=>o.target&&!o.cleared).length})});return r});
hook('scheduleFail',function(fn,a){const before=this.failureScheduled;const r=fn.apply(this,a);presentation('source fail',()=>{if(!before&&this.failureScheduled)emit('fail',null)});return r});
hook('showEndText',function(fn,a){const r=fn.apply(this,a);presentation('source win',()=>{if(a[1]==='win')emit('winner',null)});return r});
hook('loadLevel',function(fn,a){presentation('reset feedback',()=>{objectFeedback.reset();for(let i=events.length-1;i>=0;i--)if(events[i].type!=='level-clear')events.splice(i,1);shotAt=-1;lastWaterFx=-1000;aimHeld=false;lastRejected=-1000;tableContacts=new WeakMap;pendingMuzzle=null;mark('load',{requested:a[0]})});return fn.apply(this,a)});
hook('clearStage',function(fn,a){presentation('clear feedback',()=>objectFeedback.reset());return fn.apply(this,a)});

// Preserve source particle options by identity. Its constant-color sampler can
// alias emitter data, so injecting systemTweaks.tint would compound across births.
const cannonParticles=g.effects.playCannonFireParticles;
g.effects.playCannonFireParticles=function(origin,direction,options={}){const result=cannonParticles.call(this,origin,direction,options);presentation('muzzle origin',()=>{pendingMuzzle={position:{x:origin.x,y:origin.y,z:origin.z},direction:{x:direction.x,y:direction.y,z:direction.z},fireSeq:g.fireSeq,expectedLaunch:g.ballLaunchSeq+1,t:performance.now()}});return result};

// Existing sampled sound is retained, with deterministic timbral variation and a quiet cannon tail.
const play=g.assets.playAudio.bind(g.assets);let audioSerial=0;
const audioBuses=new Map(),bufferPlay=g.assets.webAudio.playBuffer;
let lastAzureAccent=-1000,azureAudioSerial=0;
// Small authored resonances complement the retained source recordings. These
// tones share the source-unlocked context, compressor and master mute bus.
function azureTone(kind){
 if(g.muted||document.hidden)return;
 const entry=[...audioBuses].find(([context])=>context.state==='running');if(!entry)return;
 if(kind==='ceramic'&&performance.now()-lastAzureAccent<80)return;
 if(kind==='ceramic')lastAzureAccent=performance.now();
 const [context,bus]=entry,start=context.currentTime,variation=[1,.975,1.035,.99][azureAudioSerial++%4];
 const notes=kind==='clear'?[[560,.015,.20,0,'sine'],[840,.012,.21,.085,'sine'],[1120,.009,.22,.17,'sine']]:kind==='cannon'?[[76,.038,.14,0,'sine'],[265,.010,.035,0,'triangle']]:[[690*variation,.011,.095,0,'triangle'],[1130*variation,.005,.075,.005,'sine']];
 for(const [frequency,peak,duration,delay,wave]of notes){const oscillator=context.createOscillator(),envelope=context.createGain(),at=start+delay;oscillator.type=wave;oscillator.frequency.setValueAtTime(frequency,at);if(kind==='cannon')oscillator.frequency.exponentialRampToValueAtTime(frequency*.57,at+duration);envelope.gain.setValueAtTime(.00001,at);envelope.gain.linearRampToValueAtTime(peak,at+.004);envelope.gain.exponentialRampToValueAtTime(.00001,at+duration);oscillator.connect(envelope);envelope.connect(bus.compressor);oscillator.start(at);oscillator.stop(at+duration+.015);oscillator.onended=()=>{oscillator.disconnect();envelope.disconnect()};}
 state.audio.push({name:`Azure ${kind} accent`,t:performance.now(),gain:Math.max(...notes.map(n=>n[1])),pitch:kind==='ceramic'?variation:1,sourceEvent:kind==='clear'?'committed level clear':kind});if(state.audio.length>500)state.audio.shift();
}
// Native fallback borrows clones from pools. Track those same elements without
// replacing playback/cache behavior, so muting also reaches an in-flight clone.
const nativeActive=new Set(),nativeTracked=new WeakSet();
function trackNativeMedia(media){if(!media||nativeTracked.has(media))return media;nativeTracked.add(media);const clone=media.cloneNode,playNative=media.play;media.cloneNode=function(...a){return trackNativeMedia(clone.apply(this,a))};media.play=function(...a){nativeActive.add(this);if(g.muted)this.muted=true;let result;try{result=playNative.apply(this,a)}catch(e){nativeActive.delete(this);throw e}result?.catch(()=>nativeActive.delete(this));return result};const settled=()=>nativeActive.delete(media);media.addEventListener('ended',settled);media.addEventListener('pause',settled);return media}
function syncNativeMute(){const media=new Set(nativeActive);for(const item of g.assets.audioCache.values())media.add(item);for(const pool of g.assets.audioPools.values())for(const item of pool)media.add(item);for(const item of media)trackNativeMedia(item).muted=g.muted}
const nativeAudio=g.assets.audio,unlockAudio=g.assets.unlockAudio;
g.assets.audio=function(...a){return trackNativeMedia(nativeAudio.apply(this,a))};
g.assets.unlockAudio=function(...a){const result=unlockAudio.apply(this,a);result?.then(syncNativeMute,syncNativeMute);return result};
syncNativeMute();
g.assets.webAudio.playBuffer=function(context,buffer,volume,rate){let bus=audioBuses.get(context);if(!bus){const gain=context.createGain(),compressor=context.createDynamicsCompressor();compressor.threshold.value=-8;compressor.knee.value=12;compressor.ratio.value=3;compressor.attack.value=.003;compressor.release.value=.16;gain.gain.value=g.muted?0:.75;compressor.connect(gain);gain.connect(context.destination);bus={gain,compressor};audioBuses.set(context,bus)}const facade={createBufferSource:context.createBufferSource.bind(context),createGain:context.createGain.bind(context),destination:bus.compressor,currentTime:context.currentTime};return bufferPlay.call(this,facade,buffer,volume,rate)};
g.assets.playAudio=function(name,volume=1,rate=1){if(g.muted)return;const k=audioSerial++,variate=[.98,1.025,.955,1.045,1][k%5];const impact=/Hit|Breaking|Break/.test(name),cannon=name==='Cannon';const gain=volume*(impact?.88:cannon?.88:1),pitch=rate*(impact?variate:1);state.audio.push({name,t:performance.now(),gain,pitch});if(state.audio.length>500)state.audio.shift();play(name,gain,pitch);if(cannon||impact)azureTone(cannon?'cannon':'ceramic');if(cannon){const seq=g.fireSeq;setTimeout(()=>{if(!g.muted&&!document.hidden&&seq===g.fireSeq){play('Cannon',.09,.73);state.audio.push({name:'Cannon tail',t:performance.now(),gain:.09,pitch:.73})}},32)}};

const controls=document.createElement('div');controls.id='royal-options';controls.innerHTML='<button type="button" aria-label="Mute sound" aria-pressed="false">Sound on</button><button type="button" aria-label="Reduce decorative motion" aria-pressed="false">Calm motion</button>';document.getElementById('app').append(controls);
const [sound,motion]=controls.children;
sound.onclick=()=>{g.muted=!g.muted;g.assets.setMusicMuted(g.muted);for(const[context,bus]of audioBuses)bus.gain.gain.setTargetAtTime(g.muted?0:.75,context.currentTime,.008);syncNativeMute();sound.textContent=g.muted?'Sound off':'Sound on';sound.setAttribute('aria-pressed',String(g.muted));sound.setAttribute('aria-label',g.muted?'Unmute sound':'Mute sound')};
function setLow(value){state.lowMotion=!!value;document.body.classList.toggle('royal-low-motion',state.lowMotion);motion.setAttribute('aria-pressed',String(state.lowMotion));lastTime=performance.now()}
addEventListener('pointerup',()=>{aimHeld=false});addEventListener('pointercancel',()=>{aimHeld=false});
motion.onclick=()=>setLow(!state.lowMotion);matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>setLow(e.matches));setLow(state.lowMotion);state.setLowMotion=setLow;

// Draw only temporary contact graphics. All positions come from actual world contacts.
function ring(x,y,r,alpha,color,ys=.45){ctx.save();ctx.translate(x,y);ctx.scale(1,ys);ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();ctx.restore()}
function draw(t){
 ctx.clearRect(0,0,W,H);
 const scale=Math.min(W/390,H/694);
 if(aimHeld&&g.lastAimTarget){const p=point(g.lastAimTarget);ring(p.x,p.y,12*scale,.75,'#fff4c4',1)}
 for(let i=events.length-1;i>=0;i--){
  const e=events[i],age=(t-e.t)/1000;
  const duration=e.type==='level-clear'?1.05:e.type==='water'?FX_TIMING.water.duration:e.type==='impact'||e.type==='table'?FX_TIMING.contact.duration:.72;
  if(age>duration){events.splice(i,1);continue}
  let p=point(e.position),angle=e.angle??-Math.PI/2,attached=true;
  if(e.anchor){
   const world=objectFeedback.resolveAnchor(e.anchor,{});
   if(world){p=point(world);const m=e.anchor.object.group.matrixWorld.elements,center=point({x:m[12],y:m[13],z:m[14]});if(Math.hypot(p.x-center.x,p.y-center.y)>1)angle=Math.atan2(p.y-center.y,p.x-center.x);e.lastAttached={x:p.x,y:p.y};e.angle??=angle;}
   else{attached=false}
  }
  if(e.type==='shot'&&e.direction){const q=point({x:e.position.x+e.direction.x,y:e.position.y+e.direction.y,z:e.position.z+e.direction.z});if(Math.hypot(q.x-p.x,q.y-p.y)>.5)angle=Math.atan2(q.y-p.y,q.x-p.x)}
  const u=age/duration,fade=Math.max(0,1-u);
  ctx.save();
  try{
   if(e.type==='shot'){
    // Ignition is fixed at the engine's real muzzle VFX origin. Smoke detaches
    // from that contact point; it does not follow the restored cannon pose.
    if(!state.lowMotion&&plumeFrames.length===3){
     const r=(68+u*17)*scale,phase=age<.09?0:age<.24?1:2,blend=phase===0?Math.max(0,(age-.055)/.035):phase===1?Math.max(0,(age-.18)/.06):0;
     ctx.save();try{ctx.translate(p.x,p.y-u*19*scale);ctx.rotate(angle+Math.PI/2+(e.serial%3-1)*.055);ctx.globalAlpha=fade*.88*(1-blend);ctx.drawImage(plumeFrames[phase],-r/2,-r/2,r,r);if(phase<2&&blend>0){ctx.globalAlpha=fade*.88*blend;ctx.drawImage(plumeFrames[phase+1],-r/2,-r/2,r,r)}}finally{ctx.restore()}
    }else if(!state.lowMotion&&plume){const r=(54+u*38)*scale;ctx.globalAlpha=fade*.76;ctx.drawImage(plume,p.x-r/2,p.y-r/2-u*19*scale,r,r)}
    drawContactAccent(ctx,{x:p.x,y:p.y,angle,age,strength:.62,scale:scale*.88,calm:state.lowMotion,kind:'brass'});
   }else if(e.type==='impact'||e.type==='table'){
    const kind=e.type==='impact'?'ceramic':'table',strength=e.type==='impact'?1:.66;
    if(attached||age<.06)drawContactAccent(ctx,{x:p.x,y:p.y,angle,age,strength,scale,calm:state.lowMotion,kind,skipSecondary:true});
    const origin=point(e.position);drawContactSecondary(ctx,{x:origin.x,y:origin.y,angle:e.angle??angle,age,strength,scale,calm:state.lowMotion,kind});
   }else if(e.type==='water'){
    drawWaterFoam(ctx,{x:p.x,y:p.y,age,strength:e.sizeClass==='big'||e.sizeClass==='mid'?.80:.65,scale,calm:state.lowMotion});
   }else if(e.type==='level-clear'){
    // The source has committed completion. Keep the next target and its colors
    // readable: a brief enamel title sits in the lower water above the cannon.
    const y=H*.77,alpha=Math.min(1,age/.065)*Math.min(1,(duration-age)/.25);
    ctx.globalAlpha=alpha;ctx.textAlign='center';ctx.font=`700 ${21*scale}px Remissis,system-ui`;ctx.lineWidth=4*scale;ctx.strokeStyle='#173f56';ctx.fillStyle='#fff4d5';ctx.strokeText('Level clear!',W/2,y);ctx.fillText('Level clear!',W/2,y);
    drawClearAccent(ctx,{x:W/2,y:y+10*scale,width:190*scale,age,scale,calm:state.lowMotion});
   }else if(e.type==='unavailable'){
    ctx.globalAlpha=fade;ctx.textAlign='center';ctx.font=`600 ${13*scale}px system-ui`;ctx.fillStyle='#fff5d7';ctx.shadowColor='#20324b';ctx.shadowBlur=5;ctx.fillText('No balls left',W/2,H*.79);
   }
  }finally{ctx.restore()}
 }
 state.transientFx={active:events.length,types:Object.fromEntries([...new Set(events.map(e=>e.type))].map(type=>[type,events.filter(e=>e.type===type).length]))};
}

let artConfig=null,backgroundLayers=[],uniforms=[],waterVisualTime=null,waterPreviousTime=null;
const imageLoads=new Map;
function loadImage(url){if(!imageLoads.has(url))imageLoads.set(url,new Promise((resolve,reject)=>{const im=new Image;im.onload=()=>resolve(im);im.onerror=()=>reject(Error(`Unable to load ${url}`));im.src=url}));return imageLoads.get(url)}
// Texture.clone shares Source by default; isolate each artwork layer before replacing its image.
// Three assigns random UUIDs in constructors. Keep these synchronous art allocations
// on their own random stream; always restore the game's provider before yielding.
let artSeed=613;
function artAllocation(make){const gameplayRandom=Math.random;Math.random=()=>{artSeed=(Math.imul(artSeed,1664525)+1013904223)>>>0;return artSeed/4294967296};try{return make()}finally{Math.random=gameplayRandom}}
const objectFeedback=createRoyalObjectFeedback(g,state,artAllocation);
const cannonLight=createRoyalCannonLight(g,state);cannonLight.tryInstall();
function layerTexture(texture,image){return artAllocation(()=>{const clone=texture.clone();clone.source=new texture.source.constructor(image);clone.needsUpdate=true;return clone})}
function patchMaterial(material,kind){const old=material.onBeforeCompile?.bind(material);const time={value:0};uniforms.push(time);material.onBeforeCompile=shader=>{old?.(shader);shader.uniforms.royalTime=time;shader.fragmentShader=`uniform float royalTime;
vec2 royalPalmWind(vec2 uv){
 float side=step(.5,uv.x);vec2 root=mix(vec2(.2700,.6748),vec2(.6938,.6748),side);
 float rise=max(0.0,uv.y-root.y);
 float gust=sin(royalTime*.65+side*2.1)*.65+sin(royalTime*1.13+side*4.0)*.35;
 float pause=.35+.65*smoothstep(-.7,.7,sin(royalTime*.23+side*2.7));
 vec2 crown=mix(vec2(.293,.709),vec2(.672,.712),side),d=uv-crown;
 float angle=atan(d.y,d.x),tip=smoothstep(.010,.047,length(d));
 float crownMask=smoothstep(root.y+.025,root.y+.055,uv.y);
 float flex=sin(angle*3.0+royalTime*.95+side*2.4)*sin(royalTime*.41+side*1.1)*.0014*tip*crownMask*pause;
 uv+=vec2(cos(angle+1.5708),sin(angle+1.5708))*flex;
 uv.x-=rise*rise*gust*pause*.40;
 return uv;
}
`+shader.fragmentShader;
 let uv='vec2 ruv=vMapUv;';
 if(kind==='water')uv+=`float wet=1.0-smoothstep(0.53,0.57,ruv.y);float depth=clamp((.57-ruv.y)*2.0,0.0,1.0);ruv.x+=wet*depth*(sin(ruv.y*90.0+royalTime*.65)*.0011+sin(ruv.y*153.0-royalTime*.41)*.0005);ruv.y+=wet*depth*sin(ruv.x*65.0+royalTime*.43)*.0007;`;
 if(kind==='palms')uv+='ruv=royalPalmWind(ruv);';
 if(kind==='shadow')uv+=`float side=step(.5,ruv.x);vec2 root=mix(vec2(.2700,.6748),vec2(.6938,.6748),side);float rise=(root.y-ruv.y)*3.8;ruv=vec2(root.x+(ruv.x-root.x)+rise*.45,root.y+rise);ruv=royalPalmWind(ruv);`;
 const body=kind==='shadow'?`vec4 src=texture2D(map,ruv);float mask=smoothstep(.64,.661,vMapUv.y)*(1.0-smoothstep(.674,.677,vMapUv.y));diffuseColor*=vec4(.10,.22,.25,src.a*.28*mask);`:`diffuseColor*=texture2D(map,ruv);`;
 shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP\n${uv}${body}\n#endif`)};material.customProgramCacheKey=()=>`royal-${kind}-azure-v2`;material.needsUpdate=true}
async function installArt(){
 try{
  const res=await fetch('assets/art-manifest.json');if(!res.ok)throw Error('Art manifest missing');artConfig=await res.json();
  // Load the complete treatment together, including late UI surfaces. Cached
  // promises keep the later installation steps in one microtask chain instead
  // of exposing a half-restyled scene during an asynchronous network startup.
  const resources=[...Object.values(artConfig.textures||{}),artConfig.background,artConfig.palms,artConfig.plume,...(artConfig.plumeFrames||[]),...Object.values(artConfig.ui||{}).flatMap(value=>typeof value==='string'?[value]:Object.values(value||{}))].filter(value=>typeof value==='string'&&value);
  await Promise.all([...new Set(resources)].map(file=>loadImage(/^(?:data:|blob:|https?:|\/|\.\/assets\/|assets\/)/.test(file)?file:`assets/${file}`)));
  while(!g.backgroundMesh||g.levelLoading||g.warmupState)await new Promise(r=>setTimeout(r,35));
  await g.assets.waitForCachedTextures();
  const painted=new Map(await Promise.all(Object.entries(artConfig.textures||{}).map(async([name,file])=>[name,await loadImage(`assets/${file}`)])));
  const textureOriginal=g.assets.texture.bind(g.assets),applied=new WeakSet();
  function applyTexture(name,texture){const image=painted.get(name);if(!image||applied.has(texture))return;applied.add(texture);Promise.resolve(texture.userData.readyPromise).then(()=>{texture.image=image;texture.needsUpdate=true;state.replaced.push(name)})}
  for(const [name,texture] of g.assets.textureCache)applyTexture(name,texture);
  g.assets.texture=function(name){const texture=textureOriginal(name);applyTexture(name,texture);return texture};
  if(artConfig.plume)plume=await loadImage(`assets/${artConfig.plume}`);
  if(artConfig.plumeFrames)plumeFrames=await Promise.all(artConfig.plumeFrames.map(file=>loadImage(`assets/${file}`)));
  const bg=g.backgroundMesh;
  if(artConfig.background){const im=await loadImage(`assets/${artConfig.background}`);bg.material=artAllocation(()=>bg.material.clone());bg.material.map=layerTexture(bg.material.map,im);patchMaterial(bg.material,'water');state.replaced.push('BackgroundWater')}
  if(artConfig.palms){const im=await loadImage(`assets/${artConfig.palms}`);for(const kind of ['shadow','palms']){const layer=artAllocation(()=>bg.clone());layer.name=`Painted ${kind}`;layer.material=artAllocation(()=>bg.material.clone());layer.material.map=layerTexture(bg.material.map,im);layer.material.transparent=true;layer.material.depthWrite=false;layer.material.onBeforeCompile=()=>{};layer.renderOrder=bg.renderOrder+(kind==='shadow'?1:2);patchMaterial(layer.material,kind);bg.parent.add(layer);backgroundLayers.push(layer)}}
  const finish=await installAzureFinish(g,state,artConfig,loadImage,artAllocation);
  if(!finish.ready)throw Error('Azure material/UI finish did not complete');
  state.artReady=true;mark('art-ready',{textures:state.replaced,finish:finish.version,plumePhases:plumeFrames.length});
 }catch(e){state.errors.push(String(e));console.error('[Royal painted]',e)}
}

// Extra articulation is applied to visual joints for the render only, then restored.
// This prevents a moving muzzle/socket from ever changing an original shot trajectory.
function articulate(t){if(state.lowMotion||shotAt<0||!g.cannonFireTargets)return()=>{};const age=(t-shotAt)/1000;if(age>.58)return()=>{};const saved=[];const recoil=Math.exp(-age*8)*Math.sin(age*17);for(const [path,amount] of [['Cannon_Root/joint3',.075],['Cannon_Root/joint3/joint2',.24]]){const record=g.cannonFireTargets.get(path),node=record?.node||record;if(!node?.position)continue;saved.push([node,node.position.clone(),node.quaternion.clone(),node.scale.clone()]);node.position.z-=recoil*amount;node.rotation.x+=recoil*(path.endsWith('joint2')?.065:-.025);node.scale.y*=1+recoil*.025;node.updateMatrix()}state.jointSamples??=[];state.jointSamples.push({t:age,values:saved.map(([n])=>({name:n.name,position:n.position.toArray(),quaternion:n.quaternion.toArray()}))});if(state.jointSamples.length>80)state.jointSamples.shift();return()=>{for(const[n,p,q,s]of saved){n.position.copy(p);n.quaternion.copy(q);n.scale.copy(s);n.updateMatrix()}g.cannonRig?.updateMatrixWorld(true)}}
hook('renderScene',function(fn,a){installWaterHook();presentation('install object feedback',()=>objectFeedback.tryInstall());presentation('install cannon light',()=>cannonLight.tryInstall());const t=performance.now(),dt=Math.min((t-lastTime)/1000,.05);lastTime=t;if(!state.lowMotion&&!document.hidden)ambientTime+=dt;state.ambientTime=ambientTime;for(const u of uniforms)u.value=ambientTime;for(const layer of backgroundLayers){layer.position.copy(this.backgroundMesh.position);layer.quaternion.copy(this.backgroundMesh.quaternion);layer.scale.copy(this.backgroundMesh.scale)}if(this.water){const wt=this.water.time;if(waterVisualTime===null)waterVisualTime=wt;if(!state.lowMotion&&waterPreviousTime!==null)waterVisualTime+=Math.max(0,wt-waterPreviousTime);waterPreviousTime=wt;for(const material of [this.water.surface?.material,this.water.ringMaterial])if(material?.uniforms?.uTime)material.uniforms.uTime.value=waterVisualTime;state.waterVisualTime=waterVisualTime;}const restore=articulate(t);let result;try{if(state.lowMotion)this.lastFairyTime=t*.001;result=fn.apply(this,state.lowMotion?[false]:a)}finally{presentation('restore cannon pose',restore)}presentation('draw feedback',()=>draw(t));state.frames++;return result});
state.capture=()=>({version:VERSION,ready:state.ready,artReady:state.artReady,lowMotion:state.lowMotion,ambientTime,errors:state.errors,replaced:state.replaced,eventCount:state.events.length,eventTypes:Object.fromEntries([...new Set(state.events.map(e=>e.type))].map(k=>[k,state.events.filter(e=>e.type===k).length])),audioCount:state.audio.length,audioByName:Object.fromEntries([...new Set(state.audio.map(e=>e.name))].map(k=>[k,state.audio.filter(e=>e.name===k).length])),jointSamples:state.jointSamples||[],azureFinish:state.azureFinish,objectFeedback:state.objectFeedback,cannonLight:state.cannonLight,transientFx:state.transientFx,waterFxCounts:state.waterFxCounts,plumePhases:plumeFrames.length,waterVisualTime,frames:state.frames});
state.ready=true;installArt();
