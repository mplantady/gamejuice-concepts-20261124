/* Storybook2.1 material feedback. Runtime review is recorded separately.
 * Pure canvas presentation: no source commands, audio, native writes, timers,
 * subscriptions or RAF of its own. Coordinates are CSS pixels in caller's CTM.
 * Caller: reset on readiness/load/reset; cell only for a verified changed action;
 * reveal on the first native dogRenderable edge; result on actual panel reveal.
 * Draw after native/pup artwork. This module confines accents to object rims
 * and paw-contact flanks, so faces, functional symbols and CTA copy stay clear.
 */
(() => {
  'use strict';
  if (window.WoofFeedback) return;
  const cells = new Map(), placed = new Set(), errors = new Set();
  const palette = Object.freeze({cream:'#fff1c0',warm:'#eac377',ink:'#674b39',rose:'#aa515b',paleRose:'#efb4a4'});
  const maxCells = 36, routineBudget = 8, historyLimit = 64;
  let hud = null, outcome = null, terminal = false, resultStarted = false, gentleState = false, epoch = 0;
  let nextId = 0, draws = 0, lastError = '', maxActive = 0, rejected = 0;
  let anchors = [], history = [];
  const clock = () => performance.now();
  const clamp = value => Math.max(0, Math.min(1, value));
  const ease = value => 1 - (1-clamp(value)) ** 3;
  const key = (x,y) => `${x},${y}`;
  const stamp = value => Number.isFinite(value) && value >= 0 ? value : clock();
  const validCell = (x,y) => Number.isInteger(x) && Number.isInteger(y) && x>=0 && y>=0 && x<6 && y<6;
  const read = fn => { try { return fn(); } catch (_) { return null; } };
  const note = (type,data={}) => { history.push({type,epoch,...data}); if(history.length>historyLimit)history.shift(); };
  function rect(value) {
    if(!value || value.visible===false)return null;
    const {left,top,right,bottom}=value;
    if(![left,top,right,bottom].every(Number.isFinite)||right<=left||bottom<=top)return null;
    return {left,top,right,bottom,width:right-left,height:bottom-top,x:(left+right)/2,y:(top+bottom)/2};
  }
  function cellRect(x,y) { return rect(read(()=>window.WoofdokuBridge?.cellRect(x,y))); }
  function uiRect(name) { return rect(read(()=>window.WoofdokuBridge?.uiRect(name))); }
  const inside = (r,x,y) => ({x:Math.max(r.left,Math.min(r.right,x)),y:Math.max(r.top,Math.min(r.bottom,y))});
  const overlap = (a,b) => a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  function roundedPath(ctx,r,radius) {
    const k=Math.min(radius,r.width/2,r.height/2);
    ctx.moveTo(r.left+k,r.top);ctx.lineTo(r.right-k,r.top);ctx.quadraticCurveTo(r.right,r.top,r.right,r.top+k);
    ctx.lineTo(r.right,r.bottom-k);ctx.quadraticCurveTo(r.right,r.bottom,r.right-k,r.bottom);
    ctx.lineTo(r.left+k,r.bottom);ctx.quadraticCurveTo(r.left,r.bottom,r.left,r.bottom-k);
    ctx.lineTo(r.left,r.top+k);ctx.quadraticCurveTo(r.left,r.top,r.left+k,r.top);ctx.closePath();
  }
  function clipped(ctx,r,body,protectedRects=[]) {
    if(!r)return;
    ctx.save();
    try {
      ctx.beginPath();roundedPath(ctx,r,Math.min(r.width,r.height)*.13);ctx.clip();
      // Each hole gets its own intersection, avoiding even-odd overlap leaks.
      for(const area of protectedRects.map(rect).filter(Boolean))if(overlap(r,area)){
        ctx.beginPath();ctx.rect(r.left,r.top,r.width,r.height);ctx.rect(area.left,area.top,area.width,area.height);ctx.clip('evenodd');
      }
      body();
    } finally { ctx.restore(); }
  }
  // A filled, tapered brush ribbon, not a blurred glow or a uniform line ring.
  function brush(ctx,a,b,c,width,color,alpha) {
    if(!(width>0&&alpha>0)||![a.x,a.y,b.x,b.y,c.x,c.y,width,alpha].every(Number.isFinite))return;
    const dx=c.x-a.x,dy=c.y-a.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len,w=width;
    ctx.save();
    try {
      ctx.globalAlpha*=clamp(alpha);ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(a.x,a.y);
      ctx.quadraticCurveTo(b.x+nx*w,b.y+ny*w,c.x,c.y);
      ctx.quadraticCurveTo(b.x-nx*w,b.y-ny*w,a.x,a.y);ctx.closePath();ctx.fill();
    } finally { ctx.restore(); }
  }
  const point = (r,x,y) => ({x:r.left+r.width*x,y:r.top+r.height*y});
  function fade(age,duration,attack=0) {
    if(age<0||age>=duration)return 0;
    return (attack?clamp(age/attack):1)*(1-clamp(age/duration))**1.25;
  }
  const calmAlpha = (e,now) => e.calm ? fade(now-e.calmAt,e.calmUntil-e.calmAt) : null;
  function calm(e,now,duration=230) {
    if(!e||e.calm)return;
    e.calm=true;e.calmAt=now;e.calmUntil=Math.min(e.expiresAt,now+duration);
  }
  function fresh(type,at,duration,extra={}) {
    const e={id:++nextId,epoch,type,at,expiresAt:at+duration,calm:false,...extra};
    if(gentleState)calm(e,at,type==='result'?330:230);
    return e;
  }
  function expire(now) {
    for(const [k,e]of cells)if(now>=e.expiresAt||(e.calm&&now>=e.calmUntil))cells.delete(k);
    if(hud&&(now>=hud.expiresAt||(hud.calm&&now>=hud.calmUntil)))hud=null;
    if(outcome&&(now>=outcome.expiresAt||(outcome.calm&&now>=outcome.calmUntil)))outcome=null;
  }
  function reset(mode) {
    if(typeof mode==='boolean')gentleState=mode;
    epoch++;cells.clear();placed.clear();errors.clear();hud=null;outcome=null;terminal=false;resultStarted=false;anchors=[];history=[];lastError='';
    note('reset');return epoch;
  }
  function cell(type,{x,y,at,livesBefore,livesAfter}={}) {
    if(!validCell(x,y)||!['place','invalid','mark','unmark'].includes(type)||terminal){rejected++;return false;}
    const k=key(x,y),time=stamp(at),old=cells.get(k);
    if(placed.has(k)||errors.has(k)||(old&&time<=old.at)){rejected++;return false;}
    expire(time);
    const duration=type==='place'?2400:type==='invalid'?700:type==='mark'?260:200;
    const e=fresh(type,time,duration,{x,y,revealAt:null});cells.set(k,e);
    if(type==='place'){
      placed.add(k);
      if(!hud||hud.type!=='invalid')hud=fresh('place',time,440);
    }
    if(type==='invalid'){
      errors.add(k);
      // Source RefreshHearts keeps zero-based index e active iff e<lives.
      // Serialized order is HeartSlot1,2,3: one loss empties livesAfter+1.
      if(Number.isInteger(livesBefore)&&Number.isInteger(livesAfter)&&livesBefore<=3&&livesAfter>=0&&livesBefore===livesAfter+1){
        hud=fresh('invalid',time,620,{slot:livesAfter+1,livesAfter});
      }
    }
    const routines=[...cells.values()].filter(v=>v.type==='mark'||v.type==='unmark').sort((a,b)=>a.at-b.at);
    for(const excess of routines.slice(0,Math.max(0,routines.length-routineBudget)))cells.delete(key(excess.x,excess.y));
    // Coordinate validation already bounds this map to36; this is a second guard.
    while(cells.size>maxCells)cells.delete(cells.keys().next().value);
    maxActive=Math.max(maxActive,cells.size);note('cell',{id:e.id,type,x,y,at:time,slot:hud?.type==='invalid'?hud.slot:null});return true;
  }
  function reveal(x,y,at) {
    const e=cells.get(key(x,y));
    if(terminal||!e||e.type!=='place'||e.revealAt!==null){rejected++;return false;}
    const time=stamp(at);
    if(time<e.at||time>=e.expiresAt||(e.calm&&time>=e.calmUntil)){rejected++;return false;}
    e.revealAt=time;e.expiresAt=time+680;note('reveal',{id:e.id,x,y,at:time});return true;
  }
  function result(kind,at) {
    kind=kind==='complete'?'success':kind==='failure'?'failed':kind;
    if(!['success','failed'].includes(kind)||resultStarted){rejected++;return false;}
    terminal=true;resultStarted=true;cells.clear();hud=null;
    const time=stamp(at);outcome=fresh('result',time,kind==='success'?1520:920,{kind});
    note('result',{id:outcome.id,kind,at:time});return true;
  }
  function pressure(ctx,r,age,e) {
    const alpha=e.calm?calmAlpha(e,age+e.at):fade(age,250);
    if(!(alpha>0))return;
    const p=e.calm?1:ease(age/110),w=Math.max(2.8,Math.min(r.width,r.height)*.075);
    brush(ctx,point(r,.085,.27),point(r,.08,.10-.025*p),point(r,.59,.078),w,palette.cream,.96*alpha);
    brush(ctx,point(r,.66,.082),point(r,.88,.08),point(r,.92,.26),w*.7,palette.warm,.78*alpha);
    brush(ctx,point(r,.58,.90),point(r,.80,.94),point(r,.91,.77),w*.72,palette.ink,.26*alpha);
    brush(ctx,point(r,.12,.82),point(r,.18,.90),point(r,.34,.90),w*.8,palette.warm,.72*alpha);
  }
  function contact(ctx,r,base,e,now) {
    if(e.revealAt===null||!base)return;
    const age=now-e.revealAt,alpha=e.calm?calmAlpha(e,now):fade(age,680,24);
    if(!(alpha>0))return;
    // Exactly the registered contact used by current Storybook drawDog().
    const foot=inside(r,base.x,base.top+base.height*460/512);
    const size=Math.min(base.width,r.width),p=e.calm?1:ease(age/180),span=size*(.23+.08*p),dip=size*(e.calm?.035:.025+.06*(1-p));
    anchors.push({id:e.id,kind:'dog-contact',x:foot.x,y:foot.y,cellX:e.x,cellY:e.y});
    for(const side of [-1,1]){
      const a=inside(r,foot.x+side*span,foot.y-.7),b=inside(r,foot.x+side*size*.20,foot.y+dip),c=inside(r,foot.x+side*size*.07,foot.y+1);
      const underA={...a,y:a.y+.65},underB={...b,y:b.y+.65},underC={...c,y:c.y+.65};
      brush(ctx,underA,underB,underC,Math.max(3.5,size*.105),palette.ink,.28*alpha);
      brush(ctx,a,b,c,Math.max(2.8,size*.080),palette.cream,.96*alpha);
      if(!e.calm){
        const a2=inside(r,foot.x+side*size*.30,foot.y-size*.13),b2=inside(r,foot.x+side*size*(.33+.025*p),foot.y-size*.18),c2=inside(r,foot.x+side*size*(.36+.035*p),foot.y-size*.21);
        brush(ctx,a2,b2,c2,Math.max(1.4,size*.045),palette.warm,.68*alpha);
      }
    }
  }
  function invalid(ctx,r,e,now) {
    const age=now-e.at,alpha=e.calm?calmAlpha(e,now):fade(age,700);
    if(!(alpha>0))return;
    const p=e.calm?1:ease(age/100),w=Math.max(2.8,r.width*.075),inset=.105+.025*(1-p);
    brush(ctx,point(r,inset,.39),point(r,inset,.14),point(r,.36,inset),w,palette.rose,.9*alpha);
    brush(ctx,point(r,1-inset,.61),point(r,1-inset,.86),point(r,.64,1-inset),w,palette.rose,.9*alpha);
    brush(ctx,point(r,.29,.83),point(r,.50,.89),point(r,.72,.83),w*.75,palette.paleRose,.62*alpha);
  }
  function routine(ctx,r,e,now) {
    const age=now-e.at,duration=e.type==='mark'?260:200,alpha=e.calm?calmAlpha(e,now):fade(age,duration);
    if(!(alpha>0))return;
    const p=e.calm?1:ease(age/duration),span=e.type==='mark'?.12+.07*p:.19-.09*p,y=.70;
    brush(ctx,point(r,.5-span,y),point(r,.5,y+.055),point(r,.5+span,y),Math.max(1.3,r.width*.035),palette.cream,.54*alpha);
  }
  function drawHud(ctx,s,now) {
    if(!hud)return;
    const age=now-hud.at,alpha=hud.calm?calmAlpha(hud,now):fade(age,hud.expiresAt-hud.at);
    if(!(alpha>0))return;
    if(hud.type==='invalid'){
      if(s.lives!==hud.livesAfter)return;
      const path=`TopHud/StatusNodes/HealthNode/HeartSlot${hud.slot}`,r=uiRect(path);
      const icon=read(()=>window.WoofdokuBridge?.uiRect(`${path}/HeartIcon`));
      // The static socket is active; the spent white icon must actually be off.
      if(!r||!icon||icon.visible!==false)return;
      anchors.push({id:hud.id,kind:'spent-bone-socket',slot:hud.slot,rect:r});
      clipped(ctx,r,()=>{
        brush(ctx,point(r,.12,.65),point(r,.17,.91),point(r,.42,.88),Math.max(1.6,r.width*.07),palette.paleRose,.86*alpha);
        brush(ctx,point(r,.59,.14),point(r,.84,.10),point(r,.89,.37),Math.max(1.6,r.width*.07),palette.rose,.76*alpha);
      });
    }else{
      const r=rect(s.countRect)||uiRect('TopHud/StatusNodes/QueenNode/QueenContent/QueenCountLabel');
      if(!r)return;
      const band={...r,top:r.bottom-r.height*.16,height:r.height*.16};
      clipped(ctx,band,()=>brush(ctx,point(r,.20,.94),point(r,.50,.985),point(r,.82,.94),Math.max(1.4,r.height*.07),palette.warm,.65*alpha));
    }
  }
  function drawResult(ctx,s,now) {
    if(!outcome||s.result!==outcome.kind||(outcome.kind==='success'&&!s.completed))return;
    const e=outcome,age=now-e.at,r=uiRect('CompletePanel/Icon')||rect(s.resultIconRect);
    const success=e.kind==='success',alpha=e.calm?calmAlpha(e,now):fade(age,success?1100:700,36);
    if(r&&alpha>0)clipped(ctx,r,()=>{
      const w=Math.max(2,Math.min(r.width,r.height)*.021),p=e.calm?1:ease(age/230),tone=success?palette.cream:palette.paleRose;
      // The actual badge is a rounded wooden rectangle, not a circular medal.
      brush(ctx,point(r,.07,.24),point(r,.065,.065),point(r,.34+.16*p,.046),w,tone,.88*alpha);
      brush(ctx,point(r,.95,.54),point(r,.965,.91),point(r,.62,.952),w*.82,success?palette.warm:palette.rose,.76*alpha);
      if(success){
        brush(ctx,point(r,.12,.945),point(r,.35,.975),point(r,.57,.95),w*.7,palette.cream,.64*alpha);
        // Fixed glint on the existing golden paw emblem at upper right.
        const x=.815,y=.155,glint=e.calm?alpha:fade(age-120,520,60),g=.035;
        brush(ctx,point(r,x-g,y),point(r,x,y-.002),point(r,x+g,y),w*.8,palette.cream,.9*glint);
        brush(ctx,point(r,x,y-g*.72),point(r,x+.002,y),point(r,x,y+g*.72),w*.56,palette.cream,.9*glint);
      }
      anchors.push({id:e.id,kind:'result-wood-rim',result:e.kind,rect:r});
    },[s.resultInfoRect,s.resultPlayRect]);
    const cta=rect(s.resultPlayRect);
    const handoff=e.calm?calmAlpha(e,now):fade(age-(success?510:260),success?760:570,70);
    if(cta&&handoff>0){
      const band={...cta,top:cta.top+cta.height*.82,height:cta.height*.18};
      clipped(ctx,band,()=>{
        brush(ctx,point(cta,.15,.88),point(cta,.49,.955),point(cta,.85,.88),Math.max(2,cta.height*.075),success?palette.cream:palette.paleRose,.75*handoff);
        anchors.push({id:e.id,kind:'cta-lower-rim',rect:band});
      },[s.resultInfoRect]);
    }
  }
  function draw(ctx,snapshot,now,gentle) {
    const time=stamp(now);expire(time);anchors=[];draws++;
    gentleState=!!gentle;
    if(gentleState){for(const e of cells.values())calm(e,time);calm(hud,time);calm(outcome,time,330);}
    if(!ctx||!snapshot)return;
    ctx.save();
    try {
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
      if('filter'in ctx)ctx.filter='none';
      if(snapshot.resultVisible){
        // No board/HUD VFX are ever painted over an endcard, even if a late
        // wrong_placement notification follows the source failure event.
        cells.clear();hud=null;terminal=true;drawResult(ctx,snapshot,time);lastError='';return;
      }
      if(terminal)return;
      for(const [k,e]of cells){
        const c=snapshot.cells?.find(value=>value.x===e.x&&value.y===e.y);
        if(!c)continue;
        const matches=e.type==='place'?c.selected:e.type==='invalid'?c.error:e.type==='mark'?c.excluded:!c.excluded&&!c.selected&&!c.error;
        if(!matches){cells.delete(k);continue;}
        const r=cellRect(e.x,e.y);if(!r)continue;
        clipped(ctx,r,()=>{
          if(e.type==='place'){
            pressure(ctx,r,time-e.at,e);
            if(c.dogRenderable)contact(ctx,r,rect(c.dogBaseRect),e,time);
          }else if(e.type==='invalid')invalid(ctx,r,e,time);else routine(ctx,r,e,time);
        });
      }
      drawHud(ctx,snapshot,time);lastError='';
    } catch(error) { lastError=String(error?.message||error); }
    finally { ctx.restore(); }
  }
  window.WoofFeedback=Object.freeze({reset,cell,reveal,result,draw,diagnostics:()=>({
    status:'ready',integrated:true,epoch,draws,terminal,resultStarted,gentle:gentleState,activeCells:cells.size,
    maxCells,maxActive,routineBudget,hud:hud?{type:hud.type,slot:hud.slot??null,at:hud.at,calm:hud.calm}:null,
    result:outcome?{kind:outcome.kind,at:outcome.at,calm:outcome.calm}:null,
    active:[...cells.values()].map(e=>({id:e.id,type:e.type,x:e.x,y:e.y,at:e.at,revealAt:e.revealAt,expiresAt:e.expiresAt,calm:e.calm})),
    anchors:anchors.map(value=>({...value})),history:history.map(value=>({...value})),rejected,error:lastError,
    mutationScope:'Own bounded descriptors and caller canvas pixels only; no native state, transforms, audio or clock changes.'
  })});
})();
