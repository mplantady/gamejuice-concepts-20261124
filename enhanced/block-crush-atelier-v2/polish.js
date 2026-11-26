/* Jewel Atelier. Presentation only: original simulation, RNG and callbacks always run. */
(() => {
'use strict';
const version='block-crush-atelier-20261126-v2';
const state=window.__blockPolish={version,ready:false,errors:[],events:[],counts:{},replaced:{},suppressed:{sprites:{},particles:0,armatures:{}},nativeSprites:{},frames:0,ambientFrames:0,ambientTime:0,landingFrames:0,jewelJointFrames:0,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,muted:false,assets:0};
const root=new URL('.',document.currentScript.src),images={},frames={},spriteMap={},lands=new WeakMap(),clears=new WeakMap(),hudHits=new WeakMap(),effects=[],silencedClips=new Set(),observedSprites=new Map();
const resultAppear=new WeakMap();
const finishedTargets=new Set(),GEMS=[11,13,14,15,16,17];
const FX_ROOTS=new Set(['put_se','destroy_node','pre_destroy_back','pre_destroy_front','score_num']);
const FX_SPRITES=new Set(['sd_ori','combo_glow3','glow2','part','expo','atom1','click_se','combo_heart_glow','combo_heart_glow2','stat_glow','stat_recv','combo_crush']);
const FX_ARMATURES=new Set(['gameplay_option_blast_1_ske','gameplay_option_blast_2_ske','gameplay_blocklight_ske','gameplay_elimination_ske','gameplay_encourage_ske']);
let manifest=null,cc=null,C=null,control=null,renderer=null,previous=0,fx=null,ctx=null,bg=null,bctx=null,bgBase=null,bgFrame=null,lastBg=-1;
let selected=null,lastReceive=-1,audio=null,master=null,noise=null,serial=0,epoch=0,shake=null,installed=false;
const now=()=>performance.now()/1000;
const hash=i=>{let n=Math.imul(i+177,374761393);n^=n>>>13;return ((Math.imul(n,1274126177)^(n>>>16))>>>0)/4294967296};
const count=(obj,key)=>obj[key]=(obj[key]||0)+1;
function event(type,data={}){count(state.counts,type);const e={type,time:now(),epoch,...data};state.events.push(e);if(state.events.length>1000)state.events.shift();return e}
function failure(e){const message=e?.stack||String(e);if(!state.errors.includes(message))state.errors.push(message)}
function safe(fn,...args){try{return fn?.(...args)}catch(e){failure(e)}}
function wrap(obj,key,before,after){const fn=obj?.[key];if(typeof fn!=='function'||fn.__atelier)return;function call(...args){let memo;try{memo=before?.apply(this,args)}catch(e){failure(e)}const result=fn.apply(this,args);try{after?.call(this,result,memo,...args)}catch(e){failure(e)}return result}call.__atelier=true;obj[key]=call}
function waitFor(test){return new Promise((resolve,reject)=>{const start=now();function poll(){try{if(test())return resolve();if(now()-start>40)return reject(Error('Game startup did not become ready'));setTimeout(poll,25)}catch(e){reject(e)}}poll()})}
function load(file){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('Asset failed: '+file));im.src=new URL(file,root)})}
function world(node){return node.convertToWorldSpaceAR(cc.v2(0,0))}
function center(block){return world(block.spr_node||block.node)}
function shakeOffset(){if(!state.reduced||!shake||now()>shake.until||!shake.node?.parent)return {x:0,y:0};const n=shake.node,p=n.parent;const a=p.convertToWorldSpaceAR(n.position),b=p.convertToWorldSpaceAR(cc.v2(shake.x,shake.y));return {x:a.x-b.x,y:a.y-b.y}}
function visualMatrix(m){const q=shakeOffset();if(!q.x&&!q.y)return m;const out=m.slice();out[4]-=q.x;out[5]-=q.y;return out}
function screen(p){const q=window.__blockPresentation.layout(),s=shakeOffset();return {x:q.x+(p.x-s.x)*q.s,y:innerHeight-q.y-(p.y-s.y)*q.s,s:q.s}}
function puff(type,p,data={}){effects.push({type,p:{x:p.x,y:p.y},t:now(),...data});if(effects.length>320)effects.splice(0,effects.length-320)}
function ancestor(node,predicate){for(let n=node;n;n=n.parent)if(predicate(n))return n;return null}
function muted(){return state.muted||!!cc?.mute||!!control?.mute||document.hidden}
function silence(...clips){for(const clip of clips.flat())if(clip)silencedClips.add(clip)}

