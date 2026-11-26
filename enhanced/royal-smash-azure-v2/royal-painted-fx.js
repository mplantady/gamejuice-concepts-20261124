/**
 * Azure Coast v2.1 — integrated painted event accents.
 *
 * Pure, age-driven Canvas 2D accents for the Azure Coast treatment. Callers own
 * real event gates, positions, contact direction and removal from their queue.
 * No clock, random source, game object, DOM, audio, asset or camera is accessed.
 *
 * API (positions are CSS pixels; age is seconds since the verified event):
 *   drawContactAccent(ctx, {x,y,angle=0,age,strength=1,scale=1,calm=false,kind,skipSecondary=false})
 *     angle points AWAY from contact along the chosen surface/response direction.
 *     kind is 'ceramic' (default), or 'table'/'support'/'brass'. The small
 *     secondary chips are highlight flecks; they do not represent target damage.
 *   drawContactSecondary(ctx, {x,y,angle=0,age,strength=1,scale=1,calm=false,kind})
 *     Draw only free flecks at an independently supplied emission origin. Use
 *     skipSecondary:true on a moving attached crest to avoid drawing them twice.
 *   drawWaterFoam(ctx, {x,y,age,strength=1,scale=1,calm=false})
 *     x/y is the true water intersection. The ribbons stay in that local plane.
 *   drawClearAccent(ctx, {x,y,width,age,scale=1,calm=false})
 *     width is the requested CSS-pixel span, capped at 320 * scale. Place this
 *     under existing committed-clear text; this function draws no text/reward.
 *
 * All calls return whether they submitted visible geometry. Invalid numerical
 * inputs or expired/negative ages draw nothing. Strength clamps to [0,1], scale
 * to (0,4]. Context state is restored even if a drawing operation throws.
 *
 * Suggested review stills at 60 fps (NOT proof of motion quality):
 *   contact: f1 onset, f3 crest, f6 flecks, f12 decay, f18 empty;
 *   water:   f2 onset, f9 crest, f17 secondary, f32 thinning, f42 empty;
 *   clear:   f4 onset, f12 full trim, f23 traveling glint, f40 decay, f57 empty.
 * Review against the frozen actual BEFORE capture before integration.
 */

export const FX_TIMING = Object.freeze({
  contact: Object.freeze({duration: .30, attack: .018, peak: .055, decay: .095, calmDuration: .14}),
  water: Object.freeze({duration: .70, attack: .035, peak: .15, decay: .24, calmDuration: .23}),
  clear: Object.freeze({duration: .95, attack: .065, peak: .20, decay: .43, calmDuration: .28})
});

export const FX_METRICS = Object.freeze({
  contact: Object.freeze({maximumRadiusAtScale1: 22.5, maximumFilledShapes: 9, maximumSecondaryFlecks: 3}),
  water: Object.freeze({maximumWidthAtScale1: 58, maximumHeightAtScale1: 24, maximumFilledShapes: 10, maximumDrops: 2}),
  clear: Object.freeze({maximumWidthAtScale1: 320, maximumHeightAtScale1: 30, maximumFilledShapes: 6}),
  interpretation: 'Geometric budgets, not visual/performance acceptance. Scale multiplies these bounds.'
});

const COLOR = Object.freeze({
  ink: '#173f56', cobalt: '#245f87', teal: '#195b70',
  ivoryLight: '#fff9df', ivory: '#f2e0b6', ivoryShade: '#d1b77d',
  brassLight: '#ffe5a8', brass: '#dba441', brassShade: '#986024',
  foam: '#f7f3dd', foamShade: '#9bcfda'
});
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const smooth = (a, b, x) => {const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t);};
const easeOut = x => 1 - (1 - clamp(x)) ** 3;
const envelope = (age, attack, decay, end) => smooth(0, attack, age) * (1 - smooth(decay, end, age));

function inputs(options, duration, calmDuration) {
  if (!options || !Number.isFinite(options.x) || !Number.isFinite(options.y) || !Number.isFinite(options.age)) return null;
  const scale = options.scale === undefined ? 1 : options.scale;
  const strength = options.strength === undefined ? 1 : options.strength;
  const calm = options.calm === true;
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(strength)) return null;
  if (options.age < 0 || options.age >= (calm ? calmDuration : duration) || strength <= 0) return null;
  return {x: options.x, y: options.y, age: options.age, scale: Math.min(scale, 4), strength: clamp(strength), calm};
}

