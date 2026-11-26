/* Presentation-only footer. Layout is the native 512×132 footprint from
   assets/generated/environment/layout.json. The receiving cloth never moves. */
(() => {
  'use strict';
  if (window.WoofEnvironment) return;

  const nativeWidth = 512, nativeHeight = 132;
  const props = [
    {name:'ball', x:27, y:75, w:44, h:44},
    {name:'bowl', x:424, y:63, w:65, h:49},
    {name:'bone', x:458, y:14, w:40, h:40},
    {name:'grass0', x:19, y:43, w:21, h:16, period:7.3, phase:0.08, active:0.60, amplitude:1.15},
    {name:'grass1', x:162, y:88, w:32, h:26, period:10.7, phase:0.39, active:0.67, amplitude:1.90},
    {name:'grass2', x:307, y:73, w:25, h:18, period:8.9, phase:0.74, active:0.57, amplitude:1.35},
    {name:'grass3', x:385, y:100, w:23, h:17, period:12.1, phase:0.20, active:0.63, amplitude:1.20}
  ];
  const errors = [], loaded = [];
  let ready = false, loading = null, frames = 0, shadowBuilds = 0;
  let lastAmbient = 0, lastGentle = true, lastError = '';
  const lastRect = {left:0, top:0, width:0, height:0};

  function phaseAt(prop, seconds) {
    return ((seconds / prop.period + prop.phase) % 1 + 1) % 1;
  }
  function displacement(prop, seconds, gentle) {
    if (gentle || !prop.period) return 0;
    const phase = phaseAt(prop, seconds);
    if (phase >= prop.active) return 0;
    const u = phase / prop.active;
    // Smooth start/finish around a single left-right breath, then a real hold.
    const envelope = Math.sin(Math.PI * u);
    return prop.amplitude * Math.sin(Math.PI * 2 * u) * envelope * envelope;
  }
  function makeShadow(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', {willReadFrequently:true});
    if (!context) throw new Error('Shadow canvas unavailable');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const alpha = pixels.data[i + 3];
      pixels.data[i] = 31;
      pixels.data[i + 1] = 48;
      pixels.data[i + 2] = 63;
      // Discard low-alpha export haze rather than project a rectangular matte.
      pixels.data[i + 3] = alpha <= 96 ? 0 : Math.round((alpha - 96) / 159 * 255);
    }
    context.putImageData(pixels, 0, 0);
    shadowBuilds++;
    return canvas;
  }
  function load(baseURL = 'assets/generated/environment/') {
    if (loading) return loading;
    const base = String(baseURL).replace(/\/?$/, '/');
    loading = Promise.all(props.map(prop => new Promise(resolve => {
      const image = new Image();
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        image.onload = image.onerror = null;
        if (error) {
          lastError = `${prop.name}: ${error}`;
          errors.push(lastError);
        } else {
          prop.image = image;
          loaded.push(prop.name);
        }
        resolve(!error);
      };
      const timeout = setTimeout(() => finish('image loading timed out'), 15000);
      image.onload = () => {
        try {
          if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error('empty image');
          prop.shadow = makeShadow(image);
          finish('');
        } catch (error) { finish(String(error?.message || error)); }
      };
      image.onerror = () => finish('image failed to load');
      image.src = base + prop.name + '.png';
    }))).then(results => {
      ready = results.every(Boolean);
      return ready;
    });
    return loading;
  }
  function draw(ctx, footerRect, ambient = 0, gentle = false) {
    if (!ready || !ctx || !footerRect) return false;
    const width = footerRect.width, height = footerRect.height;
    const left = Number.isFinite(footerRect.left) ? footerRect.left : footerRect.x - width / 2;
    const top = Number.isFinite(footerRect.top) ? footerRect.top : footerRect.y - height / 2;
    if (!(width > 0 && height > 0) || !Number.isFinite(left) || !Number.isFinite(top)) return false;
    lastRect.left = left; lastRect.top = top;
    lastRect.width = width; lastRect.height = height;
    lastGentle = !!gentle;
    // Low motion ignores time entirely, producing identical pixels across draws.
    lastAmbient = lastGentle ? 0 : (Number.isFinite(ambient) ? ambient : 0);
    ctx.save();
    ctx.translate(left, top);
    ctx.scale(width / nativeWidth, height / nativeHeight);
    ctx.imageSmoothingEnabled = true;
    // All shadows land on the stationary cloth before any prop is painted.
    for (const prop of props) {
      prop.wind = displacement(prop, lastAmbient, lastGentle);
      const footX = prop.x + prop.w / 2, footY = prop.y + prop.h;
      ctx.save();
      ctx.translate(footX, footY);
      // A compressed alpha silhouette supplies the fixed attached contact.
      ctx.globalAlpha *= prop.period ? 0.15 : 0.18;
      ctx.drawImage(prop.shadow, -prop.w * 0.48, -prop.h * 0.025, prop.w * 0.96, prop.h * 0.105);
      ctx.restore();
      ctx.save();
      ctx.translate(footX, footY);
      // The grass projection follows its lean around the same ground anchor.
      // No shadow texture, cloth texture or environmental origin translates.
      ctx.transform(1, 0, -0.24 - prop.wind / prop.h * 0.7, -0.15, 0, 0);
      ctx.globalAlpha *= prop.period ? 0.10 : 0.075;
      ctx.drawImage(prop.shadow, -prop.w / 2, -prop.h, prop.w, prop.h);
      ctx.restore();
    }
    for (const prop of props) {
      ctx.save();
      ctx.translate(prop.x + prop.w / 2, prop.y + prop.h);
      // Horizontal shear is zero along the entire planted bottom edge. Upper
      // blades bend; the prop's position, ground footprint and base stay fixed.
      if (prop.period) ctx.transform(1, 0, -prop.wind / prop.h, 1, 0, 0);
      ctx.drawImage(prop.image, -prop.w / 2, -prop.h, prop.w, prop.h);
      ctx.restore();
    }
    ctx.restore();
    frames++;
    return true;
  }
  function diagnostics() {
    return {
      ready, loading:!!loading && !ready && !errors.length,
      loaded:[...loaded], errors:[...errors], error:lastError,
      frames, shadowBuilds, cachedShadowCount:props.filter(prop => prop.shadow).length,
      nativeSize:[nativeWidth, nativeHeight], footerRect:{...lastRect},
      gentle:lastGentle, ambientSeconds:lastAmbient,
      receivingPlane:'stationary native blue cloth; this module never paints or moves it',
      props:props.map(prop => ({
        name:prop.name, nativeRect:{x:prop.x, y:prop.y, width:prop.w, height:prop.h},
        anchorNative:[prop.x + prop.w / 2, prop.y + prop.h],
        anchorScreen:[lastRect.left + (prop.x + prop.w / 2) / nativeWidth * lastRect.width,
          lastRect.top + (prop.y + prop.h) / nativeHeight * lastRect.height],
        periodSeconds:prop.period || null,
        phase:prop.period && !lastGentle ? phaseAt(prop, lastAmbient) : 0,
        paused:!prop.period || lastGentle || phaseAt(prop, lastAmbient) >= prop.active,
        topDisplacementNative:prop.wind || 0,
        motion:prop.period ? 'horizontal shear about a fixed bottom edge' : 'at rest'
      }))
    };
  }
  window.WoofEnvironment = Object.freeze({
    load, draw, diagnostics,
    get ready() { return ready; },
    get errors() { return [...errors]; }
  });
})();
