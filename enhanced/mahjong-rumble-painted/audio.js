/**
 * Mahjong Rumble — ceramic table sound design, v1.
 * Self-contained physical/modal Foley and restrained musical reward accents.
 * No gameplay state or shared Math.random is read or changed. There is no loop
 * or replacement music here: retain the source music through its original path.
 */

const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const finite = (x, fallback) => Number.isFinite(x) ? x : fallback;

/** Rendered once, before interaction; also available for offline waveform QA. */
export function buildMahjongSoundBank(sampleRate = 44100) {
  sampleRate = Math.round(clamp(finite(sampleRate, 44100), 8000, 192000));
  let seed = 0x6d61686a;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const make = seconds => new Float32Array(Math.ceil(sampleRate * seconds));
  function mode(out, offset, frequency, duration, level, material = 'ceramic') {
    const start = Math.round(offset * sampleRate);
    const modes = material === 'wood'
      ? [[1, 1, 1], [1.81, .24, .56], [3.02, .12, .32]]
      : material === 'bell'
        ? [[1, 1, 1], [2.001, .18, .68], [3.98, .055, .36]]
        : [[1, 1, 1], [2.32, .27, .55], [3.91, .10, .29], [5.62, .035, .18]];
    const length = Math.min(out.length - start, Math.ceil(duration * sampleRate));
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const attack = 1 - Math.exp(-t / (material === 'bell' ? .0038 : .0013));
      const tail = Math.min(1, (length - i) / (sampleRate * .014));
      let value = 0;
      for (const [ratio, weight, damping] of modes) {
        // Upper material modes die sooner; a tiny pitch relaxation softens the strike.
        const phase = TAU * frequency * ratio * (t + .000018 * (1 - Math.exp(-t * 85)));
        value += Math.sin(phase) * weight * Math.exp(-t * 6.5 / (duration * damping));
      }
      out[start + i] += level * value * attack * tail;
    }
  }
  function contact(out, offset, duration, level, cutoff = 3200) {
    const start = Math.round(offset * sampleRate);
    const length = Math.min(out.length - start, Math.ceil(duration * sampleRate));
    const a = 1 - Math.exp(-TAU * cutoff / sampleRate);
    let low = 0, dc = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      low += a * ((random() * 2 - 1) - low);
      dc += .025 * (low - dc);
      const attack = Math.min(1, t / .0014);
      const end = Math.min(1, (length - i) / (sampleRate * .006));
      out[start + i] += (low - dc) * level * attack * end * Math.exp(-t * 7 / duration);
    }
  }
  function finish(out, peak) {
    let max = 0;
    for (const x of out) max = Math.max(max, Math.abs(x));
    const gain = max > 0 ? peak / max : 1;
    for (let i = 0; i < out.length; i++) out[i] *= gain;
    // Guaranteed silent endpoints prevent discontinuities in repeated taps.
    const fade = Math.min(Math.ceil(sampleRate * .008), out.length);
    for (let i = 0; i < fade; i++) out[out.length - fade + i] *= 1 - i / (fade - 1);
    out[0] = 0; out[out.length - 1] = 0;
    return out;
  }
  const bank = {};
  bank.tap = [0, 1, 2, 3].map(v => {
    const out = make(.19);
    mode(out, 0, 1090 * [1, 1.018, .984, 1.009][v], .17, .27);
    mode(out, .001, 238 + v * 5, .075, .14, 'wood');
    contact(out, 0, .026, .14, 2800);
    return finish(out, .73);
  });
  bank.mismatch = [0, 1].map(v => {
    const out = make(.28);
    mode(out, 0, 360 + v * 7, .14, .19, 'wood');
    mode(out, .085, 278 + v * 5, .15, .14, 'wood');
    contact(out, 0, .036, .075, 1500);
    contact(out, .085, .028, .05, 1250);
    return finish(out, .66);
  });
  bank.match = [0, 1].map(v => {
    const out = make(.88);
    for (const [i, f] of [523.251, 659.255, 783.991].entries()) {
      mode(out, i * .045, f, .70, .13 - i * .008, 'bell');
      mode(out, i * .045, 1160 * (1 + .012 * v), .10, .045);
      contact(out, i * .045, .018, .03, 3300);
    }
    mode(out, 0, 261.626, .20, .065, 'wood');
    return finish(out, .78);
  });
  bank.settle = [0, 1, 2, 3].map(v => {
    const out = make(.15);
    mode(out, 0, 720 + v * 22, .105, .14);
    mode(out, .003, 178 + v * 4, .09, .11, 'wood');
    contact(out, 0, .033, .13, 2100);
    contact(out, .021 + v * .001, .018, .045, 1700);
    return finish(out, .64);
  });
  bank.winnings = [0, 1, 2].map(v => {
    const out = make(.38);
    mode(out, 0, [1046.502, 1318.51, 1567.982][v], .31, .15, 'bell');
    mode(out, .014, 783.991, .23, .035, 'bell');
    contact(out, 0, .016, .022, 2300);
    return finish(out, .62);
  });
  bank.final = [0].map(() => {
    const out = make(1.65);
    for (const [i, f] of [523.251, 659.255, 783.991, 1046.502].entries()) {
      mode(out, i * .095, f, 1.20 - i * .08, .115, 'bell');
      contact(out, i * .095, .016, .012, 2000);
    }
    mode(out, .285, 261.626, 1.1, .05, 'bell');
    mode(out, .285, 392, 1.1, .035, 'bell');
    return finish(out, .82);
  });
  return { sampleRate, bank };
}