function initAudio(){if(audio)return;try{audio=new (window.AudioContext||window.webkitAudioContext)();state.audioContext=audio;master=audio.createGain();master.gain.value=muted()?0:.52;const limiter=audio.createDynamicsCompressor();limiter.threshold.value=-14;limiter.knee.value=12;limiter.ratio.value=5;limiter.attack.value=.002;limiter.release.value=.16;master.connect(limiter);limiter.connect(audio.destination);noise=audio.createBuffer(1,Math.floor(audio.sampleRate*.12),audio.sampleRate);const samples=noise.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=(hash(i)-.5)*2*Math.exp(-i/samples.length*9)}catch(e){failure('Audio: '+e.message)}}
function sound(kind,value=0){if(muted())return;initAudio();if(!audio||audio.state!=='running')return;const t=audio.currentTime;count(state.counts,'sound-'+kind);
 const note=(freq,delay,amp,dur=.28)=>{for(const [mul,gain]of [[1,1],[2.71,.19],[5.43,.055]]){const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.setValueAtTime(freq*mul,t+delay);o.frequency.exponentialRampToValueAtTime(freq*mul*.998,t+delay+dur);g.gain.setValueAtTime(0,t+delay);g.gain.linearRampToValueAtTime(amp*gain,t+delay+.003);g.gain.exponentialRampToValueAtTime(.0001,t+delay+dur);o.connect(g);g.connect(master);o.start(t+delay);o.stop(t+delay+dur+.01)}};
 const tap=(freq,amp,duration)=>{const src=audio.createBufferSource(),filter=audio.createBiquadFilter(),g=audio.createGain();src.buffer=noise;filter.type='bandpass';filter.frequency.value=freq;filter.Q.value=1.8;g.gain.value=amp;src.connect(filter);filter.connect(g);g.connect(master);src.start(t);src.stop(t+duration)};
 if(kind==='pickup'){note(880,0,.028,.13);tap(2600,.065,.04)}
 if(kind==='invalid'){note(147,0,.095,.10);tap(530,.17,.05)}
 if(kind==='place'){const f=[523.25,587.33,659.25,698.46][value%4];note(f,0,.105,.23);note(f*.5,0,.065,.13);tap(1950,.15,.055)}
 if(kind==='clear'){[523.25,659.25,783.99,1046.5].slice(0,value>=4?4:2).forEach((f,i)=>note(f,i*.046,.083,.72));tap(3100,.065,.08)}
 if(kind==='receive')note([783.99,987.77,1174.66][value%3],0,.022,.23);
 if(kind==='target'){note(1046.5,0,.065,.48);note(1318.5,.08,.045,.55)}
 if(kind==='finish')[523.25,659.25,783.99,1046.5].forEach((f,i)=>note(f,i*.12,.10,.95));
}
addEventListener('pointerdown',()=>{if(!muted()){initAudio();audio?.resume()}},{passive:true});
addEventListener('visibilitychange',()=>{previous=now();if(master)master.gain.value=muted()?0:.52});
function makeControls(){const el=document.createElement('div');el.id='garden-preferences';el.innerHTML='<button aria-label="Mute sound" aria-pressed="false">Sound on</button><button aria-label="Reduce decorative motion" aria-pressed="false">Motion on</button>';
 const style=document.createElement('style');style.textContent='#garden-preferences{position:fixed;left:50%;bottom:max(5px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:20;display:flex;gap:6px}#garden-preferences button{font:600 10px system-ui;color:#fff3d2;background:#143c38ed;border:1px solid #cfad68;border-radius:14px;padding:5px 10px;cursor:pointer;box-shadow:0 1px 4px #1a130a66}#garden-preferences button:focus-visible{outline:2px solid #fff1b5;outline-offset:2px}';document.head.append(style);document.body.append(el);
 const [a,b]=el.children;a.onclick=()=>{state.muted=!state.muted;if(cc)cc.mute=state.muted;if(master)master.gain.value=state.muted?0:.52;if(state.muted)cc?.audioEngine?.pauseAll?.();else{cc?.audioEngine?.resumeAll?.();audio?.resume()}a.textContent=state.muted?'Sound off':'Sound on';a.setAttribute('aria-pressed',String(state.muted))};
 state.setReduced=value=>{state.reduced=!!value;b.textContent=state.reduced?'Motion reduced':'Motion on';b.setAttribute('aria-pressed',String(state.reduced));lastBg=-1;previous=now()};b.onclick=()=>state.setReduced(!state.reduced);state.setReduced(state.reduced);matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>state.setReduced(e.matches));
}
function installHooks(){C=__require('comps').COMPS;control=__require('control').control;cc=window.cc;
 const engine=cc.audioEngine,play=engine.play;engine.play=function(clip,loop,volume){const level=muted()||silencedClips.has(clip)?0:(volume??1)*.35;return play.call(this,clip,loop,level)};
 const opt=__require('opt').default.prototype,blast=__require('blast').default.prototype,block=__require('block').default.prototype,stat=__require('stat_unit').default.prototype,score=__require('score').default.prototype;
 wrap(opt,'cancle',function(){return {p:this.node.parent.convertToWorldSpaceAR(this.ori_pos),slot:this.pos_index}},function(_,m){event('invalid',{slot:m.slot});puff('invalid',m.p);sound('invalid');selected=null});
 wrap(opt,'putOn',function(){const t=now();return this.fs_list.map(({fs},i)=>{lands.set(fs.spr_node,{t,phase:i*.006});return {p:center(fs),i:fs.i,j:fs.j}})},function(_,cells){selected=null;event('place',{cells:cells.map(x=>[x.i,x.j]),put:C.view.put_cnt});for(const c of cells)puff('place',c.p,{seed:serial++});sound('place',C.view.put_cnt-1)});
 wrap(blast,'checkBingo',null,function(result){if(!result?.lines)return;const unique=[...new Set(result.destroy_blocks.map(x=>x.block))],rows=new Set(),cols=new Set();event('clear',{lines:result.lines,cells:unique.map(b=>[b.i,b.j])});for(const {block,rotation}of result.destroy_blocks)(rotation?cols:rows).add(rotation?block.j:block.i);for(const r of rows)puff('line',center(this.block_map[r][0]),{end:center(this.block_map[r][7]),major:result.lines>=4});for(const c of cols)puff('line',center(this.block_map[0][c]),{end:center(this.block_map[7][c]),major:result.lines>=4});sound('clear',result.lines)});
 wrap(block,'blastDestroy',function(){return {p:center(this),color:this.ori_color_num}},function(_,m){if(now()-(clears.get(this)??-10)>.06){puff('clear-cell',m.p,{color:m.color,seed:serial++});clears.set(this,now())}});
 wrap(stat,'playRecv',function(){silence(this.audio_recv)},function(){hudHits.set(this.spr_ani.node,{t:now()});puff('receive',world(this.spr_ani.node),{color:this.color});event('receive',{color:this.color});if(now()-lastReceive>.055){sound('receive',this.color%3);lastReceive=now()}});
 wrap(stat,'playFinish',null,function(){if(finishedTargets.has(this.color))return;finishedTargets.add(this.color);puff('target',world(this.spr_ani?.node||this.node),{color:this.color});event('target-complete',{color:this.color});sound('target')});
 wrap(score,'showScore',function(){silence(this.audio_grade)},function(_,memo,data){if(!data?.bingo_lines)return;puff('score',world(this.node),{grade:String(this.grade?.string||'').trim(),score:String(this.score_lbl?.string||''),lines:data.bingo_lines,combo:data.combo||0});event('score-feedback',{grade:String(this.grade?.string||'').trim(),score:data.score,lines:data.bingo_lines})});
 wrap(blast,'shakeCamera',function(){shake={node:this.root,x:this.root.x,y:this.root.y,until:now()+.5}});
 wrap(blast,'gameOver',function(reason,win){return !this.is_game_over?{reason,win:!!win}:null},function(_,m){if(!m)return;event('result',m);if(m.win){puff('result',world(this.play_area),{win:true});sound('finish')}});
 wrap(blast,'restart',function(){effects.length=0;selected=null;finishedTargets.clear();serial=0;epoch++;event('restart')});
 state.hooksInstalled=true;
}
function registerAudio(){const v=C?.view;if(!v)return;silence(v.audio_move,v.audio_cancle,v.audio_put,v.audio_crush_small,v.audio_crush_big,v.audio_combo);const collection=C.eliminate_collect_star;silence(collection?.audio_gen_star,collection?.audio_fly_star);for(const t of collection?.target_list||[])silence(t.unit?.audio_recv)}

