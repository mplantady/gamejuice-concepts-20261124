/* Royal Smash: Painted Tides. This module only observes gameplay and renders presentation.
 * The original engine, random stream, colliders, shot vectors, counts and clocks stay intact. */
const VERSION='royal-smash-painted-v1';
const state=window.__royalPolish={version:VERSION,ready:false,artReady:false,errors:[],events:[],audio:[],replaced:[],frames:0,ambientTime:0,lowMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
const waitForGame=()=>new Promise(resolve=>{const poll=()=>window.__royalSmashGame?resolve(window.__royalSmashGame):setTimeout(poll,20);poll()});
const g=await waitForGame();
const events=[];let serial=0,lastTime=performance.now(),ambientTime=0,lastWaterFx=-1000;
const canvas=document.createElement('canvas');canvas.id='royal-fx';document.getElementById('app').append(canvas);
const ctx=canvas.getContext('2d');let W=0,H=0,dpr=1;
function resize(){W=innerWidth;H=innerHeight;dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)}resize();addEventListener('resize',resize);
function mark(type,data={}){const e={type,t:performance.now(),level:g.levelIndex,balls:g.remainingMoves,...data};state.events.push(e);if(state.events.length>800)state.events.shift();return e}
function emit(type,position,extra={}){if(type==='water'){const now=performance.now();if(now-lastWaterFx<85)return;lastWaterFx=now;}const p=position?{x:position.x,y:position.y,z:position.z}:null;events.push({type,position:p,t:performance.now(),serial:serial++,...extra});if(events.length>30)events.shift();mark(type,extra)}
function point(p){if(!p||!g.camera)return {x:W/2,y:H/2};const v=g.camera.position.clone().set(p.x,p.y,p.z).project(g.camera);return{x:(v.x*.5+.5)*W,y:(.5-v.y*.5)*H}}
function hook(name,callback){const fn=g[name];if(typeof fn!=='function')return;g[name]=function(...args){return callback.call(this,fn,args)}}
function pulse(name){const p=g.ui.movesPanel;if(!p)return;p.classList.remove(name);void p.offsetWidth;p.classList.add(name);setTimeout(()=>p.classList.remove(name),250)}
let shotAt=-1,lastRejected=-1000,aimHeld=false,plume=null,tableContacts=new WeakMap;
const waterHooks=new WeakSet;
function installWaterHook(){const water=g.water;if(!water||waterHooks.has(water)||typeof water.enter!=='function')return;const enter=water.enter;water.enter=function(...a){const [object,body,options={}]=a,already=this.floaters.has(object);const r=enter.apply(this,a);if(!already&&this.floaters.has(object)&&g.levelShotFired){const contact=options.contactPoint||body.position;emit('water',{x:contact.x,y:this.surfaceY,z:contact.z},{kind:options.kind})}return r};waterHooks.add(water)}
hook('onPointerDown',function(fn,a){const r=fn.apply(this,a);aimHeld=true;return r});
hook('onPointerUp',function(fn,a){aimHeld=false;return fn.apply(this,a)});
hook('createBall',function(fn,a){const value=fn.apply(this,a);shotAt=performance.now();emit('shot',a[0]);pulse('royal-shot');return value});
hook('shootFromPointer',function(fn,a){const unavailable=this.inputLocked||this.levelLoading||this.remainingMoves<=0;const r=fn.apply(this,a);if(unavailable&&(this.remainingMoves<=0||this.failureScheduled)&&performance.now()-lastRejected>500){lastRejected=performance.now();pulse('royal-empty');emit('unavailable',null,{reason:'no balls or result locked'})}return r});
hook('handleBallObject',function(fn,a){const [ball,obj,,contact]=a;const before=ball?.obstacleHits||0;const r=fn.apply(this,a);if((ball?.obstacleHits||0)>before)emit('impact',contact||ball.body.position,{category:obj.category,launch:ball.launchSeq});return r});
hook('handleBallTable',function(fn,a){const ball=a[0],accepted=ball?.active&&!ball.destroyed,launch=ball?.launchSeq;const r=fn.apply(this,a);if(accepted&&tableContacts.get(ball)!==launch){tableContacts.set(ball,launch);emit('table',a[1]||ball.body.position,{launch})}return r});
hook('checkForComplete',function(fn,a){const before=this.completionScheduled;const r=fn.apply(this,a);if(!before&&this.completionScheduled)emit('level-clear',null,{next:this.completionNextLevelId,remaining:this.objects.filter(o=>o.target&&!o.cleared).length});return r});
hook('scheduleFail',function(fn,a){const before=this.failureScheduled;const r=fn.apply(this,a);if(!before&&this.failureScheduled)emit('fail',null);return r});
hook('showEndText',function(fn,a){const r=fn.apply(this,a);if(a[1]==='win')emit('winner',null);return r});
hook('loadLevel',function(fn,a){for(let i=events.length-1;i>=0;i--)if(events[i].type!=='level-clear')events.splice(i,1);shotAt=-1;lastWaterFx=-1000;aimHeld=false;lastRejected=-1000;tableContacts=new WeakMap;mark('load',{requested:a[0]});return fn.apply(this,a)});

