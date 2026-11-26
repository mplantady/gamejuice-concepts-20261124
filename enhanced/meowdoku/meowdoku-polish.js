/* Meowdoku presentation extension. Native rules, inputs and clocks remain authoritative. */
(() => {
  const A=window.MeowdokuNative;
  A.restorePortraitLayout();
  A.setAudioHeadroom(.82);
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const P=window.MeowdokuPolish={version:'meowdoku-expressive-20261126-v5',ready:false,errors:[],events:[],actors:[],lowMotion:media.matches,ambientTime:0};
  P.setReducedMotion=value=>{P.lowMotion=!!value;};
  media.addEventListener('change',e=>P.setReducedMotion(e.matches));
  P.diagnostics=()=>({version:P.version,ready:P.ready,errors:P.errors,lowMotion:P.lowMotion,ambientTime:P.ambientTime,actors:P.actors.map(x=>({id:x.id,phase:x.phase,earLeft:x.earLeft,earRight:x.earRight,blink:x.blink})),events:P.events.slice(-120)});
  const textures=[],surfaces=[],actors=[],effects=[],owned=new WeakSet();
  let previous=0,root=null,asset={},hud=null,activeError=null,lastAccent=-100;
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
  const envelope=(t,d)=>t>=0&&t<d?Math.sin(Math.PI*t/d):0;
  const record=(kind,cell)=>{P.events.push({kind,time:A.Cl.time,wall_ms:performance.now(),row:cell?.Row,col:cell?.Col});if(P.events.length>500)P.events.shift();};
  const wrap=(object,key,fn)=>{const original=object[key];object[key]=function(...args){return fn.call(this,original.bind(this),...args);};};
  function textureSurface(img,size=256){
    const canvas=document.createElement('canvas');canvas.width=Array.isArray(size)?size[0]:size;canvas.height=Array.isArray(size)?size[1]:size;
    const ctx=canvas.getContext('2d');const mesh=img.ensureMesh(),material=mesh.material.clone(),texture=A.texture(canvas);
    material.map=texture;material.needsUpdate=true;
    let native=false;
    const original=img.ensureMesh.bind(img);img.ensureMesh=function(){const mesh=original();mesh.material=native?(A.materials.get(A.sprites[img.sprite]?.f||'__white')||material):material;return mesh;};
    const surface={canvas,ctx,texture,img,setNative(value){if(native===value)return;native=value;img.ensureMesh();A.dirty();},update(){texture.needsUpdate=true;A.dirty();}};textures.push(surface);return surface;
  }
  function effectNode(cell){
    const n=new A.node({n:'MeowdokuActionInk',a:0,rt:[.5,.5,.5,.5,.5,.5,160,160,0,0,0,1,1],img:{s:null,t:0,fm:4,fa:1,fo:0,ppu:1,rc:0,c:[1,1,1,1],en:1}},cell.node);
    cell.node.children.push(n);const s=textureSurface(n.img);const fx={cell,node:n,s,kind:'',at:-100,dirty:false};effects.push(fx);return fx;
  }
  function emit(cell,kind){const fx=effects.find(x=>x.cell===cell);if(fx){fx.kind=kind;fx.at=A.Cl.time;fx.dirty=true;fx.node.SetActive(true);const children=cell.node.children;children.splice(children.indexOf(fx.node),1);const index=kind==='place'?children.indexOf(cell.catImage.node):children.length;children.splice(index,0,fx.node);}record(kind,cell);}
  function round(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
  function paintPanel(node,kind){
    if(!node?.img||owned.has(node))return;owned.add(node);node.img.type=0;
    const w=Math.max(64,Math.ceil(node.rectW)),h=Math.max(48,Math.ceil(node.rectH));
    const s=textureSurface(node.img,[w,h]);const c=s.ctx,r=Math.min(22,h*.22);
    c.clearRect(0,0,w,h);let g=c.createLinearGradient(0,0,0,h);
    g.addColorStop(0,'#fffdf5');g.addColorStop(.5,'#fff3e3');g.addColorStop(1,'#ebd2bd');
    c.fillStyle=g;round(c,1,1,w-2,h-2,r);c.fill();
    c.strokeStyle='rgba(255,255,255,.9)';c.lineWidth=2;round(c,3,3,w-6,h-6,r-2);c.stroke();
    c.strokeStyle='rgba(148,94,62,.48)';c.lineWidth=3;round(c,1,1,w-2,h-2,r);c.stroke();s.update();
  }
  function addActor(img,id,cell=null){
    if(!img||owned.has(img))return null;owned.add(img);
    const s=textureSurface(img);const actor={id,cell,img,s,phase:'idle',at:-100,seed:actors.length*.83+1.17,earLeft:0,earRight:0,blink:0};actors.push(actor);P.actors=actors;return actor;
  }
  function react(actor,phase){if(actor){if(actor===hud&&actor.phase==='error'&&A.Cl.time-actor.at<.9&&phase!=='error')return;actor.phase=phase;actor.at=A.Cl.time;}}
  function soundAccent(kind){
    if(!A.Sl.isPlaying||A.Sl.mute)return;
    if(kind!=='place'&&A.Cl.time-lastAccent<.065)return;lastAccent=A.Cl.time;
    const ac=A.audioContext;if(!ac||ac.state!=='running')return;
    const t=ac.currentTime,g=ac.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(kind==='place'?.045:.022,t+.006);g.gain.exponentialRampToValueAtTime(.0001,t+(kind==='place'?.36:.09));g.connect(ac.destination);
    const notes=kind==='place'?[659.25,987.77]:kind==='mark'?[420]:[310];
    notes.forEach((f,i)=>{const o=ac.createOscillator();o.type='sine';o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(f*.985,t+.2);o.connect(g);o.start(t+i*.015);o.stop(t+.4);});
  }
  function attach(){
    if(!A.Q.root||root===A.Q.root)return;
    root=A.Q.root;actors.length=effects.length=0;P.events.length=0;P.ambientTime=0;activeError=null;
    const {Q}=A;
    // Keep the native hierarchy and tutorial scrim above all gameplay paint.
    [Q.ui.catCountProgress.parent,Q.root.findDeep('ImageHeart'),Q.root.findDeep('GuideTip1'),Q.root.findDeep('GuideTip2')].forEach(n=>paintPanel(n,'panel'));
    Q.ui.ruleCardsContainer.walk(n=>{if(n.img&&n.rectW>200&&n.rectH>=100&&n.rectH<200)paintPanel(n,'panel');});
    Q.ui.ruleCards.forEach(n=>paintPanel(n,'panel'));
    // Preserve the native Download pill artwork and its original silhouette.
    hud=addActor(Q.ui.catCountAnim.img,'hud-cat');
    addActor(Q.ui.catFly.img,'flying-counter-cat');
    for(const cell of Q.grid._cells.values()){
      const actor=addActor(cell.catImage,`cat-${cell.Row}-${cell.Col}`,cell);effectNode(cell);
      wrap(cell,'PlaceCat',(original,...args)=>{const result=original(...args);react(actor,'place');if(hud){hud.look=cell.Col<4?'left':'right';hud.lookUntil=A.Cl.time+2;}emit(cell,'place');soundAccent('place');return result;});
      wrap(cell,'SetExcluded',function(original,...args){const before=this.Data.isExcluded;const result=original(...args);if(before!==this.Data.isExcluded){emit(this,this.Data.isExcluded?'mark':'unmark');if(!args[1])soundAccent(this.Data.isExcluded?'mark':'unmark');}return result;});
      wrap(cell,'PlayRemoveCatAnimation',function(original,...args){react(actor,'remove');emit(this,'remove');react(hud,'remove');return original(...args);});
      wrap(cell,'PlayErrorAnimation',function(original,...args){const result=original(...args);activeError=this;if(hud){hud.look=this.Col<4?'left':'right';hud.lookUntil=A.Cl.time+1.4;}emit(this,'error');return result;});
      // Input halo is separate from legality, and never consumes a click.
      wrap(cell,'OnPointerDown',function(original,...args){emit(this,'focus');return original(...args);});
    }
    wrap(Q.ui,'UpdateCatNum',function(original,count,total){const before=this.catCountBefore;const result=original(count,total);if(count>before){react(hud,'place');record('hud-count-arrival');}return result;});
    // SetupButtons has already bound the native method. Listen after that handler
    // so this response observes its real result without replacing its accounting.
    let observedHearts=Q.ui.currentHeartNum;
    Q.grid.OnErrorPlace.add(()=>{const hearts=Q.ui.currentHeartNum;if(hearts<observedHearts){react(hud,'error');record('fish-loss');}observedHearts=hearts;});
    Q.grid.OnAllCatsPlaced.add(()=>record('native-completion'));
    wrap(Q.tut.handGuide,'setWorldPosition',function(original,x,y){
      const tut=Q.tut;if(P.lowMotion&&tut._isTutorialActive&&tut.guidingStep?.guideLongPress){const target=tut.cellsToExclude.find(c=>!c.Data.isExcluded)||tut.cellsToExclude[0];if(target){x=target.node.world[4];y=target.node.world[5];}}
      return original(x,y);
    });
    // Freeze decorative native loops under the OS preference without advancing their clocks.
    for(const a of Q.animators){
      const update=a.update.bind(a);
      a.update=function(dt){
        if(P.lowMotion){
          if(this.node===Q.tut.handGuide){
            if(!this.started)this.start();
            const glove=this.node.findDeep('GuideHand');if(glove){glove.scale.x=glove.scale.y=1;glove.rotZ=0;if(glove.img)glove.img.color.a=1;}
            return;
          }
          const st=this.ctrl?.states?.[this.state||this.ctrl?.default],clip=st&&A.Vc.clips[st.clip];
          const isDecorative=clip?.loop||this.node===Q.ui.catCountAnim;
          if(isDecorative&&!this.prev){if(!this.started)update(0);return;}
        }
        return update(dt);
      };
    }
    P.ready=true;record('presentation-ready');
  }
  function normalImage(name){const im=asset[name],canvas=document.createElement('canvas');canvas.width=canvas.height=183;const c=canvas.getContext('2d');if(im.width===104)c.drawImage(im,11.6,14.4,161.2,161.2);else c.drawImage(im,0,0,183,183);return canvas;}
  function drawCat(actor){
    const {s}=actor,c=s.ctx;const t=A.Cl.time-actor.at,ambient=P.ambientTime;
    let phase=actor.phase;
    if(t>({place:1.05,error:.9,remove:.45}[phase]??Infinity))actor.phase=phase='idle';
    if(!actor.img.node.activeInHierarchy)return;
    let anticipation=0,ear=0,turn=0,cheek=0,wink=0,blink=0;
    const cycle=(ambient+actor.seed)% (4.7+actor.seed*.13);
    blink=envelope(cycle-.1,.16);const glance=envelope(cycle-1.8,.8);
    if(!P.lowMotion){
      if(phase==='place'&&t<1.05){anticipation=envelope(t,.15);ear=envelope(t-.43,.58);cheek=envelope(t-.48,.46);wink=envelope(t-.63,.35);turn=.035*envelope(t-.16,.65);}
      else if(phase==='error'&&t<.9){ear=1.35*envelope(t,.85);blink=envelope(t+.08,.95)*.55;turn=-.13*envelope(t,.75);}
      else if(phase==='remove'&&t<.45){ear=-envelope(t,.4);}
      else {ear=.28*envelope(cycle-2.9,.35);turn=.012*glance;}
    } else {blink=0;wink=phase==='place'&&t<.35?1:0;}
    actor.earLeft=P.lowMotion?0:(-.24*ear+.08*anticipation);
    actor.earRight=P.lowMotion?0:(.32*ear-.06*anticipation);
    actor.blink=blink;
    const signature=[phase,anticipation,ear,turn,cheek,wink>.25,blink>.42,glance>.1,P.lowMotion,actor.lookUntil>A.Cl.time?actor.look:''].join('|');
    const animator=actor.img.node.animator;
    const clip=animator?.ctrl?.states?.[animator.state]?.clip;
    const previousClip=animator?.ctrl?.states?.[animator.prev]?.clip;
    const nativeAction=phase!=='error'&&((clip&&A.Vc.clips[clip]&&!A.Vc.clips[clip].loop)||(previousClip&&A.Vc.clips[previousClip]&&!A.Vc.clips[previousClip].loop));
    // Retain every native eyelid/gaze frame. Extra ear gestures occur only in
    // an open-eye rest, so a five-pose approximation never replaces native idle.
    const nativeIdle=phase==='idle'&&!(actor.id==='hud-cat'&&actor.lookUntil>A.Cl.time)&&(Math.abs(ear)<.02||actor.img.sprite!==24758);
    const useNative=nativeAction||nativeIdle;
    const drawSignature=signature+'|'+(useNative?actor.img.sprite:'custom');
    if(actor.signature===drawSignature)return;actor.signature=drawSignature;
    if(useNative&&!P.lowMotion&&turn===0&&anticipation===0&&cheek===0){s.setNative(true);return;}
    s.setNative(false);
    c.clearRect(0,0,256,256);c.save();c.scale(256/183,256/183);c.translate(91.5,133);c.rotate(turn);c.scale(1+cheek*.06,1-anticipation*.065);c.translate(-91.5,-133);
    if(useNative&&!P.lowMotion){
      const source=A.images[A.sprites[actor.img.sprite]?.f];
      if(source)c.drawImage(source,0,0,183,183);
      c.restore();s.update();return;
    }
    if(actor.cell){c.translate(91.5,91.5);c.scale(1.15,1.15);c.translate(-91.5,-91.5);}
    let frame=blink>.42?asset.closedNormalized:wink>.25?asset.winkNormalized:glance>.1?asset[(actor.seed%2>1?'left':'right')+'Normalized']:asset.canonicalNormalized;
    if(actor.id==='hud-cat'&&actor.lookUntil>A.Cl.time&&phase==='idle')frame=asset[actor.look+'Normalized'];
    if(Math.abs(ear)>.02&&phase!=='idle')frame=blink>.42?asset.closedNormalized:asset.canonicalNormalized;
    if((Math.abs(actor.earLeft)+Math.abs(actor.earRight)<.004&&cheek<.02)||![asset.canonicalNormalized,asset.closedNormalized].includes(frame)){c.drawImage(frame,0,0);c.restore();s.update();return;}
    // Independent source-art ear pieces rotate about their roots; the head contact stays fixed.
    for(const [side,points,pivot,rotation] of [
      ['left',[[39,30],[61,26],[87,67],[40,87]],[60,73],actor.earLeft],
      ['right',[[105,66],[130,26],[146,29],[148,86]],[125,73],actor.earRight]
    ]){c.save();c.translate(...pivot);c.rotate(rotation);c.translate(-pivot[0],-pivot[1]);c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.clip();c.drawImage(frame,0,0);c.restore();}
    c.save();c.beginPath();c.moveTo(0,72);c.lineTo(42,72);c.quadraticCurveTo(91,25,145,72);c.lineTo(183,72);c.lineTo(183,cheek>.02?122:183);c.lineTo(0,cheek>.02?122:183);c.closePath();c.clip();c.drawImage(frame,0,0);c.restore();
    if(cheek>.02){c.save();c.translate(91.5,116);c.scale(1+cheek*.035,1+cheek*.075);c.translate(-91.5,-116+cheek*2);c.beginPath();c.rect(0,116,183,67);c.clip();c.drawImage(frame,0,0);c.restore();}
    c.restore();s.update();
  }
  function drawEffect(fx){
    const t=A.Cl.time-fx.at,d=fx.kind==='place'?.72:fx.kind==='error'?.65:.3;
    if(t>d){if(fx.dirty){fx.s.ctx.clearRect(0,0,256,256);fx.s.update();fx.dirty=false;fx.node.SetActive(false);}return;}
    const c=fx.s.ctx,p=clamp(t/d);c.clearRect(0,0,256,256);c.save();
    if(fx.kind==='place'){
      c.globalAlpha=(1-p)*.9;c.strokeStyle='#fff4c4';c.lineWidth=17*(1-p)+3;
      const r=P.lowMotion?110:94+24*smooth(p);c.beginPath();c.arc(128,128,r,0,Math.PI*2);c.stroke();
      if(!P.lowMotion)for(let i=0;i<5;i++){const a=i*Math.PI*2/5-.6,rr=108+p*10,x=128+Math.cos(a)*rr,y=128+Math.sin(a)*rr;c.save();c.translate(x,y);c.rotate(a+p*.5);c.fillStyle=i%2?'#fffdf1':'#ffda79';const z=18*(1-p);c.beginPath();c.moveTo(0,-z);c.quadraticCurveTo(1,0,z,0);c.quadraticCurveTo(0,1,0,z);c.quadraticCurveTo(-1,0,-z,0);c.quadraticCurveTo(0,-1,0,-z);c.fill();c.restore();}
    } else if(fx.kind==='error'){
      c.globalAlpha=(1-p)*.95;c.strokeStyle='#fff0d9';c.lineWidth=15;round(c,22,22,212,212,18);c.stroke();
      c.fillStyle='#fff8e8';c.font='bold 68px sans-serif';c.textAlign='center';c.fillText('!',128,150);
    } else if(fx.kind==='mark'){
      c.globalAlpha=1-smooth((p-.55)/.45);c.strokeStyle='#fff6d3';c.lineWidth=17;c.lineCap='round';
      const draw=(x1,y1,x2,y2,t)=>{t=smooth(t);c.beginPath();c.moveTo(x1,y1);c.lineTo(x1+(x2-x1)*t,y1+(y2-y1)*t);c.stroke();};
      draw(64,64,192,192,P.lowMotion?1:p*4);draw(192,64,64,192,P.lowMotion?1:(p-.22)*4);
      if(!P.lowMotion){c.fillStyle='#fff9e7';for(let i=0;i<3;i++){const x=192+p*(i-1)*22,y=192+p*(i-1)*15;c.beginPath();c.arc(x,y,8*(1-p),0,7);c.fill();}}
    } else {
      c.globalAlpha=(1-p)*.8;c.strokeStyle=fx.kind==='remove'?'#eedfff':'#ffffff';c.lineWidth=fx.kind==='focus'?3:5;
      const inset=P.lowMotion?24:20+p*12;round(c,inset,inset,256-inset*2,256-inset*2,18);c.stroke();
    }
    c.restore();fx.s.update();
  }
  function tick(now){
    try{
      const dt=Math.min(.05,previous?(now-previous)/1000:0);previous=now;
      if(A.Q.root){attach();if(!P.lowMotion&&!document.hidden)P.ambientTime+=dt;
        if(P.lowMotion&&A.Q.tut._isTutorialActive){
          const tut=A.Q.tut,hand=tut.handGuide,target=tut.guidingStep?.guideLongPress?(tut.cellsToExclude.find(c=>!c.Data.isExcluded)||tut.cellsToExclude[0]):tut.guideCellView;
          if(target&&hand.activeInHierarchy){hand.setWorldPosition(target.node.world[4],target.node.world[5]);const glove=hand.findDeep('GuideHand');if(glove){glove.scale.x=glove.scale.y=1;glove.rotZ=0;}A.layout();A.dirty();}
        }
        for(const a of actors)drawCat(a);for(const f of effects)drawEffect(f);
      }
    }catch(e){if(!P.errors.includes(e.message))P.errors.push(e.message);console.error('Meowdoku polish:',e);}
    requestAnimationFrame(tick);
  }
  // Everything can start before asynchronous art is ready; native play remains available.
  Promise.all(['cat-canonical','cat-wink','cat-closed','cat-look-left','cat-look-right'].map(name=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{asset[name]=im;resolve()};im.onerror=()=>reject(new Error('Missing '+name));im.src=`assets/${name}.png`;}))).then(async()=>{
    asset.canonicalNormalized=normalImage('cat-canonical');asset.winkNormalized=normalImage('cat-wink');asset.closedNormalized=normalImage('cat-closed');asset.leftNormalized=normalImage('cat-look-left');asset.rightNormalized=normalImage('cat-look-right');
    await A.ready;requestAnimationFrame(tick);
  }).catch(e=>{P.errors.push(e.message);console.error(e);});
})();