function frameFor(name,image){const meta=manifest.frameMeta?.[name]||{},logical=meta.logicalSize||[image.width,image.height],texture=__blockPresentation.texture(image),dynamic=name==='dynamic-atelier';
 // Native Three constants: LinearFilter1006; LinearMipmapLinearFilter1008.
 // Only immutable production textures get mipmaps; the24Hz background remains unmipped.
 texture.generateMipmaps=!dynamic;texture.minFilter=dynamic?1006:1008;texture.magFilter=1006;texture.needsUpdate=true;
 const f={name,image,meta,logical,texture};frames[name]=f;return f}
function compose(m,sx=1,sy=1,angle=0,tx=0,ty=0,pivot=[0,0]){const c=Math.cos(angle),s=Math.sin(angle),a=c*sx,b=s*sx,d=c*sy,e=-s*sy,x=tx+pivot[0]-a*pivot[0]-e*pivot[1],y=ty+pivot[1]-b*pivot[0]-d*pivot[1];return [m[0]*a+m[2]*b,m[1]*a+m[3]*b,m[0]*e+m[2]*d,m[1]*e+m[3]*d,m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]}
function paint(node,frame,m,opacity,width=node._w,height=node._h,anchor=[node._ax,node._ay]){if(!frame||opacity<=0||!width||!height)return;renderer._use(frame.texture,770,771);const x=-anchor[0]*width,y=-anchor[1]*height;renderer.quad(m,x,y,x+width,y+height,0,0,1,1,255,255,255,Math.min(255,Math.round(opacity*255)),false)}
function staticLocal(node,m){const parent=node.parent?._wm;return parent?visualMatrix(compose(parent,1,1,0,node.x,node.y)):visualMatrix(m)}
function staticInstallCTA(node,m){const parent=node.parent,install=parent?.parent;if(!['free_to_play','red_point'].includes(node.name)||parent?.name!=='download_end'||install?.name!=='install'||!install._wm)return visualMatrix(m);
 // Hold the exact source breath parent at authored scale1/angle0, retaining each child's local transform (including the badge's scale1.2). Source tween and hit target remain native.
 return visualMatrix(compose(compose(install._wm,1,1,0,parent.x,parent.y),node.scaleX,node.scaleY,node.angle*Math.PI/180,node.x,node.y))}
