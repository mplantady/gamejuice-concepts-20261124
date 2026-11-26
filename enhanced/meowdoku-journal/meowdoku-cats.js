/* Original generated cat artwork, mechanically registered and articulated.
 * Presentation only: native sprite IDs, animator clocks, transforms and game state
 * remain authoritative. All GPU textures are shared immutable cached frames. */
(() => {
  'use strict';
  const A=window.MeowdokuNative;
  const base=window.MEOWDOKU_CAT_ASSET_BASE||'assets/cats/';
  const R=window.MeowdokuCats={version:'meowdoku-journal-cats-v4',readyState:false,errors:[]};
  const images={},cache=new Map(),poseCache=new Map();
  let manifest=null,actors=[],byImage=new WeakMap(),clock=0,ambientClock=0,lastLowMotion=false;
  const stats={framesCreated:0,textureBinds:0,cacheHits:0,cacheEvictions:0,visibleActors:0};
  const durations={place:1.05,progress:.72,error:.98,remove:.4,unmark:.28,complete:1.25};
  const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
  const wave=(t,start,duration)=>t>=start&&t<start+duration?Math.sin(Math.PI*(t-start)/duration):0;
  const quant=(n,step)=>Math.round(n/step)*step;
  const makeCanvas=(w,h=w)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
  const isFailure=sprite=>sprite>=24888&&sprite<=24910&&sprite%2===0;
  const failurePoses=['failure-open','failure-open','failure-open','failure-tears','failure-tears','failure-tears','failure-closed','failure-closed','failure-closed','failure-closed','failure-tears','failure-open'];
  const report=e=>{const message=e?.message||String(e);if(!R.errors.includes(message))R.errors.push(message);};
  function sourceMetric(sprite){
    let m=manifest.native_sprite_metrics[String(sprite)];
    if(!m)m=manifest.native_sprite_metrics['24786'];
    // Native Idle has tiny source-padding differences. A common resting chin
    // avoids a registration jump while all original gaze/lid keys stay intact.
    if(sprite>=24758&&sprite<=24778&&sprite%2===0)m={...m,bbox:manifest.native_sprite_metrics['24758'].bbox};
    return m;
  }
  function poseWithLids(name,lid=0){
    const q=Math.round(clamp(lid)*8),key=name+':'+q;
    if(poseCache.has(key))return poseCache.get(key);
    const canvas=makeCanvas(512),c=canvas.getContext('2d'),source=images[name]||images.open;
    c.drawImage(source,0,0);
    if(q&&name!=='closed'&&name!=='concern'){
      const fraction=q/8;
      for(const [x,y,w,h] of Object.values(manifest.rig.eyes)){
        // The closed painted eye patch supplies the lids. The original eye
        // aperture compresses independently inside that patch, not the head.
        c.save();c.beginPath();c.ellipse(x+w/2,y+h/2,w/2+2,h/2+2,0,0,Math.PI*2);c.clip();c.drawImage(images.closed,0,0);
        const remaining=h*(1-fraction);
        if(remaining>2){
          c.save();c.beginPath();c.ellipse(x+w/2,y+h/2,w/2,remaining/2,0,0,Math.PI*2);c.clip();
          c.drawImage(source,x,y,w,h,x,y+(h-remaining)/2,w,remaining);c.restore();
        }
        c.restore();
      }
    }
    poseCache.set(key,canvas);return canvas;
  }
  function polygon(c,points){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();}
  function drawArt(c,art,spec){
    const rig=manifest.rig;
    c.save();c.translate(...rig.head_pivot);c.rotate(spec.turn);c.translate(-rig.head_pivot[0],-rig.head_pivot[1]);
    if(spec.pose==='concern'||(Math.abs(spec.ear)<.001&&Math.abs(spec.cheek)<.001)){
      c.drawImage(art,0,0);c.restore();return;
    }
    // Ear roots share the head coordinate system; only the ear pieces hinge.
    for(const [part,angle] of [[rig.ear_left,-spec.ear],[rig.ear_right,spec.ear*.93]]){
      c.save();c.translate(...part.pivot);c.rotate(angle);c.translate(-part.pivot[0],-part.pivot[1]);polygon(c,part.polygon);c.clip();c.drawImage(art,0,0);c.restore();
    }
    const h=rig.head_mask,split=spec.cheek>.001;
    c.save();c.beginPath();c.moveTo(...h.left);c.lineTo(...h.shoulder);c.quadraticCurveTo(...h.curve_control,...h.curve_end);c.lineTo(...h.right);c.lineTo(512,split?rig.cheek.overlap_to:512);c.lineTo(0,split?rig.cheek.overlap_to:512);c.closePath();c.clip();c.drawImage(art,0,0);c.restore();
    if(split){
      // The lower muzzle expands about the fixed chin; this is not sprite bob.
      c.save();c.translate(256,456);c.scale(1+spec.cheek*.035,1-spec.cheek*.025);c.translate(-256,-456);c.beginPath();c.rect(0,rig.cheek.clip_y,512,512-rig.cheek.clip_y);c.clip();c.drawImage(art,0,0);c.restore();
    }
    c.restore();
  }
  function drawContact(c){
    // A thin warm ink wash meets the chin; it inherits the same native actor
    // transform and never slides across the stationary journal underneath.
    c.save();c.translate(256,457);c.scale(125,9);
    const wash=c.createRadialGradient(0,0,0,0,0,1);
    wash.addColorStop(0,'rgba(72,49,37,.18)');
    wash.addColorStop(.45,'rgba(92,62,43,.10)');
    wash.addColorStop(1,'rgba(92,62,43,0)');
    c.fillStyle=wash;c.fillRect(-1,-1,2,2);c.restore();
  }
  function evict(){
    if(cache.size<192)return;
    const live=new Set(actors.map(a=>a.frameKey));
    for(const [key,frame] of cache){if(!key.startsWith('failure|')&&!live.has(key)){frame.texture.dispose?.();cache.delete(key);stats.cacheEvictions++;break;}}
  }
  const failureTail=[[0,380],[119,380],[119,466],[146,527],[150,591],[0,591]];
  const failureHeart=[[120,333],[391,333],[415,432],[405,522],[332,555],[181,555],[112,518],[111,430]];
  const failureHeartInset=[[131,348],[382,348],[401,432],[394,511],[328,544],[187,544],[123,508],[122,432]];
  function tracePolygon(c,points){points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();}
  function failureHeartLayer(name){
    const key='failure-heart:'+name;if(poseCache.has(key))return poseCache.get(key);
    // A narrow alpha feather removes the hard texture join over the upper
    // belly. The inset torso cutout remains covered by the opaque mask core.
    let mask=poseCache.get('failure-heart-mask');
    if(!mask){
      mask=makeCanvas(512,768);const m=mask.getContext('2d');m.fillStyle='#fff';polygon(m,failureHeart);
      if('filter' in m){m.filter='blur(3px)';m.fill();m.filter='none';}
      else {
        // Conservative feather for contexts without a filter property.
        m.fill();m.globalCompositeOperation='destination-out';m.lineJoin='round';
        for(const [width,alpha] of [[12,.08],[8,.16],[4,.24],[2,.3],[1,.65]]){m.lineWidth=width;m.strokeStyle=`rgba(0,0,0,${alpha})`;m.stroke();}
        m.globalCompositeOperation='source-over';
      }
      poseCache.set('failure-heart-mask',mask);
    }
    const canvas=makeCanvas(512,768),c=canvas.getContext('2d');c.drawImage(images[name],0,0);c.globalCompositeOperation='destination-in';c.drawImage(mask,0,0);c.globalCompositeOperation='source-over';poseCache.set(key,canvas);return canvas;
  }
  function failureSpec(index){
    if(index<0)return {failure:true,index:-1,pose:'failure-closed',ear:0,turn:0,paw:0,tail:0,lid:0,cheek:0};
    const phase=index/48*Math.PI*2,beat=Math.floor(index/4);
    return {failure:true,index,pose:failurePoses[beat],ear:.065*Math.sin(phase),turn:.032*Math.sin(phase),paw:.022*Math.sin(phase-.5),tail:.085*Math.sin(phase+.4),lid:beat>=6&&beat<=9?1:beat>=3&&beat<=5?.55:0,cheek:0};
  }
  function drawFailureArt(c,spec){
    const open=images['failure-open'],art=images[spec.pose];
    // Tail pivots at its body attachment; the open pose's feet never move.
    c.save();c.translate(139,553);c.rotate(spec.tail);c.translate(-139,-553);polygon(c,failureTail);c.clip();c.drawImage(open,0,0);c.restore();
    c.save();c.beginPath();c.rect(112,344,304,261);c.clip();c.beginPath();c.rect(0,0,512,768);tracePolygon(c,failureTail);tracePolygon(c,failureHeartInset);c.clip('evenodd');c.drawImage(art,0,0);c.restore();
    c.save();c.beginPath();c.rect(0,605,512,163);c.clip();c.drawImage(open,0,0);c.restore();
    // Head and ears articulate independently above the stationary torso. The
    // forearms/heart overlap the neck seam, as they do in the source artwork.
    c.save();c.translate(256,350);c.rotate(spec.turn);c.translate(-256,-350);
    if(Math.abs(spec.ear)<.001){c.beginPath();c.rect(0,0,512,370);c.clip();c.drawImage(art,0,0);}
    else {
      for(const [points,pivot,angle] of [
        [[[35,140],[155,117],[193,220],[81,265],[35,265]],[129,219],-spec.ear],
        [[[326,124],[460,137],[460,260],[359,249],[322,200]],[373,216],spec.ear]
      ]){c.save();c.translate(...pivot);c.rotate(angle);c.translate(-pivot[0],-pivot[1]);polygon(c,points);c.clip();c.drawImage(art,0,0);c.restore();}
      c.save();polygon(c,[[110,70],[388,70],[388,232],[460,248],[460,370],[55,370],[55,245],[110,230]]);c.clip();c.drawImage(art,0,0);c.restore();
    }
    c.restore();
    // The illustrated pose changes supply the raised-paw gesture; a separate
    // forearm hinge carries the heart between those beats without bobbing feet.
    c.save();c.translate(256,532);c.rotate(spec.paw);c.translate(-256,-532);c.drawImage(failureHeartLayer(spec.pose),0,0);c.restore();
  }
  function failureTexture(spec){
    const key='failure|'+spec.index;if(cache.has(key)){stats.cacheHits++;return cache.get(key);}
    evict();const canvas=makeCanvas(432,768),c=canvas.getContext('2d'),rig=manifest.failure_rig;
    c.save();c.translate(...rig.native_contact);const scale=rig.native_visible_height/rig.registered_visible_height;c.scale(scale,scale);c.translate(-256,-650);
    c.save();c.translate(256,650);c.scale(135,10);const g=c.createRadialGradient(0,0,0,0,0,1);g.addColorStop(0,'rgba(72,49,37,.2)');g.addColorStop(1,'rgba(72,49,37,0)');c.fillStyle=g;c.fillRect(-1,-1,2,2);c.restore();
    drawFailureArt(c,spec);c.restore();const texture=A.texture(canvas),frame={key,texture,canvas};cache.set(key,frame);stats.framesCreated++;return frame;
  }
  function textureFrame(sprite,spec){
    if(isFailure(sprite))return failureTexture(spec.failure?spec:failureSpec((sprite-24888)*2));
    const key=[sprite,spec.pose,spec.lid,spec.ear,spec.cheek,spec.turn].join('|');
    if(cache.has(key)){stats.cacheHits++;return cache.get(key);}
    evict();
    const canvas=makeCanvas(192),c=canvas.getContext('2d'),metric=sourceMetric(sprite);
    if(metric.bbox){
      const b=metric.bbox,centerX=(b[0]+b[2])*.5*512,bottom=b[3]*512;
      const scale=Math.min((b[2]-b[0])*512/468,(b[3]-b[1])*512/401);
      c.save();c.scale(192/512,192/512);c.translate(centerX,bottom);c.scale(scale,scale);c.translate(-256,-456);
      drawContact(c);drawArt(c,poseWithLids(spec.pose,spec.lid),spec);c.restore();
    }
    const texture=A.texture(canvas),frame={key,texture,canvas};cache.set(key,frame);stats.framesCreated++;return frame;
  }
  function specFor(actor,time,ambient,lowMotion){
    const sprite=actor.img.sprite,metric=sourceMetric(sprite),age=time-actor.at;
    if(isFailure(sprite)){
      if(lowMotion)return failureSpec(-1);
      // Native animator.time is already scaled by controller speed .1. Read
      // its two-second loop; never advance, replace or write the native clock.
      const clipTime=actor.img.node.animator?.time;
      const index=Number.isFinite(clipTime)?Math.floor(((clipTime%.2+.2)%.2)/.2*48)%48:(sprite-24888)*2;
      return failureSpec(index);
    }
    if(durations[actor.phase]!==undefined&&age>=durations[actor.phase])actor.phase='idle';
    let spec={pose:metric.pose||'open',lid:metric.lid||0,ear:0,cheek:0,turn:0,stage:'idle'};
    const direction=actor.look==='left'?-1:actor.look==='right'?1:actor.cell?(actor.cell.Col<4?1:-1):1;
    if(lowMotion){
      spec={pose:actor.phase==='error'?'concern':'open',lid:0,ear:0,cheek:0,turn:0,stage:actor.phase==='idle'?'idle':'low-motion-hold'};
      return spec;
    }
    if(actor.phase==='error'){
      // Actual fish loss: quick ear-led recoil, a small contrary head response,
      // and a readable concerned hold. It never shares a positive wink cue.
      if(age<.12){spec.pose='open';spec.ear=.32*clamp(age/.12);spec.lid=.5*clamp(age/.12);spec.stage='onset';}
      else if(age<.73){spec.pose='concern';spec.lid=0;spec.stage='concern';}
      else {spec.pose='open';spec.ear=.32*(1-clamp((age-.73)/.25));spec.lid=.6*(1-clamp((age-.73)/.25));spec.stage='settle';}
      spec.turn=direction*(-.075*wave(age,0,.24)+.055*wave(age,.17,.28)-.025*wave(age,.41,.34));
    } else if(actor.phase==='place'||actor.phase==='complete'){
      // Native Appear/FindWink retain their exact frame times and node curves.
      // Accepted onset compresses the lids and tucks the ears; the ears open
      // through the contact beat, then settle independently of the fixed chin.
      spec.ear=.23*wave(age,0,.16)-.11*wave(age,.10,.34)+.19*wave(age,.34,.5);
      spec.lid=Math.max(spec.lid,.38*wave(age,0,.16));
      spec.cheek=1.25*wave(age,.11,.34)+.45*wave(age,.48,.36);
      spec.turn=direction*(.065*wave(age,.08,.35)-.025*wave(age,.4,.5));
      spec.stage=age<.12?'onset':age<.36?'contact':'settle';
    } else if(actor.phase==='progress'){
      // This shorter acknowledgement starts only when the native HUD count
      // actually arrives, after its flying-cat delay.
      spec.ear=.21*wave(age,0,.28)-.065*wave(age,.24,.36);
      spec.cheek=wave(age,.07,.34);spec.lid=Math.max(spec.lid,.25*wave(age,0,.16));
      spec.turn=direction*(.07*wave(age,0,.32)-.025*wave(age,.28,.38));
      spec.stage=age<.32?'acknowledge':'settle';
    } else if(actor.phase==='remove'){
      spec.ear=.11*wave(age,0,.32);spec.lid=Math.max(spec.lid,.55*wave(age,0,.28));spec.turn=-direction*.025*wave(age,0,.34);spec.stage='release';
    } else if(actor.phase==='unmark'){
      spec.ear=.035*wave(age,0,.24);spec.lid=Math.max(spec.lid,.32*wave(age,0,.24));spec.stage='quiet-blink';
    } else if(actor.lookUntil>time){
      spec.pose=actor.look==='left'?'look-left':'look-right';spec.lid=0;
    } else {
      // Native blink/gaze animation stays intact. Add independent ear twitches
      // only to its open-eye rests, with a long pause between local gestures.
      const rest=sprite===24758||sprite===24786||sprite===24298||sprite===24390;
      const phase=(ambient+actor.seed)%(5.9+(actor.seed%1.7));
      if(rest)spec.ear=.055*wave(phase,3.9,.42);
    }
    spec.ear=quant(spec.ear,.0125);spec.cheek=quant(spec.cheek,.125);spec.turn=quant(spec.turn,.005);spec.lid=Math.round(clamp(spec.lid)*8)/8;
    return spec;
  }
  R.attach=(img,id,cell=null)=>{
    if(!img)return null;
    if(byImage.has(img))return byImage.get(img);
    const originalEnsure=img.ensureMesh.bind(img);
    const actor={img,id,cell,at:-100,phase:'idle',seed:actors.length*.913+1.17,look:null,lookUntil:-100,frameKey:null,frame:null,material:null,originalEnsure,earLeft:0,earRight:0,lid:0,blink:0};
    // Before asynchronous assets are ready, native rendering is a safe no-op path.
    img.ensureMesh=function(){
      const mesh=originalEnsure();
      if(actor.frame){
        if(!actor.material){actor.material=mesh.material.clone();actor.material.map=actor.frame.texture;actor.material.needsUpdate=true;}
        mesh.material=actor.material;
      }
      return mesh;
    };
    actors.push(actor);byImage.set(img,actor);return actor;
  };
  R.react=(actor,phase)=>{
    if(!actor)return;
    if(!durations[phase])return;
    const now=Number.isFinite(A.Cl?.time)?A.Cl.time:clock;
    if(actor.phase==='error'&&now-actor.at<durations.error&&phase!=='error')return;
    if(phase==='unmark'&&['place','progress','complete'].includes(actor.phase)&&now-actor.at<durations[actor.phase])return;
    actor.phase=phase;actor.at=now;
  };
  R.tick=(time,ambient,lowMotion=false)=>{
    clock=Number.isFinite(time)?time:clock;ambientClock=Number.isFinite(ambient)?ambient:ambientClock;lastLowMotion=!!lowMotion;
    if(!R.readyState)return;
    let visible=0;
    for(const actor of actors){
      if(!actor.img.node.activeInHierarchy)continue;visible++;
      try{
        const spec=specFor(actor,clock,ambientClock,lastLowMotion),frame=textureFrame(actor.img.sprite,spec);
        actor.earLeft=spec.ear===0?0:-spec.ear;actor.earRight=spec.ear*(spec.failure?1:.93);actor.lid=spec.lid;actor.blink=spec.lid;actor.pose=spec.pose;actor.headTurn=spec.turn;actor.pawTurn=spec.paw||0;actor.tailTurn=spec.tail||0;actor.failurePhase=spec.failure?spec.index:null;actor.eventStage=spec.stage||(spec.failure?'native-failure-loop':'idle');actor.cheek=spec.cheek;
        if(actor.frameKey===frame.key)continue;
        actor.frame=frame;actor.frameKey=frame.key;
        const mesh=actor.img.ensureMesh();actor.material.map=frame.texture;mesh.material=actor.material;
        stats.textureBinds++;A.dirty();
      }catch(e){report(e);}
    }
    stats.visibleActors=visible;
  };
  R.reset=()=>{
    for(const a of actors){a.img.ensureMesh=a.originalEnsure;a.material?.dispose?.();}
    actors=[];byImage=new WeakMap();clock=0;ambientClock=0;stats.visibleActors=0;
  };
  R.diagnostics=()=>({version:R.version,ready:R.readyState,errors:R.errors.slice(),time:clock,ambient:ambientClock,lowMotion:lastLowMotion,cacheSize:cache.size,poseCacheSize:poseCache.size,failureCache:{frames:49,width:432,height:768,rgbaBytes:65028096},...stats,actors:actors.filter(a=>a.img.node.activeInHierarchy).map(a=>({id:a.id,sprite:a.img.sprite,phase:a.phase,eventStage:a.eventStage,pose:a.pose,earLeft:a.earLeft,earRight:a.earRight,lid:a.lid,blink:a.blink,headTurn:a.headTurn,cheek:a.cheek,pawTurn:a.pawTurn,tailTurn:a.tailTurn,failurePhase:a.failurePhase,frameKey:a.frameKey}))});
  R.ready=Promise.all([
    fetch(base+'cat-manifest.json').then(r=>{if(!r.ok)throw Error('Cat manifest '+r.status);return r.json();}).then(data=>{manifest=data;}),
    ...['open','closed','wink','look-left','look-right','concern','failure-open','failure-tears','failure-closed'].map(name=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{images[name]=im;resolve();};im.onerror=()=>reject(Error('Cat pose failed: '+name));im.src=base+name+'.png';})),
    A.ready
  ]).then(()=>{
    // Prepare all native-ID replacements once; textures upload only when used.
    for(const id of Object.keys(manifest.native_sprite_metrics)){
      const m=sourceMetric(+id);textureFrame(+id,{pose:m.pose||'open',lid:Math.round((m.lid||0)*8)/8,ear:0,cheek:0,turn:0});
    }
    for(let i=-1;i<48;i++)failureTexture(failureSpec(i));
    R.readyState=true;return R;
  }).catch(e=>{report(e);return R;});
})();
