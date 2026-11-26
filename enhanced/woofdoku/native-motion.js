/* Gentle motion for two native result decorations only. Original board input,
   model, clocks, instructional hints and placement settlement stay untouched. */
(() => {
  'use strict';
  if (window.WoofNativeMotion) return;
  const hooks = [];
  let controller = null, gentle = false, installed = false, disposed = false;
  let lastError = '', suppressedConfetti = 0, suppressedWobbles = 0;

  function stopDecorations() {
    if (!controller) return;
    // These native helpers stop only their own visual coroutine and restore
    // the CTA's original pose. They leave its click listener/interactivity intact.
    controller.StopConfetti();
    controller.StopCompletePlayButtonWobble();
  }
  function detach() {
    for (const hook of hooks) {
      if (controller?.[hook.name] !== hook.wrapper) continue;
      if (hook.descriptor) Object.defineProperty(controller, hook.name, hook.descriptor);
      else delete controller[hook.name];
    }
    hooks.length = 0;
    installed = false;
  }
  function install() {
    if (disposed || installed) return;
    try {
      controller = App.SceneObjectLookup.FindIncludingInactive(App.PlayableResultPanelViewController);
      if (!controller) throw new Error('Native result controller unavailable');
      for (const name of ['PlayConfetti', 'StopConfetti', 'StartCompletePlayButtonWobble', 'StopCompletePlayButtonWobble']) {
        if (typeof controller[name] !== 'function') throw new Error(`Native result helper unavailable: ${name}`);
      }
      for (const [name, stop, kind] of [
        ['PlayConfetti', 'StopConfetti', 'confetti'],
        ['StartCompletePlayButtonWobble', 'StopCompletePlayButtonWobble', 'wobble']
      ]) {
        const original = controller[name];
        const descriptor = Object.getOwnPropertyDescriptor(controller, name);
        const wrapper = function (...args) {
          if (!gentle) return original.apply(this, args);
          if (kind === 'confetti') suppressedConfetti++;
          else suppressedWobbles++;
          return this[stop]();
        };
        hooks.push({name, descriptor, wrapper});
        controller[name] = wrapper;
        if (controller[name] !== wrapper) throw new Error(`Cannot attach native motion preference: ${name}`);
      }
      installed = true;
      if (gentle) stopDecorations();
      lastError = '';
    } catch (error) {
      lastError = String(error?.message || error);
      detach();
    }
  }
  function setGentle(value) {
    if (disposed) return false;
    const changed = gentle !== !!value;
    gentle = !!value;
    if (changed && gentle && installed) {
      try { stopDecorations(); }
      catch (error) { lastError = String(error?.message || error); return false; }
    }
    // Full motion permits subsequent native starts. It never replays or catches
    // up a confetti burst or button wobble that Gentle already stopped.
    return true;
  }
  function restore() {
    disposed = true;
    detach();
    gentle = false;
  }
  window.WoofNativeMotion = Object.freeze({
    setGentle, restore,
    diagnostics: () => ({
      installed, gentle, disposed, error: lastError,
      suppressedConfetti, suppressedWobbles,
      confettiPlaying: !!controller?.mConfettiEffect?.IsPlaying,
      ctaAnimating: !!controller?.mCompletePlayButtonWobbleCoroutine,
      ctaInteractable: controller?.mCompletePlayButton?.interactable ?? null,
      mutationScope: 'Native result confetti and CTA wobble only; essential hints and board feedback retained.'
    })
  });
  const ready = window.WoofdokuBridge?.ready;
  if (ready?.then) ready.then(install).catch(error => { lastError = String(error?.message || error); });
  else lastError = 'Load native-motion.js after original-bridge.js';
  window.addEventListener('pagehide', restore, {once:true});
})();