/**
 * createMahjongAudio(existingAudioContext)
 * x is normalized horizontal position (-1…1), strength is 0…1.
 * Call unlock() from the original pointer handler before play().
 * Exposed master is post-mute/post-compressor, and can feed a recorder.
 */
export function createMahjongAudio(context) {
  if (!context || typeof context.createGain !== 'function') {
    return {
      unlock: async () => false, setMuted: () => true, isMuted: () => true,
      play: () => false, stop: () => {}, dispose: () => {}, master: null,
      connectOutput: () => null,
      diagnostics: () => ({ ready: false, unavailable: true, errors: [], byEvent: {} })
    };
  }
  const input = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const master = context.createGain();
  const roomInput = context.createGain();
  const reflectionA = context.createDelay(.2);
  const reflectionB = context.createDelay(.2);
  const roomFilter = context.createBiquadFilter();
  const roomGainA = context.createGain();
  const roomGainB = context.createGain();
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 5;
  compressor.attack.value = .003;
  compressor.release.value = .12;
  master.gain.value = .72;
  input.connect(compressor).connect(master).connect(context.destination);
  // Two dark early reflections, without a feedback loop or long reverb wash.
  roomFilter.type = 'lowpass'; roomFilter.frequency.value = 2600; roomFilter.Q.value = .5;
  reflectionA.delayTime.value = .033; reflectionB.delayTime.value = .067;
  roomGainA.gain.value = .055; roomGainB.gain.value = .025;
  roomInput.connect(roomFilter);
  roomFilter.connect(reflectionA).connect(roomGainA).connect(input);
  roomFilter.connect(reflectionB).connect(roomGainB).connect(input);

  const rendered = buildMahjongSoundBank(context.sampleRate);
  const buffers = {};
  for (const [name, variations] of Object.entries(rendered.bank)) {
    buffers[name] = variations.map(data => {
      const buffer = context.createBuffer(1, data.length, rendered.sampleRate);
      buffer.copyToChannel(data, 0); return buffer;
    });
  }
  const levels = { tap: .24, mismatch: .23, match: .39, settle: .19, winnings: .18, final: .48 };
  const gaps = { tap: .035, mismatch: .16, match: .12, settle: .045, winnings: .07, final: .8 };
  const aliases = { select: 'tap', invalid: 'mismatch', success: 'match', contact: 'settle', reward: 'winnings', complete: 'final' };
  let muted = false, disposed = false, unlocked = context.state === 'running';
  let serial = 0, lastFinal = -Infinity;
  const active = new Map(), last = new Map(), variants = new Map(), recent = [];
  const stats = { requested: 0, played: 0, muted: 0, throttled: 0, locked: 0, unknown: 0,
    peakVoices: 0, stopped: 0, byEvent: {}, errors: [] };
  function record(event, extra = {}) {
    recent.push({ event, at: Number(context.currentTime.toFixed(4)), ...extra });
    if (recent.length > 80) recent.shift();
  }
  function stop() {
    for (const [source, item] of active) {
      try {
        const now = context.currentTime;
        item.gain.gain.cancelScheduledValues(now);
        item.gain.gain.setTargetAtTime(0, now, .006);
        source.stop(now + .025);
      } catch (_) { /* Already ended. */ }
    }
    last.clear(); variants.clear(); lastFinal = -Infinity; stats.stopped++;
  }
  function setMuted(value) {
    muted = Boolean(value);
    if (disposed || context.state === 'closed') return muted;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(muted ? 0 : .72, now, .008);
    if (muted) stop();
    return muted;
  }
  async function unlock() {
    if (disposed || context.state === 'closed') return false;
    // Set synchronously so the gesture's first cue can be scheduled during resume.
    unlocked = true;
    try { if (context.state !== 'running' && context.resume) await context.resume(); return true; }
    catch (error) { stats.errors.push(String(error)); unlocked = false; return false; }
  }
  function play(requestedName, options = {}) {
    stats.requested++;
    const name = aliases[requestedName] || requestedName;
    if (!buffers[name]) { stats.unknown++; return false; }
    if (disposed || context.state === 'closed') return false;
    if (muted) { stats.muted++; return false; }
    if (!unlocked) { stats.locked++; return false; }
    const now = context.currentTime;
    // Limit simultaneous arrival sounds and suppress ordinary cues under the finale.
    if (now - (last.get(name) ?? -Infinity) < gaps[name] ||
        (name !== 'final' && now - lastFinal < .18) || active.size >= 12) {
      stats.throttled++; return false;
    }
    const strength = clamp(finite(options.strength, 1), 0, 1);
    if (strength === 0) return false;
    const variantIndex = Number.isInteger(options.variant) ? Math.abs(options.variant) : (variants.get(name) || 0);
    const variant = variantIndex % buffers[name].length;
    const buffer = buffers[name][variant];
    const source = context.createBufferSource();
    const gain = context.createGain();
    const pan = context.createStereoPanner ? context.createStereoPanner() : context.createGain();
    const x = clamp(finite(options.x, 0), -1, 1);
    source.buffer = buffer;
    // Subtle alternating detune only for physical contacts, never reward pitches.
    source.playbackRate.value = name === 'tap' || name === 'settle' ? [1, .992, 1.007, .997][serial % 4] : 1;
    if (pan.pan) pan.pan.value = x * .42;
    gain.gain.value = levels[name] * strength;
    source.connect(gain).connect(pan).connect(input);
    pan.connect(roomInput);
    const entry = { gain, pan, name };
    source.onended = () => {
      active.delete(source);
      source.disconnect(); gain.disconnect(); pan.disconnect();
    };
    try {
      source.start(now);
      active.set(source, entry);
      serial++; variants.set(name, variantIndex + 1); last.set(name, now);
      if (name === 'final') lastFinal = now;
      stats.played++; stats.byEvent[name] = (stats.byEvent[name] || 0) + 1;
      stats.peakVoices = Math.max(stats.peakVoices, active.size);
      record(name, { variant, pan: Number((x * .42).toFixed(3)), strength });
      return true;
    } catch (error) {
      source.disconnect(); gain.disconnect(); pan.disconnect();
      stats.errors.push(String(error)); return false;
    }
  }
  function dispose() {
    if (disposed) return;
    stop(); disposed = true;
    for (const node of [input, compressor, master, roomInput, roomFilter, reflectionA, reflectionB, roomGainA, roomGainB]) {
      try { node.disconnect(); } catch (_) { /* Idempotent teardown. */ }
    }
  }
  return {
    unlock, setMuted, isMuted: () => muted, play, stop, dispose, master,
    connectOutput(destination) { if (destination && !disposed) master.connect(destination); return master; },
    diagnostics: () => ({
      ...stats, byEvent: { ...stats.byEvent }, errors: [...stats.errors],
      ready: !disposed, state: context.state, muted, unlocked, activeVoices: active.size,
      sampleRate: context.sampleRate, masterGain: .72,
      compressorReduction: compressor.reduction,
      source: 'Original game-specific modal ceramic/wood Foley and tonal accents; no generated sample or replacement music',
      gameplayRandomUntouched: true, recent: recent.map(x => ({ ...x }))
    })
  };
}

if (typeof window !== 'undefined') window.createMahjongAudio = createMahjongAudio;
