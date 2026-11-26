/* Native support-art adapter. Each replacement owns a fresh Texture2D/Sprite.
   It never edits shared original textures, transforms, hierarchy, hit targets,
   game models, clocks or input. Original surfaces remain until images are ready. */
(() => {
  'use strict';
  if (window.WoofNativeSurfaces) return;
  const paths = Object.freeze({
    background: 'BackgroundLayer/BackgroundImage',
    footer: 'BackgroundLayer/BottomDecoration',
    board: 'BoardLayer/GridMapBg',
    rules: 'TopHud/HintPanel',
    counter: 'TopHud/StatusNodes/QueenNode',
    health: 'TopHud/StatusNodes/HealthNode'
  });
  const applied = new Map();
  let lastError = '', lastAppliedAt = null;
  const dimensions = image => ({
    width: image?.naturalWidth || image?.videoWidth || image?.width || 0,
    height: image?.naturalHeight || image?.videoHeight || image?.height || 0
  });
  function releaseOwned(entry) {
    // Only a texture constructed by this adapter may be disposed.
    try { entry?.texture?.handle?.destroy?.(); } catch (_) {}
  }
  function nativeImage(key) {
    const root = UnityEngine.GameObject.Find('GameCanvas');
    return root?.transform?.Find(paths[key])?.GetComponent(UnityEngine.UI.Image) || null;
  }
  function makeSurface(key, source) {
    const {width, height} = dimensions(source);
    if (!(width > 0 && height > 0) || source.complete === false) throw new Error(`${key}: image is not loaded`);
    const image = nativeImage(key);
    if (!image) throw new Error(`${key}: native surface ${paths[key]} is unavailable`);
    let texture = null;
    try {
      texture = new UnityEngine.Texture2D.$ctor1(width, height);
      if (!texture.handle?.setSource) throw new Error('Texture2D native image upload API unavailable');
      // These are the same public texture properties used by native imports.
      texture.handle.mipmaps = false;
      texture.filterMode = UnityEngine.FilterMode.Bilinear;
      texture.wrapMode = UnityEngine.TextureWrapMode.Clamp;
      texture.handle.setSource(source);
      const sprite = UnityEngine.Sprite.Create(
        texture,
        new UnityEngine.Rect.$ctor1(0, 0, width, height),
        new pc.Vec2(.5, .5)
      );
      if (!sprite) throw new Error('Native sprite creation failed');
      return {key, source, image, texture, sprite, width, height};
    } catch (error) {
      releaseOwned({texture});
      throw error;
    }
  }
  function restore() {
    for (const entry of applied.values()) {
      try {
        entry.image.sprite = entry.originalSprite;
        entry.image.preserveAspect = entry.originalPreserveAspect;
        if (entry.originalColor) entry.image.color = entry.originalColor.$clone();
      } catch (_) { /* Scene may already have been disposed. */ }
      releaseOwned(entry);
    }
    applied.clear();
  }
  function apply(options = {}) {
    const staged = [];
    try {
      if (!window.UnityEngine?.Texture2D || !window.pc?.Vec2) throw new Error('Native renderer is not ready');
      const desired = {background:options.background, footer:options.footer, ...(options.panels || {})};
      // Status is a convenience alias; every native panel gets an independent texture.
      if (desired.status) { desired.counter = desired.status; desired.health = desired.status; delete desired.status; }
      for (const [key, source] of Object.entries(desired)) {
        if (!source) continue;
        if (!Object.hasOwn(paths, key)) throw new Error(`Unsupported surface key: ${key}`);
        if (applied.get(key)?.source === source) continue;
        staged.push(makeSurface(key, source));
      }
      // Only commit after every requested image and native target is available.
      for (const entry of staged) {
        const previous = applied.get(entry.key);
        entry.originalSprite = previous ? previous.originalSprite : entry.image.sprite;
        entry.originalPreserveAspect = previous ? previous.originalPreserveAspect : entry.image.preserveAspect;
        entry.originalColor = previous?.originalColor ?? entry.image.color?.$clone?.();
        entry.image.sprite = entry.sprite;
        // The source's background is a solid blue Image. Its tint must become
        // white to display the generated blue artwork at its authored values.
        if (entry.key === 'background') {
          entry.image.color = new pc.Color(1, 1, 1, entry.originalColor?.a ?? 1);
          // The original null-sprite solid filled the entire rect. A new image
          // must also fill it rather than introduce aspect-ratio letterboxes.
          entry.image.preserveAspect = false;
        }
        applied.set(entry.key, entry);
        releaseOwned(previous);
      }
      lastAppliedAt = performance.now();
      lastError = '';
      return true;
    } catch (error) {
      lastError = String(error?.message || error);
      for (const entry of staged) if (applied.get(entry.key) !== entry) releaseOwned(entry);
      return false;
    }
  }
  window.WoofNativeSurfaces = Object.freeze({
    apply, restore,
    diagnostics: () => ({
      applied: [...applied.values()].map(e => ({surface:e.key, nativePath:paths[e.key], width:e.width, height:e.height})),
      error:lastError, lastAppliedAt,
      mutationScope:'Allowlisted native UI image sprite; white tint and full-rect fill for background only. All textures are newly owned.'
    })
  });
  window.addEventListener('pagehide', restore, {once:true});
})();