function drawTile(node,b,m,opacity){let base=visualMatrix(m);if(state.reduced&&b.in_opt){const optNode=ancestor(node,n=>!!n.getComponent?.('opt')),o=optNode?.getComponent('opt');if(o&&!o.clicking&&!o.auto_moving&&o.toy_node?.scale){const factor=o.getScale()/o.toy_node.scale,origin=world(o.toy_node);base=compose(base,factor,factor);base[4]=origin.x+(m[4]-origin.x)*factor;base[5]=origin.y+(m[5]-origin.y)*factor}}
 const hit=lands.get(node),age=hit?now()-hit.t-hit.phase:10,active=!state.reduced&&age>=0&&age<.65;
 const spring=active?Math.sin(age*22)*Math.exp(-age*8):0,compression=active?Math.sin(Math.min(1,age/.19)*Math.PI)*Math.exp(-age*8):0;
 paint(node,frames['tile-shadow'],base,opacity);
 const bezel=base;
 paint(node,frames['tile-bezel']||frames.tile,bezel,opacity);
 const face=active?compose(base,1+.045*compression,1-.075*compression,0,0,spring*.8,[0,-node._h*.34]):base;
 if(frames['tile-face'])paint(node,frames['tile-face'],face,opacity);
 const jewel=frames['gem-'+b.color_num];if(jewel){const joint=active?compose(base,1,1,spring*.09,0,Math.max(0,Math.sin(age/.55*Math.PI))*2.3,[0,-node._h*.18]):base;paint(node,jewel,joint,opacity);if(active){const glint=frames['sheen-'+b.color_num],shine=Math.max(0,Math.sin((age-.035)/.42*Math.PI));paint(node,glint,joint,opacity*shine*.32);state.jewelJointFrames++}}
 if(active)state.landingFrames++;
}
function suppressSprite(node,name){if(ancestor(node,n=>FX_ROOTS.has(n.name)))return true;if(FX_SPRITES.has(name))return true;if(node.name==='spr_light'&&node.parent?.name==='stat_fly')return true;if(node.name==='highlight'&&node.parent?.parent?.getComponent?.('block'))return true;if(node===C?.view?.guide_mask_node)return true;if(state.reduced&&ancestor(node,n=>n.name==='guide_node'||n.name==='stat_fly'))return true;return false}
function hookRenderer(){renderer=window.__r2d;const original=renderer.sprite,originalLabel=renderer.label,originalParticles=renderer.particles,originalArmature=renderer.armature,originalDraw=renderer.draw;
 renderer.sprite=function(node,sprite,m,opacity){const name=sprite._spriteFrame?.name||'(no frame)';if(suppressSprite(node,name)){count(state.suppressed.sprites,name);return}const b=node.parent?.getComponent?.('block');
  if(b&&node===b.spr_node){count(state.replaced,name);drawTile(node,b,m,opacity);return}
  const key=name==='028crush2'?'dynamic-atelier':spriteMap[name],frame=frames[key];if(!frame){count(state.nativeSprites,name);return original.call(this,node,sprite,visualMatrix(m),opacity)}
  count(state.replaced,name);if(observedSprites.get(name)?.node!==node)observedSprites.set(name,{node,key});let matrix=state.reduced&&name==='check'?staticLocal(node,m):state.reduced&&(name==='free_to_play'||name==='red_point')?staticInstallCTA(node,m):visualMatrix(m);const hit=hudHits.get(node),age=hit?now()-hit.t:10;if(hit&&!state.reduced&&age<.35){const wobble=Math.sin(age*26)*Math.exp(-age*13);matrix=compose(matrix,1+.025*wobble,1-.025*wobble,wobble*.025)}
  paint(node,frame,matrix,opacity);
 };
 renderer.label=function(node,label,m,opacity){if(ancestor(node,n=>n.name==='score_num'))return;const stat=state.reduced&&ancestor(node,n=>!!n.getComponent?.('stat_unit'));const matrix=stat&&stat.getComponent('stat_unit').lbl?.node===node?staticLocal(node,m):visualMatrix(m);return originalLabel.call(this,node,label,matrix,opacity)};
 // Render-only interception: particle simulation and DragonBones update/COMPLETE events remain native.
 renderer.particles=function(){state.suppressed.particles++};
 renderer.armature=function(node,armature,m,opacity){const key=armature.asset||node.name;if(key==='gameplay_icon_flower_ske'&&manifest.resultFace){count(state.suppressed.armatures,key);drawResultFace(node,m,opacity);return}const replacement=manifest.armatureMap?.[key];if(replacement){count(state.suppressed.armatures,key);const layer=typeof replacement==='string'?replacement:replacement.asset;const frame=frames[layer];if(frame)paint(node,frame,visualMatrix(m),opacity,...(replacement.logicalSize||frame.logical));return}if(FX_ARMATURES.has(key)){count(state.suppressed.armatures,key);return}return originalArmature.call(this,node,armature,visualMatrix(m),opacity)};
 renderer.draw=function(...args){tick();drawBackdrop();return originalDraw.apply(this,args)};
 const render=__renderer.render;__renderer.render=function(...args){const result=render.apply(this,args);safe(drawFX);if(!state.ready&&installed){state.ready=true;event('ready');document.documentElement.classList.add('atelier-ready');document.getElementById('atelier-loading')?.remove()}return result};
 state.nativeRendererMethods={sprite:typeof original,label:typeof originalLabel,particles:typeof originalParticles,armature:typeof originalArmature};
}
function drawResultFace(node,m,opacity){
 // Restore the source's existing happy face only in its source result container.
 if(!C?.view?.is_game_over||!C.view.is_win||opacity<=0||Math.hypot(m[0],m[1])<.0001)return;
 const conf=manifest.resultFace,body=frames[conf.body];if(!body)return;
 if(!resultAppear.has(node))resultAppear.set(node,now());const age=now()-resultAppear.get(node),phase=age%7.8;
 const wink=state.reduced?1:phase<.22?0:phase<.38?(phase-.22)/.16:phase<.78?1:phase<.98?1-(phase-.78)/.2:phase>6.1&&phase<6.3?Math.sin((phase-6.1)/.2*Math.PI):0;
 const size=conf.logicalSize||[137,130],base=compose(visualMatrix(m),1,1,0,...(conf.sourceBodyBoneOffset||conf.offset||[.1433,2.5642]));
 paint(node,body,base,opacity,size[0],size[1],[.5,.5]);
 for(const part of conf.parts||[]){const frame=frames[part.id||part.asset];if(!frame)continue;const role=part.role,partSize=part.size||size,offset=part.offset||[0,0],pivot=part.facialJointLocal||part.pivot||[0,0];let a=1,sy=1,angle=0;
  if(role==='eye-open'){a=1-wink;sy=Math.max(.12,1-.88*wink)}
  if(role==='wink'||role==='eye-wink')a=wink;
  if(role==='smile'&&!state.reduced)sy=1+.07*wink;
  if(role==='cheek')a=.82+.18*wink;
  if((role==='star'||role==='heart')&&!state.reduced){const joint=Math.sin(age*4.2+offset[0]*.03)*Math.exp(-age*1.5);angle=joint*.12}
  paint(node,frame,compose(base,1,sy,angle,offset[0],offset[1],pivot),opacity*a,partSize[0],partSize[1],[.5,.5]);
 }
 const decorations=conf.decorations||{};
 for(const [kind,x,y,scale]of [['star',93,56,.85],['star',-94,-48,.62],['heart',-83,65,.55]]){const frame=frames[decorations[kind]];if(!frame)continue;const joint=state.reduced?0:Math.sin(age*4+x*.02)*Math.exp(-age*1.8)*.13;paint(node,frame,compose(base,scale,scale,joint,x,y),opacity,frame.logical[0],frame.logical[1],[.5,.5])}
 count(state.counts,'result-face-render');
}
function meshDraw(context,im,p,time,index){const W=im.width,H=im.height,logical=p.logicalSize||[W,H],pivot=p.pivot||[logical[0]/2,logical[1]],rootX=pivot[0]*W/logical[0],rootY=pivot[1]*H/logical[1],phase=time*(p.rate||.6)+hash(index+33)*6.28;
 const rhythm=(Math.sin(phase*.47)+1)/2,quiet=rhythm<.28?0:Math.pow((rhythm-.28)/.72,2),bend=(Math.sin(phase)+.23*Math.sin(phase*1.83))*quiet;
 const amp=(p.amplitude??8)*W/logical[0]*bend,step=Math.max(8,Math.ceil((p.mesh==='horizontal'?W:H)/24));
 if(p.mesh==='horizontal'){const max=Math.max(rootX,W-rootX),dy=x=>amp*.7*Math.pow((x-rootX)/max,2);for(let x=0;x<W;x+=step){const n=Math.min(step,W-x),y0=dy(x),y1=dy(x+n);context.save();context.transform(1,(y1-y0)/n,0,1,x,y0);context.drawImage(im,x,0,n,H,0,0,n+.35,H);context.restore()}}
 else{const max=Math.max(rootY,H-rootY),dx=y=>amp*Math.pow((y-rootY)/max,2);for(let y=0;y<H;y+=step){const n=Math.min(step,H-y),x0=dx(y),x1=dx(y+n);context.save();context.transform(1,0,(x1-x0)/n,1,x0,y);context.drawImage(im,0,y,W,n,0,0,W,n+.35);context.restore()}}
}
function drawFoliagePart(context,p,time,index,isShadow){const im=images[p.id];if(!im)return;const size=p.logicalSize||[im.width,im.height],offset=p.shadow?.offset||p.shadowOffset||[-5,8];context.save();context.translate(p.x,p.y);if(isShadow){context.translate(offset[0],offset[1]);context.globalAlpha=p.shadow?.opacity??p.shadowOpacity??.18;context.globalCompositeOperation='multiply'}context.scale(size[0]/im.width,size[1]/im.height);meshDraw(context,isShadow?images[p.id+'-shadow']:im,p,time,index);context.restore()}
function layerMasks(options={}){
 if(!bg||!bgBase||!manifest)return null;
 // Snapshot the phase already present in the actual background, including24Hz throttling.
 const phase=lastBg>=0?lastBg:state.ambientTime,size=manifest.nativeCanvas||[1080,1920];
 const make=()=>{const c=document.createElement('canvas');c.width=bg.width;c.height=bg.height;return c};
 const canopy=make(),shadow=make(),background=make(),receiver=make();
 for(const [canvas,isShadow]of [[canopy,false],[shadow,true]]){const context=canvas.getContext('2d');context.scale(bg.width/size[0],bg.height/size[1]);for(let i=0;i<(manifest.foliage||[]).length;i++)drawFoliagePart(context,manifest.foliage[i],phase,i,isShadow)}
 background.getContext('2d').drawImage(bg,0,0);receiver.getContext('2d').drawImage(bgBase,0,0);
 const encode=c=>options.format==='canvas'?c:c.toDataURL('image/png');
 return {width:bg.width,height:bg.height,nativeCanvas:size.slice(),ambientTime:state.ambientTime,renderedAmbientTime:phase,format:options.format==='canvas'?'canvas':'data-url',canopy:encode(canopy),shadow:encode(shadow),background:encode(background),receiver:encode(receiver)};
}
function drawBackdrop(){if(!bg||!manifest)return;const time=state.ambientTime;if(lastBg>=0&&(state.reduced||time-lastBg<1/24))return;lastBg=time;bctx.clearRect(0,0,bg.width,bg.height);bctx.drawImage(bgBase,0,0);
 const canvas=manifest.nativeCanvas||[1080,1920];bctx.save();bctx.scale(bg.width/canvas[0],bg.height/canvas[1]);
 for(let i=0;i<(manifest.foliage||[]).length;i++){const p=manifest.foliage[i];drawFoliagePart(bctx,p,time,i,true);drawFoliagePart(bctx,p,time,i,false)}
 bctx.restore();bgFrame.texture.needsUpdate=true;state.ambientFrames++;
}
function tick(){const t=now(),dt=previous?Math.min(.05,t-previous):0;previous=t;if(!state.reduced&&!document.hidden)state.ambientTime+=dt;state.frames++;if(master)master.gain.value=muted()?0:.52;registerAudio();const dragging=C?.view?.opt_comps?.find(o=>o?.clicking&&o.node?.parent);if(dragging&&selected!==dragging){selected=dragging;event('pickup',{slot:dragging.pos_index});sound('pickup')}else if(!dragging)selected=null}
function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function drawClearPreview(option,view){
 const rows=[...new Set(option.bingo_i||[])],columns=[...new Set(option.bingo_j||[])];state.clearPreview={visible:rows.length+columns.length>0,rows,columns};
 ctx.save();ctx.globalAlpha=.62;
 const outline=(first,last)=>{if(!first||!last)return;const a=screen(center(first)),b=screen(center(last)),half=51.5*a.s,x=Math.min(a.x,b.x)-half,y=Math.min(a.y,b.y)-half,w=Math.abs(b.x-a.x)+2*half,h=Math.abs(b.y-a.y)+2*half;roundRect(x,y,w,h,Math.max(2,10*a.s));ctx.strokeStyle='#75b7ab';ctx.lineWidth=2.4;ctx.stroke();ctx.strokeStyle='#fff0c8';ctx.lineWidth=.85;ctx.stroke()};
 for(const row of rows)outline(view.block_map[row]?.[0],view.block_map[row]?.[7]);
 for(const column of columns)outline(view.block_map[0]?.[column],view.block_map[7]?.[column]);
 ctx.restore();
}
function drawFX(){if(!ctx||!C?.view)return;const t=now(),d=Math.min(devicePixelRatio||1,2),w=innerWidth,h=innerHeight;if(fx.width!==w*d||fx.height!==h*d){fx.width=w*d;fx.height=h*d;fx.style.width=w+'px';fx.style.height=h+'px'}ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);
 const v=C.view;
 if(v.guide_node?.active&&!selected&&!v.is_game_over){for(const [r,c]of v.guide_block_list[v.put_cnt]||[]){const b=v.block_map[r]?.[c];if(!b||b.getOpacity()===255)continue;const p=screen(center(b)),size=101*p.s;ctx.globalAlpha=state.reduced?.75:.48+.12*Math.sin(state.ambientTime*2);ctx.strokeStyle='#e9cc83';ctx.lineWidth=1.2;roundRect(p.x-size/2,p.y-size/2,size,size,3);ctx.stroke()}ctx.globalAlpha=1}
 state.clearPreview={visible:false,rows:[],columns:[]};if(selected?.clicking&&selected.node?.parent){const valid=selected.checkAllow();if(valid)drawClearPreview(selected,v);for(const b of selected.blocks){const p=screen(center(b)),r=51*p.s;ctx.strokeStyle=valid?'#fff4ce':'#eab69b';ctx.lineWidth=1.3;roundRect(p.x-r,p.y-r,2*r,2*r,4);ctx.stroke()}}
 for(let i=effects.length-1;i>=0;i--){const e=effects[i],age=t-e.t,limit=e.type==='result'?2.6:e.type==='score'?1.25:1.2;if(age>limit){effects.splice(i,1);continue}const p=screen(e.p),cell=113*p.s;ctx.save();ctx.translate(p.x,p.y);
  if(e.type==='invalid'&&age<.32){ctx.globalAlpha=1-age/.32;ctx.strokeStyle='#edc4a9';ctx.lineWidth=2;const r=cell*.48;roundRect(-r,-r,2*r,2*r,5);ctx.stroke();ctx.beginPath();ctx.moveTo(-4,-4);ctx.lineTo(4,4);ctx.moveTo(4,-4);ctx.lineTo(-4,4);ctx.stroke()}
  if(e.type==='place'&&age<.30){ctx.globalAlpha=(1-age/.30)*.65;ctx.strokeStyle='#fff7dc';ctx.lineWidth=1.2;const r=cell*.43;roundRect(-r,-r,2*r,2*r,cell*.08);ctx.stroke();if(!state.reduced){ctx.fillStyle='#fff8de';for(let k=0;k<2;k++){const a=hash(e.seed*9+k)*6.28,v=age*cell*.7;ctx.beginPath();ctx.arc(Math.cos(a)*v,Math.sin(a)*v,1.15*(1-age/.30),0,6.28);ctx.fill()}}}
  if(e.type==='clear-cell'&&age<.54){const a=age/.54;ctx.globalAlpha=(1-a)*.78;ctx.strokeStyle='#f8dfa5';ctx.lineWidth=1.5;const r=cell*(state.reduced?.4:.39+a*.10);roundRect(-r,-r,2*r,2*r,cell*.08);ctx.stroke();if(!state.reduced&&e.seed%2===0){for(let k=0;k<3;k++){const angle=hash(e.seed*7+k)*6.28,dist=cell*a*.58;ctx.save();ctx.translate(Math.cos(angle)*dist,Math.sin(angle)*dist+a*a*cell*.25);ctx.rotate(angle+a);const chip=images['gem-'+e.color]||images['tile-face'];ctx.beginPath();ctx.moveTo(-2.5,-1.5);ctx.lineTo(2.2,-.6);ctx.lineTo(.5,2.5);ctx.closePath();ctx.clip();ctx.drawImage(chip,-4,-4,8,8);ctx.restore()}}}
  if(e.type==='line'&&age<.64){const end=screen(e.end),dx=end.x-p.x,dy=end.y-p.y,u=state.reduced?1:Math.min(1,age/.27);ctx.globalAlpha=(1-age/.64)*(e.major?.75:.55);ctx.strokeStyle='#88cfc4';ctx.lineWidth=state.reduced?3:e.major?5:3.8;ctx.shadowBlur=state.reduced?0:7;ctx.shadowColor='#8fd8c7';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(dx*u,dy*u);ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#fff5dc';ctx.lineWidth=state.reduced?1.2:1.7;ctx.stroke()}
  if(e.type==='receive'||e.type==='target'){const duration=e.type==='target'?1.1:.36;if(age<duration){const a=age/duration;ctx.globalAlpha=1-a;ctx.strokeStyle=e.type==='target'?'#fff5bd':'#e9d5a1';ctx.lineWidth=e.type==='target'?2:1.2;ctx.beginPath();ctx.arc(0,0,cell*(.25+a*(state.reduced?.015:e.type==='target'?.5:.25)),0,6.28);ctx.stroke();if(e.type==='target'){for(let k=0;k<6;k++){const angle=k*Math.PI/3-Math.PI/2,r=cell*(state.reduced?.38:.30+a*.38);ctx.save();ctx.rotate(angle);ctx.beginPath();ctx.moveTo(r,0);ctx.lineTo(r+cell*.12*(1-a),0);ctx.stroke();ctx.restore()}}}}
  if(e.type==='score'){const a=age/1.25;ctx.globalAlpha=Math.min(1,age/.08)*(1-Math.max(0,(a-.6)/.4));const size=Math.max(13,45*p.s);ctx.font='600 '+size+'px Georgia,serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=3;ctx.strokeStyle='#173b36';ctx.fillStyle='#fff0c7';const text=e.lines>=2?e.grade:e.score;ctx.strokeText(text,0,0);ctx.fillText(text,0,0);if(e.lines>=2){ctx.font='600 '+Math.max(12,34*p.s)+'px system-ui';ctx.strokeText(e.score,0,size*1.15);ctx.fillText(e.score,0,size*1.15)}if(e.combo>0){ctx.font='600 '+Math.max(10,24*p.s)+'px system-ui';const combo=e.combo===1?'COMBO':'COMBO '+e.combo;ctx.strokeText(combo,0,size*2.2);ctx.fillText(combo,0,size*2.2)}}
  if(e.type==='result'&&e.win&&!state.reduced){ctx.globalAlpha=Math.min(.7,1-age/2.6);for(let k=0;k<20;k++){const angle=k*2.399,dist=cell*(1.7+age*1.6),x=Math.cos(angle)*dist,y=Math.sin(angle)*dist+age*age*cell*.20;ctx.save();ctx.translate(x,y);ctx.rotate(angle+age*.8);ctx.fillStyle=k%3?'#fff1bc':'#cda85c';ctx.fillRect(-2,-1,4,2);ctx.restore()}}
  ctx.restore();
 }
}
function registration(){const assets=Object.entries(manifest?.runtime||{}).map(([id,file])=>({id,file,...(manifest.frameMeta?.[id]||{}),bounds:manifest.frameMeta?.[id]?.alphaBounds||null,source:manifest.frameMeta?.[id]?.source||null}));
 const actors=[];function part(b,id){const node=b.spr_node||b.node,p=world(node),width=node._w??node.width,height=node._h??node.height,ax=node._ax??node.anchorX,ay=node._ay??node.anchorY,contactAnchor=[(.5-ax)*width,-ay*height],contact=node.convertToWorldSpaceAR(cc.v2(contactAnchor[0],contactAnchor[1]));const localCorners=[[-ax*width,-ay*height],[(1-ax)*width,-ay*height],[(1-ax)*width,(1-ay)*height],[-ax*width,(1-ay)*height]],corners=localCorners.map(([x,y])=>node.convertToWorldSpaceAR(cc.v2(x,y)));actors.push({id,parent:b.in_opt?'source-tray':'source-board',parts:['tile-shadow','tile-bezel','tile-face',...(GEMS.includes(b.color_num)?['gem-'+b.color_num]:[])],contactAnchor,worldContact:[contact.x,contact.y],worldCenter:[p.x,p.y],logicalSize:[113,113],nodeSize:[width,height],nodeAnchor:[ax,ay],renderExtent:[Math.min(...corners.map(q=>q.x)),Math.min(...corners.map(q=>q.y)),Math.max(...corners.map(q=>q.x)),Math.max(...corners.map(q=>q.y))],worldCorners:corners.map(q=>[q.x,q.y]),jewelPivot:[0,-height*.18],sourceOpacity:b.getOpacity(),functionalColor:b.color_num})}
 for(const [r,row]of (C?.view?.block_map||[]).entries())for(const [c,b]of row.entries())part(b,'board-'+r+'-'+c);for(const o of C?.view?.opt_comps||[])if(o?.node?.parent)for(const [i,b]of o.blocks.entries())part(b,'tray-'+o.pos_index+'-'+i);
 const foliage=(manifest?.foliage||[]).map((p,i)=>({id:p.id,parent:'stationary-receiver',parts:[p.id+'-shadow',p.id],pivot:p.pivot,contactAnchor:p.pivot,worldContact:[p.x+p.pivot[0],p.y+p.pivot[1]],mesh:p.mesh,rate:p.rate,phase:hash(i+33)*6.28,shadowOffset:p.shadow?.offset||p.shadowOffset||[-5,8],logicalSize:p.logicalSize}));
 return {version,canvas:[1080,1920],origin:'top-left for asset/foliage geometry; source world coordinates upward Y for interactive pieces',cellPitch:113,layers:['stationary receiver','anchored environmental shadows','articulated botanical parts','source board and tray contacts','tile bezel','tile face','jointed colored jewel','source-driven HUD','source-driven action effects'],assets,actors,foliage,resultFace:manifest?.resultFace||null,ui:[...observedSprites].map(([native,{node,key}])=>({native,asset:key,anchor:[node._ax,node._ay],nodeSize:[node._w,node._h],worldCenter:[world(node).x,world(node).y]})),probes:manifest?.probes||null,suppressed:state.suppressed,sourceSimulation:'No nodes, opacity, animation components, RNG calls or completion callbacks are disabled. All FX suppression occurs in renderer methods.'};
}
state.registration=registration;state.layerMasks=layerMasks;
state.capture=()=>({version,ready:state.ready,reduced:state.reduced,muted:state.muted,assets:state.assets,counts:state.counts,frames:state.frames,ambientTime:state.ambientTime,ambientFrames:state.ambientFrames,landingFrames:state.landingFrames,jewelJointFrames:state.jewelJointFrames,errors:state.errors,events:state.events,suppressed:state.suppressed,replaced:state.replaced,nativeSprites:state.nativeSprites,hooksInstalled:state.hooksInstalled,assetVersion:manifest?.version,clearPreview:state.clearPreview});
async function init(){try{
 const assetsReady=(async()=>{manifest=await fetch(new URL('assets/manifest.json',root)).then(r=>{if(!r.ok)throw Error('Asset manifest missing');return r.json()});await Promise.all(Object.entries(manifest.runtime||{}).map(async([key,file])=>{images[key]=await load(file);state.assets++}));for(const p of manifest.foliage||[]){images[p.id]=images[p.id]||await load(p.file);state.assets++;const shadow=document.createElement('canvas');shadow.width=images[p.id].width;shadow.height=images[p.id].height;const s=shadow.getContext('2d');s.filter='blur('+(p.shadow?.blur??2)+'px)';s.drawImage(images[p.id],0,0);s.filter='none';s.globalCompositeOperation='source-in';s.fillStyle='#30291e';s.fillRect(0,0,shadow.width,shadow.height);images[p.id+'-shadow']=shadow}})();
 await waitFor(()=>window.cc&&window.__require&&window.__r2d&&window.__blockPresentation);installHooks();await assetsReady;await waitFor(()=>C?.view?.block_map?.length===8);
 for(const [key,im]of Object.entries(images))if(!key.endsWith('-shadow')||key==='tile-shadow')frameFor(key,im);
 for(const code of GEMS){const source=images['gem-'+code];if(!source)continue;const sheen=document.createElement('canvas');sheen.width=source.width;sheen.height=source.height;const sc=sheen.getContext('2d'),g=sc.createLinearGradient(0,sheen.height,sheen.width,0);g.addColorStop(0,'#ffffff00');g.addColorStop(.43,'#ffffff00');g.addColorStop(.50,'#fffbea');g.addColorStop(.57,'#ffffff00');g.addColorStop(1,'#ffffff00');sc.fillStyle=g;sc.fillRect(0,0,sheen.width,sheen.height);sc.globalCompositeOperation='destination-in';sc.drawImage(source,0,0);frameFor('sheen-'+code,sheen)}
 const size=manifest.nativeCanvas||[1080,1920];bg=document.createElement('canvas');bg.width=720;bg.height=1280;bctx=bg.getContext('2d');bgBase=document.createElement('canvas');bgBase.width=bg.width;bgBase.height=bg.height;bgBase.getContext('2d').drawImage(images.backdrop,0,0,bg.width,bg.height);bgFrame=frameFor('dynamic-atelier',bg);Object.assign(spriteMap,manifest.spriteMap||{});
 fx=document.createElement('canvas');fx.id='block-crush-fx';fx.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:5';document.body.append(fx);ctx=fx.getContext('2d');makeControls();hookRenderer();drawBackdrop();installed=true;
 }catch(e){failure(e);document.documentElement.classList.add('atelier-ready');document.getElementById('atelier-loading')?.remove();console.error('Jewel Atelier:',e)}}
init();
})();