function frame(ctx, x, y, scale, angle, alpha, paint) {
  if (!ctx || typeof ctx.save !== 'function' || typeof ctx.restore !== 'function' || alpha <= 0) return false;
  ctx.save();
  try {
    const inheritedAlpha = Number.isFinite(ctx.globalAlpha) ? clamp(ctx.globalAlpha) : 1;
    if (inheritedAlpha <= 0) return false;
    ctx.globalAlpha = inheritedAlpha * clamp(alpha);
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.scale(scale, scale);
    paint();
  } finally {ctx.restore();}
  return true;
}

function wash(ctx, x0, y0, x1, y1, light, middle, dark) {
  if (typeof ctx.createLinearGradient !== 'function') return middle;
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, light);
  gradient.addColorStop(.56, middle);
  gradient.addColorStop(1, dark);
  return gradient;
}

// The crest has a long leading tip and a shorter folded return. Its asymmetry
// belongs to the wave/enamel vocabulary, rather than an evenly radiating star.
function contactCrest(ctx, fill, offsetY = 0) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(-12, 2 + offsetY);
  ctx.bezierCurveTo(-5, 1 + offsetY, -2, -4 + offsetY, 1, -9 + offsetY);
  ctx.bezierCurveTo(4, -13 + offsetY, 10, -14 + offsetY, 16, -13 + offsetY);
  ctx.bezierCurveTo(10, -9 + offsetY, 9, -4 + offsetY, 20, -1 + offsetY);
  ctx.bezierCurveTo(13, 0 + offsetY, 8, 2 + offsetY, 6, 8 + offsetY);
  ctx.bezierCurveTo(3, 5 + offsetY, -3, 5 + offsetY, -12, 2 + offsetY);
  ctx.closePath();
  ctx.fill();
}

function contactHighlight(ctx, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(-8, 2);
  ctx.bezierCurveTo(-2, -1, 0, -7, 3, -9);
  ctx.bezierCurveTo(6, -11, 9, -12, 12, -12);
  ctx.bezierCurveTo(7, -9, 5, -5, 3, -2);
  ctx.bezierCurveTo(0, 1, -3, 3, -8, 2);
  ctx.closePath();
  ctx.fill();
}

const FLECKS = Object.freeze([
  Object.freeze({x: 1, y: -3, dx: 10, dy: -5, turn: -.45, size: 3.4, delay: .042, life: .15}),
  Object.freeze({x: -1, y: 3, dx: 12, dy: 4, turn: .38, size: 2.6, delay: .065, life: .16}),
  Object.freeze({x: 2, y: 0, dx: 15, dy: -1, turn: -.1, size: 2.1, delay: .078, life: .14})
]);

function fleckShape(ctx, size, fill, yOffset = 0) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(-size, yOffset);
  ctx.bezierCurveTo(-size * .15, -size * .55 + yOffset, size * .7, -size * .28 + yOffset, size, -size * .05 + yOffset);
  ctx.bezierCurveTo(size * .35, size * .24 + yOffset, -size * .08, size * .42 + yOffset, -size, yOffset);
  ctx.closePath();
  ctx.fill();
}

function contactSecondary(ctx, p, support) {
  if (p.calm) return;
  for (let index = 0; index < FLECKS.length; index++) {
    if (index === 2 && p.strength < .7) continue;
    const f = FLECKS[index];
    const u = (p.age - f.delay) / f.life;
    if (u <= 0 || u >= 1) continue;
    const travel = easeOut(u);
    ctx.save();
    try {
      ctx.globalAlpha *= Math.sin(Math.PI * u) * .78;
      ctx.translate(f.x + f.dx * travel, f.y + f.dy * travel + u * u * 1.7);
      ctx.rotate(f.turn + u * .15);
      fleckShape(ctx, f.size, support ? COLOR.brassShade : COLOR.cobalt, .65);
      fleckShape(ctx, f.size, index === 1 && support ? COLOR.brass : COLOR.ivoryLight);
    } finally {ctx.restore();}
  }
}

