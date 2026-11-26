/* Astral Cabinet: independent artwork and jointed mechanisms on the unchanged source game. */
import {loadCabinetAssets} from './cabinet-assets.js';
import {createLatchRig} from './mechanical-latches.js';
import {createCabinetAudio} from './cabinet-audio.js';
import {installCabinetUI} from './cabinet-ui.js';
import {createCabinetEffects} from './cabinet-effects.js';
export function installRotateRestyle(api){
  const state={ready:false,version:'2026-11-26-cabinet-vfx-v3',time:0,ambientTime:0,events:[],counts:{},errors:[],selected:null,fx:[],sleeves:[],shadows:[],materials:[],audioCounts:{},lowMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,muted:false,loads:0};
  const loading=document.createElement('div');loading.id='rotate-loading';loading.innerHTML='<strong>Rotate Rings</strong><span>Opening the cabinet…</span>';document.body.append(loading);
  const canvas=document.createElement('canvas');canvas.id='rotate-fx';document.body.append(canvas);const ctx=canvas.getContext('2d');
  let alignmentKey='';let width=0,height=0,ratio=1,g=null,selectedAt=0,releaseAt=0,lastTurn=0,turnSerial=0,grabAngle=0;
  const linked=new WeakSet();let lastTurnAngle=0,previousMotionAngle=null,lastMotionInput=-Infinity,lastPointerClock=0,angularVelocity=0,art=null,ui=null;
  const log=(event,data={})=>{state.counts[event]=(state.counts[event]||0)+1;state.events.push({event,time:state.time,audioTime:api.audio?.currentTime,...data});if(state.events.length>600)state.events.shift()};
  const effects=createCabinetEffects({log});
  const audio=createCabinetAudio(api,state,log);
  const rig=createLatchRig({...api,onContact:(owner,name)=>{const l=rig.snapshot().latches.find(l=>l.owner===owner&&l.name===name);audio.play('latch_settle',undefined,l?panWorld(l.paintedJawKnuckleWorld.x):panRing(owner));if(l)effect('contact',null,{owner,name,worldX:l.hingeWorld.x,worldY:l.hingeWorld.y});}});
  const artReady=loadCabinetAssets(api).then(result=>{art={...result.textures,metadata:result.metadata};state.assetReady=true;installArt();api.dirty();}).catch(e=>{state.errors.push('art: '+e.message);loading.remove();});
  function panWorld(x){return Math.max(-.5,Math.min(.5,x*api.scale()/Math.max(1,innerWidth*.5)));}
  function panRing(id){const node=g?._ringNodes[id];return node?panWorld(worldNode(node).x):0;}
  function sound(name,gain,pan=0,rate=1){return audio.play(name,gain,pan,rate)}
  function effect(kind,id,extra={}){state.fx.push({kind,id,t:state.time,...extra});if(state.fx.length>96)state.fx.shift();effects.emit(kind,{id,...extra},state.time);log(kind,{id,...extra});api.dirty();}
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
  function attach(game){g=game;effects.reset();state.hudPulse=null;state.gripLocalDeg=null;state.ready=false;state.fx=[];state.sleeves=[];state.shadows=[];state.materials=[];state.selected=null;
    for(const def of api.level.rings){const n=g._ringNodes[def.id],v=n.view;
      wrap(v,'onTouchStart',function(old,p){old(p);if(this._dragging||this._rejectTracking){state.selected=this.ringId;selectedAt=state.time;grabAngle=this.data.rotationDeg;state.gripLocalDeg=-this.touchToDragDeg(p)+grabAngle;lastTurnAngle=grabAngle;previousMotionAngle=grabAngle;lastMotionInput=state.time;lastPointerClock=performance.now()/1000;angularVelocity=0;sound('contact',undefined,panRing(this.ringId));effect('select',this.ringId,{gripLocalDeg:state.gripLocalDeg});}});
      wrap(v,'onTouchMove',function(old,p){const before=this.data?.rotationDeg;old(p);if(this._dragging&&Math.abs(this.data.rotationDeg-before)>.001){const delta=(this.data.rotationDeg-before+540)%360-180;const clock=performance.now()/1000;angularVelocity=delta/Math.max(1/240,clock-lastPointerClock);lastPointerClock=clock;lastMotionInput=state.time;log('turn',{id:this.ringId,angle:this.data.rotationDeg});effects.emit('turn',{id:this.ringId,angle:this.data.rotationDeg,delta,gripLocalDeg:state.gripLocalDeg},state.time);api.dirty();}});
      wrap(v,'onTouchEnd',function(old,...args){old(...args);releaseAt=state.time;if(state.selected!==null)effect('release',state.selected,{gripLocalDeg:state.gripLocalDeg});state.selected=null;previousMotionAngle=null;angularVelocity=0;lastMotionInput=-Infinity;audio.stopMotion();api.dirty();});
      wrap(v,'playRejectDragTween',function(old,...args){const would=this.data&&!this._rejectPlaying&&!this._snapping&&!this.data.escaped;const result=old(...args);if(would)effect('blocked',this.ringId,{gripLocalDeg:state.gripLocalDeg});return result;});
      wrap(v,'playEscapeTween',function(old,...args){effect('escape',this.ringId);sound('ring_escape',undefined,panRing(this.ringId));return old(...args);});
    }
    wrap(g,'startGuide',function(old,...args){if(!state.lowMotion)return old(...args);this.stopGuide();const guide=this.getCurrentGuide();if(!guide||this._ended)return;this.attachGuideToPlayfield();this.layoutGuideArrow(this.getRingGuideCenter(guide.ringId),guide);this.arrowNode.active=true;this.arrowNode.ensureOpacity().opacity=189;this.handSprite.active=false;});
    wrap(g,'startLayerOverHandRotationPingPong',function(old,...args){if(!state.lowMotion)return old(...args);this.stopLayerOverHandRotationPingPong();const h=this.resolveLayerOverHandNode();if(h){h.active=true;h.angle=15;}});
    wrap(g,'playEncourageAnimation',function(old,...args){const promise=old(...args),instance=this._encourageEfxInstance,armature=instance?.armature;if(armature){wrap(armature,'render',function(render,m,opacity,visible,order){return render(m,0,false,order)});if(!this._ended||this._totalEscapedCount>=2){const major=this._totalEscapedCount>=2;if(art){const plate=api.sprite('cabinet_encourage_plaque',art.header,{w:major?470:370,h:major?150:125},instance);plate.y=0;}const label=new api.Node('cabinet_encourage_words');instance.addChild(label);api.label(label,{string:major?'Great!':'Good!',family:'Georgia',fontSize:major?70:58,lineHeight:76,bold:true,color:[48,43,64,255]});state.encourage={node:label,t:state.time};}}return promise;});
    wrap(g,'playSfx',function(old,name){if(name!=='levelStart')return;return old(name);});
    wrap(g,'onLockedRingDragReject',function(old,...args){sound('fixed_rejection',undefined,panRing(state.selected));return old(...args)});
    wrap(g,'onRingDragEnd',function(old,v){if(!this._ended&&!this._busy&&!v.isDragging&&!v.isSnapping&&!this._linkSys.getUnlockableCouplings(v.ringId).length){effect('misaligned',v.ringId,{gripLocalDeg:state.gripLocalDeg});sound('misaligned_release',undefined,panRing(v.ringId))}return old(v)});
    wrap(g,'doSetupLevel',async function(old,...args){const r=await old(...args);installLinks();installArt();return r});
    wrap(g,'adjustIqScore',function(old,delta){log('iq',{before:this._iqScore,delta,after:this._iqScore+delta});state.hudPulse={t:state.time,delta};effect(delta>0?'progress':'penalty',null,{delta});return old(delta)});
    wrap(g,'endPlayable',function(old,...args){if(!this._ended){const success=this._totalEscapedCount>=2;log('trial-end',{success,iq:this._iqScore,escaped:this._totalEscapedCount});effect(success?'trial-complete':'trial-limit',null);audio.stopMotion();sound(success?'trial_success':'trial_limit');if(!success)log('failure-tone');}return old(...args)});
    const controls=document.getElementById('rotate-controls')||document.createElement('div');controls.id='rotate-controls';controls.innerHTML='<button id="rotate-sound" aria-pressed="false">Sound on</button><button id="rotate-motion" aria-pressed="false">Motion full</button>';if(!controls.parentNode)document.body.append(controls);
    controls.querySelector('#rotate-sound').onclick=()=>{state.muted=!state.muted;audio.mute(state.muted);syncControls()};controls.querySelector('#rotate-motion').onclick=()=>{setLowMotion(!state.lowMotion)};syncControls();
    installLinks();installArt();log('ready');
  }
  function syncControls(){const s=document.getElementById('rotate-sound'),m=document.getElementById('rotate-motion');if(s){s.textContent=state.muted?'Sound off':'Sound on';s.setAttribute('aria-pressed',String(state.muted));m.textContent=state.lowMotion?'Motion reduced':'Motion full';m.setAttribute('aria-pressed',String(state.lowMotion))}}
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>{setLowMotion(e.matches)});
  function setLowMotion(value){state.lowMotion=value;if(g){g.stopGuide();g.stopLayerOverHandRotationPingPong();if(!g._ended)g.startGuide();else if(!value)g.startLayerOverHandRotationPingPong();}syncControls();api.dirty()}
  function installLinks(){effects.reset();state.hudPulse=null;state.gripLocalDeg=null;if(g?._iqNode)g._iqNode.setScale(1,1);state.fx=[];state.sleeves=[];state.selected=null;const muted=state.muted;audio.mute(true);if(!muted)audio.mute(false);const links=g._linkSys;if(linked.has(links))return;linked.add(links);wrap(links,'breakCoupling',function(old,owner,name){const was=this.couplings.find(c=>c.linked&&c.ownerRingId===owner&&c.connectNode===name);old(owner,name);if(was){rig.release(owner,name,state.time);const arm=g._connectArmNodes.get(`${owner}:${name}`),part=arm?.getChildByName('connect');if(part){const joint=rig.snapshot().latches.find(l=>l.owner===owner&&l.name===name)?.paintedJawKnuckleWorld;effect('coupling',was.partnerRingId,{owner,name,worldX:joint?.x??part.wm[4],worldY:joint?.y??part.wm[5]});sound('latch_release',undefined,panWorld(joint?.x??worldNode(part).x));}}});}
  function update(dt){if(!g)return;state.time+=dt;if(!state.lowMotion)state.ambientTime+=dt;
    for(const sh of state.shadows){const n=sh.ring,id=sh.view.ringId;let pressure=state.selected===id ? .7 : 0;for(const e of state.fx){const age=state.time-e.t;if((e.id===id||e.owner===id)&&['contact','blocked','misaligned'].includes(e.kind)&&age<.35)pressure=Math.max(pressure,Math.sin(Math.PI*age/.35));}if(state.lowMotion)pressure=0;sh.node.x=n.x+4+pressure*1.4;sh.node.y=n.y-7-pressure*2;sh.node.angle=sh.view._rotatePivot.angle;sh.node.sprite.color=[27,18,41,Math.round(128+pressure*26)];sh.node.ensureOpacity().opacity=n.opacity;sh.node.active=n.active;}
    const selected=state.selected!==null?g._ringNodes[state.selected]?.view:null;const aligned=selected?.isDragging&&!g._busy&&!g._ended?g._linkSys.getUnlockableCouplings(selected.ringId):[];const nextKey=aligned.map(c=>c.ownerRingId+':'+c.connectNode).join(',');if(nextKey&&nextKey!==alignmentKey){for(const c of aligned){const part=g._connectArmNodes.get(`${c.ownerRingId}:${c.connectNode}`)?.getChildByName('connect');if(part){const joint=rig.snapshot().latches.find(l=>l.owner===c.ownerRingId&&l.name===c.connectNode)?.paintedJawKnuckleWorld;effect('aligned',selected.ringId,{owner:c.ownerRingId,name:c.connectNode,worldX:joint?.x??part.wm[4],worldY:joint?.y??part.wm[5]})}}}alignmentKey=nextKey;
    if(selected?.isDragging){const angle=selected.data.rotationDeg;audio.motion(state.time-lastMotionInput<.07?angularVelocity:0,panRing(selected.ringId),dt);previousMotionAngle=angle;}else audio.stopMotion();
    rig.update(state.time,state.lowMotion);ui?.update();
    if(g._iqNode){const age=state.hudPulse?state.time-state.hudPulse.t:1,peak=state.hudPulse?.delta>0 ? .12 : .06,q=Math.min(1,age/.42),bump=state.lowMotion||q>=1?0:Math.sin(Math.PI*q)*Math.exp(-q*1.3);g._iqNode.setScale(1+peak*bump,1+peak*bump);}
    if(state.encourage?.node.isValid){const q=Math.min(1,(state.time-state.encourage.t)/.22),scale=state.lowMotion?1:.9+.1*(1-Math.pow(1-q,3));state.encourage.node.setScale(scale,scale);}state.fx=state.fx.filter(e=>state.time-e.t<1.4);
    // Decoration obeys motion preference; essential ring dragging and rule timers remain unchanged.
    if(state.lowMotion&&g.handSprite){g._activeLevelRoot?.setScale(api.level.levelRootScale??1,api.level.levelRootScale??1);if(g.layerOver?.active)g.layerOver.setScale(1,1);g.handSprite.active=false;g.arrowNode.active=!!g.getCurrentGuide()&&!g._ended;g.arrowNode.ensureOpacity().opacity=189;const hand=g.resolveLayerOverHandNode();if(hand){g.stopLayerOverHandRotationPingPong();hand.angle=15;}}
  }
  function active(){return state.selected!==null||effects.snapshot().activeCount>0||state.fx.length>0||rig.snapshot().latches.some(l=>!['open','closed','reduced-open'].includes(l.phase))}
  // All effects resolve positions from the live scene after the engine renders.
  // These helpers read transforms only; no hit, score, angle or gameplay clock is written.
  function worldNode(node,local={x:0,y:0}){let x=local.x,y=local.y,angle=0;for(let n=node;n;n=n.parent){const a=(n.angle||0)*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),xx=x*(n.sx??1),yy=y*(n.sy??1);x=c*xx-sn*yy+(n.x||0);y=sn*xx+c*yy+(n.y||0);angle+=n.angle||0;}return{x,y,angle};}
  function screenNode(node,fallback){if(!node)return fallback;const p=worldNode(node);return{x:width/2+p.x*api.scale(),y:height/2-p.y*api.scale(),angle:p.angle};}
  function effectFrame(){
    const scale=api.scale(),rings=api.level.rings.map(def=>{const n=g._ringNodes[def.id],v=n?.view,p=point(def.id);return p?{id:def.id,...p,angle:v._rotatePivot?.angle??v.data.rotationDeg,active:n.active,open:![4,5,8,10].includes(def.id),canDrag:v.canDrag(),gripLocalDeg:state.selected===def.id?state.gripLocalDeg:undefined}:null}).filter(Boolean),joints={};
    for(const joint of rig.snapshot().latches){const part=g._connectArmNodes.get(`${joint.owner}:${joint.name}`)?.getChildByName('connect'),p=joint.paintedJawKnuckleWorld;joints[`${joint.owner}:${joint.name}`]={x:width/2+p.x*scale,y:height/2-p.y*scale,angle:part?worldNode(part).angle:0};}
    const score=screenNode(g._iqNode,{x:width/2+66*scale,y:height/2-443*scale}),icon=g.layerOver?.getChildByName('icon'),result=screenNode(icon,{x:width/2,y:height/2-200*scale});
    return{time:state.time,lowMotion:state.lowMotion,width,height,scale,selected:state.selected,angularVelocity,ended:g._ended,success:g._totalEscapedCount>=2,rings,joints,hud:{x:width/2,y:score.y,scoreX:score.x,scoreY:score.y},result:{...result,r:(icon?.w||250)*scale*.5}};
  }
  function draw(){if(!g)return;const d=Math.min(devicePixelRatio||1,2);if(width!==innerWidth||height!==innerHeight||ratio!==d){width=innerWidth;height=innerHeight;ratio=d;canvas.width=width*d;canvas.height=height*d;canvas.style.width=width+'px';canvas.style.height=height+'px'}ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);effects.render(ctx,effectFrame());}
  function snapshot(){return {version:state.version,effects:effects.snapshot(),assets:art?.metadata,assetReady:state.assetReady,rig:rig.snapshot(),ui:ui?.snapshot(),audioMix:audio.snapshot(),ready:state.ready,loads:state.loads,errors:[...state.errors],counts:{...state.counts},audio:{...state.audioCounts},lowMotion:state.lowMotion,muted:state.muted,masterGain:api.master?.gain.value,iq:g?._iqScore,escaped:g?._totalEscapedCount,ended:g?._ended,rings:g?._ringData.map(r=>({id:r.id,angle:r.rotationDeg,escaped:r.escaped})),links:g?._linkSys.couplings.map(c=>({owner:c.ownerRingId,node:c.connectNode,partner:c.partnerRingId,linked:c.linked})),events:[...state.events]}}
  return {attach,update,draw,active,snapshot,state,game:()=>g,canvas,rig,artReady,effects,effectFrame};
}
