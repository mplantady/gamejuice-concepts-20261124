/* Native visual adapter: only suppresses the original selected-dog image alpha.
   Image.enabled, GameObject.active, transforms, coroutines, state, clocks and
   event order remain owned by Luna. Call only once replacement art is ready. */
(() => {
  'use strict';
  if (window.WoofNativeVisuals) return;
  const hidden = new Map();
  let lastError = '', count = 0, cachedController = null, cachedHud = null, cachedFooter = null;
  const alpha = (icon, value) => {
    const current = icon.color;
    if (!current || typeof current.$clone !== 'function') return false;
    const next = current.$clone();
    next.a = value;
    icon.color = next;
    return true;
  };
  function restoreIcon(icon, priorAlpha) {
    try { alpha(icon, priorAlpha); } catch (_) { /* Object may have been destroyed on reload. */ }
  }
  function hideDogs() {
    try {
      if (!window.App?.SceneObjectLookup || !App.BoardViewController || !App.BoardCellStatus) return 0;
      const controller = cachedController || (cachedController = App.SceneObjectLookup.FindIncludingInactive(App.BoardViewController));
      if (!controller?.mCellViews) return 0;
      const keep = new Set();
      // The existing HUD mascot shares the same new authored performance.
      const hud=cachedHud || (cachedHud=UnityEngine.GameObject.Find('GameCanvas')?.transform?.Find('TopHud/StatusNodes/QueenNode/QueenContent/QueenIcon')?.GetComponent(UnityEngine.UI.Image));
      if(hud?.color?.$clone){keep.add(hud);if(!hidden.has(hud))hidden.set(hud,hud.color.a);if(hud.color.a!==0)alpha(hud,0);}
      const footer=cachedFooter||(cachedFooter=UnityEngine.GameObject.Find('GameCanvas')?.transform?.Find('BackgroundLayer/BottomDecoration')?.GetComponent(UnityEngine.UI.Image));
      if(footer?.color?.$clone){keep.add(footer);if(!hidden.has(footer))hidden.set(footer,footer.color.a);if(footer.color.a!==0)alpha(footer,0);}

      for (const view of controller.mCellViews) {
        const icon = view?.mPieceIcon;
        if (!icon || view.mCurrentStatus !== App.BoardCellStatus.PlacedSuccess || !icon.enabled) continue;
        const color = icon.color;
        if (!color || typeof color.$clone !== 'function') continue;
        keep.add(icon);
        if (!hidden.has(icon)) hidden.set(icon, color.a);
        if (color.a !== 0) alpha(icon, 0);
      }
      // Reset/reload may disable or replace cells. Restore detached originals so
      // no hidden visual survives a later reset or replacement-art failure.
      for (const [icon, priorAlpha] of hidden) {
        if (!keep.has(icon)) { restoreIcon(icon, priorAlpha); hidden.delete(icon); }
      }
      count = hidden.size;
      lastError = '';
      return count;
    } catch (error) {
      lastError = String(error?.message || error);
      restore();
      return 0;
    }
  }
  function restore() {
    for (const [icon, priorAlpha] of hidden) restoreIcon(icon, priorAlpha);
    hidden.clear();
    count = 0;
  }
  window.WoofNativeVisuals = Object.freeze({
    hideDogs, restore,
    diagnostics: () => ({ hiddenDogs: Math.max(0,count-(cachedHud&&hidden.has(cachedHud)?1:0)-(cachedFooter&&hidden.has(cachedFooter)?1:0)), hiddenHud:!!(cachedHud&&hidden.has(cachedHud)), hiddenFooter:!!(cachedFooter&&hidden.has(cachedFooter)), error: lastError, mutationScope: 'selected dog, HUD dog and footer image alpha only; coherent native fallback on result' })
  });
  window.addEventListener('pagehide', restore, { once: true });
})();
