/* Astral Cabinet: independent artwork and jointed mechanisms on the unchanged source game. */
import {loadCabinetAssets} from './cabinet-assets.js';
import {createLatchRig} from './mechanical-latches.js';
import {createCabinetAudio} from './cabinet-audio.js';
import {installCabinetUI} from './cabinet-ui.js';
export function installRotateRestyle(api){
  const state={ready:false,version:'2026-11-26-cabinet-v2',time:0,ambientTime:0,events:[],counts:{},errors:[],selected:null,fx:[],sleeves:[],shadows:[],materials:[],audioCounts:{},lowMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,muted:false,loads:0};
  const loading=document.createElement('div');loading.id='rotate-loading';loading.innerHTML='<strong>Rotate Rings</strong><span>Opening the cabinet…</span>';document.body.append(loading);
  const canvas=document.createElement('canvas');canvas.id='rotate-fx';document.body.append(canvas);const ctx=canvas.getContext('2d');
  let alignmentKey='';let width=0,height=0,ratio=1,g=null,selectedAt=0,releaseAt=0,lastTurn=0,turnSerial=0,grabAngle=0;
  const linked=new WeakSet();let lastTurnAngle=0,previousMotionAngle=null,lastMotionInput=-Infinity,lastPointerClock=0,angularVelocity=0,art=null,ui=null;
  const log=(event,data={})=>{state.counts[event]=(state.counts[event]||0)+1;state.events.push({event,time:state.time,audioTime:api.audio?.currentTime,...data});if(state.events.length>600)state.events.shift()};
  const audio=createCabinetAudio(api,state,log);
  const rig=createLatchRig({...api,onContact:(owner,name)=>{audio.play('latch_settle',undefined,api.level.rings.find(r=>r.id===owner).x/600);const l=rig.snapshot().latches.find(l=>l.owner===owner&&l.name===name);if(l)effect('contact',null,{owner,name,worldX:l.hingeWorld.x,worldY:l.hingeWorld.y});}});
  const artReady=loadCabinetAssets(api).then(result=>{art={...result.textures,metadata:result.metadata};state.assetReady=true;installArt();api.dirty();}).catch(e=>{state.errors.push('art: '+e.message);loading.remove();});
  function sound(name,gain,pan=0,rate=1){return audio.play(name,gain,pan,rate)}
  function effect(kind,id,extra={}){state.fx.push({kind,id,t:state.time,...extra});log(kind,{id,...extra});api.dirty();}
  function point(id){const n=g?._ringNodes[id];return n?{x:width/2+n.wm[4]*api.scale(),y:height/2-n.wm[5]*api.scale(),r:112.5*Math.hypot(n.wm[0],n.wm[1])*api.scale(),alpha:n.opacity/255}:null}
  function wrap(obj,key,fn){const old=obj[key];obj[key]=function(...args){return fn.call(this,old.bind(this),...args)}}
  function texture(c){const t=new api.Texture(c);t.colorSpace=api.NoColorSpace;t.minFilter=api.LinearFilter;t.generateMipmaps=false;t.userData.w=c.width;t.userData.h=c.height;return t}
  function shadowTexture(source){const image=source.image,pad=Math.ceil(image.width/14),mask=document.createElement('canvas');mask.width=image.width;mask.height=image.height;const mc=mask.getContext('2d');mc.drawImage(image,0,0);mc.globalCompositeOperation='source-in';mc.fillStyle='#fff';mc.fillRect(0,0,mask.width,mask.height);const c=document.createElement('canvas');c.width=image.width+pad*2;c.height=image.height+pad*2;const x=c.getContext('2d');x.filter=`blur(${image.width/56}px)`;x.drawImage(mask,pad,pad);return {tex:texture(c),w:c.width/image.width,h:c.height/image.height}}
  function installArt(){
    if(!g||!art)return;
    if(!g.__cabinetArt){
      g.__cabinetArt=true;
      const bg=g.bgNode.sprite;bg.tex=art.surface;bg.ownTex=false;bg.mesh.material.map=art.surface;bg.mesh.material.color.setRGB(1,1,1);bg.color=[255,255,255,255];bg.mesh.material.needsUpdate=true;
      const shadowRoot=new api.Node('cabinet_contact_shadows');g._levelRoot.addChild(shadowRoot);shadowRoot.setSiblingIndex(0);
      for(const def of api.level.rings){
        const n=g._ringNodes[def.id],v=n.view,im=v._rotatePivot.getChildByName('ring_Img'),tex=def.id===4?art.knot:([5,8,10].includes(def.id)?art.bronze:art.open);
        im.sprite.color=[...im.sprite.color.slice(0,3),0];
        const visual=api.sprite('cabinet_piece',tex,{w:im.w,h:im.h,color:[255,255,255,255]},im);
        const st=shadowTexture(tex);const sh=api.sprite('cabinet_contact_shadow',st.tex,{w:im.w*st.w,h:im.h*st.h,color:[27,18,41,128]},shadowRoot);sh.sprite.ownTex=true;sh.setScale(im.sx,im.sy);state.shadows.push({node:sh,ring:n,view:v,baseX:im.sx,baseY:im.sy});
      }
      ui=installCabinetUI(api,g,art);
    }
    if(g._linkSys?.couplings.length)rig.attach(g,{socketTexture:art.socket,jawTexture:art.jaw});
    state.ready=!!g._ringData.length&&!!art;if(state.ready)loading.remove();
  }
  function attach(game){g=game;state.ready=false;state.fx=[];state.sleeves=[];state.shadows=[];state.materials=[];state.selected=null;
    for(const def of api.level.rings){const n=g._ringNodes[def.id],v=n.view;
      wrap(v,'onTouchStart',function(old,p){old(p);if(this._dragging||this._rejectTracking){state.selected=this.ringId;selectedAt=state.time;grabAngle=this.data.rotationDeg;lastTurnAngle=grabAngle;previousMotionAngle=grabAngle;lastMotionInput=state.time;lastPointerClock=performance.now()/1000;angularVelocity=0;sound('contact',undefined,def.x/600);effect('select',this.ringId);}});
      wrap(v,'onTouchMove',function(old,p){const before=this.data?.rotationDeg;old(p);if(this._dragging&&Math.abs(this.data.rotationDeg-before)>.001){const delta=(this.data.rotationDeg-before+540)%360-180;const clock=performance.now()/1000;angularVelocity=delta/Math.max(1/240,clock-lastPointerClock);lastPointerClock=clock;lastMotionInput=state.time;log('turn',{id:this.ringId,angle:this.data.rotationDeg});api.dirty();}});
      wrap(v,'onTouchEnd',function(old,...args){old(...args);releaseAt=state.time;state.selected=null;previousMotionAngle=null;angularVelocity=0;lastMotionInput=-Infinity;audio.stopMotion();api.dirty();});
      wrap(v,'playRejectDragTween',function(old,...args){const would=this.data&&!this._rejectPlaying&&!this._snapping&&!this.data.escaped;const result=old(...args);if(would)effect('blocked',this.ringId);return result;});
      wrap(v,'playEscapeTween',function(old,...args){effect('escape',this.ringId);sound('ring_escape',undefined,def.x/600);return old(...args);});
    }
    wrap(g,'startGuide',function(old,...args){if(!state.lowMotion)return old(...args);this.stopGuide();const guide=this.getCurrentGuide();if(!guide||this._ended)return;this.attachGuideToPlayfield();this.layoutGuideArrow(this.getRingGuideCenter(guide.ringId),guide);this.arrowNode.active=true;this.arrowNode.ensureOpacity().opacity=189;this.handSprite.active=false;});
    wrap(g,'startLayerOverHandRotationPingPong',function(old,...args){if(!state.lowMotion)return old(...args);this.stopLayerOverHandRotationPingPong();const h=this.resolveLayerOverHandNode();if(h){h.active=true;h.angle=15;}});
    wrap(g,'playEncourageAnimation',function(old,...args){const promise=old(...args),instance=this._encourageEfxInstance,armature=instance?.armature;if(armature){wrap(armature,'render',function(render,m,opacity,visible,order){return render(m,0,false,order)});if(!this._ended||this._totalEscapedCount>=2){const major=this._totalEscapedCount>=2;if(art){const plate=api.sprite('cabinet_encourage_plaque',art.header,{w:major?470:370,h:major?150:125},instance);plate.y=0;}const label=new api.Node('cabinet_encourage_words');instance.addChild(label);api.label(label,{string:major?'Great!':'Good!',family:'Georgia',fontSize:major?70:58,lineHeight:76,bold:true,color:[48,43,64,255]});state.encourage={node:label,t:state.time};}}return promise;});
    wrap(g,'playSfx',function(old,name){if(name!=='levelStart')return;return old(name);});
    wrap(g,'onLockedRingDragReject',function(old,...args){sound('fixed_rejection');return old(...args)});
    wrap(g,'onRingDragEnd',function(old,v){if(!this._ended&&!this._busy&&!v.isDragging&&!v.isSnapping&&!this._linkSys.getUnlockableCouplings(v.ringId).length){effect('misaligned',v.ringId);sound('misaligned_release')}return old(v)});
    wrap(g,'doSetupLevel',async function(old,...args){const r=await old(...args);installLinks();installArt();return r});
    wrap(g,'adjustIqScore',function(old,delta){log('iq',{before:this._iqScore,delta,after:this._iqScore+delta});effect(delta>0?'progress':'penalty',null,{delta});return old(delta)});
    wrap(g,'endPlayable',function(old,...args){if(!this._ended){const success=this._totalEscapedCount>=2;log('trial-end',{success,iq:this._iqScore,escaped:this._totalEscapedCount});effect(success?'trial-complete':'trial-limit',null);audio.stopMotion();sound(success?'trial_success':'trial_limit');if(!success)log('failure-tone');}return old(...args)});
    const controls=document.getElementById('rotate-controls')||document.createElement('div');controls.id='rotate-controls';controls.innerHTML='<button id="rotate-sound" aria-pressed="false">Sound on</button><button id="rotate-motion" aria-pressed="false">Motion full</button>';if(!controls.parentNode)document.body.append(controls);
    controls.querySelector('#rotate-sound').onclick=()=>{state.muted=!state.muted;audio.mute(state.muted);syncControls()};controls.querySelector('#rotate-motion').onclick=()=>{setLowMotion(!state.lowMotion)};syncControls();
    installLinks();installArt();log('ready');
  }
  function syncControls(){const s=document.getElementById('rotate-sound'),m=document.getElementById('rotate-motion');if(s){s.textContent=state.muted?'Sound off':'Sound on';s.setAttribute('aria-pressed',String(state.muted));m.textContent=state.lowMotion?'Motion reduced':'Motion full';m.setAttribute('aria-pressed',String(state.lowMotion))}}
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>{setLowMotion(e.matches)});
  function setLowMotion(value){state.lowMotion=value;if(g){g.stopGuide();g.stopLayerOverHandRotationPingPong();if(!g._ended)g.startGuide();else if(!value)g.startLayerOverHandRotationPingPong();}syncControls();api.dirty()}
  function installLinks(){state.fx=[];state.sleeves=[];state.selected=null;const muted=state.muted;audio.mute(true);if(!muted)audio.mute(false);const links=g._linkSys;if(linked.has(links))return;linked.add(links);wrap(links,'breakCoupling',function(old,owner,name){const was=this.couplings.find(c=>c.linked&&c.ownerRingId===owner&&c.connectNode===name);old(owner,name);if(was){rig.release(owner,name,state.time);const arm=g._connectArmNodes.get(`${owner}:${name}`),part=arm?.getChildByName('connect');if(part){const joint=rig.snapshot().latches.find(l=>l.owner===owner&&l.name===name)?.paintedJawKnuckleWorld;effect('coupling',was.partnerRingId,{owner,name,worldX:joint?.x??part.wm[4],worldY:joint?.y??part.wm[5]});sound('latch_release',undefined,api.level.rings.find(r=>r.id===owner).x/600);}}});}
  function update(dt){if(!g)return;state.time+=dt;if(!state.lowMotion)state.ambientTime+=dt;
    for(const sh of state.shadows){const n=sh.ring;sh.node.x=n.x+4;sh.node.y=n.y-7;sh.node.angle=sh.view._rotatePivot.angle;sh.node.ensureOpacity().opacity=n.opacity;sh.node.active=n.active;}
    const selected=state.selected!==null?g._ringNodes[state.selected]?.view:null;const aligned=selected?.isDragging&&!g._busy&&!g._ended?g._linkSys.getUnlockableCouplings(selected.ringId):[];const nextKey=aligned.map(c=>c.ownerRingId+':'+c.connectNode).join(',');if(nextKey&&nextKey!==alignmentKey){for(const c of aligned){const part=g._connectArmNodes.get(`${c.ownerRingId}:${c.connectNode}`)?.getChildByName('connect');if(part){const joint=rig.snapshot().latches.find(l=>l.owner===c.ownerRingId&&l.name===c.connectNode)?.paintedJawKnuckleWorld;effect('aligned',selected.ringId,{worldX:joint?.x??part.wm[4],worldY:joint?.y??part.wm[5]})}}}alignmentKey=nextKey;
    if(selected?.isDragging){const angle=selected.data.rotationDeg;audio.motion(state.time-lastMotionInput<.07?angularVelocity:0,api.level.rings.find(r=>r.id===selected.ringId).x/600,dt);previousMotionAngle=angle;}else audio.stopMotion();
    rig.update(state.time,state.lowMotion);ui?.update();
    if(state.encourage?.node.isValid){const q=Math.min(1,(state.time-state.encourage.t)/.22),scale=state.lowMotion?1:.9+.1*(1-Math.pow(1-q,3));state.encourage.node.setScale(scale,scale);}state.fx=state.fx.filter(e=>state.time-e.t<1.4);
    // Decoration obeys motion preference; essential ring dragging and rule timers remain unchanged.
    if(state.lowMotion&&g.handSprite){g._activeLevelRoot?.setScale(api.level.levelRootScale??1,api.level.levelRootScale??1);if(g.layerOver?.active)g.layerOver.setScale(1,1);g.handSprite.active=false;g.arrowNode.active=!!g.getCurrentGuide()&&!g._ended;g.arrowNode.ensureOpacity().opacity=189;const hand=g.resolveLayerOverHandNode();if(hand){g.stopLayerOverHandRotationPingPong();hand.angle=15;}}
  }
  function active(){return !!state.selected||state.fx.length>0||rig.snapshot().latches.some(l=>!['open','closed','reduced-open'].includes(l.phase))}
  function draw(){if(!g)return;const d=Math.min(devicePixelRatio||1,2);if(width!==innerWidth||height!==innerHeight||ratio!==d){width=innerWidth;height=innerHeight;ratio=d;canvas.width=width*d;canvas.height=height*d;canvas.style.width=width+'px';canvas.style.height=height+'px'}ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);const scale=api.scale();
    if(state.selected!==null&&!g._ended){const p=point(state.selected),v=g._ringNodes[state.selected].view;if(p&&v.canDrag()){ctx.save();ctx.translate(p.x,p.y);ctx.strokeStyle='#fff3ca';ctx.lineWidth=2;ctx.shadowColor='#f4d998';ctx.shadowBlur=9;const gap=Math.PI/2-v.data.rotationDeg*Math.PI/180;for(const side of [-1,1]){const a=gap+side*.55;ctx.beginPath();ctx.arc(0,0,p.r-8,a-.09,a+.09);ctx.stroke();}ctx.shadowBlur=0;ctx.restore();}}
    for(const e of state.fx){const age=state.time-e.t,p=e.id!==null?point(e.id):null;if(e.kind==='select'||e.kind==='turn')continue;
      if(['blocked','misaligned'].includes(e.kind)&&p&&age<.65){ctx.save();ctx.globalAlpha=(1-age/.65)*.95;ctx.strokeStyle='#6f2518';ctx.lineWidth=3;const r=p.r+10;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#fff0cb';ctx.strokeStyle='#6f2518';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y-14,10,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(p.x,p.y-20);ctx.lineTo(p.x,p.y-13);ctx.moveTo(p.x,p.y-9);ctx.lineTo(p.x,p.y-8);ctx.stroke();ctx.restore();}
      if((e.kind==='coupling'||e.kind==='aligned'||e.kind==='contact')&&age<.38&&!g._ended){const x=width/2+e.worldX*scale,y=height/2-e.worldY*scale;ctx.save();ctx.globalAlpha=1-age/.38;ctx.strokeStyle='#fff6ce';ctx.shadowColor='#ffd17a';ctx.shadowBlur=7;ctx.lineWidth=2;const len=state.lowMotion?6:5+age*24;for(let j=0;j<4;j++){const a=j*Math.PI/2+.35;ctx.beginPath();ctx.moveTo(x+Math.cos(a)*3,y+Math.sin(a)*3);ctx.lineTo(x+Math.cos(a)*len,y+Math.sin(a)*len);ctx.stroke()}ctx.restore();}
      if(e.kind==='escape'&&p&&age<.8&&!g._ended){ctx.save();const q=age/.8;ctx.globalAlpha=(1-q)*.75;ctx.strokeStyle='#fff5cf';ctx.lineWidth=2;ctx.shadowColor='#ffda7a';ctx.shadowBlur=8;const radius=p.r+(state.lowMotion?7:q*27);ctx.beginPath();ctx.arc(p.x,p.y,radius,.16,Math.PI*1.8);ctx.stroke();if(!state.lowMotion)for(let i=0;i<6;i++){const a=i*2.399+e.id;const r=p.r+q*(24+i*3),x=p.x+Math.cos(a)*r,y=p.y+Math.sin(a)*r;ctx.fillStyle=i%2?'#fff1bb':'#ba7033';ctx.beginPath();ctx.ellipse(x,y,3*(1-q),5*(1-q),a,0,Math.PI*2);ctx.fill()}ctx.restore();}
      if((e.kind==='progress'||e.kind==='penalty')&&age<.9&&!g._ended){ctx.save();ctx.globalAlpha=1-age/.9;ctx.font=`bold ${Math.max(16,30*scale)}px Georgia`;ctx.textAlign='center';ctx.fillStyle=e.delta>0?'#344334':'#9a2b1d';const y=height/2-401*scale-(state.lowMotion?0:age*17);ctx.fillText(`${e.delta>0?'+':''}${e.delta}`,width/2+130*scale,y);ctx.restore();}
      if(e.kind==='trial-complete'&&age<1.4){ctx.save();ctx.globalAlpha=(1-age/1.4)*.75;ctx.strokeStyle='#f4d69b';ctx.lineWidth=3;const r=125*scale+(state.lowMotion?0:age*45);ctx.beginPath();ctx.arc(width/2,height/2-309*scale,r,0,Math.PI*2);ctx.stroke();ctx.restore();}
    }
  }
  function snapshot(){return {version:state.version,assets:art?.metadata,assetReady:state.assetReady,rig:rig.snapshot(),ui:ui?.snapshot(),audioMix:audio.snapshot(),ready:state.ready,loads:state.loads,errors:[...state.errors],counts:{...state.counts},audio:{...state.audioCounts},lowMotion:state.lowMotion,muted:state.muted,masterGain:api.master?.gain.value,iq:g?._iqScore,escaped:g?._totalEscapedCount,ended:g?._ended,rings:g?._ringData.map(r=>({id:r.id,angle:r.rotationDeg,escaped:r.escaped})),links:g?._linkSys.couplings.map(c=>({owner:c.ownerRingId,node:c.connectNode,partner:c.partnerRingId,linked:c.linked})),events:[...state.events]}}
  return {attach,update,draw,active,snapshot,state,game:()=>g,canvas,rig,artReady};
}
