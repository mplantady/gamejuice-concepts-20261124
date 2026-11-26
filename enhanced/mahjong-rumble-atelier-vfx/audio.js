/**
 * Mahjong Rumble — Jade Atelier VFX-pass sound routing.
 * Purpose-authored modal ceramic/jade impacts with dark lacquer-body resonance.
 * Physical contacts lead; compact pitched accents identify verified progress.
 * The result-panel landing reuses a quiet existing material contact, not a reward.
 * No gameplay state or shared Math.random is read or changed. Source music remains
 * on its existing path. These cues are synthesized Foley, not recorded samples.
 */

const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const finite = (x, fallback) => Number.isFinite(x) ? x : fallback;

/** Built before the first action; deterministic, independent of gameplay RNG. */
export function buildMahjongSoundBank(sampleRate = 44100) {
  sampleRate = Math.round(clamp(finite(sampleRate, 44100), 8000, 192000));
  let seed = 0x6174656c;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const make = seconds => new Float32Array(Math.ceil(sampleRate * seconds));
  const materials = {
    // Broad, quickly damped upper modes keep tiny physical strikes from becoming bells.
    jade: [[1, 1, 1], [1.537, .29, .59], [2.287, .19, .34], [3.746, .068, .19]],
    lacquer: [[1, 1, 1], [1.78, .36, .49], [2.93, .17, .24], [4.21, .055, .15]],
    // Felt-like pitched body is reserved for verified match/arrival/ending accents.
    mallet: [[1, 1, 1], [2.006, .17, .48], [3.981, .035, .21]],
  };
  function mode(out, offset, frequency, duration, level, material = 'jade') {
    const start = Math.round(offset * sampleRate);
    const length = Math.min(out.length - start, Math.ceil(duration * sampleRate));
    const modes = materials[material];
    const attackTime = material === 'mallet' ? .0044 : .00065;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const attack = 1 - Math.exp(-t / attackTime);
      const tail = Math.min(1, (length - i) / (sampleRate * .012));
      let value = 0;
      for (const [ratio, weight, damping] of modes) {
        const f = frequency * ratio;
        // Remove modes beyond Nyquist rather than aliasing at low sample rates.
        if (f >= sampleRate * .45) continue;
        const relax = material === 'mallet' ? .000006 : .000024;
        const phase = TAU * f * (t + relax * (1 - Math.exp(-t * 100)));
        const decay = Math.exp(-t * 7.2 / (duration * damping));
        value += Math.sin(phase) * weight * decay;
      }
      out[start + i] += level * value * attack * tail;
    }
  }
  function contact(out, offset, duration, level, lowCut = 430, highCut = 4200) {
    const start = Math.round(offset * sampleRate);
    const length = Math.min(out.length - start, Math.ceil(duration * sampleRate));
    const hi = 1 - Math.exp(-TAU * Math.min(highCut, sampleRate * .4) / sampleRate);
    const lo = 1 - Math.exp(-TAU * Math.min(lowCut, sampleRate * .2) / sampleRate);
    let high = 0, low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = random() * 2 - 1;
      high += hi * (noise - high);
      low += lo * (high - low);
      const attack = Math.min(1, t / .0008);
      const end = Math.min(1, (length - i) / (sampleRate * .004));
      out[start + i] += (high - low) * level * attack * end * Math.exp(-t * 6.3 / duration);
    }
  }
  function strike(out, at, pitch, weight, variant = 0, soft = false) {
    mode(out, at, pitch, soft ? .112 : .162, weight * .64);
    mode(out, at + .0011, 176 + variant * 3.2, .092, weight * .36, 'lacquer');
    contact(out, at, soft ? .018 : .012, weight * (soft ? .18 : .30), 520, soft ? 2500 : 4700);
    // A tiny nonuniform second contact gives a tile a hard face and mass.
    const rebound = .0084 + (variant % 3) * .0017;
    contact(out, at + rebound, .011, weight * .048, 600, 3000);
    mode(out, at + rebound, pitch * .996, .054, weight * .055);
  }
  function finish(out, peak) {
    let max = 0;
    for (const x of out) max = Math.max(max, Math.abs(x));
    const gain = max > 0 ? peak / max : 1;
    for (let i = 0; i < out.length; i++) out[i] *= gain;
    const fade = Math.min(Math.ceil(sampleRate * .008), out.length);
    for (let i = 0; i < fade; i++) out[out.length - fade + i] *= 1 - i / (fade - 1);
    out[0] = 0; out[out.length - 1] = 0;
    return out;
  }
  const bank = {};
  bank.tap = [0, 1, 2, 3, 4, 5].map(v => {
    const out = make(.19);
    strike(out, 0, [1148, 1171, 1126, 1159, 1137, 1165][v], .37, v);
    return finish(out, .72);
  });
  bank.mismatch = [0, 1].map(v => {
    const out = make(.22);
    mode(out, 0, 237 + v * 5, .096, .23, 'lacquer');
    contact(out, 0, .025, .065, 160, 1300);
    // A short closing knock communicates rejection without a comic failure alarm.
    mode(out, .058, 194 + v * 4, .096, .125, 'lacquer');
    contact(out, .058, .019, .034, 140, 1100);
    return finish(out, .66);
  });
  bank.match = [0, 1, 2].map(v => {
    const out = make(.78);
    for (const [i, at] of [0, .032, .074].entries()) {
      strike(out, at, [1108, 1186, 1264][i] * (1 + v * .004), .16 - i * .014, (v + i) % 6, true);
    }
    // A compact D/A/E colour opens beneath the physical three-tile contact.
    mode(out, .026, 293.665, .43, .044, 'mallet');
    mode(out, .055, 440, .59, .068, 'mallet');
    mode(out, .084, 659.255, .59, .059, 'mallet');
    return finish(out, .76);
  });
  bank.settle = [0, 1, 2, 3].map(v => {
    const out = make(.18);
    strike(out, 0, 756 + v * 19, .26, v, true);
    mode(out, .002, 132 + v * 2.3, .105, .102, 'lacquer');
    contact(out, .019 + v * .0013, .016, .045, 230, 1700);
    return finish(out, .65);
  });
  bank.winnings = [0, 1, 2].map(v => {
    const out = make(.34);
    const frequency = [880, 987.767, 1174.659][v];
    mode(out, 0, frequency, .29, .14, 'mallet');
    mode(out, 0, 440, .11, .036, 'lacquer');
    contact(out, 0, .009, .026, 900, 3800);
    return finish(out, .60);
  });
  bank.final = [0].map(() => {
    const out = make(1.48);
    // Only the real fourth-match ad ending receives this widest/longest resolution.
    for (const [i, f] of [293.665, 440, 587.33, 880].entries()) {
      const at = i * .073;
      mode(out, at, f, 1.10 - i * .10, .105 - i * .006, 'mallet');
      if (i < 3) strike(out, at, 1200 + i * 52, .032, i, true);
    }
    mode(out, .219, 146.832, .80, .034, 'lacquer');
    mode(out, .219, 659.255, .79, .031, 'mallet');
    return finish(out, .81);
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
  roomFilter.type = 'lowpass'; roomFilter.frequency.value = 1800; roomFilter.Q.value = .5;
  reflectionA.delayTime.value = .019; reflectionB.delayTime.value = .041;
  roomGainA.gain.value = .035; roomGainB.gain.value = .014;
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
  // Same 19 authored PCM buffers as V2: panel adds no sample or reward.
  // Its once-per-popup trigger belongs to the real panel-completion callback;
  // this debounce also rejects accidental duplicate scheduling in that transition.
  buffers.panel = [buffers.settle[0]];
  const levels = { tap: .26, mismatch: .21, match: .39, settle: .22, winnings: .17, final: .50, panel: .12 };
  const gaps = { tap: .035, mismatch: .16, match: .12, settle: .045, winnings: .07, final: .8, panel: .8 };
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
      source: 'Jade Atelier VFX pass: unchanged 19 authored ceramic/jade and lacquer PCM variants; quiet panel contact reuses settle[0]; synthesized, not recorded samples; source music retained',
      gameplayRandomUntouched: true, recent: recent.map(x => ({ ...x }))
    })
  };
}

if (typeof window !== 'undefined') window.createMahjongAudio = createMahjongAudio;
