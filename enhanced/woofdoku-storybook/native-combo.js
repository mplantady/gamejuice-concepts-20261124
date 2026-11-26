/* Relocates only the native combo decoration. Its source text, streak model,
   coroutine, alpha, feedback timing, audio and game callbacks remain unchanged. */
(() => {
  'use strict';
  if (window.WoofNativeCombo) return;
  let controller = null, original = null, descriptor = null, wrapper = null;
  let burstOriginal = null, burstDescriptor = null, burstWrapper = null;
  let root = null, originalScale = null, installed = false, disposed = false;
  let lastError = '', layout = null, measuredAt = -Infinity, refreshCount = 0, lastSourcePosition = null;
  const hiddenOrnaments = new Map();
  let ornamentCandidates = 0, unsupportedOrnaments = 0, clampCount = 0;
  const inkPadding = .65, nativePeak = 1.22;
  const safely = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
  const clone = value => value.$clone ? value.$clone() : value.clone();
  function projectWorld(world) {
    const canvas = document.getElementById('application-canvas');
    const bounds = canvas?.getBoundingClientRect();
    if (!bounds?.width || !bounds?.height || !UnityEngine.Screen.width || !UnityEngine.Screen.height) throw new Error('Canvas projection is unavailable');
    const screen = UnityEngine.RectTransformUtility.WorldToScreenPoint(null, world);
    return {x:bounds.left + screen.x / UnityEngine.Screen.width * bounds.width,
      y:bounds.top + (1 - screen.y / UnityEngine.Screen.height) * bounds.height};
  }
  const project = (parent, x, y) => projectWorld(parent.TransformPoint$1(new pc.Vec3(x, y, 0)));
  function bounds(points) {
    const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
    const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y));
    if (![left, right, top, bottom].every(Number.isFinite)) throw new Error('Invalid native visual bounds');
    return {left, right, top, bottom, width:right-left, height:bottom-top};
  }
  function rectBounds(rect) {
    const corners = Array.from({length:4}, () => new pc.Vec3());
    rect.GetWorldCorners(corners);
    return bounds(corners.map(projectWorld));
  }
  function textLocalBounds(combined = false) {
    const size = controller?.LastMeasuredTextSize;
    const main = controller?.mMainText?.rectTransform;
    if (!size || !main) return null;
    const mainScale = main.localScale || {x:1,y:1};
    const layers = combined ? [controller.mMainText,controller.mOutlineText,controller.mShadowText] : [controller.mMainText];
    const points = [];
    for (const graphic of layers) {
      const rect = graphic?.rectTransform, center = rect?.anchoredPosition;
      if (!center || (combined && graphic.gameObject?.activeInHierarchy === false)) continue;
      // LastMeasuredTextSize is source PreferredVisualSize(main), already
      // including the main layer's own scale. Preserve native layer offsets.
      const scale = rect.localScale || mainScale;
      // TMP_Text.bounds calls the native UGUI GetCompoundBounds(), which
      // unions its actual mesh bounds (including SDF padding), not its layout
      // box. Read each layer so outline/shadow offsets are part of the clamp.
      const mesh = safely(() => graphic.bounds), mc = mesh?.center, mh = mesh?.halfExtents;
      const hasMesh = mc && mh && [mc.x,mc.y,mh.x,mh.y].every(Number.isFinite) && mh.x>0 && mh.y>0;
      const width = hasMesh ? 2*mh.x*Math.abs(scale.x) : size.x*Math.abs(scale.x/(mainScale.x||1));
      const height = hasMesh ? 2*mh.y*Math.abs(scale.y) : size.y*Math.abs(scale.y/(mainScale.y||1));
      const cx=center.x+(hasMesh?mc.x*scale.x:0),cy=center.y+(hasMesh?mc.y*scale.y:0);
      for (const [x,y] of [[-1,-1],[-1,1],[1,-1],[1,1]]) points.push({x:cx+x*width/2,y:cy+y*height/2});
    }
    return points.length ? bounds(points) : null;
  }
  function meshBounds(graphic) {
    const rect=graphic?.rectTransform,box=safely(()=>graphic.bounds),c=box?.center,h=box?.halfExtents;
    if (!rect || !c || !h || ![c.x,c.y,h.x,h.y].every(Number.isFinite) || h.x<=0 || h.y<=0) return null;
    return bounds([[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,y])=>project(rect,c.x+x*h.x,c.y+y*h.y)));
  }
  function textBounds(combined = false) {
    const layers=combined?[controller?.mMainText,controller?.mOutlineText,controller?.mShadowText]:[controller?.mMainText];
    const projected=layers.filter(g=>g&&g.gameObject?.activeInHierarchy!==false).map(meshBounds).filter(Boolean);
    if(projected.length===layers.filter(Boolean).length)return bounds(projected.flatMap(r=>[{x:r.left,y:r.top},{x:r.right,y:r.bottom}]));
    const textRoot = controller?.mTextRoot, local = textLocalBounds(combined);
    if (!textRoot || !local) return null;
    return bounds([[local.left,local.top],[local.left,local.bottom],[local.right,local.top],[local.right,local.bottom]]
      .map(([x,y]) => project(textRoot,x,y)));
  }
  const translated = (r,x,y) => ({left:r.left+x,right:r.right+x,top:r.top+y,bottom:r.bottom+y,width:r.width,height:r.height});
  const contains = (outer,inner,margin=0) => !!outer && !!inner && inner.left>=outer.left+margin-.01 && inner.right<=outer.right-margin+.01 && inner.top>=outer.top+margin-.01 && inner.bottom<=outer.bottom-margin+.01;
  function restoreOrnament(graphic, saved) {
    safely(() => {
      const current = graphic.color;
      // If native code has already supplied a new nonzero alpha, keep it.
      if (current.a !== 0) return;
      const color = clone(current); color.a = saved.alpha; graphic.color = color;
    });
  }
  function suppressOverlappingOrnaments() {
    if (!layout) return;
    const candidates = new Map();
    const add = (graphic, rect) => { if (graphic) candidates.set(graphic, rect || graphic.rectTransform || graphic.transform); };
    const collect = value => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value) add(value);
    };
    add(controller.mGlow);
    add(controller.mUiParticle, controller.mStarRoot);
    add(controller.mYellowStarUiParticle, controller.mYellowStarRoot);
    collect(controller.mComboUiParticles);
    for (const visual of controller.mBurstVisuals || []) if (visual?.Image) add(visual.Image, visual.Rect);
    const keep = new Set();
    ornamentCandidates = candidates.size; unsupportedOrnaments = 0;
    for (const [graphic, rect] of candidates) {
      if (!rect?.GetWorldCorners || !graphic.color || typeof graphic.color.a !== 'number') { unsupportedOrnaments++; continue; }
      if (graphic.gameObject?.activeInHierarchy === false || graphic.enabled === false) continue;
      const screenBounds = safely(() => rectBounds(rect));
      if (!screenBounds) { unsupportedOrnaments++; continue; }
      const overlaps = layout.protectedRects.some(p => screenBounds.left < p.right && screenBounds.right > p.left && screenBounds.top < p.bottom && screenBounds.bottom > p.top);
      if (!overlaps) continue;
      const current = graphic.color;
      if (typeof current.$clone !== 'function' && typeof current.clone !== 'function') { unsupportedOrnaments++; continue; }
      keep.add(graphic);
      const saved = hiddenOrnaments.get(graphic);
      if (!saved) hiddenOrnaments.set(graphic, {alpha:current.a, bounds:screenBounds});
      else { if (current.a !== 0) saved.alpha = current.a; saved.bounds = screenBounds; }
      if (current.a !== 0) { const color = clone(current); color.a = 0; graphic.color = color; }
    }
    for (const [graphic, saved] of hiddenOrnaments) {
      if (!keep.has(graphic)) { restoreOrnament(graphic, saved); hiddenOrnaments.delete(graphic); }
    }
  }
  function measure() {
    const bridge = window.WoofdokuBridge;
    const queen = bridge.uiRect('TopHud/StatusNodes/QueenNode');
    const health = bridge.uiRect('TopHud/StatusNodes/HealthNode');
    const rules = bridge.uiRect('TopHud/HintPanel');
    const board = bridge.uiRect('BoardLayer/GridMapBg') || bridge.uiRect('BoardLayer/BoardRoot');
    const hud = [queen,health].filter(rect => rect?.visible && rect.width>0 && rect.height>0);
    if (!rules?.visible || !board?.visible || !root?.parent) throw new Error('Native rule/board-frame bounds unavailable');
    // The frame extends beyond BoardRoot. Use the actual painted-frame rect,
    // keeping the feedback out of both the rules and the wooden board lip.
    const rawGapHeight = board.top-rules.bottom;
    const padding = Math.min(.8,Math.max(0,rawGapHeight*.025));
    const gap = {left:Math.max(rules.left,board.left)+padding,right:Math.min(rules.right,board.right)-padding,
      top:rules.bottom+padding,bottom:board.top-padding};
    gap.width=gap.right-gap.left;gap.height=gap.bottom-gap.top;
    if (!(gap.width>0 && gap.height>2*inkPadding)) throw new Error('No free gap between native rules and board frame');
    const origin=project(root.parent,0,0),px=project(root.parent,1,0),py=project(root.parent,0,1);
    const a=px.x-origin.x,b=py.x-origin.x,c=px.y-origin.y,d=py.y-origin.y,determinant=a*d-b*c;
    if (!Number.isFinite(determinant)||Math.abs(determinant)<1e-8) throw new Error('Degenerate native canvas projection');
    const effectScale=controller.EffectiveScale(),initial=controller.mTextRootInitialScale;
    const local=textLocalBounds(true),main=textLocalBounds(false);
    if (!local || !main || !(main.height>0)) throw new Error('Native combo dimensions unavailable');
    // These reference dimensions never use the currently animated child scale
    // or our fitted root scale. Re-measurement cannot compound a previous fit.
    const sx=Math.abs((initial?.x||1)*effectScale*originalScale.x),sy=Math.abs((initial?.y||1)*effectScale*originalScale.y);
    const settledWidth=Math.abs(a)*local.width*sx+Math.abs(b)*local.height*sy;
    const settledHeight=Math.abs(c)*local.width*sx+Math.abs(d)*local.height*sy;
    const mainHeight=Math.abs(c)*main.width*sx+Math.abs(d)*main.height*sy;
    const pixelWidth=settledWidth*nativePeak,pixelHeight=settledHeight*nativePeak;
    const fit=Math.min(1,(gap.width-2*inkPadding)/pixelWidth,(gap.height-2*inkPadding)/pixelHeight,22/mainHeight);
    if (!(fit>0 && Number.isFinite(fit))) throw new Error('Invalid combo fit');
    const scale=clone(originalScale);scale.x*=fit;scale.y*=fit;root.localScale=scale;
    refreshCount++;
    return {region:'rules-to-board-frame',gap,rawGapHeight,fit,basis:{a,b,c,d,determinant},
      protectedRects:[...hud,rules,board].map(({left,right,top,bottom})=>({left,right,top,bottom})),
      boardFrame:{left:board.left,right:board.right,top:board.top,bottom:board.bottom},
      unscaledFootprint:{width:pixelWidth,height:pixelHeight},
      fittedFootprint:{width:pixelWidth*fit+2*inkPadding,height:pixelHeight*fit+2*inkPadding},
      estimatedTextHeight:mainHeight*fit,peakTextHeight:mainHeight*fit*nativePeak,inkPadding,
      footprintSource:'Native TMP compound mesh bounds, with preferred-size fallback before mesh exists',
      legibilityLimited:mainHeight*fit<14,offset:{x:0,y:0},currentFootprint:null,contained:true};
  }
  function positionWithinGap(sourcePosition) {
    const current=textBounds(true);
    if (!current) return sourcePosition;
    const {a,b,c,d,determinant}=layout.basis,gap=layout.gap;
    const base=controller.mInitialVisualPosition;
    // Retain the source motion's direction and progress, but bound its actual
    // projected footprint. A constant offset alone allowed a 14px upward drift.
    const dx=sourcePosition.x-base.x,dy=sourcePosition.y-base.y-Math.max(0,controller.mVerticalOffset);
    const sourceOffset={x:a*dx+b*dy,y:c*dx+d*dy};
    const desired={x:(gap.left+gap.right)/2+sourceOffset.x,y:(gap.top+gap.bottom)/2+sourceOffset.y};
    const minX=gap.left+current.width/2+inkPadding,maxX=gap.right-current.width/2-inkPadding;
    const minY=gap.top+current.height/2+inkPadding,maxY=gap.bottom-current.height/2-inkPadding;
    const target={x:Math.max(minX,Math.min(maxX,desired.x)),y:Math.max(minY,Math.min(maxY,desired.y))};
    const shift={x:target.x-(current.left+current.right)/2,y:target.y-(current.top+current.bottom)/2};
    // Translation from the currently projected footprint avoids assumptions
    // about RectTransform anchors, text-center offsets, and the prior frame.
    const position=clone(root.anchoredPosition);
    position.x+=(d*shift.x-b*shift.y)/determinant;position.y+=(a*shift.y-c*shift.x)/determinant;
    const clamped=Math.abs(target.x-desired.x)>.01||Math.abs(target.y-desired.y)>.01;
    if(clamped)clampCount++;
    layout.offset={x:position.x-sourcePosition.x,y:position.y-sourcePosition.y};
    layout.nativeScreenOffset=sourceOffset;layout.clamped=clamped;
    layout.currentFootprint=translated(current,shift.x,shift.y);
    layout.contained=contains(gap,layout.currentFootprint,inkPadding);
    return position;
  }
  function invalidate() { measuredAt = -Infinity; layout = null; }
  function restore() {
    disposed = true;
    if (controller?.VisualPositionAt === wrapper) {
      if (descriptor) Object.defineProperty(controller, 'VisualPositionAt', descriptor);
      else delete controller.VisualPositionAt;
      if (root && lastSourcePosition) safely(() => { root.anchoredPosition = clone(lastSourcePosition); });
    }
    if (controller?.UpdateBurstVisuals === burstWrapper) {
      if (burstDescriptor) Object.defineProperty(controller, 'UpdateBurstVisuals', burstDescriptor);
      else delete controller.UpdateBurstVisuals;
    }
    for (const [graphic, saved] of hiddenOrnaments) restoreOrnament(graphic, saved);
    hiddenOrnaments.clear();
    if (root && originalScale) safely(() => { root.localScale = clone(originalScale); });
    installed = false;
    window.removeEventListener('resize', invalidate);
    window.removeEventListener('orientationchange', invalidate);
  }
  function install() {
    if (disposed || installed) return;
    try {
      // Resources array[0] is the inactive prefab in the
      // recorded baseline. Scope selection to the actual scene canvas/board.
      const canvas = UnityEngine.GameObject.Find('GameCanvas');
      const board = UnityEngine.GameObject.Find('[BoardView]')?.GetComponent(App.BoardViewController);
      const linked = board?.mComboFeedbackViewController;
      const scoped = canvas?.GetComponentInChildren(App.ComboFeedbackViewController, true);
      controller = linked?.gameObject?.activeInHierarchy ? linked : scoped;
      if (!controller?.gameObject?.activeInHierarchy) throw new Error('Active scene combo controller unavailable');
      if (!controller?.mVisualRoot || typeof controller.VisualPositionAt !== 'function' || typeof controller.UpdateBurstVisuals !== 'function') throw new Error('Native combo presentation unavailable');
      root = controller.mVisualRoot;
      originalScale = clone(root.localScale);
      original = controller.VisualPositionAt;
      descriptor = Object.getOwnPropertyDescriptor(controller, 'VisualPositionAt');
      wrapper = function (...args) {
        const sourcePosition = original.apply(this, args);
        if (this !== controller || disposed) return sourcePosition;
        lastSourcePosition = clone(sourcePosition);
        try {
          const now = performance.now();
          // Read the current frame after source child-scale/geometry updates.
          // Reference sizing uses intrinsic mesh geometry, never that animated
          // child scale, so repeated fitting cannot shrink or enlarge itself.
          const copy = this.mMainText?.text || '';
          layout = {...measure(), copy, nativePlaybackSeconds:Number.isFinite(args[0])?args[0]:null}; measuredAt = now;
          const position = positionWithinGap(sourcePosition);
          lastError = '';
          return position;
        } catch (error) {
          lastError = String(error?.message || error);
          safely(() => { root.localScale = clone(originalScale); });
          invalidate();
          return sourcePosition;
        }
      };
      controller.VisualPositionAt = wrapper;
      if (controller.VisualPositionAt !== wrapper) throw new Error('Native combo method cannot be wrapped');
      burstOriginal = controller.UpdateBurstVisuals;
      burstDescriptor = Object.getOwnPropertyDescriptor(controller, 'UpdateBurstVisuals');
      burstWrapper = function (...args) {
        const result = burstOriginal.apply(this, args);
        if (this === controller && !disposed) {
          try { suppressOverlappingOrnaments(); }
          catch (error) { lastError = String(error?.message || error); }
        }
        return result;
      };
      controller.UpdateBurstVisuals = burstWrapper;
      if (controller.UpdateBurstVisuals !== burstWrapper) throw new Error('Native ornament presentation cannot be wrapped');
      installed = true;
    } catch (error) { lastError = String(error?.message || error); restore(); }
  }
  window.WoofNativeCombo = Object.freeze({
    refresh:invalidate, restore,
    diagnostics: () => ({installed, disposed, error:lastError, refreshCount, clampCount,
      controllerName:safely(() => controller.gameObject.name, ''), controllerActive:!!safely(() => controller.gameObject.activeInHierarchy, false),
      nativeTriggered:!!safely(() => controller.mTriggeredUnRegister, false), lastDisplayedCombo:safely(() => controller.LastDisplayedCombo, 0),
      layout:layout ? JSON.parse(JSON.stringify(layout)) : null,
      text:safely(() => controller.mMainText.text, ''),
      visible:!!safely(() => controller.IsPlaying && root.gameObject.activeInHierarchy && controller.mCanvasGroup.alpha > 0 && Math.abs(controller.mTextRoot.localScale.x) > .001, false),
      nativeAlpha:safely(() => controller.mCanvasGroup.alpha, 0),
      nativeTextScale:safely(() => controller.mTextRoot.localScale.x, 0),
      nativePlaybackSeconds:layout?.nativePlaybackSeconds??null,
      nativeHold:!!layout && layout.nativePlaybackSeconds>=.333 && layout.nativePlaybackSeconds<=.833,
      measuredTextBounds:safely(() => textBounds(false)),
      textLayerBounds:safely(() => ({main:meshBounds(controller.mMainText),outline:meshBounds(controller.mOutlineText),shadow:meshBounds(controller.mShadowText)})),
      combinedTextBounds:safely(() => textBounds(true)),
      measuredTextContained:safely(() => contains(layout?.gap,textBounds(true),inkPadding),false),
      nativeTextLayoutBounds:safely(() => rectBounds(controller.mMainText.rectTransform)),
      ornamentCandidates, unsupportedOrnaments, alphaHiddenOrnaments:hiddenOrnaments.size,
      hiddenOrnamentBounds:[...hiddenOrnaments.values()].map(saved => ({...saved.bounds})),
      mutationScope:'Combo VisualPositionAt result, decorative VisualRoot localScale, and alpha of native ornaments overlapping HUD/rules/board frame only'})
  });
  window.addEventListener('resize', invalidate);
  window.addEventListener('orientationchange', invalidate);
  window.addEventListener('pagehide', restore, {once:true});
  if (window.WoofdokuBridge?.ready?.then) window.WoofdokuBridge.ready.then(install).catch(error => { lastError = String(error?.message || error); });
  else lastError = 'Load native-combo.js after original-bridge.js';
})();