// Warm the original additive flash so the painted ivory smoke retains detail.
// Supported particle tint leaves source emission count, lifetime and RNG intact.
const cannonParticles=g.effects.playCannonFireParticles;
g.effects.playCannonFireParticles=function(origin,direction,options={}){const tweaks=options.systemTweaks||{};return cannonParticles.call(this,origin,direction,{...options,systemTweaks:{...tweaks,ImpactCircle:{...tweaks.ImpactCircle,tint:[.62,.52,.36]},Smoke:{...tweaks.Smoke,tint:[.92,.86,.73]}}})};

// Existing sampled sound is retained, with deterministic timbral variation and a quiet cannon tail.
const play=g.assets.playAudio.bind(g.assets);let audioSerial=0;
const audioBuses=new Map(),bufferPlay=g.assets.webAudio.playBuffer;
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
g.assets.playAudio=function(name,volume=1,rate=1){if(g.muted)return;const k=audioSerial++,variate=[.98,1.025,.955,1.045,1][k%5];const impact=/Hit|Breaking|Break/.test(name),cannon=name==='Cannon';const gain=volume*(impact?.88:cannon?.88:1),pitch=rate*(impact?variate:1);state.audio.push({name,t:performance.now(),gain,pitch});if(state.audio.length>500)state.audio.shift();play(name,gain,pitch);if(cannon){const seq=g.fireSeq;setTimeout(()=>{if(!g.muted&&!document.hidden&&seq===g.fireSeq){play('Cannon',.09,.73);state.audio.push({name:'Cannon tail',t:performance.now(),gain:.09,pitch:.73})}},32)}};

const controls=document.createElement('div');controls.id='royal-options';controls.innerHTML='<button type="button" aria-label="Mute sound" aria-pressed="false">Sound on</button><button type="button" aria-label="Reduce decorative motion" aria-pressed="false">Calm motion</button>';document.getElementById('app').append(controls);
const [sound,motion]=controls.children;
sound.onclick=()=>{g.muted=!g.muted;g.assets.setMusicMuted(g.muted);for(const[context,bus]of audioBuses)bus.gain.gain.setTargetAtTime(g.muted?0:.75,context.currentTime,.008);syncNativeMute();sound.textContent=g.muted?'Sound off':'Sound on';sound.setAttribute('aria-pressed',String(g.muted));sound.setAttribute('aria-label',g.muted?'Unmute sound':'Mute sound')};
function setLow(value){state.lowMotion=!!value;document.body.classList.toggle('royal-low-motion',state.lowMotion);motion.setAttribute('aria-pressed',String(state.lowMotion));lastTime=performance.now()}
addEventListener('pointerup',()=>{aimHeld=false});addEventListener('pointercancel',()=>{aimHeld=false});
motion.onclick=()=>setLow(!state.lowMotion);matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>setLow(e.matches));setLow(state.lowMotion);state.setLowMotion=setLow;

