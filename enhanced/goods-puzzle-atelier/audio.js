/* Goods Puzzle Atelier — retained recordings and material-specific accents.
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
  const sampleLevels = {music:1, startWave:0.36, putDown:0.30, match:0.62, soldOut:0.52};
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
    // contact tuples: [frequency, decay, level, finalFrequency, delay].
    // A maximum of three sources per contact stays within the v1 voice budget.
    textile: {lift:530, grip:[0.075,0.065,800],
      body:[125,0.075,0.078,82], surface:[0.115,0.080,780]},
    paper: {lift:650, grip:[0.085,0.045,1850],
      body:[235,0.048,0.062,175], surface:[0.155,0.055,1950]},
    ceramic: {lift:815, grip:[0.040,0.030,2400],
      modes:[[1180,0.145,0.057,1165],[2710,0.068,0.021,2670,0.002]], surface:[0.075,0.025,2850]},
    metal: {lift:745, grip:[0.038,0.032,1900],
      body:[148,0.078,0.067,112], modes:[[840,0.190,0.050,831],[1932,0.100,0.024,1913,0.002]]},
    food: {lift:590, grip:[0.050,0.040,1180],
      body:[165,0.052,0.047,135], surface:[0.065,0.043,1320]},
    wood: {lift:605, grip:[0.065,0.038,1100],
      body:[225,0.074,0.105,165], surface:[0.095,0.042,1230]},
    leather: {lift:505, grip:[0.080,0.077,650],
      body:[135,0.076,0.073,92], surface:[0.105,0.095,630]},
    paintedwood: {lift:635, grip:[0.055,0.038,1320],
      body:[285,0.069,0.091,210], surface:[0.076,0.047,1470]},
    plastic: {lift:705, grip:[0.048,0.033,1550],
      body:[315,0.058,0.080,235], modes:[[610,0.056,0.026,570,0.004]], surface:[0.095,0.035,1660]},
    wax: {lift:555, grip:[0.045,0.050,760],
      body:[190,0.070,0.071,152], surface:[0.052,0.055,710]},
    shelf: {lift:620, grip:[0.060,0.050,1350],
      body:[175,0.080,0.090,110], modes:[[880,0.065,0.025,760,0.005]], surface:[0.095,0.055,1100]}
  };
  const detailFor = detail => {
    const type=Number.isInteger(detail?.type)&&detail.type>0&&detail.type<materialByType.length?detail.type:null;
    return {type,material:type===null?'shelf':materialByType[type]};
  };
  const active = new Set(), loops = new Map(), wantedLoops = new Set(), last = new Map();
  const counts = {samples:{}, cues:{}, missing:0, suppressed:0, capped:0, peakVoices:0,
    errors:0, variationIndex:0, materialCues:{}, typeCues:{}, lastMaterialCue:null};
  let muted = false, destroyed = false, pendingGestureCue = null, pendingStartWave = false;
  const clock = () => context.currentTime || 0;
  const audible = () => !destroyed && !muted &&
    (offline || (context.state === 'running' &&
      (typeof document === 'undefined' || !document.hidden)));
  const vary = () => [1, 0.985, 1.015, 0.995, 1.008][counts.variationIndex++ % 5];
  const safe = fn => {try {return fn();} catch (_) {counts.errors++; return null;}};
  const smooth = (parameter, value, at, seconds=0.025) => {
    // cancelAndHoldAtTime is not universal in older mobile browsers.
    if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(at);
    else {parameter.cancelScheduledValues(at); parameter.setValueAtTime(parameter.value, at);}
    parameter.linearRampToValueAtTime(value, at + seconds);
  };
  function track(source, nodes, loopKey) {
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
      nodes.forEach(node=>safe(()=>node.disconnect()));
    };
    return true;
  }
  function duck(seconds, depth=0.15) {
    const now=clock();
    smooth(music.gain, depth, now, 0.025);
    music.gain.setValueAtTime(depth, now+seconds);
    music.gain.linearRampToValueAtTime(0.26, now+seconds+0.28);
  }
  function play(name, loop=false) {
    if (loop) wantedLoops.add(name);
    if (loop && loops.has(name)) return loops.get(name);
    if (!audible()) {if(name==='startWave'&&!muted&&!destroyed)pendingStartWave=true;counts.suppressed++; return null;}
    const buffer=buffers[name];
    if (!buffer) {counts.missing++; return null;}
    return safe(()=>{
      const source=context.createBufferSource(), gain=context.createGain();
      source.buffer=buffer; source.loop=!!loop;
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
  function envelope(gain, peak, at, duration, attack=0.005) {
    gain.gain.setValueAtTime(0.0001,at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002,peak),at+attack);
    gain.gain.exponentialRampToValueAtTime(0.0001,at+duration);
  }
  function tone(hz, duration, level, delay=0, endHz=hz, wave='sine') {
    const at=clock()+delay;
    const oscillator=context.createOscillator(), gain=context.createGain();
    oscillator.type=wave;
    oscillator.frequency.setValueAtTime(hz,at);
    oscillator.frequency.exponentialRampToValueAtTime(endHz,at+duration);
    envelope(gain,level,at,duration);
    oscillator.connect(gain); gain.connect(effects);
    if (!track(oscillator,[oscillator,gain],null)) return;
    oscillator.start(at); oscillator.stop(at+duration+0.01);
  }
  function texture(level, duration=0.08, frequency=1300, delay=0) {
    const at=clock()+delay;
    const source=context.createBufferSource(), gain=context.createGain();
    const filter=context.createBiquadFilter();
    source.buffer=noise;
    filter.type='bandpass'; filter.frequency.value=frequency; filter.Q.value=0.65;
    envelope(gain,level,at,duration,0.003);
    source.connect(filter); filter.connect(gain); gain.connect(effects);
    if (!track(source,[source,filter,gain],null)) return;
    source.start(at); source.stop(at+duration+0.01);
  }
  function materialContact(profile,pitch) {
    const emit=([hz,duration,level,endHz=hz,delay=0])=>tone(hz*pitch,duration,level,delay,endHz*pitch);
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
  const cooldown={pickup:0.06, reject:0.12, contact:0.045, match:0.10, soldOut:0.10};
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
      const pitch=vary(),profile=materialProfiles[resolved.material];
      switch (name) {
        case 'pickup':
          // A common short upward gesture keeps selection legible; the quieter
          // grip surface distinguishes felt, paper, glaze, metal, and wood.
          tone(profile.lift*pitch,0.064,0.072,0,profile.lift*1.14*pitch);
          texture(...profile.grip);
          break;
        case 'reject':
          // A forgiving descending pair, never a punitive alarm or reward.
          tone(392*pitch,0.10,0.11,0,360*pitch);
          tone(294*pitch,0.12,0.095,0.07,270*pitch);
          texture(0.045,0.08,650);
          break;
        case 'contact':
          // Dry, restrained resonances: soft goods stop quickly; ceramics and
          // metal retain short inharmonic tails. This is authored synthesis,
          // not a claim that these are recordings of physical household goods.
          materialContact(profile,pitch);
          break;
        case 'match':
          // Quiet upper harmonics support, rather than replace, the stock chime.
          tone(784,0.29,0.075);
          tone(988,0.32,0.065,0.055);
          tone(1175,0.38,0.055,0.11);
          // The success motif stays uniform and strongest. A single quiet
          // texture keeps the matched material present without three impacts.
          texture(Math.min(0.075,profile.grip[0]),0.12,profile.grip[2],0.035);
          duck(0.55);
          break;
        case 'soldOut':
          // Physical stamp contact. It confirms a closed shelf, not a victory.
          tone(126*pitch,0.12,0.115,0,83*pitch);
          texture(0.12,0.075,900);
          tone(1568,0.22,0.025,0.035);
          break;
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
      materialByType:[...materialByType]}),
    destroy() {
      destroyed=true; wantedLoops.clear();
      [...active,...loops.values()].forEach(source=>safe(()=>source.stop()));
      active.clear(); loops.clear();
      if (typeof context.removeEventListener==='function') context.removeEventListener('statechange',resumeLoops);
      if (typeof document!=='undefined') document.removeEventListener('visibilitychange',resumeLoops);
      [master,music,effects,compressor].forEach(node=>safe(()=>node.disconnect()));
    }
  };
}
