/* Goods Puzzle Atelier VFX — retained recordings and registered material cues.
 * The supplied buffers object remains live while the original decoder fills it.
 * No gameplay state, timers, random source, or AudioContext lifecycle is changed.
 */
function installGoodsAudio({context, buffers}) {
  const noop = {play:()=>null, cue:()=>false, setMuted:()=>{},
    diagnostics:()=>({available:false}), destroy:()=>{}};
  if (!context || !buffers || typeof context.createGain !== 'function') return noop;

  const offline = typeof context.startRendering === 'function';
  const master = context.createGain(), music = context.createGain();
  const effects = context.createGain(), compressor = context.createDynamicsCompressor();
  master.gain.value = 0.72;
  music.gain.value = 0.26;
  effects.gain.value = 0.76;
  compressor.threshold.value = -13;
  compressor.knee.value = 16;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.13;
  music.connect(compressor); effects.connect(compressor);
  compressor.connect(master); master.connect(context.destination);

  // Retain the original contact recording as a quieter common support layer;
  // the authored material transient carries the identity of the moved good.
  const sampleLevels = {music:1, startWave:0.36, putDown:0.26, match:0.62, soldOut:0.40};
  // Index is the protected original item type. Palette never selects a sound.
  // Index zero is a safe fallback for calls without an item (e.g. shelf stamp).
  const materialByType = Object.freeze([
    'shelf', 'paper', 'paper', 'food', 'ceramic', 'wood', 'textile', 'textile',
    'textile', 'textile', 'food', 'textile', 'plastic', 'food', 'wax', 'paper',
    'ceramic', 'wood', 'ceramic', 'ceramic', 'wood', 'paper', 'food', 'metal',
    'leather', 'food', 'food', 'food', 'leather', 'paintedwood', 'ceramic',
    'plastic', 'plastic'
  ]);
  const materialProfiles = {
    // contact tuples: [frequency, decay, level, finalFrequency, delay, waveform].
    // A maximum of three sources per contact stays within the v1 voice budget.
    textile: {lift:530, grip:[0.070,0.065,760],
      body:[125,0.065,0.072,91], surface:[0.115,0.074,680,0,0.48]},
    paper: {lift:650, grip:[0.085,0.045,1850],
      body:[235,0.042,0.050,175,0,'triangle'], surface:[0.145,0.050,2150,0,0.9]},
    ceramic: {lift:815, grip:[0.040,0.030,2400],
      modes:[[1180,0.155,0.053,1176],[2710,0.069,0.020,2699,0.002]], surface:[0.066,0.022,2850,0,1.4]},
    metal: {lift:745, grip:[0.038,0.032,1900],
      body:[148,0.065,0.059,119], modes:[[840,0.205,0.048,837],[1932,0.110,0.023,1925,0.002]]},
    food: {lift:590, grip:[0.050,0.040,1180],
      body:[165,0.047,0.047,135], surface:[0.068,0.038,1320,0,0.58]},
    wood: {lift:605, grip:[0.065,0.038,1100],
      body:[225,0.067,0.088,176,0,'triangle'], surface:[0.092,0.036,1230,0,0.8]},
    leather: {lift:505, grip:[0.080,0.077,650],
      body:[135,0.070,0.068,98], surface:[0.100,0.088,590,0.004,0.48]},
    paintedwood: {lift:635, grip:[0.055,0.038,1320],
      body:[285,0.061,0.078,222,0,'triangle'], surface:[0.076,0.037,1470,0,0.95]},
    plastic: {lift:705, grip:[0.048,0.033,1550],
      body:[315,0.052,0.070,247,0,'triangle'], modes:[[610,0.050,0.024,586,0.004]], surface:[0.080,0.028,1660,0,1.1]},
    wax: {lift:555, grip:[0.045,0.050,760],
      body:[190,0.061,0.065,160], surface:[0.052,0.050,710,0,0.45]},
    shelf: {lift:620, grip:[0.060,0.050,1350],
      body:[175,0.080,0.090,110], modes:[[880,0.065,0.025,760,0.005]], surface:[0.095,0.055,1100]}
  };
  const detailFor = detail => {
    const type=Number.isInteger(detail?.type)&&detail.type>0&&detail.type<materialByType.length?detail.type:null;
    return {type,material:type===null?'shelf':materialByType[type]};
  };
  const active = new Set(), loops = new Map(), wantedLoops = new Set(), last = new Map();
  const cueGroups = new Set(), variations = new Map();
  const counts = {samples:{}, cues:{}, missing:0, suppressed:0, capped:0, peakVoices:0,
    errors:0, variationIndex:0, materialCues:{}, typeCues:{}, lastMaterialCue:null,
    cueVariation:{}, promotedMatchVoices:0, completionPromotions:0};
  let muted = false, destroyed = false, pendingGestureCue = null, pendingStartWave = false;
  let currentGroup = null, currentAccent = null, cueGain = 1;
  let duckUntil = 0, duckDepth = 0.26, completionUntil = 0;
  let musicLoopCache = new WeakMap();
  let musicLoopRepair = {applied:false,reason:'Music has not decoded/started'};
  const clock = () => context.currentTime || 0;
  const audible = () => !destroyed && !muted &&
    (offline || (context.state === 'running' &&
      (typeof document === 'undefined' || !document.hidden)));
  const vary = () => [1, 0.985, 1.015, 0.995, 1.008][counts.variationIndex++ % 5];
  function accentFor(name,type) {
    // Per-event/type cycles cannot perturb gameplay randomness or depend on
    // the relative order in which native sample and presentation hooks fire.
    const key=name+':'+(type??'shelf'), index=variations.get(key)||0;
    variations.set(key,index+1);counts.cueVariation[key]=index+1;
    const step=index%5;
    return {pitch:[1,0.986,1.012,0.994,1.007][step],
      duration:[1,0.95,1.035,0.98,1.015][step],
      level:[1,0.95,0.985,0.965,0.99][step],
      offset:[0,0.037,0.079,0.011,0.053][step]};
  }
  const safe = fn => {try {return fn();} catch (_) {counts.errors++; return null;}};
  const smooth = (parameter, value, at, seconds=0.025) => {
    // cancelAndHoldAtTime is not universal in older mobile browsers.
    if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(at);
    else {parameter.cancelScheduledValues(at); parameter.setValueAtTime(parameter.value, at);}
    parameter.linearRampToValueAtTime(value, at + seconds);
  };
  function track(source, nodes, loopKey, cleanup) {
    if (!loopKey && active.size >= 24) {
      counts.capped++;
      nodes.forEach(node=>safe(()=>node.disconnect()));
      return false;
    }
    if (loopKey) loops.set(loopKey, source);
    else {active.add(source); counts.peakVoices=Math.max(counts.peakVoices,active.size);}
    source.onended = () => {
      active.delete(source);
      if (loopKey && loops.get(loopKey) === source) loops.delete(loopKey);
      if (cleanup) cleanup();
      nodes.forEach(node=>safe(()=>node.disconnect()));
    };
    return true;
  }
  function duck(seconds, depth=0.15) {
    const now=clock();
    // An opening shutter must not raise the music in the middle of the final
    // shelf's resolution. Overlapping cues extend the deepest current dip.
    duckDepth=now<duckUntil?Math.min(duckDepth,depth):depth;
    duckUntil=Math.max(duckUntil,now+seconds);
    smooth(music.gain, duckDepth, now, 0.025);
    music.gain.setValueAtTime(duckDepth, duckUntil);
    music.gain.linearRampToValueAtTime(0.26, duckUntil+0.28);
  }
  function seamlessMusic(buffer) {
    // The retained 30.981 s MP3 has a quiet head/tail gap at its loop boundary.
    // A single cached buffer overlaps only its final .400 s with its own head.
    // First playback still begins at the original sample zero; subsequent
    // loops resume after that overlapped head. No timer or second voice needed.
    const cached=musicLoopCache.get(buffer);
    if(cached){musicLoopRepair={...cached.diagnostics};return cached;}
    const rate=buffer.sampleRate,length=buffer.length,channels=buffer.numberOfChannels;
    const duration=length/rate,overlap=Math.floor(rate*0.400);
    if(!Number.isFinite(duration)||duration<30.8||duration>31.2||
      !Number.isInteger(length)||!Number.isFinite(rate)||rate<8000||rate>96000||
      !Number.isInteger(channels)||channels<1||channels>2||overlap<2){
      musicLoopRepair={applied:false,reason:'Unexpected music dimensions; original buffer retained'};
      return {buffer,loopStart:0,loopEnd:buffer.duration};
    }
    const repaired=context.createBuffer(channels,length,rate),start=length-overlap;
    for(let channel=0;channel<channels;channel++){
      const original=buffer.getChannelData(channel),output=repaired.getChannelData(channel);
      output.set(original);
      for(let i=0;i<overlap;i++){
        const angle=(i/(overlap-1))*Math.PI/2;
        output[start+i]=original[start+i]*Math.cos(angle)+original[i]*Math.sin(angle);
      }
    }
    const diagnostics={applied:true,method:'Single-buffer equal-power tail/head overlap',
      overlapSeconds:overlap/rate,overlapFrames:overlap,sampleRate:rate,channels,
      firstPassSeconds:duration,loopSeconds:(length-overlap)/rate,
      sourceFrames:length,additionalMusicVoices:0};
    const result={buffer:repaired,loopStart:overlap/rate,loopEnd:duration,diagnostics};
    musicLoopCache.set(buffer,result);musicLoopRepair={...diagnostics};return result;
  }
  function play(name, loop=false) {
    if (loop) wantedLoops.add(name);
    if (loop && loops.has(name)) return loops.get(name);
    if (!audible()) {if(name==='startWave'&&!muted&&!destroyed)pendingStartWave=true;counts.suppressed++; return null;}
    const buffer=buffers[name];
    if (!buffer) {counts.missing++; return null;}
    return safe(()=>{
      const source=context.createBufferSource(), gain=context.createGain();
      const repaired=name==='music'&&loop?seamlessMusic(buffer):null;
      // AudioBufferSourceNode accepts only one non-null buffer assignment.
      source.buffer=repaired?repaired.buffer:buffer; source.loop=!!loop;
      if(repaired){source.loopStart=repaired.loopStart;source.loopEnd=repaired.loopEnd;}
      gain.gain.value=sampleLevels[name] ?? 0.45;
      // Loop speed and the existing musical samples retain their native pitch.
      if (name==='putDown') source.playbackRate.value=vary();
      source.connect(gain); gain.connect(loop ? music : effects);
      if (!track(source,[source,gain],loop ? name : null)) return null;
      source.start();
      counts.samples[name]=(counts.samples[name]||0)+1;
      if (name==='match') duck(0.48);
      if (name==='soldOut') duck(0.32,0.18);
      return source;
    });
  }

  // A fixed local noise sequence gives cloth/wood texture without reading the
  // game's random stream. Its band-limited use avoids scratchy high frequencies.
  const noise=context.createBuffer(1,Math.ceil(context.sampleRate*0.24),context.sampleRate);
  const data=noise.getChannelData(0);
  let seed=0x4a554943, previous=0;
  for (let i=0;i<data.length;i++) {
    seed^=seed<<13; seed^=seed>>>17; seed^=seed<<5;
    previous=0.68*previous+0.32*((seed>>>0)/2147483648-1);
    data[i]=previous;
  }
  function envelope(gain, peak, at, duration, attack=0.003, shape='impact') {
    peak=Math.max(0.0002,peak*cueGain*(currentAccent?.level??1));
    gain.gain.setValueAtTime(0.0001,at);
    gain.gain.exponentialRampToValueAtTime(peak,at+attack);
    // Physical transients lose most energy early; a separate quiet tail gives
    // metal/glaze resonance without turning every placement into a bell.
    if(shape==='impact'&&duration>0.038)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.00015,peak*0.24),at+Math.min(0.025,duration*0.35));
    gain.gain.exponentialRampToValueAtTime(0.0001,at+duration);
  }
  function trackSynth(source,gain,nodes,at) {
    const group=currentGroup,voice={source,gain,at};
    if(!track(source,nodes,null,()=>{
      if(group){group.voices.delete(voice);if(!group.voices.size)cueGroups.delete(group);}
    }))return false;
    if(group)group.voices.add(voice);
    return true;
  }
  function retireMatchTails() {
    const now=clock();let retired=0;
    for(const group of cueGroups)if(group.name==='match')for(const voice of group.voices){
      safe(()=>smooth(voice.gain.gain,0.0001,now,0.025));
      safe(()=>voice.source.stop(now+0.027));retired++;
    }
    counts.promotedMatchVoices+=retired;
    if(retired)counts.completionPromotions++;
  }
  function tone(hz, duration, level, delay=0, endHz=hz, wave='sine', shape='impact') {
    const at=clock()+delay;
    // Major-event timing is fixed to the real visual event. Routine material
    // decay varies slightly; neither clock nor callback timing is modified.
    if(currentGroup?.name!=='completed'&&currentGroup?.name!=='match')duration*=currentAccent?.duration??1;
    const oscillator=context.createOscillator(), gain=context.createGain();
    oscillator.type=wave;
    oscillator.frequency.setValueAtTime(hz,at);
    oscillator.frequency.exponentialRampToValueAtTime(endHz,at+duration);
    envelope(gain,level,at,duration,shape==='resolve'?0.006:0.003,shape);
    oscillator.connect(gain); gain.connect(effects);
    if (!trackSynth(oscillator,gain,[oscillator,gain],at)) return;
    oscillator.start(at); oscillator.stop(at+duration+0.01);
  }
  function texture(level, duration=0.08, frequency=1300, delay=0, q=0.65) {
    const at=clock()+delay;
    const source=context.createBufferSource(), gain=context.createGain();
    const filter=context.createBiquadFilter();
    source.buffer=noise;
    filter.type='bandpass'; filter.frequency.value=frequency*(currentAccent?.pitch??1); filter.Q.value=q;
    envelope(gain,level,at,duration,0.003,'soft');
    source.connect(filter); filter.connect(gain); gain.connect(effects);
    if (!trackSynth(source,gain,[source,filter,gain],at)) return;
    source.start(at,currentAccent?.offset??0); source.stop(at+duration+0.01);
  }
  function materialContact(profile,pitch) {
    const emit=([hz,duration,level,endHz=hz,delay=0,wave='sine'])=>tone(hz*pitch,duration,level,delay,endHz*pitch,wave);
    if(profile.body)emit(profile.body);
    if(profile.modes)profile.modes.forEach(emit);
    if(profile.surface)texture(...profile.surface);
  }
  function countMaterial(name,detail) {
    const family=counts.materialCues[detail.material]||(counts.materialCues[detail.material]={});
    family[name]=(family[name]||0)+1;
    if(detail.type!==null){
      const item=counts.typeCues[detail.type]||(counts.typeCues[detail.type]={});
      item[name]=(item[name]||0)+1;
    }
    counts.lastMaterialCue={name,type:detail.type,material:detail.material,at:clock()};
  }
  const cooldown={pickup:0.06, reject:0.12, contact:0.045, match:0.10, soldOut:0.10, completed:0.90};
  function cue(name, detail={}) {
    if (!(name in cooldown)) return false;
    // Copy only the immutable type, never retain a mutable item/cell object.
    // The sold-out stamp belongs to its receiving shelf, even after a match.
    const resolved=name==='soldOut'?{type:null,material:'shelf'}:detailFor(detail);
    if (!audible()) {
      counts.suppressed++;
      if (name==='pickup'&&!muted&&!destroyed&&context.state==='suspended'&&(typeof document==='undefined'||!document.hidden)) {pendingGestureCue={name,detail:{type:resolved.type},at:Date.now()};counts.firstGestureQueued=(counts.firstGestureQueued||0)+1;}
      return false;
    }
    const now=clock();
    if (now-(last.get(name) ?? -100)<cooldown[name]) {counts.suppressed++; return false;}
    last.set(name,now);
    const result=safe(()=>{
      currentAccent=accentFor(name,resolved.type);
      currentGroup={name,at:now,voices:new Set()};cueGroups.add(currentGroup);
      const group=currentGroup,pitch=currentAccent.pitch,profile=materialProfiles[resolved.material];
      cueGain=(name==='match'||name==='completed')?1:(now<completionUntil?0.56:1);
      if(name==='soldOut'&&detail?.matched===true)cueGain*=0.76;
      try {switch (name) {
        case 'pickup':
          // A common short upward gesture keeps selection legible; the quieter
          // grip surface distinguishes felt, paper, glaze, metal, and wood.
          tone(profile.lift*pitch,0.060,0.056,0,profile.lift*1.11*pitch,'sine','soft');
          texture(...profile.grip);
          break;
        case 'reject':
          // A forgiving descending pair, never a punitive alarm or reward.
          tone(392*pitch,0.085,0.085,0,360*pitch,'sine','soft');
          tone(294*pitch,0.10,0.072,0.055,270*pitch,'sine','soft');
          texture(0.038,0.065,650);
          break;
        case 'contact':
          // Dry, restrained resonances: soft goods stop quickly; ceramics and
          // metal retain short inharmonic tails. This is authored synthesis,
          // not a claim that these are recordings of physical household goods.
          materialContact(profile,pitch);
          break;
        case 'match':
          // Quiet upper harmonics support, rather than replace, the stock chime.
          tone(784,0.19,0.073,0,784,'sine','resolve');
          tone(988,0.24,0.062,0.036,988,'sine','resolve');
          tone(1175,0.29,0.056,0.078,1175,'sine','resolve');
          // The success motif stays uniform and strongest. A single quiet
          // texture keeps the matched material present without three impacts.
          texture(Math.min(0.065,profile.grip[0]),0.080,profile.grip[2],0.016);
          duck(0.55);
          break;
        case 'soldOut':
          // Physical stamp contact. It confirms a closed shelf, not a victory.
          tone(126*pitch,0.095,0.092,0,89*pitch,'triangle');
          texture(0.085,0.055,820,0,0.75);
          tone(940*pitch,0.037,0.024,0.011,904*pitch);
          break;
        case 'completed':
          // Root alone supplies this after !priorEnd && isGameEnd and the
          // verified final match. Promote that shelf's match; no invented win.
          retireMatchTails();completionUntil=now+0.8;
          tone(444,0.065,0.044,0,412,'triangle');
          // The native shutter opens at +.2 s. Its physical stop and the brass
          // inset resolve together around +.38 s; last voice ends at +.71 s.
          tone(588,0.30,0.092,0.34,588,'sine','resolve');
          tone(784,0.32,0.080,0.38,784,'sine','resolve');
          tone(1562,0.19,0.027,0.382,1558,'sine','resolve');
          tone(118,0.075,0.065,0.38,86,'triangle');
          duck(0.80,0.12);
          break;
      }} finally {
        if(!group.voices.size)cueGroups.delete(group);
        currentGroup=null;currentAccent=null;cueGain=1;
      }
      counts.cues[name]=(counts.cues[name]||0)+1;
      countMaterial(name,resolved);
      return true;
    });
    return result===true;
  }
  function resumeLoops() {
    if (audible()) {
      for (const name of wantedLoops) if (!loops.has(name)) play(name,true);
      if(pendingStartWave){pendingStartWave=false;play('startWave');}
      const pending=pendingGestureCue;pendingGestureCue=null;
      if(pending&&Date.now()-pending.at<250){cue(pending.name,pending.detail);counts.firstGestureRecovered=(counts.firstGestureRecovered||0)+1;}
    }
  }
  function setMuted(value) {
    muted=!!value;if(muted){pendingGestureCue=null;pendingStartWave=false;}
    safe(()=>smooth(master.gain,muted?0:0.72,clock(),0.018));
    if (!muted) resumeLoops();
  }
  if (typeof context.addEventListener==='function') context.addEventListener('statechange',resumeLoops);
  if (typeof document!=='undefined') document.addEventListener('visibilitychange',resumeLoops);
  return {
    play, cue, setMuted,
    // A gameplay recorder can receive the exact post-mix output. The normal
    // speaker connection stays intact; the returned function removes its tap.
    connectCapture(destination) {
      master.connect(destination);
      return ()=>safe(()=>master.disconnect(destination));
    },
    diagnostics:()=>({available:true, muted, state:context.state, activeVoices:active.size,
      activeLoops:[...loops.keys()], wantedLoops:[...wantedLoops], ...counts,
      samples:{...counts.samples}, cues:{...counts.cues},
      materialCues:Object.fromEntries(Object.entries(counts.materialCues).map(([key,value])=>[key,{...value}])),
      typeCues:Object.fromEntries(Object.entries(counts.typeCues).map(([key,value])=>[key,{...value}])),
      lastMaterialCue:counts.lastMaterialCue?{...counts.lastMaterialCue}:null,
      cueVariation:{...counts.cueVariation}, activeCueGroups:cueGroups.size,
      completionActive:clock()<completionUntil, duckUntil,
      musicLoopRepair:{...musicLoopRepair},
      materialByType:[...materialByType]}),
    destroy() {
      destroyed=true; wantedLoops.clear();
      [...active,...loops.values()].forEach(source=>safe(()=>source.stop()));
      active.clear(); loops.clear();cueGroups.clear();musicLoopCache=new WeakMap();
      if (typeof context.removeEventListener==='function') context.removeEventListener('statechange',resumeLoops);
      if (typeof document!=='undefined') document.removeEventListener('visibilitychange',resumeLoops);
      [master,music,effects,compressor].forEach(node=>safe(()=>node.disconnect()));
    }
  };
}