// Draw only temporary contact graphics. All positions come from actual world contacts.
function ring(x,y,r,alpha,color,ys=.45){ctx.save();ctx.translate(x,y);ctx.scale(1,ys);ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();ctx.restore()}
function draw(t){ctx.clearRect(0,0,W,H);const scale=Math.min(W/390,H/694);if(aimHeld&&g.lastAimTarget){const p=point(g.lastAimTarget);ring(p.x,p.y,12*scale,.75,'#fff4c4',1);}for(let i=events.length-1;i>=0;i--){const e=events[i],age=(t-e.t)/1000,duration=e.type==='winner'?2.5:e.type==='level-clear'?1.25:e.type==='water'?1.0:.72;if(age>duration){events.splice(i,1);continue}const p=point(e.position),u=age/duration,fade=Math.max(0,1-u);ctx.save();
 if(e.type==='shot'){
  if(!state.lowMotion&&plume){const r=(50+u*46)*scale;ctx.save();ctx.translate(p.x,p.y-u*30*scale);ctx.rotate((e.serial%3-1)*.17+u*.14);ctx.globalAlpha=fade*.62;ctx.drawImage(plume,-r/2,-r/2,r,r);ctx.restore();}
  if(!state.lowMotion&&!plume){for(let n=0;n<5;n++){const a=n*1.37+e.serial*.4,r=(8+u*32)*scale,x=p.x+Math.cos(a)*u*25*scale,y=p.y-u*24*scale+Math.sin(a)*u*13*scale;const grad=ctx.createRadialGradient(x,y,0,x,y,r);grad.addColorStop(0,`rgba(255,244,207,${fade*.22})`);grad.addColorStop(.56,`rgba(238,233,215,${fade*.16})`);grad.addColorStop(1,'rgba(235,232,211,0)');ctx.fillStyle=grad;ctx.fillRect(x-r,y-r,r*2,r*2)}}
  if(age<.13)ring(p.x,p.y,(8+age*180)*scale,(1-age/.13)*.95,'#fff4c4',.7);
 }else if(e.type==='impact'||e.type==='table'){
  const r=(8+u*28)*scale;if(u<.5)ring(p.x,p.y,r,fade*.75,'#fff4d0',.72);
  if(!state.lowMotion){for(let n=0;n<7;n++){const a=(n/7)*Math.PI*2+e.serial*.7,d=(10+u*42)*scale;const x=p.x+Math.cos(a)*d,y=p.y+Math.sin(a)*d*.7+u*u*24*scale;ctx.globalAlpha=fade*.9;ctx.strokeStyle=n%2?'#c6f6ff':'#fff6d2';ctx.lineWidth=(n%3+1)*scale;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*8*fade*scale,y+Math.sin(a)*8*fade*scale);ctx.stroke()}}
 }else if(e.type==='water'){
  ring(p.x,p.y,(8+u*42)*scale,fade*.65,'#c5f7ee',.26);if(!state.lowMotion&&u<.65){for(let n=0;n<5;n++){const dx=(n-2)*12*u*scale,y=p.y-Math.sin(u/.65*Math.PI)*(20-Math.abs(n-2)*3)*scale;ctx.globalAlpha=fade*.65;ctx.fillStyle='#effff8';ctx.beginPath();ctx.ellipse(p.x+dx,y,2*scale,4*fade*scale,dx*.02,0,Math.PI*2);ctx.fill()}}
 }else if(e.type==='level-clear'){
  // Clear feedback only after the engine commits completion. No extra score/reward is invented.
  if(u<.8){const y=H*.39;ctx.globalAlpha=Math.min(1,age*8)*Math.min(1,(1-u)*3);ctx.textAlign='center';ctx.font=`700 ${22*scale}px Remissis,system-ui`;ctx.lineWidth=5*scale;ctx.strokeStyle='#234d66';ctx.fillStyle='#fff6d5';ctx.strokeText('Level clear!',W/2,y);ctx.fillText('Level clear!',W/2,y)}
  if(!state.lowMotion)for(let n=0;n<10;n++){const a=n/10*Math.PI*2,r=(30+u*85)*scale;ctx.globalAlpha=fade*.8;ctx.fillStyle=n%2?'#fff0b4':'#bff9f1';ctx.save();ctx.translate(W/2+Math.cos(a)*r,H*.39+Math.sin(a)*r*.6);ctx.rotate(a+u);ctx.fillRect(-2*scale,-5*scale,4*scale,10*scale);ctx.restore()}
 }else if(e.type==='unavailable'){ctx.globalAlpha=fade;ctx.textAlign='center';ctx.font=`600 ${13*scale}px system-ui`;ctx.fillStyle='#fff5d7';ctx.shadowColor='#20324b';ctx.shadowBlur=5;ctx.fillText('No balls left',W/2,H*.79)}
 ctx.restore()}}

