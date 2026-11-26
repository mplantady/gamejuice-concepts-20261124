/* Copper cabinet Foley. Pure presentation: no game state, rules or RNG. */
const CUES = {
  contact: {files:['contact-copper-1','contact-copper-2'],gain:.45,priority:2},
  motion_contact: {files:['motion-contact-1','motion-contact-2'],gain:.22,priority:1},
  motion_friction: {files:['motion-friction-loop'],gain:.18,priority:0,loop:true},
  fixed_rejection: {files:['blocked-resistance'],gain:.60,priority:3},
  misaligned_release: {files:['misaligned-stop'],gain:.50,priority:3},
  latch_release: {files:['latch-release-1','latch-release-2'],gain:.63,priority:4},
  latch_settle: {files:['latch-settle-1','latch-settle-2'],gain:.42,priority:4},
  ring_escape: {files:['ring-departure'],gain:.48,priority:4},
  trial_success: {files:['trial-resolve'],gain:.62,priority:6},
  trial_limit: {files:['trial-limit'],gain:.45,priority:5},
};
const MASTER_GAIN=.80, FOLEY_GAIN=.85, MAX_CUE_VOICES=5;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;

export function createCabinetAudio(api,state,log=()=>{}) {
  const context=api.audio;
  state.errors=Array.isArray(state.errors)?state.errors:[];
  state.audioCounts=state.audioCounts||{};
  state.loads=finite(state.loads);
  state.audioReady=false;
  let disposed=false,muted=!!state.muted,loaded=0,readySettled=false;
  let friction=null,fadeTimer=null,idleTimer=null,smoothedSpeed=0,travel=0,lastContact=-Infinity;
  let motionStarts=0,motionStops=0,peakSpeed=0,dropped=0,stolen=0,serial=0;
  const buffers=new Map(),voices=new Set(),cursors=new Map(),reportedErrors=new Set();
  const ownMaster=!!context&&!api.master;
  const master=context?(api.master||context.createGain()):null;
  const bus=context?context.createGain():null;
  const controller=typeof AbortController==='function'?new AbortController():null;
  const fileToCue=new Map(Object.entries(CUES).flatMap(([cue,row])=>row.files.map(file=>[file,cue])));
  const files=[...fileToCue.keys()];

  function mark(event,data={}) {try{log(event,{...data,audioTime:context?.currentTime??null});}catch{}}
  function error(name,reason) {
    const message=`cabinet audio ${name}: ${reason?.message||reason}`;
    if(!reportedErrors.has(message)){reportedErrors.add(message);state.errors.push(message);mark('audio-error',{name,message});}
  }
  function target(param,value,timeConstant=.012) {
    if(!param||!context)return;
    const now=context.currentTime;
    if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(now);
    else {param.cancelScheduledValues(now);param.setValueAtTime(param.value,now);}
    param.setTargetAtTime(value,now,timeConstant);
  }
  function isRunning(){return !disposed&&!muted&&!!context&&context.state==='running';}
  function panner(pan) {
    if(!context.createStereoPanner)return null;
    const node=context.createStereoPanner();node.pan.value=clamp(finite(pan),-.5,.5);return node;
  }
  function connect(source,gain,pan) {
    source.connect(gain);
    if(pan){gain.connect(pan);pan.connect(bus);}else gain.connect(bus);
  }
  function disconnect(voice) {
    try{voice.source.disconnect();voice.gain.disconnect();voice.pan?.disconnect();}catch{}
  }
  function endVoice(voice) {
    voices.delete(voice);try{voice.source.stop();}catch{}disconnect(voice);
  }
  function clearMotionTimers() {
    if(idleTimer!==null){clearTimeout(idleTimer);idleTimer=null;}
    if(fadeTimer!==null){clearTimeout(fadeTimer);fadeTimer=null;}
  }
  function endFriction(voice=friction) {
    if(!voice)return;
    if(friction===voice)friction=null;
    try{voice.source.stop();}catch{}disconnect(voice);
    motionStops++;mark('audio-motion-stop');
  }
  function stopMotion() {
    if(idleTimer!==null){clearTimeout(idleTimer);idleTimer=null;}
    smoothedSpeed=0;travel=0;lastContact=-Infinity;
    if(!friction||fadeTimer!==null)return;
    const voice=friction;target(voice.gain.gain,0,.010);
    // Keep one loop during the 60ms release. A new actual movement can cancel
    // this fade and reuse it; no second loop or un-cancellable scheduled stop.
    fadeTimer=setTimeout(()=>{fadeTimer=null;endFriction(voice);},60);
  }

  if(context){
    if(ownMaster)master.connect(context.destination);
    bus.gain.value=FOLEY_GAIN;bus.connect(master);
    master.gain.setValueAtTime(muted?0:MASTER_GAIN,context.currentTime);
  }

  function play(name,gain,pan=0,rate=1) {
    if(!isRunning())return false;
    const cue=CUES[name]?name:fileToCue.get(name);
    if(!cue){error('cue',`unknown name ${name}`);return false;}
    const config=CUES[cue];
    if(config.loop){error('cue','use motion() for the friction loop');return false;}
    const cursor=cursors.get(cue)||0;
    const file=CUES[name]?config.files[cursor%config.files.length]:name;
    if(!buffers.has(file))return false; // Never queue stale events during load.
    if(voices.size>=MAX_CUE_VOICES){
      const victim=[...voices].sort((a,b)=>a.priority-b.priority||a.serial-b.serial)[0];
      if(config.priority<victim.priority){dropped++;return false;}
      endVoice(victim);stolen++;
    }
    const source=context.createBufferSource(),volume=context.createGain(),panNode=panner(pan);
    source.buffer=buffers.get(file);source.playbackRate.value=clamp(finite(rate,1),.75,1.25);
    volume.gain.value=clamp(finite(gain,config.gain),0,1);
    const voice={source,gain:volume,pan:panNode,priority:config.priority,serial:++serial};
    connect(source,volume,panNode);voices.add(voice);
    source.onended=()=>{voices.delete(voice);disconnect(voice);};
    try{source.start(context.currentTime);}catch(reason){endVoice(voice);error(file,reason);return false;}
    cursors.set(cue,cursor+1);
    state.audioCounts[file]=(state.audioCounts[file]||0)+1;
    mark('audio-cue',{cue,file,gain:volume.gain.value,pan:panNode?.pan.value??0,voiceCount:voices.size});
    return true;
  }

  function motion(velocity,pan=0,dt=1/60) {
    const speed=Math.abs(finite(velocity));
    if(!isRunning()||!buffers.has('motion-friction-loop')||speed<2){stopMotion();return false;}
    clearMotionTimers();
    const delta=clamp(finite(dt,1/60),0,.10);
    smoothedSpeed+=(speed-smoothedSpeed)*(1-Math.exp(-delta/.035));
    peakSpeed=Math.max(peakSpeed,speed);
    if(!friction){
      const source=context.createBufferSource(),volume=context.createGain(),panNode=panner(pan);
      source.buffer=buffers.get('motion-friction-loop');source.loop=true;volume.gain.value=0;
      friction={source,gain:volume,pan:panNode};connect(source,volume,panNode);
      const voice=friction;
      source.onended=()=>{if(friction===voice)friction=null;disconnect(voice);};
      try{source.start(context.currentTime);}catch(reason){endFriction(voice);error('motion-friction-loop',reason);return false;}
      motionStarts++;state.audioCounts['motion-friction-loop']=(state.audioCounts['motion-friction-loop']||0)+1;
      mark('audio-motion-start');
    }
    const amount=Math.sqrt(clamp((smoothedSpeed-2)/360,0,1));
    target(friction.gain.gain,CUES.motion_friction.gain*amount,.0067);
    if(friction.pan)target(friction.pan.pan,clamp(finite(pan),-.5,.5),.015);
    target(friction.source.playbackRate,clamp(.90+smoothedSpeed/1200,.90,1.15),.035);
    travel+=speed*delta;
    if(travel>=28&&context.currentTime-lastContact>=.120){
      if(play('motion_contact',undefined,pan)){travel%=28;lastContact=context.currentTime;}
    }
    // Root may call motion per pointer event or per frame. Neither path leaves
    // a friction loop running when movement callbacks stop arriving.
    idleTimer=setTimeout(()=>{idleTimer=null;stopMotion();},120);
    return true;
  }

  function mute(value) {
    if(disposed)return muted;
    muted=!!value;state.muted=muted;
    target(master?.gain,muted?0:MASTER_GAIN,.008);
    if(muted){clearMotionTimers();endFriction();smoothedSpeed=0;travel=0;lastContact=-Infinity;
      for(const voice of [...voices])endVoice(voice);}
    mark('audio-mute',{muted,masterSetting:MASTER_GAIN});
    return muted;
  }
  function snapshot() {
    return {version:'cabinet-audio-v2',available:!!context,ready:readySettled&&loaded===files.length&&!disposed,settled:readySettled,loaded,expected:files.length,
      muted,masterSetting:MASTER_GAIN,masterTarget:muted?0:MASTER_GAIN,masterGain:master?.gain.value??0,
      foleyGain:FOLEY_GAIN,voices:voices.size,voiceLimit:MAX_CUE_VOICES,frictionVoices:friction?1:0,
      motionSpeed:smoothedSpeed,peakMotionSpeed:peakSpeed,motionStarts,motionStops,dropped,stolen,
      counts:{...state.audioCounts},errors:[...reportedErrors],disposed};
  }
  const visibilityChanged=()=>{if(typeof document!=='undefined'&&document.hidden)stopMotion();};
  const audioStateChanged=()=>{if(context?.state!=='running')stopMotion();};
  if(typeof document!=='undefined')document.addEventListener('visibilitychange',visibilityChanged);
  context?.addEventListener?.('statechange',audioStateChanged);

  const ready=context?Promise.all(files.map(async file=>{
    try{
      const response=await fetch(new URL(`audio/${file}.wav`,import.meta.url),controller?{signal:controller.signal}:{});
      if(!response.ok)throw new Error(`HTTP${response.status}`);
      const buffer=await context.decodeAudioData(await response.arrayBuffer());
      if(!disposed){buffers.set(file,buffer);loaded++;state.loads++;}
    }catch(reason){if(!disposed)error(file,reason);}
  })).then(()=>{readySettled=true;state.audioReady=!disposed&&loaded===files.length;if(!disposed)mark('audio-ready',{loaded,expected:files.length});return snapshot();})
    :Promise.resolve().then(()=>{readySettled=true;state.audioReady=false;error('context','WebAudio unavailable');return snapshot();});

  function dispose() {
    if(disposed)return;
    disposed=true;state.audioReady=false;controller?.abort();clearMotionTimers();endFriction();
    for(const voice of [...voices])endVoice(voice);
    buffers.clear();bus?.disconnect();if(ownMaster)master?.disconnect();
    if(typeof document!=='undefined')document.removeEventListener('visibilitychange',visibilityChanged);
    context?.removeEventListener?.('statechange',audioStateChanged);
  }
  return {ready,play,motion,stopMotion,mute,snapshot,dispose};
}
