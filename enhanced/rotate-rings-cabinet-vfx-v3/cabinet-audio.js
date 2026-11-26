/* Cabinet VFX pass: accepted Foley, controlled hierarchy and contact timing.
   Pure presentation: no game state, rules, random state or generated samples. */
const CUES = {
  contact: {files:['contact-copper-1','contact-copper-2'],gain:.52,priority:2,group:'grip',cap:2,detail:true,gap:.045,cutoff:6200,variation:true},
  motion_contact: {files:['motion-contact-1','motion-contact-2'],gain:.16,priority:1,group:'tick',cap:1,detail:true,gap:.145,cutoff:4300,variation:true},
  motion_friction: {files:['motion-friction-loop'],gain:.14,priority:0,loop:true},
  fixed_rejection: {files:['blocked-resistance'],gain:.64,priority:3,group:'resistance',cap:1,gap:.080,cutoff:1750,rate:.94,duck:[.38,.18]},
  misaligned_release: {files:['misaligned-stop'],gain:.44,priority:3,group:'resistance',cap:1,gap:.060,cutoff:3600,rate:1.03,duck:[.55,.12]},
  latch_release: {files:['latch-release-1','latch-release-2'],gain:.66,priority:4,group:'latch',cap:2,cutoff:7600,shape:'release',duck:[.35,.23]},
  latch_settle: {files:['latch-settle-1','latch-settle-2'],gain:.58,priority:5,group:'latch',cap:2,cutoff:3200,duck:[.25,.11]},
  ring_escape: {files:['ring-departure'],gain:.54,priority:4,group:'escape',cap:2,cutoff:5800,attack:.008,duck:[.45,.40]},
  trial_success: {files:['trial-resolve'],gain:.74,priority:7,group:'result',cap:1,cutoff:7000,duck:[.15,.75]},
  trial_limit: {files:['trial-limit'],gain:.50,priority:6,group:'result',cap:1,cutoff:1600,rate:.97,duck:[.25,.25]},
};
const MASTER_GAIN=.80, FOLEY_GAIN=.85, MAX_CUE_VOICES=5;
const DETAIL_GAINS=[1,.91,.97,.87], DETAIL_RATES=[1,.985,1.015,.995];
const TRAVEL_STEPS=[28,38,31,43];
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
  let motionStarts=0,motionStops=0,peakSpeed=0,dropped=0,stolen=0,serial=0,repeated=0,tickStep=0;
  let duckUntil=0,duckAmount=1;
  const buffers=new Map(),sampleInfo=new Map(),voices=new Set(),cursors=new Map(),reportedErrors=new Set(),lastPlayed=new Map();
  const cueHistory=[];
  const ownMaster=!!context&&!api.master;
  const master=context?(api.master||context.createGain()):null;
  const bus=context?context.createGain():null;
  const detailBus=context?context.createGain():null;
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
  function connect(source,gain,pan,filter=null,detail=false) {
    if(filter){source.connect(filter);filter.connect(gain);}else source.connect(gain);
    const destination=detail?detailBus:bus;
    if(pan){gain.connect(pan);pan.connect(destination);}else gain.connect(destination);
  }
  function disconnect(voice) {
    try{voice.source.disconnect();voice.filter?.disconnect();voice.gain.disconnect();voice.pan?.disconnect();}catch{}
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

  function duckDetails(amount,hold) {
    const now=context.currentTime;
    if(now>=duckUntil)duckAmount=1;
    duckAmount=Math.min(duckAmount,amount);duckUntil=Math.max(duckUntil,now+hold);
    target(detailBus.gain,duckAmount,.006);
    // Only low-priority mechanical detail is ducked. Source music and event
    // contacts remain independent; no timer can re-enable sound after mute.
    detailBus.gain.setTargetAtTime(1,duckUntil,.070);
  }
  function clearDetails() {
    duckUntil=0;duckAmount=1;lastPlayed.clear();travel=0;tickStep=0;
    if(detailBus){detailBus.gain.cancelScheduledValues(context.currentTime);detailBus.gain.setValueAtTime(1,context.currentTime);}
  }
  function envelope(param,gain,start,duration,config) {
    const attack=Math.min(config.attack||.0007,duration*.1);
    param.setValueAtTime(0,start);param.linearRampToValueAtTime(gain,start+attack);
    if(config.shape==='release'){
      // The opening impulse has its own short body; its tail leaves space for
      // the independently triggered real jaw contact at +0.19 seconds.
      param.setValueAtTime(gain,start+Math.min(.035,duration*.15));
      param.linearRampToValueAtTime(gain*.50,start+Math.min(.150,duration*.55));
      param.linearRampToValueAtTime(gain*.20,start+Math.min(.190,duration*.75));
    }else param.setValueAtTime(gain,start+Math.max(attack,duration-.018));
    param.linearRampToValueAtTime(0,start+duration);
  }

  if(context){
    if(ownMaster)master.connect(context.destination);
    bus.gain.value=FOLEY_GAIN;bus.connect(master);detailBus.gain.value=1;detailBus.connect(bus);
    master.gain.setValueAtTime(muted?0:MASTER_GAIN,context.currentTime);
  }

  function play(name,gain,pan=0,rate) {
    if(!isRunning())return false;
    const cue=CUES[name]?name:fileToCue.get(name);
    if(!cue){error('cue',`unknown name ${name}`);return false;}
    const config=CUES[cue];
    if(config.loop){error('cue','use motion() for the friction loop');return false;}
    const cursor=cursors.get(cue)||0;
    const file=CUES[name]?config.files[cursor%config.files.length]:name;
    if(!buffers.has(file))return false; // Never queue stale events during load.
    const now=context.currentTime,last=lastPlayed.get(cue);
    if(config.gap&&last&&now-last.time<config.gap&&Math.abs(finite(pan)-last.pan)<.08){
      repeated++;mark('audio-repeat-suppressed',{cue,interval:now-last.time});return false;
    }
    const sameGroup=[...voices].filter(voice=>voice.group===config.group);
    if(sameGroup.length>=config.cap){
      const victim=sameGroup.sort((a,b)=>a.priority-b.priority||a.serial-b.serial)[0];
      if(config.priority<victim.priority){dropped++;return false;}
      endVoice(victim);stolen++;
    }
    if(voices.size>=MAX_CUE_VOICES){
      const victim=[...voices].sort((a,b)=>a.priority-b.priority||a.serial-b.serial)[0];
      if(config.priority<victim.priority){dropped++;return false;}
      endVoice(victim);stolen++;
    }
    const source=context.createBufferSource(),volume=context.createGain(),panNode=panner(pan);
    const filter=config.cutoff&&context.createBiquadFilter?context.createBiquadFilter():null;
    if(filter){filter.type='lowpass';filter.frequency.value=config.cutoff;filter.Q.value=.5;}
    const variation=config.variation?cursor%DETAIL_GAINS.length:0;
    const appliedRate=clamp(finite(rate,(config.rate||1)*(config.variation?DETAIL_RATES[variation]:1)),.75,1.25);
    // Distinct release and settle phases keep their authored level. Only
    // simultaneous copies of the same cue share the acoustic headroom.
    const overlap=1/Math.sqrt(1+Math.min(sameGroup.filter(voice=>voice.cue===cue).length,config.cap-1)*.7);
    const appliedGain=clamp(finite(gain,config.gain),0,1)*(config.variation?DETAIL_GAINS[variation]:1)*overlap;
    source.buffer=buffers.get(file);source.playbackRate.value=appliedRate;
    const duration=source.buffer.duration/appliedRate;
    envelope(volume.gain,appliedGain,now,duration,config);
    const voice={source,gain:volume,pan:panNode,filter,cue,priority:config.priority,group:config.group,serial:++serial,startedAt:now,endsAt:now+duration};
    connect(source,volume,panNode,filter,config.detail);voices.add(voice);
    source.onended=()=>{voices.delete(voice);disconnect(voice);};
    try{source.start(now);}catch(reason){endVoice(voice);error(file,reason);return false;}
    cursors.set(cue,cursor+1);
    lastPlayed.set(cue,{time:now,pan:finite(pan)});
    if(config.duck)duckDetails(...config.duck);
    state.audioCounts[file]=(state.audioCounts[file]||0)+1;
    const event={cue,file,gain:appliedGain,pan:panNode?.pan.value??0,rate:appliedRate,priority:config.priority,
      onsetAudioTime:now,sourcePeakAudioTime:now+(sampleInfo.get(file)?.peakOffset||0)/appliedRate,
      endsAudioTime:now+duration,cutoffHz:filter?config.cutoff:null,detailDuck:config.duck?duckAmount:null,
      voiceCount:voices.size};
    cueHistory.push(event);if(cueHistory.length>32)cueHistory.shift();mark('audio-cue',event);
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
      friction={source,gain:volume,pan:panNode};connect(source,volume,panNode,null,true);
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
    const step=TRAVEL_STEPS[tickStep%TRAVEL_STEPS.length];
    if(travel>=step&&context.currentTime-lastContact>=.160){
      const tickGain=CUES.motion_contact.gain*(.65+.35*Math.sqrt(clamp(speed/240,0,1)));
      if(play('motion_contact',tickGain,pan)){travel%=step;tickStep++;lastContact=context.currentTime;}
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
      for(const voice of [...voices])endVoice(voice);clearDetails();}
    mark('audio-mute',{muted,masterSetting:MASTER_GAIN});
    return muted;
  }
  function snapshot() {
    return {version:'cabinet-audio-vfx-v3',available:!!context,ready:readySettled&&loaded===files.length&&!disposed,settled:readySettled,loaded,expected:files.length,
      muted,masterSetting:MASTER_GAIN,masterTarget:muted?0:MASTER_GAIN,masterGain:master?.gain.value??0,
      foleyGain:FOLEY_GAIN,voices:voices.size,voiceLimit:MAX_CUE_VOICES,frictionVoices:friction?1:0,
      motionSpeed:smoothedSpeed,peakMotionSpeed:peakSpeed,motionStarts,motionStops,dropped,stolen,repeated,
      detailDuckAmount:context&&context.currentTime<duckUntil?duckAmount:1,detailDuckUntil:duckUntil,
      cueGroups:Object.fromEntries([...new Set([...voices].map(voice=>voice.group))].map(group=>[group,[...voices].filter(voice=>voice.group===group).length])),
      recentCues:cueHistory.map(event=>({...event})),sourcePeakNote:'Raw decoded sample peak estimate; filters/envelopes and output latency are not included.',
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
      if(!disposed){
        let peak=0,peakFrame=0;
        if(buffer.getChannelData)for(let channel=0;channel<buffer.numberOfChannels;channel++){
          const data=buffer.getChannelData(channel);
          for(let i=0;i<data.length;i++)if(Math.abs(data[i])>peak){peak=Math.abs(data[i]);peakFrame=i;}
        }
        sampleInfo.set(file,{peak,peakOffset:peakFrame/(buffer.sampleRate||48000)});
        buffers.set(file,buffer);loaded++;state.loads++;
      }
    }catch(reason){if(!disposed)error(file,reason);}
  })).then(()=>{readySettled=true;state.audioReady=!disposed&&loaded===files.length;if(!disposed)mark('audio-ready',{loaded,expected:files.length});return snapshot();})
    :Promise.resolve().then(()=>{readySettled=true;state.audioReady=false;error('context','WebAudio unavailable');return snapshot();});

  function dispose() {
    if(disposed)return;
    disposed=true;state.audioReady=false;controller?.abort();clearMotionTimers();endFriction();
    for(const voice of [...voices])endVoice(voice);
    buffers.clear();sampleInfo.clear();detailBus?.disconnect();bus?.disconnect();if(ownMaster)master?.disconnect();
    if(typeof document!=='undefined')document.removeEventListener('visibilitychange',visibilityChanged);
    context?.removeEventListener?.('statechange',audioStateChanged);
  }
  return {ready,play,motion,stopMotion,mute,snapshot,dispose};
}
