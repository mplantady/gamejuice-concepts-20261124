import './meowdoku-cats.js';
import './meowdoku-surfaces.js';
import './meowdoku-ink-feedback.js';
/* Meowdoku presentation extension. Native rules, inputs and clocks remain authoritative. */
(() => {
  const A=window.MeowdokuNative, C=window.MeowdokuCats, S=window.MeowdokuSurfaces, F=window.MeowdokuInk;
  A.restorePortraitLayout();
  A.setAudioHeadroom(.72);
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const P=window.MeowdokuPolish={version:'meowdoku-journal-20261126-v2',ready:false,errors:[],events:[],actors:[],lowMotion:media.matches,ambientTime:0};
  P.setReducedMotion=value=>{P.lowMotion=!!value;};
  media.addEventListener('change',e=>P.setReducedMotion(e.matches));
  P.diagnostics=()=>({version:P.version,ready:P.ready,errors:[...P.errors,...(C.diagnostics().errors||[]),...(S.diagnostics().errors||[]),...(F.diagnostics().errors||[])],cats:C.diagnostics(),surfaces:S.diagnostics(),ink:F.diagnostics(),audio:{activeVoices:voices.size,events:audioEvents.slice(-100)},lowMotion:P.lowMotion,ambientTime:P.ambientTime,actors:P.actors.map(x=>({id:x.id,phase:x.phase,earLeft:x.earLeft,earRight:x.earRight,blink:x.blink})),events:P.events.slice(-120)});
  const actors=[],voices=new Set(),audioEvents=[];
  let previous=0,root=null,hud=null,lastAccent=-100,soundSerial=0,batchMarks=0;
  const record=(kind,cell)=>{P.events.push({kind,time:A.Cl.time,wall_ms:performance.now(),row:cell?.Row,col:cell?.Col});if(P.events.length>500)P.events.shift();};
  const presentation=fn=>{try{return fn();}catch(e){if(!P.errors.includes(e.message))P.errors.push(e.message);return null;}};
  const wrap=(object,key,fn)=>{const original=object[key];object[key]=function(...args){return fn.call(this,original.bind(this),...args);};};
  const emit=(cell,kind,options={})=>{F.emit(cell,kind,options);record(kind,cell);};
  function addActor(img,id,cell=null){const actor=C.attach(img,id,cell);if(actor)actors.push(actor);P.actors=actors;return actor;}
  function react(actor,phase){if(actor){if(actor===hud&&actor.phase==='error'&&A.Cl.time-actor.at<.9&&phase!=='error')return;C.react(actor,phase);}}
  function silenceAccents(){for(const v of voices){try{v.source.stop();}catch{}try{v.source.disconnect();v.gain.disconnect();v.filter?.disconnect();}catch{}}voices.clear();}
  function soundAccent(kind,cell=null){
    if(!A.Sl.isPlaying||A.Sl.mute)return;
    const ac=A.audioContext;if(!ac||ac.state!=='running')return;
    if(cell&&['remove','unmark'].includes(kind))for(const v of voices)if(v.cell===cell&&v.startAt>ac.currentTime){try{v.source.stop();v.gain.disconnect();}catch{}voices.delete(v);audioEvents.push({kind:'cancel-pending-'+v.kind,eventTime:A.Cl.time,row:cell.Row,col:cell.Col});}
    const quiet=['mark','unmark','focus'].includes(kind);if(voices.size>=6||(quiet&&A.Cl.time-lastAccent<.065))return;lastAccent=A.Cl.time;
    const settings={place:[.133,.095,400,.028],mark:[.035,.075,1800,.012],unmark:[0,.065,1250,.009],remove:[.02,.12,800,.012],progress:[0,.16,880,.018],loss:[.183,.12,650,.016],result:[.333,.28,240,.018]};
    const [delay,duration,tone,level]=settings[kind]||settings.mark;
    const variation=1+((++soundSerial%5)-2)*.025,t=ac.currentTime+delay;
    // These voices accent the native cues. Onset follows the native silhouette/tear/result beats.
    const gain=ac.createGain();gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(level,t+.008);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);gain.connect(ac.destination);
    const frames=Math.ceil(ac.sampleRate*duration),buffer=ac.createBuffer(1,frames,ac.sampleRate),data=buffer.getChannelData(0);let seed=7919+soundSerial*137;
    for(let i=0;i<frames;i++){seed=(seed*16807)%2147483647;const x=i/ac.sampleRate;data[i]=(seed/1073741823.5-1)*.35+Math.sin(2*Math.PI*tone*variation*x)*.32*Math.exp(-x*18);}
    const source=ac.createBufferSource(),filter=ac.createBiquadFilter();source.buffer=buffer;filter.type=quiet?'bandpass':'lowpass';filter.frequency.value=quiet?tone*variation:2200;filter.Q.value=.7;source.connect(filter);filter.connect(gain);
    const voice={source,gain,filter,kind,cell,startAt:t};voices.add(voice);source.onended=()=>{voices.delete(voice);source.disconnect();filter.disconnect();gain.disconnect();};source.start(t);source.stop(t+duration+.01);
    audioEvents.push({kind,row:cell?.Row,col:cell?.Col,eventTime:A.Cl.time,scheduledAudioTime:t,delayMs:delay*1000,durationMs:duration*1000});if(audioEvents.length>200)audioEvents.shift();
  }
  function attach(){
    if(!A.Q.root||root===A.Q.root)return;
    root=A.Q.root;actors.length=0;P.events.length=0;P.ambientTime=0;lastAccent=-100;batchMarks=0;silenceAccents();audioEvents.length=0;
    const {Q}=A;
    C.reset();S.attach();F.attach();
    hud=addActor(Q.ui.catCountAnim.img,'hud-cat');
    addActor(Q.ui.catFly.img,'flying-counter-cat');
    addActor(Q.byCid.get(420282)?.img,'failure-cat');
    addActor(Q.byCid.get(420156)?.img,'failure-counter-cat');
    for(const key of ['RefreshMarkExcludedCells','MarkExcludedCells','UnmarkExcludedCellsForRemoval'])wrap(Q.grid,key,function(original,...args){batchMarks++;try{return original(...args);}finally{batchMarks--;}});
    for(const cell of Q.grid._cells.values()){
      const actor=addActor(cell.catImage,`cat-${cell.Row}-${cell.Col}`,cell);
      const candidate=cell.node.findDeep('Image_CatMay');if(candidate?.img)addActor(candidate.img,`candidate-${cell.Row}-${cell.Col}`,cell);
      wrap(cell,'PlaceCat',(original,...args)=>{const value=original(...args);presentation(()=>{react(actor,'place');if(hud){hud.look=cell.Col<4?'left':'right';hud.lookUntil=A.Cl.time+2;}emit(cell,'place');soundAccent('place',cell);});return value;});
      wrap(cell,'SetExcluded',function(original,...args){const before=this.Data.isExcluded,value=original(...args);if(before!==this.Data.isExcluded)presentation(()=>{const kind=this.Data.isExcluded?'mark':'unmark',quiet=!!args[1]||batchMarks>0;emit(this,kind,{automatic:quiet});if(!quiet){soundAccent(kind,this);if(kind==='unmark')react(hud,'unmark');}});return value;});
      wrap(cell,'PlayRemoveCatAnimation',function(original,...args){presentation(()=>{react(actor,'remove');emit(this,'remove');react(hud,'remove');soundAccent('remove',this);});return original(...args);});
      wrap(cell,'PlayErrorAnimation',function(original,...args){const value=original(...args);presentation(()=>{if(hud){hud.look=this.Col<4?'left':'right';hud.lookUntil=A.Cl.time+1.4;}emit(this,'error');});return value;});
      // A neutral contact cue never declares legality and never consumes input.
      wrap(cell,'OnPointerDown',function(original,...args){presentation(()=>emit(this,'focus'));return original(...args);});
    }
    wrap(Q.ui,'UpdateCatNum',function(original,count,total){const before=this.catCountBefore,value=original(count,total);if(count>before)presentation(()=>{record('hud-count-arrival');if(!Q.ui.failPanel.activeInHierarchy){react(hud,'progress');F.progress();soundAccent('progress');}});return value;});
    let observedHearts=Q.ui.currentHeartNum;
    // This observer follows the native decrement/panel activation. Presentation failures cannot interrupt native error handling.
    Q.grid.OnErrorPlace.add(()=>{const hearts=Q.ui.currentHeartNum;if(hearts<observedHearts)presentation(()=>{react(hud,'error');record('fish-loss');if(hearts===0&&Q.ui.failPanel.activeInHierarchy){silenceAccents();F.showResult();soundAccent('result');record('native-failure');}else{F.loss(hearts);soundAccent('loss');}});observedHearts=hearts;});
    Q.grid.OnAllCatsPlaced.add(()=>presentation(()=>record('native-completion')));
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
  function tick(now){
    try{
      const dt=Math.min(.05,previous?(now-previous)/1000:0);previous=now;
      if(A.Q.root){attach();if(!P.lowMotion&&!document.hidden)P.ambientTime+=dt;
        if(P.lowMotion&&A.Q.tut._isTutorialActive){
          const tut=A.Q.tut,hand=tut.handGuide,target=tut.guidingStep?.guideLongPress?(tut.cellsToExclude.find(c=>!c.Data.isExcluded)||tut.cellsToExclude[0]):tut.guideCellView;
          if(target&&hand.activeInHierarchy){hand.setWorldPosition(target.node.world[4],target.node.world[5]);const glove=hand.findDeep('GuideHand');if(glove){glove.scale.x=glove.scale.y=1;glove.rotZ=0;}A.layout();A.dirty();}
        }
        C.tick(A.Cl.time,P.ambientTime,P.lowMotion);S.tick(A.Cl.time,P.ambientTime,P.lowMotion);F.tick(A.Cl.time,P.lowMotion);if(A.Sl.mute||!A.Sl.isPlaying)silenceAccents();
      }
    }catch(e){if(!P.errors.includes(e.message))P.errors.push(e.message);console.error('Meowdoku polish:',e);}
    requestAnimationFrame(tick);
  }
  // Normal asynchronous startup remains playable while the independent paint loads.
  Promise.all([A.ready,C.ready,S.ready,F.ready]).then(()=>requestAnimationFrame(tick)).catch(e=>{P.errors.push(e.message);console.error(e);});
})();
