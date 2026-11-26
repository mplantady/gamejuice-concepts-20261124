/**
 * Presentation-only effects for the painted Rotate Rings cabinet.
 * Times are seconds; positions and radii are CSS pixels. The caller supplies
 * current transforms every render and clears the overlay before render().
 * Joint angles and ring angles are source degrees (positive counterclockwise).
 * No source nodes, rules, scores, random state, input or clocks are changed.
 */
export function createCabinetEffects({log} = {}) {
  const TAU = Math.PI * 2, RAD = Math.PI / 180, MAX_EVENTS = 28;
  const SPECS = {
    select: [.19, .055, 1], turn: [.16, .085, 0], release: [.16, .06, 1], aligned: [.27, .2, 2],
    coupling: [.45, .4, 4], contact: [.34, .14, 5],
    blocked: [.46, .23, 3], misaligned: [.36, .2, 3],
    escape: [.7, .6, 5], progress: [.92, .08, 6], penalty: [.48, .08, 3],
    'trial-complete': [1.35, Infinity, 9], 'trial-limit': [.8, Infinity, 8],
  };
  const COLORS = {
    copper: {light:'#fff2c8', metal:'#e5a059', dark:'#814526'},
    bronze: {light:'#fff5d6', metal:'#cfb170', dark:'#665338'},
    wood: {light:'#f9d7a5', metal:'#b9834e', dark:'#623a2b'},
    ink:'#514258', error:'#943c2a', cream:'#fff4d2', gold:'#d9aa60',
  };
  let events = [], cooldowns = new Map(), clock = 0, sequence = 0, generation = 0;
  let lastEscape = null, selectedId = null, heldGrip = null, rendered = [], accepted = {}, suppressed = {};
  let maxActive = 0, overflow = 0, resets = 0, rewinds = 0;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const finite = (v, fallback=0) => Number.isFinite(v) ? v : fallback;
  const smooth = t => {t=clamp(t,0,1);return t*t*(3-2*t);};
  const signed = a => ((a+Math.PI)%TAU+TAU)%TAU-Math.PI;
  const idOf = p => p?.id ?? p?.ringId ?? (typeof p?.ring === 'object' ? p.ring.id : p?.ring) ?? null;
  const validPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const material = r => Number(r?.id)===4 ? COLORS.wood : [5,8,10].includes(Number(r?.id)) ? COLORS.bronze : COLORS.copper;
  const gapOf = r => Math.PI/2-finite(r.angle)*RAD;
  const isOpen = r => typeof r.open==='boolean' ? r.open : ![4,5,8,10].includes(Number(r.id));
  const ringAlpha = r => clamp(finite(r.alpha,1),0,1);
  const gain = (age, peak, end) => age<0 || age>=end ? 0 : age<peak ? smooth(age/peak) : Math.pow(1-(age-peak)/(end-peak),1.35);
  const staticGain = (age,end,opacity=1) => opacity*(1-smooth((age-Math.max(0,end-.09))/.09));
  const note = (event, data) => {try{log?.(event,data);}catch{/* Telemetry cannot stop play. */}};

  function reset() {
    events=[];cooldowns.clear();lastEscape=null;selectedId=null;heldGrip=null;rendered=[];
    accepted={};suppressed={};maxActive=overflow=0;clock=0;sequence=0;
    generation++;resets++;
  }

  function emit(kind, payload={}, time=clock) {
    const spec=SPECS[kind];if(!spec)return false;
    const at=finite(time,clock), id=idOf(payload), owner=payload?.owner??null, name=payload?.name??null;
    const key=`${kind}:${owner!==null?`${owner}:${name}`:id??'hud'}`;
    // Score cues are exclusively authored by actual signed score mutations.
    if((kind==='progress'&&!(payload.delta>0))||(kind==='penalty'&&!(payload.delta<0)))return false;
    const previous=cooldowns.get(key);
    if(previous!==undefined && at-previous>=0 && at-previous<spec[1]) {
      suppressed[kind]=(suppressed[kind]||0)+1;return false;
    }
    cooldowns.set(key,at);
    if(cooldowns.size>128)cooldowns.delete(cooldowns.keys().next().value);
    let sourceId=id;
    if(kind==='escape'&&id!==null)lastEscape={id,time:at};
    if(kind==='progress'&&sourceId===null&&lastEscape&&at-lastEscape.time>=0&&at-lastEscape.time<1.5)sourceId=lastEscape.id;
    const event={kind,id:sourceId,owner,name,delta:finite(payload.delta),
      gripLocalDeg:Number.isFinite(payload.gripLocalDeg)?payload.gripLocalDeg:null,
      time:at,duration:spec[0],priority:spec[2],serial:++sequence,reduced:false};
    if(kind==='select')heldGrip=event;
    if(kind==='release'&&heldGrip&&String(heldGrip.id)===String(sourceId))heldGrip=null;
    if(kind.startsWith('trial-'))heldGrip=null;
    if(kind==='release')events=events.filter(e=>!(String(e.id)===String(sourceId)&&['select','turn'].includes(e.kind)));
    // Repeated input coalesces by object; no queued friction storm after a drag.
    if(kind==='turn'||kind==='select'||kind==='aligned')events=events.filter(e=>!(e.kind===kind&&e.id===sourceId&&e.owner===owner&&e.name===name));
    if(kind==='trial-complete'||kind==='trial-limit')events=events.filter(e=>e.priority>=8);
    events.push(event);
    if(events.length>MAX_EVENTS){
      let lowest=0;for(let i=1;i<events.length;i++)if(events[i].priority<events[lowest].priority)lowest=i;
      events.splice(lowest,1);overflow++;
    }
    maxActive=Math.max(maxActive,events.length);accepted[kind]=(accepted[kind]||0)+1;
    note('vfx-emit',{kind,id:sourceId,owner,name,time:at,generation,serial:event.serial});
    return true;
  }

  function line(ctx, points, color, width, alpha=1) {
    if(points.length<2||alpha<=0)return;
    ctx.globalAlpha=clamp(alpha,0,1);ctx.strokeStyle=color;ctx.lineWidth=width;
    ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);
    for(let i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);
    ctx.stroke();
  }
  function arc(ctx,x,y,r,a,b,color,width,alpha=1){
    if(!(r>0)||alpha<=0)return;
    ctx.globalAlpha=clamp(alpha,0,1);ctx.strokeStyle=color;ctx.lineWidth=width;
    ctx.beginPath();ctx.arc(x,y,r,a,b,b<a);ctx.stroke();
  }
  function polygon(ctx,points,color,alpha){
    ctx.globalAlpha=clamp(alpha,0,.38);ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(...points[0]);
    for(let i=1;i<points.length;i++)ctx.lineTo(...points[i]);ctx.closePath();ctx.fill();
  }
  function polar(r,a){return [Math.cos(a)*r,Math.sin(a)*r];}
  function safeAngle(r,a,clearance=.64){
    if(!isOpen(r))return a;
    const d=signed(a-gapOf(r));return Math.abs(d)<clearance?gapOf(r)+(d<0?-clearance:clearance):a;
  }
  // Split every material arc around the physical opening, including broad
  // under-strokes. Geometry never connects the two ends across empty space.
  function materialArc(ctx,r,radius,a,b,color,width,alpha){
    const direction=b>=a?1:-1,span=Math.abs(b-a),steps=Math.max(2,Math.ceil(span/.045));
    // Round stroke caps also occupy angular space. The entire thicker wipe,
    // not merely its centerline, must remain outside the real opening.
    const clearance=.53+Math.asin(Math.min(.95,width/(2*radius)))+.025;
    let start=null,last=a;
    for(let i=0;i<=steps;i++){
      const angle=a+direction*span*i/steps;
      const safe=!isOpen(r)||Math.abs(signed(angle-gapOf(r)))>clearance;
      if(safe&&start===null)start=angle;
      if((!safe||i===steps)&&start!==null){
        const end=safe?angle:last;if(Math.abs(end-start)>.012)arc(ctx,0,0,radius,start,end,color,width,alpha);
        start=null;
      }last=angle;
    }
  }
  function withRing(ctx,r,draw){
    if(!validPoint(r)||!(r.r>0)||r.active===false||ringAlpha(r)<=.01)return false;
    ctx.save();ctx.translate(r.x,r.y);draw(material(r),clamp(r.r/48,.65,1.65));ctx.restore();return true;
  }
  function gripAngle(r,event){
    const local=Number.isFinite(r.gripLocalDeg)?r.gripLocalDeg:event?.gripLocalDeg;
    return safeAngle(r,Number.isFinite(local)?(local-finite(r.angle))*RAD:gapOf(r)+Math.PI*.7,.72);
  }
  function grip(ctx,r,amount,velocity,low,event){
    withRing(ctx,r,(m,s)=>{
      const a=gripAngle(r,event),motion=low?0:clamp(Math.abs(velocity)/360,0,1);
      const direction=velocity>=0?-1:1,radius=r.r*.895;
      if(Number(r.id)===4){
        // The knot is wood, not a metal hoop. Retain its quiet carved accent.
        materialArc(ctx,r,radius,a-.25,a+.25,m.dark,5.2*s,amount*.64);
        materialArc(ctx,r,radius,a-.25,a+.25,m.light,2.5*s,amount);
        return;
      }
      const age=event?Math.max(0,clock-event.time):1;
      const onset=event?.kind==='select'&&!low?gain(age,.065,.30):0;
      const engaged=low?.78:clamp(.52+onset*.48+motion*.28,0,1);
      const opacity=amount*ringAlpha(r)*engaged;
      const span=.56+motion*.10+onset*.10;
      const dark=Number(r.id)===8||[5,10].includes(Number(r.id))?'#40352b':'#542b25';
      // A single broad reflected band, cut cleanly around the source opening.
      // Dark backing separates the cream face from the dense gilded inlay.
      materialArc(ctx,r,radius,a-span,a+span,dark,9.2*s,opacity*.92);
      materialArc(ctx,r,radius-1.1*s,a-span,a+span,m.metal,7.0*s,opacity*.92);
      materialArc(ctx,r,radius+1.0*s,a-span*.94,a+span*.94,'#fff9e8',5.0*s,opacity);
      // One short specular wipe at real grip onset, never a repeating idle pulse.
      if(onset>.01){
        const progress=smooth(age/.19),head=a+direction*(progress-.5)*span*1.28;
        materialArc(ctx,r,radius+1.0*s,head-.20,head+.20,'#fffff5',6.0*s,amount*onset);
      }
    });
  }
  function resistance(ctx,r,event,age,low){
    withRing(ctx,r,(m,s)=>{
      const alpha=(low?staticGain(age,event.duration,.85):gain(age,.055,event.duration))*ringAlpha(r);
      const a=gripAngle(r,event),extent=low?1:.82+.18*smooth(age/.10);
      // Pressure appears as a broad, contrasting brake line on the real rim.
      // Wood keeps its separate fine grain response below.
      if(Number(r.id)!==4){
        materialArc(ctx,r,r.r*.895,a-.53,a+.53,'#48262a',9.2*s,alpha*.95);
        materialArc(ctx,r,r.r*.895,a-.51,a+.51,'#fff0d6',6.4*s,alpha);
        materialArc(ctx,r,r.r*.895,a-.49,a+.49,COLORS.error,3.1*s,alpha);
      }
      // Short radial compression teeth, never a prohibition circle or gap bridge.
      for(let i=-1;i<=1;i++){
        const b=safeAngle(r,a+i*.17,.7),inner=polar(r.r*.86,b),outer=polar(r.r*.86+(4+2*(1-Math.abs(i)))*s*extent,b);
        line(ctx,[inner,outer],m.light,3.2*s,alpha*.9);
        line(ctx,[inner,outer],COLORS.error,2.0*s,alpha);
      }
      materialArc(ctx,r,r.r*.82,a-.27,a+.27,COLORS.error,2.4*s,alpha);
      if(Number(r.id)===4){
        // A restrained grain compression accent on the knot's actual wood face.
        ctx.save();ctx.rotate(-finite(r.angle)*RAD);
        for(let i=0;i<2;i++)line(ctx,[[-11*s,(i-1)*5*s],[-3*s,(i-1)*5*s-2*s],[5*s,(i-1)*5*s]],m.light,1.45*s,alpha*.85);
        ctx.restore();
      }
    });
  }
  function releaseCue(ctx,joint,event,age,low,scale){
    const s=clamp(scale/.54,.65,1.5),kind=event.kind;
    ctx.save();ctx.translate(joint.x,joint.y);ctx.rotate(-finite(joint.angle)*RAD);
    if(kind==='aligned'){
      const a=low?staticGain(age,event.duration,.82):gain(age,.045,event.duration);
      // Two matching jaw-profile corners read as a fit, not as a scored result.
      line(ctx,[[-9*s,-7*s],[-9*s,-3*s],[-5*s,-3*s]],COLORS.cream,2.2*s,a);
      line(ctx,[[9*s,7*s],[9*s,3*s],[5*s,3*s]],COLORS.cream,2.2*s,a);
      line(ctx,[[-6*s,-7*s],[-3*s,-7*s]],COLORS.gold,1.3*s,a*.8);
    }else if(kind==='coupling'){
      const alpha=low?staticGain(age,event.duration,.78):gain(age,.085,.34)*.82;
      const opening=low?1:smooth(age/.11),reach=(5+opening*7)*s;
      // Local brass wedge follows the live hinge. Its small translucent face is
      // below 0.4 alpha so it cannot flatten the painted jaw above the overlay.
      polygon(ctx,[[-2*s,-3*s],[reach,-7*s],[reach,4*s],[-2*s,3*s]],COLORS.gold,alpha*.28);
      line(ctx,[[-3*s,-5*s],[2*s,-5*s],[reach,-8*s]],COLORS.cream,1.8*s,alpha);
      line(ctx,[[-3*s,5*s],[2*s,5*s],[reach,7*s]],COLORS.gold,1.5*s,alpha*.7);
    }else{
      // Called at the rig's real 190 ms contact. A compact stepped jaw face
      // has a bright readable peak, then gives way to its warm lower bevel.
      // This is one bounded metal shape, not an added shower of particles.
      const body=low?staticGain(age,event.duration,.93):
        age<.018?smooth(age/.018):age<.075?1:1-smooth((age-.075)/.185);
      const after=low?body:gain(age,.055,event.duration);
      const face=[[-12,-4],[-4,-4],[-4,-6],[3,-6],[3,-4],[11,-4],
        [13,0],[11,4],[3,4],[3,6],[-4,6],[-4,4],[-12,4],[-13,0]];
      ctx.beginPath();ctx.moveTo(face[0][0]*s,face[0][1]*s);
      for(let i=1;i<face.length;i++)ctx.lineTo(face[i][0]*s,face[i][1]*s);
      ctx.closePath();ctx.globalAlpha=body*.94;ctx.strokeStyle='#4c342a';ctx.lineWidth=3.8*s;ctx.stroke();
      ctx.globalAlpha=body*.97;ctx.fillStyle='#fff6dc';ctx.fill();
      line(ctx,[[-9*s,-1*s],[-3*s,-1*s],[0,-3*s],[8*s,-3*s]],'#fffff4',3.7*s,body);
      line(ctx,[[-9*s,4*s],[-3*s,4*s],[0,6*s],[8*s,6*s]],'#cd873f',2.4*s,after*.95);

    }
    ctx.restore();
  }
  function escapeCue(ctx,r,event,age,low){
    withRing(ctx,r,(m,s)=>{
      const a=(low?staticGain(age,event.duration,.75):gain(age,.045,.7))*ringAlpha(r),gap=gapOf(r);
      for(const side of [-1,1]){
        const start=gap+side*.66,end=gap+side*(low?1.14:1.14+.45*smooth(age/.28));
        materialArc(ctx,r,r.r*.9,start,end,m.dark,5*s,a*.55);
        materialArc(ctx,r,r.r*.9,start,end,m.light,2.8*s,a);
        materialArc(ctx,r,r.r*.81,start+side*.08,end-side*.05,m.metal,1.4*s,a*.8);
      }
    });
  }
  function bezier(a,b,c,d,t){const u=1-t;return{x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y};}
  function scoreCue(ctx,event,age,low,ring,frame){
    const hud=frame.hud;if(!validPoint(hud))return;
    const scale=clamp(finite(frame.scale,.54)/.54,.65,1.5),positive=event.kind==='progress';
    const target={x:finite(hud.scoreX,hud.x),y:finite(hud.scoreY,hud.y)+12*scale};
    if(positive&&validPoint(ring)&&!low&&age<.62){
      const side=ring.x<frame.width/2?-1:1;
      const start={x:ring.x+side*ring.r*.84,y:ring.y-ring.r*.38};
      const edge=clamp(start.x+side*25*scale,10*scale,frame.width-10*scale);
      const c1={x:edge,y:start.y-42*scale},c2={x:edge,y:target.y+35*scale};
      const t=smooth(clamp((age-.045)/.49,0,1)),alpha=gain(age,.08,.65);
      // A short moving inlay, not a complete over-board line or free particles.
      // At most the last 12% of the route is visible; the source is always live.
      for(let i=0;i<5;i++){
        const from=clamp(t-.115+i*.023,0,1),to=clamp(from+.025,0,t);
        if(to<=from)continue;const p=bezier(start,c1,c2,target,from),q=bezier(start,c1,c2,target,to);
        line(ctx,[[p.x,p.y],[q.x,q.y]],i===4?COLORS.cream:COLORS.gold,(i===4?3.2:2.0)*scale,alpha*(.22+i*.15));
      }
    }
    const delay=positive&&!low?.47:0;
    const opacity=low?staticGain(age,event.duration,.86):gain(age-delay,.045,event.duration-delay);
    if(opacity<=0)return;
    const width=(positive?18:14)*scale,color=positive?COLORS.gold:COLORS.error;
    line(ctx,[[target.x-width,target.y],[target.x+width,target.y]],COLORS.cream,4*scale,opacity*.85);
    line(ctx,[[target.x-width,target.y],[target.x+width,target.y]],color,2*scale,opacity);
    if(positive){
      line(ctx,[[target.x-width-4*scale,target.y-3*scale],[target.x-width-4*scale,target.y+2*scale]],COLORS.gold,1.6*scale,opacity);
      line(ctx,[[target.x+width+4*scale,target.y-3*scale],[target.x+width+4*scale,target.y+2*scale]],COLORS.gold,1.6*scale,opacity);
    }
  }
  function resultCue(ctx,event,age,low,frame){
    const result=frame.result;if(!validPoint(result)||!(result.r>0))return;
    const success=event.kind==='trial-complete';
    if(!frame.ended||(success&&!frame.success)||(!success&&frame.success))return;
    const r=result.r,s=clamp(r/60,.65,1.5),alpha=low?staticGain(age,event.duration,.85):gain(age,success?.23:.08,event.duration);
    const draw=low?1:smooth(age/(success?.35:.12));
    ctx.save();ctx.translate(result.x,result.y);
    // Cabinet frame corners surround the existing icon; no new badge or reward.
    const x=r*1.18,y=r*1.12,c=12*s;
    for(const sideX of [-1,1])for(const sideY of [-1,1]){
      const points=[[sideX*(x-c*draw),sideY*y],[sideX*x,sideY*y],[sideX*x,sideY*(y-c*draw)]];
      line(ctx,points,COLORS.ink,4.6*s,alpha*.6);
      line(ctx,points,success?COLORS.cream:COLORS.gold,2.3*s,alpha);
    }
    if(success){
      // Two separated, interlocking perimeter arcs echo the actual game icon.
      // The sweep is outside its face and never passes through icon contents.
      const rr=r*1.16,off=r*.12,span=Math.PI*.86*draw;
      arc(ctx,-off,0,rr,Math.PI-span*.5,Math.PI+span*.5,COLORS.gold,4*s,alpha*.8);
      arc(ctx,-off,0,rr,Math.PI-span*.5,Math.PI+span*.5,COLORS.cream,1.7*s,alpha);
      arc(ctx,off,0,rr,-span*.5,span*.5,COLORS.gold,4*s,alpha*.8);
      arc(ctx,off,0,rr,-span*.5,span*.5,COLORS.cream,1.7*s,alpha);
      // Small joining inlay strokes finish once, then the whole seal decays.
      const finish=low?1:smooth((age-.23)/.11);
      line(ctx,[[-8*s,-rr],[0,-rr-3*s],[8*s,-rr]],COLORS.cream,2*s,alpha*finish);
      line(ctx,[[-8*s,rr],[0,rr+3*s],[8*s,rr]],COLORS.gold,2*s,alpha*finish);
    }
    ctx.restore();
  }

  function render(ctx,frame={}) {
    if(!ctx)return;
    const time=finite(frame.time,clock);
    if(time<clock-1e-6){rewinds++;reset();}
    clock=time;rendered=[];
    const rings=new Map((frame.rings||[]).map(r=>[String(r.id),r]));
    const selected=typeof frame.selected==='object'?idOf(frame.selected):frame.selected;
    selectedId=selected??null;
    events=events.filter(e=>time-e.time>=0&&time-e.time<e.duration);
    const low=!!frame.lowMotion;
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowBlur=0;
    ctx.globalCompositeOperation='source-over';
    if(!frame.ended&&selectedId!==null){
      const ring=rings.get(String(selectedId));
      const selectedEvent=[...events].reverse().find(e=>e.kind==='select'&&String(e.id)===String(selectedId))
        ||(heldGrip&&String(heldGrip.id)===String(selectedId)?heldGrip:null);
      if(low&&selectedEvent)selectedEvent.reduced=true;
      if(ring&&ring.active!==false&&ringAlpha(ring)>.01){
        grip(ctx,ring,ring.canDrag===false?.6:.88,finite(frame.angularVelocity),low||!!selectedEvent?.reduced,selectedEvent);
        rendered.push({kind:'grip',id:ring.id,x:ring.x,y:ring.y,angle:gripAngle(ring,selectedEvent)/RAD});
      }
    }
    for(const e of [...events].sort((a,b)=>a.priority-b.priority||a.serial-b.serial)){
      const age=time-e.time,ring=rings.get(String(e.id));
      e.reduced=e.reduced||low;const reduced=e.reduced;
      if(frame.ended&&!e.kind.startsWith('trial-'))continue;
      if(['select','turn','release','blocked','misaligned','escape'].includes(e.kind)){
        if(!ring||ring.active===false||ringAlpha(ring)<=.01)continue;
        if(e.kind==='select'||e.kind==='turn'||e.kind==='release'){
          if(String(selectedId)===String(ring.id))continue;
          const amount=e.kind==='release'?.75*(1-smooth(age/e.duration)):
            reduced?staticGain(age,e.duration,.65):gain(age,.035,e.duration);
          grip(ctx,ring,amount,finite(frame.angularVelocity,e.delta),reduced,e);
        }else if(e.kind==='escape')escapeCue(ctx,ring,e,age,reduced);
        else resistance(ctx,ring,e,age,reduced);
        rendered.push({kind:e.kind,id:ring.id,x:ring.x,y:ring.y,angle:ring.angle});
      }else if(['coupling','contact','aligned'].includes(e.kind)){
        const key=`${e.owner}:${e.name}`,joint=frame.joints?.[key];
        // Missing keys are omitted rather than falling back to stale coordinates.
        if(!validPoint(joint))continue;
        releaseCue(ctx,joint,e,age,reduced,finite(frame.scale,.54));
        rendered.push({kind:e.kind,joint:key,x:joint.x,y:joint.y,angle:joint.angle});
      }else if(e.kind==='progress'||e.kind==='penalty'){
        scoreCue(ctx,e,age,reduced,ring,frame);
        if(validPoint(frame.hud))rendered.push({kind:e.kind,id:e.id,x:frame.hud.scoreX??frame.hud.x,y:frame.hud.scoreY??frame.hud.y});
      }else{
        resultCue(ctx,e,age,reduced,frame);
        if(validPoint(frame.result)&&frame.ended&&((e.kind==='trial-complete')===!!frame.success))rendered.push({kind:e.kind,x:frame.result.x,y:frame.result.y});
      }
    }
    ctx.restore();
  }

  function snapshot(){
    return {version:'cabinet-vfx-v3.2',generation,time:clock,activeCount:events.length,
      selected:selectedId,heldGrip:heldGrip?{id:heldGrip.id,time:heldGrip.time,reduced:heldGrip.reduced}:null,maxActive,limit:MAX_EVENTS,overflow,resets,rewinds,
      accepted:{...accepted},suppressed:{...suppressed},
      active:events.map(e=>({kind:e.kind,id:e.id,owner:e.owner,name:e.name,time:e.time,
        remaining:Math.max(0,e.duration-(clock-e.time)),reduced:e.reduced,serial:e.serial})),
      rendered:rendered.map(e=>({...e})),
      contract:{time:'seconds',positions:'CSS pixels',angles:'source degrees',
        anchors:'Live frame transforms; no frozen world coordinates',maxBroadFillAlpha:.38,
        metalWipe:{coreWidthAt49pxRing:5.1,backingWidthAt49pxRing:9.4,arcRadians:1.12,openingClearance:'Physical half-gap plus stroke-cap envelope and0.025rad margin'},
        contactFace:{nativeFacePixels:[26,12],darkStrokePixels:3.8,peakHoldSeconds:.075,opaqueFillIsCompact:true},
        lowMotion:'Static local geometry; no travel/sweep or deferred catch-up; user rotation retained'}};
  }
  return {emit,reset,render,snapshot};
}