export function drawContactSecondary(ctx, options) {
  const timing = FX_TIMING.contact;
  const p = inputs(options, timing.duration, timing.calmDuration);
  if (!p || p.calm) return false;
  const angle = options.angle === undefined ? 0 : options.angle;
  if (!Number.isFinite(angle)) return false;
  const active = FLECKS.some((f, index) => !(index === 2 && p.strength < .7) && p.age > f.delay && p.age < f.delay + f.life);
  if (!active) return false;
  const support = ['table', 'support', 'brass'].includes(options.kind);
  const alpha = envelope(p.age, timing.attack, timing.decay, timing.duration);
  const gain = .74 + p.strength * .22;
  return frame(ctx, p.x, p.y, p.scale * (.84 + .16 * p.strength), angle, alpha * gain, () => contactSecondary(ctx, p, support));
}

export function drawContactAccent(ctx, options) {
  const timing = FX_TIMING.contact;
  const p = inputs(options, timing.duration, timing.calmDuration);
  if (!p) return false;
  const angle = options.angle === undefined ? 0 : options.angle;
  if (!Number.isFinite(angle)) return false;
  const support = ['table', 'support', 'brass'].includes(options.kind);
  const end = p.calm ? timing.calmDuration : timing.duration;
  const alpha = envelope(p.age, p.calm ? .012 : timing.attack, p.calm ? .035 : timing.decay, end);
  const gain = .74 + p.strength * .22;
  return frame(ctx, p.x, p.y, p.scale * (.84 + .16 * p.strength), angle, alpha * gain, () => {
    ctx.save();
    try {
      const settle = p.calm ? .64 : .86 + .14 * easeOut(p.age / timing.peak);
      ctx.scale(settle, settle);
      contactCrest(ctx, support ? COLOR.brassShade : COLOR.ink, 1.15);
      contactCrest(ctx, wash(ctx, -8, -12, 13, 8,
        support ? COLOR.brassLight : COLOR.ivoryLight,
        support ? COLOR.brass : COLOR.ivory,
        support ? COLOR.brassShade : COLOR.ivoryShade));
      contactHighlight(ctx, COLOR.ivoryLight);
    } finally {ctx.restore();}
    if (options.skipSecondary !== true) contactSecondary(ctx, p, support);
  });
}

function foamRibbon(ctx, x, y, width, height, fill, reverse = false) {
  // Open-ended ribbon silhouette, including two differently sized curved tips.
  // Deliberately no full ellipse, circular stroke, or evenly spaced droplets.
  ctx.save();
  try {
    ctx.translate(x, y);
    if (reverse) ctx.scale(-1, 1);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(-width * .5, height * .32);
    ctx.bezierCurveTo(-width * .34, -height * .55, -width * .08, -height * .55, width * .05, -height * .18);
    ctx.bezierCurveTo(width * .17, height * .16, width * .34, -height * .34, width * .5, -height * .15);
    ctx.bezierCurveTo(width * .27, height * .48, width * .08, height * .51, -width * .06, height * .12);
    ctx.bezierCurveTo(-width * .19, -height * .1, -width * .32, height * .15, -width * .5, height * .32);
    ctx.closePath();
    ctx.fill();
  } finally {ctx.restore();}
}

function waterDrop(ctx, x, y, height, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x, y - height);
  ctx.bezierCurveTo(x + 1.6, y - height * .28, x + 1.5, y + .8, x, y + 1.2);
  ctx.bezierCurveTo(x - 1.4, y + .8, x - 1.15, y - height * .42, x, y - height);
  ctx.closePath();
  ctx.fill();
}

