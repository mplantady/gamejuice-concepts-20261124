/* Load synchronously before DOMContentLoaded, after original script 15 has
   registered its compressed assets. The original 26 scripts stay unchanged.
   WOOF_STORYBOOK_SOUNDS maps native cue names (or allowlisted numeric IDs) to
   base64 WAV bytes. All 12 unique samples must be present before any commit. */
(() => {
  'use strict';
  if (window.WoofNativeAudioResources) return;
  const cueIds = Object.freeze({
    ui_click:9576, ui_primary_click:9576, board_place:9540,
    board_exclude:9628, board_exclude_cleared:9502, board_invalid:9556,
    game_start:9548, result_success:9396, result_failed:9614,
    combo_great:9612, combo_excellent:9436, combo_amazing:9474,
    combo_unbelievable:9458
  });
  const ids = [...new Set(Object.values(cueIds))];
  const pathFor = id => `assets/bundles/-1/${id}.mp3`;
  const status = {state:'preparing', error:'', barrierInstalled:false,
    bridgeAlreadyPresent:!!window.Bridge, replaced:[], originalPromiseCount:0};
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  window.WoofNativeAudioResources = Object.freeze({
    ready,
    diagnostics: () => ({...status, replaced:status.replaced.map(item => ({...item})),
      mutationScope:'12 allowlisted native sound resource buffers before runtime import; no playback or mute interception'})
  });
  const fallback = error => {
    status.state = 'original-fallback';
    status.error = String(error?.message || error);
    resolveReady(false);
    return false;
  };
  function resolveId(key) {
    if (Object.hasOwn(cueIds, key)) return cueIds[key];
    const id = ids.find(id => key === String(id) || key === pathFor(id));
    if (id === undefined) throw new Error(`Unsupported sound resource: ${key}`);
    return id;
  }
  function wavBytes(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Missing base64 WAV sample');
    const encoded = value.replace(/^data:audio\/(?:wav|wave|x-wav);base64,/i, '').replace(/\s/g, '');
    const binary = window.atob(encoded), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const tag = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Sample is not a RIFF WAV');
    const view = new DataView(bytes.buffer), end = view.getUint32(4, true) + 8;
    if (end > bytes.length || end < 44) throw new Error('Truncated WAV sample');
    let format = null, dataSize = 0;
    for (let offset = 12; offset + 8 <= end;) {
      const size = view.getUint32(offset + 4, true), next = offset + 8 + size;
      if (next > end) throw new Error('Truncated WAV chunk');
      if (tag(offset) === 'fmt ') {
        if (size < 16) throw new Error('Invalid WAV format chunk');
        format = {codec:view.getUint16(offset + 8, true), channels:view.getUint16(offset + 10, true),
          sampleRate:view.getUint32(offset + 12, true), blockAlign:view.getUint16(offset + 20, true)};
      }
      if (tag(offset) === 'data') dataSize += size;
      offset = next + (size & 1);
    }
    if (!format || ![1,3].includes(format.codec) || ![1,2].includes(format.channels) ||
        !format.sampleRate || !format.blockAlign || !dataSize || dataSize % format.blockAlign) {
      throw new Error('WAV must contain nonempty PCM or float mono/stereo audio');
    }
    return {buffer:bytes.buffer, bytes:bytes.length, ...format};
  }
  try {
    // Late replacement would race the native sound importer. Leave originals
    // intact rather than changing already-imported clips or active voices.
    if (document.readyState !== 'loading' || window._readyEventEmitted || !Array.isArray(window._compressedAssets)) {
      throw new Error('Sound resource adapter must load synchronously before DOMContentLoaded');
    }
    const mapping = window.WOOF_STORYBOOK_SOUNDS;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('WOOF_STORYBOOK_SOUNDS is unavailable');
    const staged = new Map(), encodedById = new Map();
    for (const [key, encoded] of Object.entries(mapping)) {
      const id = resolveId(key);
      if (encodedById.has(id) && encodedById.get(id) !== encoded) throw new Error(`Conflicting aliases for sound ${id}`);
      if (!staged.has(id)) staged.set(id, wavBytes(encoded));
      encodedById.set(id, encoded);
    }
    if (ids.some(id => !staged.has(id))) throw new Error('All 12 native sound resources are required');
    const assets = window._compressedAssets;
    const originalPromises = assets.slice(); // Before pushing: no self-dependency.
    status.originalPromiseCount = originalPromises.length;
    status.state = 'waiting-for-original-assets';
    const barrier = Promise.all(originalPromises).then(() => {
      if (!window.sounds || typeof window.sounds !== 'object') throw new Error('Original sound resource dictionary unavailable');
      const originals = ids.map(id => [pathFor(id), window.sounds[pathFor(id)]]);
      if (originals.some(([, buffer]) => !buffer)) throw new Error('Original sound allowlist is incomplete');
      try {
        for (const id of ids) window.sounds[pathFor(id)] = staged.get(id).buffer;
      } catch (error) {
        for (const [path, buffer] of originals) window.sounds[path] = buffer;
        throw error;
      }
      status.replaced = ids.map(id => ({id, path:pathFor(id), bytes:staged.get(id).bytes,
        channels:staged.get(id).channels, sampleRate:staged.get(id).sampleRate}));
      status.state = 'replaced';
      resolveReady(true);
      return true;
    }).catch(fallback);
    // Original script 19 waits here. If Bridge already exists, script 19 can
    // emit luna:ready early, but script 14 ALSO awaits this same array before
    // luna:build. Native startup/import begins only after luna:build.
    assets.push(barrier);
    status.barrierInstalled = true;
  } catch (error) { fallback(error); }
})();
