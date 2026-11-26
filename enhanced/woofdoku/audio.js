/* Woofdoku: restrained, deterministic sound layers. The original game cues remain primary.
 * No game state, timer or global random source is read or changed by this module.
 * The same PCM renderer produces the offline listening reference and runtime buffers. */
(function (host) {
  'use strict';
  const VERSION = 'woofdoku-audio-1';
  const names = ['mark', 'unmark', 'place', 'invalid', 'complete', 'fail'];
  const durations = { mark: .19, unmark: .22, place: .95, invalid: .54, complete: 2.1, fail: 1.15 };
  const cooldowns = { mark: 65, unmark: 65, place: 85, invalid: 180, complete: 1600, fail: 1600 };
  const TAU = Math.PI * 2;

  // Damped partials give wood and felt/celesta tones a rounded attack and a finite tail.
  function renderCue(type, sampleRate = 44100) {
    if (!names.includes(type)) throw new Error('Unknown Woofdoku cue: ' + type);
    const length = Math.ceil(durations[type] * sampleRate);
    const mono = new Float32Array(length);
    let seed = 3917;
    const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    const note = (at, frequency, gain, decay, material = 'felt', glide = 0) => {
      const partials = material === 'wood' ? [[1, 1], [1.497, .31], [2.71, .13]] : [[1, 1], [2, .17], [3, .045], [4.01, .019]];
      const begin = Math.floor(at * sampleRate);
      for (let i = begin; i < length; i++) {
        const t = (i - begin) / sampleRate;
        const attack = Math.min(1, t / (material === 'wood' ? .002 : .009));
        let value = 0;
        for (let p = 0; p < partials.length; p++) {
          const [ratio, amount] = partials[p];
          if (frequency * ratio > sampleRate * .4) continue;
          const phase = TAU * ratio * (frequency * t + glide * t * t * .5);
          value += Math.sin(phase) * amount * Math.exp(-t / (decay / (1 + p * .6)));
        }
        mono[i] += value * gain * attack;
      }
    };
    const paper = (at, gain, duration) => {
      const begin = Math.floor(at * sampleRate), end = Math.min(length, begin + Math.floor(duration * sampleRate));
      let low = 0, previous = 0;
      for (let i = begin; i < end; i++) {
        const t = (i - begin) / sampleRate, p = t / duration;
        low += (noise() - low) * .12;
        const high = low - previous; previous = low;
        mono[i] += high * gain * Math.sin(Math.PI * p) ** 2;
      }
    };
    if (type === 'mark') { note(0, 640, .068, .027, 'wood'); paper(0, .04, .045); }
    if (type === 'unmark') { note(0, 440, .052, .035, 'wood'); paper(0, .025, .055); }
    if (type === 'place') {
      note(0, 420, .052, .04, 'wood');
      note(.035, 659.255, .041, .18); note(.11, 783.991, .028, .22);
      paper(.015, .07, .22);
    }
    if (type === 'invalid') {
      note(0, 220, .064, .105, 'felt', -70); note(.045, 174.614, .024, .12);
      paper(.005, .055, .1);
    }
    if (type === 'complete') {
      note(0, 261.626, .047, .5);
      [523.251, 659.255, 783.991, 1046.502].forEach((f, i) => note([0, .11, .23, .39][i], f, [.058, .049, .044, .032][i], .42 + i * .025));
      paper(.03, .07, .46);
    }
    if (type === 'fail') {
      [391.995, 329.628, 261.626].forEach((f, i) => note(i * .14, f, .035, .24));
    }
    // Quiet short reflections. These are baked into the finite cue so a mute/reset
    // cannot leave an orphaned reverb node sounding after the action has ended.
    const left = new Float32Array(length), right = new Float32Array(length);
    const reflections = type === 'mark' || type === 'unmark' ? [] : [[.047, .085], [.083, .057], [.139, .034], [.223, .021]];
    for (let i = 0; i < length; i++) {
      let l = mono[i], r = mono[i];
      for (let j = 0; j < reflections.length; j++) {
        const [delay, gain] = reflections[j];
        const a = i - Math.round(delay * sampleRate), b = i - Math.round((delay + .007) * sampleRate);
        if (a >= 0) l += mono[a] * gain;
        if (b >= 0) r += mono[b] * gain;
      }
      const tail = Math.min(1, (length - i) / Math.max(1, sampleRate * .025));
      left[i] = l * tail; right[i] = r * tail;
    }
    return [left, right];
  }

  let context = null, master = null, muted = false, platformMuted = false, volume = .8, sequence = 0;
  let played = 0, dropped = 0, error = null;
  const buffers = new Map(), active = new Set(), last = new Map(), history = [];
  const now = () => host.performance ? host.performance.now() : Date.now();
  function ensure() {
    if (context) return context;
    const Ctor = host.AudioContext || host.webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor({ latencyHint: 'interactive' });
      master = context.createGain(); master.gain.value = (muted || platformMuted) ? 0 : volume;
      master.connect(context.destination);
      for (const name of names) {
        const data = renderCue(name, context.sampleRate);
        const buffer = context.createBuffer(2, data[0].length, context.sampleRate);
        buffer.copyToChannel(data[0], 0); buffer.copyToChannel(data[1], 1);
        buffers.set(name, buffer);
      }
    } catch (e) { error = String(e); return null; }
    return context;
  }
  function unlock() {
    const ctx = ensure();
    if (!ctx) return Promise.resolve(false);
    return (ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()).then(() => ctx.state === 'running').catch(e => { error = String(e); return false; });
  }
  function stopVoices() {
    for (const source of active) { try { source.stop(); } catch (_) {} }
    active.clear();
  }
  function setMuted(value) {
    muted = Boolean(value);
    if (muted) stopVoices();
    if (master) master.gain.setValueAtTime((muted || platformMuted) ? 0 : volume, context.currentTime);
    return muted;
  }
  function event(type, options = {}) {
    if (!names.includes(type)) return false;
    const timestamp = now();
    if (muted || platformMuted || (host.document && host.document.hidden) || timestamp - (last.get(type) ?? -Infinity) < cooldowns[type]) { dropped++; return false; }
    const ctx = ensure();
    // A browser that has not unlocked audio simply skips the cue; it never queues
    // stale feedback to play during a later touch.
    if (!ctx || ctx.state !== 'running') { dropped++; return false; }
    if (active.size >= 5) { dropped++; return false; }
    last.set(type, timestamp); sequence++;
    const source = ctx.createBufferSource(); source.buffer = buffers.get(type);
    const detune = type === 'mark' || type === 'unmark' ? [0, 13, -9, 6][sequence % 4] : 0;
    source.detune.value = detune;
    source.connect(master); active.add(source);
    source.onended = () => { active.delete(source); source.disconnect(); };
    const delay = Number.isFinite(options.delay) ? Math.max(0, Math.min(.25, options.delay)) : 0;
    source.start(ctx.currentTime + delay); played++;
    history.push({ type, time: Math.round(timestamp), delay, detune });
    if (history.length > 64) history.shift();
    return true;
  }
  function reset() { stopVoices(); last.clear(); sequence = 0; }
  const api = {
    version: VERSION, event, unlock, setMuted, reset, renderCue,
    setVolume(value) { volume = Math.max(0, Math.min(1, Number(value) || 0)); if (master) master.gain.value = (muted || platformMuted) ? 0 : volume; },
    getRecordingNode() { return master; },
    diagnostics() { return { version: VERSION, muted, platformMuted, volume, state: context ? context.state : 'not-created', sampleRate: context?.sampleRate || null, active: active.size, played, dropped, error, history: history.slice() }; }
  };
  host.WoofAudio = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (host.addEventListener && host.document) {
    host.addEventListener('pointerdown', unlock, { passive: true });
    host.addEventListener('keydown', unlock, { passive: true });
    for (const type of ['luna:mute','luna:unsafe:mute','luna:pause']) host.addEventListener(type, () => { platformMuted = true; stopVoices(); if (master) master.gain.value = 0; });
    for (const type of ['luna:unmute','luna:unsafe:unmute','luna:start']) host.addEventListener(type, () => { platformMuted = false; if (master) master.gain.value = muted ? 0 : volume; });
    host.document.addEventListener('visibilitychange', () => { if (host.document.hidden) stopVoices(); });
  }
})(typeof window !== 'undefined' ? window : globalThis);