export function drawWaterFoam(ctx, options) {
  const timing = FX_TIMING.water;
  const p = inputs(options, timing.duration, timing.calmDuration);
  if (!p) return false;
  const end = p.calm ? timing.calmDuration : timing.duration;
  const alpha = envelope(p.age, p.calm ? .018 : timing.attack, p.calm ? .055 : timing.decay, end);
  return frame(ctx, p.x, p.y, p.scale, 0, alpha * (.62 + p.strength * .19), () => {
    const spread = p.calm ? .72 : .60 + .40 * easeOut(p.age / .46);
    const breadth = (21 + p.strength * 7) * spread;
    const thin = p.calm ? .72 : 1 - smooth(.28, timing.duration, p.age) * .74;
    const foam = wash(ctx, 0, -5, 0, 6, COLOR.ivoryLight, COLOR.foam, COLOR.foamShade);
    foamRibbon(ctx, -breadth * .48, 1.2, breadth, 5.3 * thin, COLOR.teal);
    foamRibbon(ctx, -breadth * .48, 0, breadth, 4.7 * thin, foam);
    foamRibbon(ctx, breadth * .48, 2.6, breadth * .86, 4.6 * thin, COLOR.teal, true);
    foamRibbon(ctx, breadth * .48, 1.5, breadth * .86, 4 * thin, foam, true);
    if (!p.calm && p.age > .10) {
      ctx.save();
      try {
        ctx.globalAlpha *= .60;
        const delay = smooth(.10, .20, p.age);
        foamRibbon(ctx, -1.5, 5.5, breadth * .60 * delay, 2.7 * thin, COLOR.teal);
        foamRibbon(ctx, -1.5, 4.7, breadth * .60 * delay, 2.2 * thin, COLOR.foam);
      } finally {ctx.restore();}
    }
    if (p.calm || p.strength <= .55) return;
    const u = (p.age - .055) / .30;
    if (u <= 0 || u >= 1) return;
    ctx.save();
    try {
      ctx.globalAlpha *= Math.sin(u * Math.PI) * .75;
      const arc = Math.sin(u * Math.PI);
      const x1 = -7 - u * 5, y1 = -arc * 8;
      const x2 = 8 + u * 4, y2 = -arc * 5.2 + 1;
      waterDrop(ctx, x1, y1 + .8, 3.1, COLOR.foamShade);
      waterDrop(ctx, x1, y1, 2.7, COLOR.ivoryLight);
      waterDrop(ctx, x2, y2 + .7, 2.4, COLOR.foamShade);
      waterDrop(ctx, x2, y2, 2, COLOR.foam);
    } finally {ctx.restore();}
  });
}

function clearRibbon(ctx, halfWidth, height, fill, yOffset) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(-halfWidth, yOffset);
  ctx.bezierCurveTo(-halfWidth * .72, -height + yOffset, -halfWidth * .40, height * .75 + yOffset, -halfWidth * .10, yOffset);
  ctx.bezierCurveTo(halfWidth * .17, -height * .68 + yOffset, halfWidth * .51, height * .8 + yOffset, halfWidth, -height * .18 + yOffset);
  ctx.bezierCurveTo(halfWidth * .50, height * 1.14 + yOffset, halfWidth * .18, -height * .12 + yOffset, -halfWidth * .10, height * .66 + yOffset);
  ctx.bezierCurveTo(-halfWidth * .42, height * 1.3 + yOffset, -halfWidth * .70, -height * .48 + yOffset, -halfWidth, yOffset);
  ctx.closePath();
  ctx.fill();
}

export function drawClearAccent(ctx, options) {
  const timing = FX_TIMING.clear;
  const p = inputs(options, timing.duration, timing.calmDuration);
  if (!p || !Number.isFinite(options.width) || options.width <= 0) return false;
  const width = Math.min(options.width, FX_METRICS.clear.maximumWidthAtScale1 * p.scale);
  const end = p.calm ? timing.calmDuration : timing.duration;
  const alpha = envelope(p.age, p.calm ? .025 : timing.attack, p.calm ? .075 : timing.decay, end);
  return frame(ctx, p.x, p.y, 1, 0, alpha * .91, () => {
    const reveal = p.calm ? .88 : .20 + .80 * easeOut(p.age / timing.peak);
    const half = width * .5 * reveal;
    const height = (p.calm ? 2.1 : 3.4) * p.scale;
    // The two painted value bands echo existing enamel waves and brass trim.
    clearRibbon(ctx, half, height, COLOR.ink, 1.5 * p.scale);
    clearRibbon(ctx, half, height, COLOR.brassShade, .7 * p.scale);
    clearRibbon(ctx, half, height * .76, wash(ctx, -half, 0, half, 0,
      COLOR.brass, COLOR.ivoryLight, COLOR.brassLight), 0);
    if (p.calm) return;
    const u = (p.age - .17) / .37;
    if (u <= 0 || u >= 1) return;
    ctx.save();
    try {
      ctx.globalAlpha *= Math.sin(u * Math.PI) * .80;
      ctx.translate((-half * .75 + half * 1.5 * easeOut(u)), -.9 * p.scale);
      ctx.scale(p.scale, p.scale);
      fleckShape(ctx, Math.min(5.4, width * .10 / p.scale), COLOR.ivoryLight);
    } finally {ctx.restore();}
  });
}