let artConfig=null,backgroundLayers=[],uniforms=[],waterVisualTime=null,waterPreviousTime=null;
function loadImage(url){return new Promise((resolve,reject)=>{const im=new Image;im.onload=()=>resolve(im);im.onerror=()=>reject(Error(`Unable to load ${url}`));im.src=url})}
// Texture.clone shares Source by default; isolate each artwork layer before replacing its image.
// Three assigns random UUIDs in constructors. Keep these synchronous art allocations
// on their own random stream; always restore the game's provider before yielding.
let artSeed=613;
function artAllocation(make){const gameplayRandom=Math.random;Math.random=()=>{artSeed=(Math.imul(artSeed,1664525)+1013904223)>>>0;return artSeed/4294967296};try{return make()}finally{Math.random=gameplayRandom}}
function layerTexture(texture,image){return artAllocation(()=>{const clone=texture.clone();clone.source=new texture.source.constructor(image);clone.needsUpdate=true;return clone})}
function patchMaterial(material,kind){const old=material.onBeforeCompile?.bind(material);const time={value:0};uniforms.push(time);material.onBeforeCompile=shader=>{old?.(shader);shader.uniforms.royalTime=time;shader.fragmentShader='uniform float royalTime;\n'+shader.fragmentShader;
 let uv='vec2 ruv=vMapUv;';
 if(kind==='water')uv+=`float wet=1.0-smoothstep(0.53,0.57,ruv.y);float depth=clamp((.57-ruv.y)*2.0,0.0,1.0);ruv.x+=wet*depth*(sin(ruv.y*90.0+royalTime*.65)*.0011+sin(ruv.y*153.0-royalTime*.41)*.0005);ruv.y+=wet*depth*sin(ruv.x*65.0+royalTime*.43)*.0007;`;
 if(kind==='palms')uv+=`float side=step(.5,ruv.x);vec2 root=mix(vec2(.2700,.6748),vec2(.6938,.6748),side);float rise=max(0.0,ruv.y-root.y);float gust=sin(royalTime*.65+side*2.1)*.65+sin(royalTime*1.13+side*4.0)*.35;float pause=.35+.65*smoothstep(-.7,.7,sin(royalTime*.23+side*2.7));ruv.x-=rise*rise*gust*pause*.40;float crown=smoothstep(.045,.11,rise);ruv.y+=sin((ruv.x-root.x)*83.0+royalTime*1.25+side*3.0)*crown*.0018;`;
 if(kind==='shadow')uv+=`float side=step(.5,ruv.x);vec2 root=mix(vec2(.2700,.6748),vec2(.6938,.6748),side);float rise=(root.y-ruv.y)*3.8;float gust=sin(royalTime*.65+side*2.1)*.65+sin(royalTime*1.13+side*4.0)*.35;float pause=.35+.65*smoothstep(-.7,.7,sin(royalTime*.23+side*2.7));ruv=vec2(root.x+(ruv.x-root.x)+rise*.45-rise*rise*gust*pause*.4,root.y+rise);`;
 const body=kind==='shadow'?`vec4 src=texture2D(map,ruv);float mask=smoothstep(.64,.661,vMapUv.y)*(1.0-smoothstep(.674,.677,vMapUv.y));diffuseColor*=vec4(.10,.22,.25,src.a*.20*mask);`:`diffuseColor*=texture2D(map,ruv);`;
 shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP\n${uv}${body}\n#endif`)};material.customProgramCacheKey=()=>`royal-${kind}-v1`;material.needsUpdate=true}
async function installArt(){
 try{
  const res=await fetch('assets/art-manifest.json');if(!res.ok)throw Error('Art manifest missing');artConfig=await res.json();
  while(!g.backgroundMesh||g.levelLoading||g.warmupState)await new Promise(r=>setTimeout(r,35));
  await g.assets.waitForCachedTextures();
  const painted=new Map(await Promise.all(Object.entries(artConfig.textures||{}).map(async([name,file])=>[name,await loadImage(`assets/${file}`)])));
  const textureOriginal=g.assets.texture.bind(g.assets),applied=new WeakSet();
  function applyTexture(name,texture){const image=painted.get(name);if(!image||applied.has(texture))return;applied.add(texture);Promise.resolve(texture.userData.readyPromise).then(()=>{texture.image=image;texture.needsUpdate=true;state.replaced.push(name)})}
  for(const [name,texture] of g.assets.textureCache)applyTexture(name,texture);
  g.assets.texture=function(name){const texture=textureOriginal(name);applyTexture(name,texture);return texture};
  if(artConfig.plume)plume=await loadImage(`assets/${artConfig.plume}`);
  const bg=g.backgroundMesh;
  if(artConfig.background){const im=await loadImage(`assets/${artConfig.background}`);bg.material=artAllocation(()=>bg.material.clone());bg.material.map=layerTexture(bg.material.map,im);patchMaterial(bg.material,'water');state.replaced.push('BackgroundWater')}
  if(artConfig.palms){const im=await loadImage(`assets/${artConfig.palms}`);for(const kind of ['shadow','palms']){const layer=artAllocation(()=>bg.clone());layer.name=`Painted ${kind}`;layer.material=artAllocation(()=>bg.material.clone());layer.material.map=layerTexture(bg.material.map,im);layer.material.transparent=true;layer.material.depthWrite=false;layer.material.onBeforeCompile=()=>{};layer.renderOrder=bg.renderOrder+(kind==='shadow'?1:2);patchMaterial(layer.material,kind);bg.parent.add(layer);backgroundLayers.push(layer)}}
  state.artReady=true;mark('art-ready',{textures:state.replaced});
 }catch(e){state.errors.push(String(e));console.error('[Royal painted]',e)}
}

// Extra articulation is applied to visual joints for the render only, then restored.
// This prevents a moving muzzle/socket from ever changing an original shot trajectory.
function articulate(t){if(state.lowMotion||shotAt<0||!g.cannonFireTargets)return()=>{};const age=(t-shotAt)/1000;if(age>.58)return()=>{};const saved=[];const recoil=Math.exp(-age*8)*Math.sin(age*17);for(const [path,amount] of [['Cannon_Root/joint3',.055],['Cannon_Root/joint3/joint2',.13]]){const record=g.cannonFireTargets.get(path),node=record?.node||record;if(!node?.position)continue;saved.push([node,node.position.clone(),node.quaternion.clone(),node.scale.clone()]);node.position.z-=recoil*amount;node.rotation.x+=recoil*(path.endsWith('joint2')?.035:-.018);node.scale.y*=1+recoil*.025;node.updateMatrix()}state.jointSamples??=[];state.jointSamples.push({t:age,values:saved.map(([n])=>({name:n.name,position:n.position.toArray(),quaternion:n.quaternion.toArray()}))});if(state.jointSamples.length>80)state.jointSamples.shift();return()=>{for(const[n,p,q,s]of saved){n.position.copy(p);n.quaternion.copy(q);n.scale.copy(s);n.updateMatrix()}g.cannonRig?.updateMatrixWorld(true)}}
hook('renderScene',function(fn,a){installWaterHook();const t=performance.now(),dt=Math.min((t-lastTime)/1000,.05);lastTime=t;if(!state.lowMotion&&!document.hidden)ambientTime+=dt;state.ambientTime=ambientTime;for(const u of uniforms)u.value=ambientTime;for(const layer of backgroundLayers){layer.position.copy(this.backgroundMesh.position);layer.quaternion.copy(this.backgroundMesh.quaternion);layer.scale.copy(this.backgroundMesh.scale)}if(this.water){const wt=this.water.time;if(waterVisualTime===null)waterVisualTime=wt;if(!state.lowMotion&&waterPreviousTime!==null)waterVisualTime+=Math.max(0,wt-waterPreviousTime);waterPreviousTime=wt;for(const material of [this.water.surface?.material,this.water.ringMaterial])if(material?.uniforms?.uTime)material.uniforms.uTime.value=waterVisualTime;state.waterVisualTime=waterVisualTime;}const restore=articulate(t);let result;try{if(state.lowMotion)this.lastFairyTime=t*.001;result=fn.apply(this,state.lowMotion?[false]:a)}finally{restore()}draw(t);state.frames++;return result});
state.capture=()=>({version:VERSION,ready:state.ready,artReady:state.artReady,lowMotion:state.lowMotion,ambientTime,errors:state.errors,replaced:state.replaced,eventCount:state.events.length,eventTypes:Object.fromEntries([...new Set(state.events.map(e=>e.type))].map(k=>[k,state.events.filter(e=>e.type===k).length])),audioCount:state.audio.length,audioByName:Object.fromEntries([...new Set(state.audio.map(e=>e.name))].map(k=>[k,state.audio.filter(e=>e.name===k).length])),jointSamples:state.jointSamples||[],waterVisualTime,frames:state.frames});
state.ready=true;installArt();
