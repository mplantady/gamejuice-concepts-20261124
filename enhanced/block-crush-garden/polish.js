/* Garden Edition. Presentation-only; never consumes the game's RNG or changes its state. */
(() => {
'use strict';
const version='block-crush-garden-20261126-v1';
const state=window.__blockPolish={version,ready:false,errors:[],events:[],counts:{},replaced:{},frames:0,ambientTime:0,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,muted:false,assets:0};
const root=new URL('.',document.currentScript.src), images={},frames={},lands=new WeakMap(),clears=new WeakMap(),effects=[];
let manifest=null,cc=null,C=null,control=null,renderer=null,clock=0,previous=0,fx=null,ctx=null,bg=null,bctx=null,bgFrame=null,lastBg=-1;
const finishedTargets=new Set();let selected=null,lastReceive=0, audio=null,master=null,noise=null,serial=0;
const now=()=>performance.now()/1000;
const event=(type,data={})=>{state.counts[type]=(state.counts[type]||0)+1;const e={type,time:now(),...data};state.events.push(e);if(state.events.length>500)state.events.shift();return e};
const hash=(i)=>{let n=Math.imul(i+177,374761393);n=(n^(n>>>13));return ((Math.imul(n,1274126177)^(n>>>16))>>>0)/4294967296};
function load(file){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Asset failed: '+file));im.src=new URL(file,root)})}
function world(node){return node.convertToWorldSpaceAR(cc.v2(0,0))}
function screen(p){const q=__blockPresentation.layout();return {x:q.x+p.x*q.s,y:innerHeight-q.y-p.y*q.s,s:q.s}}
function center(block){return world(block.spr_node||block.node)}
function puff(type,p,data={}){effects.push({type,p,t:now(),...data});}
function wrap(obj,key,before,after){const fn=obj[key];if(!fn||fn.__garden)return;function call(...args){const memo=before?.apply(this,args),value=fn.apply(this,args);after?.call(this,value,memo,...args);return value}call.__garden=true;obj[key]=call}
function initAudio(){if(audio)return;try{audio=new (window.AudioContext||window.webkitAudioContext)();state.audioContext=audio;master=audio.createGain();master.gain.value=.55;const limiter=audio.createDynamicsCompressor();limiter.threshold.value=-13;limiter.knee.value=12;limiter.ratio.value=5;limiter.attack.value=.002;limiter.release.value=.15;master.connect(limiter);limiter.connect(audio.destination);noise=audio.createBuffer(1,Math.floor(audio.sampleRate*.11),audio.sampleRate);const out=noise.getChannelData(0);for(let i=0;i<out.length;i++)out[i]=(hash(i)-.5)*2*Math.exp(-i/out.length*8)}catch(e){state.errors.push('Audio: '+e.message)}}
function sound(kind,value=0){if(state.muted||cc?.mute||control?.mute||document.hidden)return;initAudio();if(!audio||audio.state!=='running')return;const t=audio.currentTime;state.counts['sound-'+kind]=(state.counts['sound-'+kind]||0)+1;
 const note=(freq,delay,amp,dur=.28)=>{for(const [mul,gain]of [[1,1],[2.76,.24],[5.4,.07]]){const osc=audio.createOscillator(),g=audio.createGain();osc.type='sine';osc.frequency.setValueAtTime(freq*mul,t+delay);osc.frequency.exponentialRampToValueAtTime(freq*mul*.997,t+delay+dur);g.gain.setValueAtTime(0,t+delay);g.gain.linearRampToValueAtTime(amp*gain,t+delay+.004);g.gain.exponentialRampToValueAtTime(.0001,t+delay+dur);osc.connect(g);g.connect(master);osc.start(t+delay);osc.stop(t+delay+dur+.01)}};
 const tap=(freq,amp,duration)=>{const src=audio.createBufferSource(),filter=audio.createBiquadFilter(),g=audio.createGain();src.buffer=noise;filter.type='bandpass';filter.frequency.value=freq;filter.Q.value=1.1;g.gain.value=amp;src.connect(filter);filter.connect(g);g.connect(master);src.start(t);src.stop(t+duration)};
 if(kind==='pickup'){note(620,.0,.036,.12);tap(1500,.08,.05)}
 if(kind==='invalid'){note(126,0,.12,.10);tap(420,.16,.055)}
 if(kind==='place'){const f=[261.63,293.66,329.63,349.23][value%4];note(f,0,.15,.24);note(f/2,0,.07,.13);tap(850,.21,.07)}
 if(kind==='clear'){[392,493.88,587.33,783.99].slice(0,value>=4?4:2).forEach((f,i)=>note(f,i*.045,.105,.8));tap(2200,.1,.1)}
 if(kind==='receive'){note([659.25,783.99,987.77][value%3],0,.025,.26)}
 if(kind==='finish'){[523.25,659.25,783.99,1046.5].forEach((f,i)=>note(f,i*.1,.12,1.1))}
}
addEventListener('pointerdown',()=>{initAudio();audio?.resume()},{passive:true});
function makeControls(){const el=document.createElement('div');el.id='garden-preferences';el.innerHTML='<button aria-label="Mute sound" aria-pressed="false">Sound on</button><button aria-label="Reduce decorative motion" aria-pressed="false">Motion on</button>';
const style=document.createElement('style');style.textContent='#garden-preferences{position:fixed;left:50%;bottom:5px;transform:translateX(-50%);z-index:20;display:flex;gap:6px}#garden-preferences button{font:600 10px system-ui;color:#fff4d4;background:#38230bd9;border:1px solid #c7a75d88;border-radius:14px;padding:5px 10px;cursor:pointer;box-shadow:0 1px 4px #0003}#garden-preferences button:focus-visible{outline:2px solid #fff1b5;outline-offset:2px}';document.head.append(style);document.body.append(el);
const [a,b]=el.children;a.onclick=()=>{state.muted=!state.muted;if(cc)cc.mute=state.muted;master&&(master.gain.value=state.muted?0:.55);if(state.muted)cc?.audioEngine?.pauseAll?.();else cc?.audioEngine?.resumeAll?.();a.textContent=state.muted?'Sound off':'Sound on';a.setAttribute('aria-pressed',state.muted)};
b.onclick=()=>state.setReduced(!state.reduced);state.setReduced=value=>{state.reduced=!!value;b.textContent=state.reduced?'Motion reduced':'Motion on';b.setAttribute('aria-pressed',state.reduced);lastBg=-1};state.setReduced(state.reduced);matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>state.setReduced(e.matches));}
function frameFor(name,image){const texture=__blockPresentation.texture(image);const f={name,_texture:texture,_rect:{x:0,y:0,width:image.width,height:image.height},_rotated:false,_originalSize:{width:image.width,height:image.height},_offset:{x:0,y:0},insetLeft:0,insetRight:0,insetTop:0,insetBottom:0};frames[name]=f;return f}
function hookGame(){C=__require('comps').COMPS;control=__require('control').control;
// Leave headroom for the original simultaneous collection sounds and new cues.
const engine=cc.audioEngine,play=engine.play;engine.play=function(clip,loop,volume){return play.call(this,clip,loop,cc.mute?0:(volume??1)*.45)};
const opt=__require('opt').default.prototype,blast=__require('blast').default.prototype,block=__require('block').default.prototype,stat=__require('stat_unit').default.prototype;
wrap(opt,'cancle',function(){return {p:this.node.parent.convertToWorldSpaceAR(this.ori_pos),slot:this.pos_index}},function(_,reject){if(reject){event('invalid',{slot:reject.slot});puff('invalid',reject.p);sound('invalid');selected=null}});
wrap(opt,'putOn',function(){const cells=this.fs_list.map(({fs})=>({block:fs,p:center(fs),i:fs.i,j:fs.j}));const t=now();cells.forEach(({block},i)=>lands.set(block.spr_node,{t,phase:i*.008}));return cells},function(_,cells){selected=null;event('place',{cells:cells.map(x=>[x.i,x.j]),put:C.view.put_cnt});for(const cell of cells)puff('place',cell.p,{seed:serial++});sound('place',C.view.put_cnt-1)});
wrap(blast,'checkBingo',null,function(result){if(result?.lines){const unique=[...new Set(result.destroy_blocks.map(x=>x.block))];event('clear',{lines:result.lines,cells:unique.map(b=>[b.i,b.j])});const rows=new Set(),cols=new Set();for(const {block,rotation}of result.destroy_blocks)(rotation?cols:rows).add(rotation?block.j:block.i);for(const row of rows)puff('line',center(this.block_map[row][0]),{end:center(this.block_map[row][7]),major:result.lines>=4});for(const col of cols)puff('line',center(this.block_map[0][col]),{end:center(this.block_map[7][col]),major:result.lines>=4});sound('clear',result.lines)}});
wrap(block,'blastDestroy',function(){return {p:center(this),color:this.ori_color_num}},function(_,m){if(now()-(clears.get(this)||0)>.06){puff('clear-cell',m.p,{color:m.color,seed:serial++});clears.set(this,now())}});
wrap(stat,'playRecv',null,function(){const p=world(this.spr_ani?.node||this.node);puff('receive',p,{color:this.color});event('receive',{color:this.color});if(now()-lastReceive>.055){sound('receive',this.color%3);lastReceive=now()}});
wrap(stat,'playFinish',null,function(){if(finishedTargets.has(this.color))return;finishedTargets.add(this.color);puff('target',world(this.node),{color:this.color});event('target-complete',{color:this.color});sound('finish')});
wrap(blast,'gameOver',function(reason,win){return !this.is_game_over?{reason,win:!!win}:null},function(_,m){if(m){event('result',m);if(m.win)sound('finish')}});
wrap(blast,'restart',function(){effects.length=0;selected=null;state.events.length=0;serial=0;finishedTargets.clear()});
}
function meshDraw(context,im,p,time,shadow=false){
const W=im.width,H=im.height,phase=time*p.rate,quiet=.3+.7*Math.pow(Math.max(0,Math.sin(phase*.43)),2),bend=(Math.sin(phase+1.7*p.x/940)+.32*Math.sin(phase*1.9+p.y/500))*quiet;
const amp=13*bend,step=12,root=p.pivot;
if(p.mesh==='horizontal'){
 const dy=x=>Math.sin(Math.PI*x/W)*(Math.sin(phase-x/W*1.4)*8+amp*.4);
 for(let x=0;x<W;x+=step){const n=Math.min(step,W-x),y0=dy(x),y1=dy(x+n);context.save();context.transform(1,(y1-y0)/n,0,1,x,y0);context.drawImage(im,x,0,n,H,0,0,n+.4,H);context.restore()}
}else{
 const dx=y=>amp*Math.pow((y-root[1])/H,2);
 for(let y=0;y<H;y+=step){const n=Math.min(step,H-y),x0=dx(y),x1=dx(y+n);context.save();context.transform(1,0,(x1-x0)/n,1,x0,y);context.drawImage(im,0,y,W,n,0,0,W,n+.4);context.restore()}
}
}
function drawBackdrop(){if(!bg||!manifest)return;const time=state.ambientTime;if(lastBg>=0&&(state.reduced||time-lastBg<1/30))return;lastBg=time;
 bctx.clearRect(0,0,bg.width,bg.height);bctx.drawImage(images.backdrop,0,0,bg.width,bg.height);
 bctx.save();bctx.scale(bg.width/940,bg.height/1673);
 for(let i=0;i<(manifest.foliage||[]).length;i++){const p=manifest.foliage[i],im=images[p.id];if(!im)continue;bctx.save();bctx.translate(p.x,p.y);
 bctx.save();bctx.translate(5,8);bctx.globalAlpha=.22;meshDraw(bctx,images[p.id+'-shadow'],p,time,true);bctx.restore();meshDraw(bctx,im,p,time);bctx.restore();}
 bctx.restore();if(bgFrame)bgFrame._texture.needsUpdate=true;state.ambientFrames=(state.ambientFrames||0)+1;
}
function hookRenderer(){renderer=window.__r2d;const original=renderer.sprite;
renderer.sprite=function(node,sprite,m,opacity){if(state.reduced){for(let n=node;n;n=n.parent)if(['guide_node','put_se','destroy_node','collect_blocks_ani'].includes(n.name))return;}let f=null;const name=sprite._spriteFrame?.name;const b=node.parent?.getComponent?.('block');
if(name==='028crush2')f=bgFrame;
else if(b&&node===b.spr_node)f=frames['gem-'+b.color_num]||b.color_num<=10||b.color_num===12?frames.tile:null;
else if(spriteMap[name])f=frames[spriteMap[name]];
if(!f)return original.call(this,node,sprite,m,opacity);
state.replaced[name]=(state.replaced[name]||0)+1;
const saved=sprite._spriteFrame,type=sprite.type,trim=sprite.trim,color=node._color;sprite._spriteFrame=f;sprite.type=0;sprite.trim=true;node._color={r:255,g:255,b:255,a:255};
let matrix=m;const landing=lands.get(node);if(landing&&!state.reduced){const t=now()-landing.t-landing.phase;if(t>=0&&t<.42){const v=Math.sin(t/.42*Math.PI*3)*Math.exp(-t*9);matrix=m.slice();matrix[0]*=1+.055*v;matrix[3]*=1-.07*v;matrix[5]+=Math.abs(v)*2;state.landingFrames=(state.landingFrames||0)+1}}
try{const value=original.call(this,node,sprite,matrix,opacity);const jewel=b&&node===b.spr_node&&frames['gem-'+b.color_num];if(jewel){let gm=matrix;if(landing&&!state.reduced){const t=now()-landing.t;if(t>=0&&t<.55){const a=Math.sin(t*19)*Math.exp(-t*7)*.13,c=Math.cos(a),s=Math.sin(a);gm=matrix.slice();gm[0]=matrix[0]*c+matrix[2]*s;gm[1]=matrix[1]*c+matrix[3]*s;gm[2]=matrix[2]*c-matrix[0]*s;gm[3]=matrix[3]*c-matrix[1]*s;gm[5]+=Math.sin(t/.55*Math.PI)*2.5;state.jewelJointFrames=(state.jewelJointFrames||0)+1}}sprite._spriteFrame=jewel;original.call(this,node,sprite,gm,opacity)}return value}finally{sprite._spriteFrame=saved;sprite.type=type;sprite.trim=trim;node._color=color}
};
const particles=renderer.particles;renderer.particles=function(...args){if(!state.reduced)return particles.apply(this,args)};
const render=__renderer.render;__renderer.render=function(...args){drawBackdrop();const out=render.apply(this,args);drawFX();return out};
}
const spriteMap={};
function drawFX(){const t=now();const dt=previous?Math.min(.05,t-previous):0;previous=t;clock=t;if(!state.reduced&&!document.hidden)state.ambientTime+=dt;state.frames++;
const dragging=C?.view?.opt_comps?.find(o=>o?.clicking&&o.node?.parent);if(dragging&&selected!==dragging){selected=dragging;event('pickup',{slot:dragging.pos_index});sound('pickup')}else if(!dragging)selected=null;
const d=Math.min(devicePixelRatio||1,2),w=innerWidth,h=innerHeight;if(fx.width!==w*d||fx.height!==h*d){fx.width=w*d;fx.height=h*d;fx.style.width=w+'px';fx.style.height=h+'px'}ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);
if(state.reduced&&C.view.guide_node?.active&&!selected&&!C.view.is_game_over){for(const [r,c]of C.view.guide_block_list[C.view.put_cnt]||[]){const p=screen(center(C.view.block_map[r][c])),size=103*p.s;ctx.strokeStyle='#ffeeb2';ctx.lineWidth=1.3;ctx.strokeRect(p.x-size/2,p.y-size/2,size,size)}}
if(selected?.clicking&&selected.node?.parent){const valid=selected.checkAllow();for(const b of selected.blocks){const p=screen(center(b));ctx.strokeStyle=valid?'#fff4bd':'#f7d892';ctx.lineWidth=1.35;ctx.shadowColor='#51300c';ctx.shadowBlur=5;ctx.strokeRect(p.x-20*p.s/.36,p.y-20*p.s/.36,40*p.s/.36,40*p.s/.36);ctx.shadowBlur=0}}
for(let i=effects.length-1;i>=0;i--){const e=effects[i],age=t-e.t;if(age>1.25){effects.splice(i,1);continue}const p=screen(e.p),cell=113*p.s;ctx.save();ctx.translate(p.x,p.y);
if(e.type==='invalid'){if(age>.4){ctx.restore();continue}ctx.globalAlpha=(1-age/.4);ctx.strokeStyle='#fff0d1';ctx.lineWidth=2.4;const r=cell*.6;ctx.beginPath();ctx.moveTo(-r,-r*.6);ctx.lineTo(-r,r*.6);ctx.moveTo(r,-r*.6);ctx.lineTo(r,r*.6);ctx.moveTo(-5,-5);ctx.lineTo(5,5);ctx.moveTo(5,-5);ctx.lineTo(-5,5);ctx.stroke()}
if(e.type==='place'&&age<.42){ctx.globalAlpha=(1-age/.42)*.72;ctx.strokeStyle='#fff1b6';ctx.lineWidth=1.8;const r=cell*(.39+age*.10);ctx.strokeRect(-r,-r,2*r,2*r);if(!state.reduced){ctx.fillStyle='#ffedaa';for(let k=0;k<3;k++){const a=hash(e.seed*9+k)*6.28,v=age*cell*.8;ctx.beginPath();ctx.arc(Math.cos(a)*v,Math.sin(a)*v,1.4*(1-age/.42),0,6.28);ctx.fill()}}}
if(e.type==='clear-cell'&&age<.65){const a=age/.65;ctx.globalAlpha=(1-a)*.7;ctx.strokeStyle='#ffe8a0';ctx.lineWidth=2;const r=cell*(state.reduced?.4:.3+a*.2);ctx.strokeRect(-r,-r,2*r,2*r);if(!state.reduced&&e.seed%3===0){for(let k=0;k<3;k++){const angle=hash(e.seed*7+k)*6.28,dist=cell*(a*.75),x=Math.cos(angle)*dist,y=Math.sin(angle)*dist+a*a*cell*.5;ctx.save();ctx.translate(x,y);ctx.rotate(angle+a*2);ctx.fillStyle=k?'#fff4c8':'#dcab63';ctx.fillRect(-2,-1.5,4,3);ctx.restore()}}}
if(e.type==='line'&&age<.6){const end=screen(e.end),dx=end.x-p.x,dy=end.y-p.y,u=state.reduced?1:Math.min(1,age/.25);ctx.globalAlpha=(1-age/.6)*.7;ctx.strokeStyle='#ffe5a1';ctx.lineWidth=state.reduced?3:6*(1-age/.6);ctx.shadowBlur=state.reduced?0:8;ctx.shadowColor='#ffcb58';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(dx*u,dy*u);ctx.stroke()}
if(e.type==='receive'||e.type==='target'){const limit=e.type==='target'?1.2:.45;if(age<limit){const a=age/limit;ctx.globalAlpha=1-a;ctx.strokeStyle='#fff6c1';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,cell*(.25+a*(state.reduced?.03:.5)),0,6.28);ctx.stroke()}}
ctx.restore()}
}
async function init(){try{
manifest=await fetch(new URL('assets/manifest.json',root)).then(r=>{if(!r.ok)throw Error('Asset manifest missing');return r.json()});
const entries=manifest.runtime||{};await Promise.all(Object.entries(entries).map(async([key,file])=>{images[key]=await load(file);state.assets++}));
for(const p of manifest.foliage||[]){images[p.id]=await load(p.file);state.assets++;const shadow=document.createElement('canvas');shadow.width=images[p.id].width;shadow.height=images[p.id].height;const s=shadow.getContext('2d');s.filter='blur(2px)';s.drawImage(images[p.id],0,0);s.filter='none';s.globalCompositeOperation='source-in';s.fillStyle='#3b311f';s.fillRect(0,0,shadow.width,shadow.height);images[p.id+'-shadow']=shadow}
await new Promise(resolve=>{function ready(){if(window.cc&&window.__blockPresentation&&window.__require&&window.COMPS?.view?.block_map?.length)resolve();else setTimeout(ready,30)}ready()});cc=window.cc;
for(const [name,im]of Object.entries(images))if(!name.endsWith('-shadow'))frameFor(name,im);
bg=document.createElement('canvas');bg.width=648;bg.height=1152;bctx=bg.getContext('2d');bgFrame=frameFor('dynamic-garden',bg);Object.assign(spriteMap,manifest.spriteMap||{});
fx=document.createElement('canvas');fx.id='block-crush-fx';fx.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:5';document.body.append(fx);ctx=fx.getContext('2d');hookGame();makeControls();drawBackdrop();hookRenderer();state.ready=true;event('ready');
state.capture=()=>({version,ready:state.ready,reduced:state.reduced,muted:state.muted,assets:state.assets,counts:state.counts,frames:state.frames,ambientTime:state.ambientTime,ambientFrames:state.ambientFrames,landingFrames:state.landingFrames,jewelJointFrames:state.jewelJointFrames,errors:state.errors,events:state.events});
}catch(e){state.errors.push(e.stack||e.message);console.error('Garden Edition:',e)}}
init();
})();
