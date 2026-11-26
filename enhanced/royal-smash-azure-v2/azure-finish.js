/* Azure Coast v2 presentation only. Original geometry, object hierarchies,
 * transforms, hit regions, physics, clocks and event handlers are retained.
 *
 * Optional art-manifest contract (filenames relative to assets/):
 * ui: {
 *   badgeSkin: 'ui-badge-azure.png', // blank composite, 259.11:254.51 aspect
 *   badgeLayers: {ui_moves_outer: '...', ui_moves_inner: '...',
 *     ui_moves_header_inner: '...', ui_moves_header_frame: '...'},
 *   playNowSurface: 'ui-jade-cta.png', // blank surface, 563:201 aspect
 *   retrySurface: 'ui-jade-retry.png'  // optional, defaults to playNowSurface
 * }
 * badgeSkin takes visual precedence over badgeLayers. Native DOM text remains.
 * Include azure-finish.css after royal-polish.css in the versioned package.
 */

const installations = new WeakMap();
const FINISH_VERSION = 'azure-finish-v2.1';
const BADGE_VARIABLES = {
  ui_moves_outer: '--moves-outer',
  ui_moves_inner: '--moves-inner',
  ui_moves_header_inner: '--moves-header-inner',
  ui_moves_header_frame: '--moves-header-frame',
};
const PROFILE_FIELDS = ['baseBrightness', 'baseContrast', 'baseSaturation',
  'diffuseWrap', 'diffuseBrightness', 'diffuseContrast', 'ambientBrightness',
  'matCapBrightness', 'matCapContrast', 'specularBrightness', 'specularSmoothness'];

function family(name) {
  if (/^Can_1x[1-5]$/.test(name)) return 'cylinder';
  if (name === 'Can_Conical') return 'cone';
  if (/^Square_Can_1x[1-5]$/.test(name)) return 'square';
  if (name === 'HardTable') return 'table';
  if (name === 'HardTablePole') return 'pole';
  if (name === 'Cannon') return 'cannon';
  if (name === 'CannonBall') return 'ball';
  if (name === 'HardCannonFloor') return 'rail';
  return null;
}

// The original table's specular brightness is 16.3. Bring light into the
// material range so authored paint remains legible instead of turning white.
const PROFILES = {
  cylinder: {baseBrightness: 1.10, baseContrast: 1.025, baseSaturation: 1.035,
    diffuseWrap: .16, diffuseBrightness: 1.20, diffuseContrast: 1.06,
    ambientBrightness: .96, matCapBrightness: .72, matCapContrast: .56},
  cone: {baseBrightness: 1.04, baseContrast: 1.025, baseSaturation: 1.035,
    diffuseWrap: .12, diffuseBrightness: 1.16, diffuseContrast: 1.06,
    ambientBrightness: .96, matCapBrightness: .86, matCapContrast: .50},
  square: {baseBrightness: 1.04, baseContrast: 1.025, baseSaturation: 1.035,
    diffuseWrap: -.10, diffuseBrightness: 1.45, diffuseContrast: 1.08,
    ambientBrightness: .96, matCapBrightness: .72, matCapContrast: .42,
    specularBrightness: .14, specularSmoothness: 24},
  table: {baseBrightness: .90, baseContrast: 1.02, baseSaturation: 1.10,
    diffuseWrap: .70, diffuseBrightness: 1.0, diffuseContrast: 1.18,
    ambientBrightness: 1.0, matCapBrightness: 1.25, matCapContrast: .85,
    specularBrightness: .45, specularSmoothness: 18},
  pole: {baseBrightness: 1.02, baseContrast: 1.02, baseSaturation: 1.05,
    diffuseWrap: .55, diffuseBrightness: .95, diffuseContrast: 1.10,
    ambientBrightness: 1.0, matCapBrightness: 1.25, matCapContrast: .90,
    specularBrightness: .22, specularSmoothness: 18},
};

function copyValue(value) {
  if (Array.isArray(value)) return value.map(copyValue);
  if (value?.isColor || value?.isVector2 || value?.isVector3 || value?.isVector4) return value.clone();
  return value;
}

function profileSnapshot(profile) {
  return profile ? Object.fromEntries(PROFILE_FIELDS.filter(k => k in profile).map(k => [k, profile[k]])) : null;
}

function textureUrl(file) {
  if (typeof file !== 'string' || !file.trim()) throw Error('Azure UI artwork needs a nonempty filename');
  return /^(?:data:|blob:|https?:|\/|\.\/assets\/|assets\/)/.test(file) ? file : `assets/${file}`;
}

function cssImage(file) {
  // JSON string quoting is valid inside CSS url(); this never enters a shell.
  return `url(${JSON.stringify(textureUrl(file))})`;
}

export async function installAzureFinish(g, state, artConfig, loadImage, artAllocation) {
  if (installations.has(g)) return installations.get(g);
  const pending = install(g, state, artConfig || {}, loadImage, artAllocation);
  installations.set(g, pending);
  return pending;
}

async function install(g, state, artConfig, loadImage, artAllocation) {
  const diagnostics = state.azureFinish = {
    version: FINISH_VERSION, ready: false, materialChanges: [], shaderCompiles: 0,
    shaderWarnings: [], ui: {loaded: [], errors: [], badgeDraws: 0},
    batchRebuilds: 0, errors: [],
  };
  const allocate = typeof artAllocation === 'function' ? artAllocation : fn => fn();
  const patched = new WeakSet();
  const userFinish = artConfig.finish || {};
  const bounded = (value, fallback, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
  const celStrength = bounded(userFinish.celStrength, .13, .30);
  const contourStrength = bounded(userFinish.contourStrength, .12, .25);

  function finishMaterial(material) {
    if (!material || patched.has(material)) return material;
    const kind = family(material.name || '');
    if (!kind) return material;
    patched.add(material);
    const originalDescriptor = material.userData?.extractedMaterial;
    const before = {roughness: material.roughness, color: material.color?.toArray?.(),
      omni: profileSnapshot(originalDescriptor?.omni)};
    if (originalDescriptor) {
      // Never mutate the engine's shared descriptor or Color instances.
      material.userData.extractedMaterial = allocate(() => ({
        ...originalDescriptor,
        color: copyValue(originalDescriptor.color),
        ...(originalDescriptor.omni ? {omni: Object.fromEntries(
          Object.entries(originalDescriptor.omni).map(([key, value]) => [key, copyValue(value)]))} : {}),
      }));
    }
    const omni = material.userData?.extractedMaterial?.omni;
    if (omni && PROFILES[kind]) {
      Object.assign(omni, PROFILES[kind]);
      // Keep baked atlas hue and true volume. The supplemental finish gently
      // groups light values and darkens grazing edges; it adds no geometry.
      const priorCompile = material.onBeforeCompile;
      const priorKey = material.customProgramCacheKey;
      const localCel = (kind === 'table' || kind === 'pole') ? celStrength * .65 : celStrength;
      const localContour = (kind === 'table' || kind === 'pole') ? contourStrength * .65 : contourStrength;
      material.onBeforeCompile = function(shader, renderer) {
        priorCompile?.call(this, shader, renderer);
        diagnostics.shaderCompiles++;
        const anchor = '#include <opaque_fragment>';
        if (!shader.fragmentShader.includes(anchor)) {
          const warning = `No opaque fragment anchor for ${this.name}; source shader retained`;
          if (!diagnostics.shaderWarnings.includes(warning)) diagnostics.shaderWarnings.push(warning);
          return;
        }
        // outgoingLight, normal and vViewPosition are standard Lambert shader
        // values, also retained by the existing OmniShade compilation hook.
        const finish = `
  float azureLuma = max(dot(max(outgoingLight, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722)), 0.0001);
  float azureSoftBands = 0.18 + 0.40 * smoothstep(0.10, 0.50, azureLuma)
    + 0.36 * smoothstep(0.50, 1.00, azureLuma);
  float azureTonalRatio = clamp(azureSoftBands / max(azureLuma, 0.035), 0.78, 1.18);
  float azureFacing = abs(dot(normalize(normal), normalize(vViewPosition)));
  float azureEdge = 1.0 - smoothstep(0.025, 0.30, azureFacing);
  outgoingLight *= mix(1.0, azureTonalRatio, ${localCel.toFixed(5)});
  outgoingLight *= 1.0 - azureEdge * ${localContour.toFixed(5)};
`;
        shader.fragmentShader = shader.fragmentShader.replace(anchor, finish + anchor);
      };
      material.customProgramCacheKey = function() {
        return `${priorKey?.call(this) || ''}:${FINISH_VERSION}:${kind}:${localCel}:${localContour}`;
      };
    } else if (kind === 'cannon') {
      material.roughness = .56;
      material.color?.setRGB(1.08, 1.08, 1.08);
    } else if (kind === 'ball') {
      material.roughness = .62;
    } else if (kind === 'rail') {
      material.roughness = .72;
    }
    material.needsUpdate = true;
    diagnostics.materialChanges.push({name: material.name, kind, before,
      after: {roughness: material.roughness, color: material.color?.toArray?.(),
        omni: profileSnapshot(material.userData?.extractedMaterial?.omni)}});
    return material;
  }

  const ui = artConfig.ui || {};
  const configured = new Map();
  for (const key of ['badgeSkin', 'playNowSurface', 'retrySurface']) if (ui[key]) configured.set(key, ui[key]);
  if (!configured.has('retrySurface') && ui.playNowSurface) configured.set('retrySurface', ui.playNowSurface);
  for (const [key, file] of Object.entries(ui.badgeLayers || {})) {
    if (BADGE_VARIABLES[key] && file) configured.set(key, file);
  }
  const images = new Map();
  const imageLoads = new Map();
  await Promise.all([...configured].map(async ([key, file]) => {
    try {
      const url = textureUrl(file);
      if (!imageLoads.has(url)) imageLoads.set(url, loadImage(url));
      const image = await imageLoads.get(url);
      images.set(key, image);
      diagnostics.ui.loaded.push({key, file, width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height});
    } catch (error) {
      diagnostics.ui.errors.push(`${key}: ${String(error)}`);
    }
  }));

  // Await artwork before changing batch snapshots. Everything from this point
  // through the single rebuild is synchronous, so loading cannot leave targets
  // rendering for seconds through the engine's slower individual fallback.
  const originalMaterial = g.assets.material;
  g.assets.material = function(...args) { return finishMaterial(originalMaterial.apply(this, args)); };
  for (const material of g.assets.materialCache.values()) finishMaterial(material);
  function finishPooledBall(ball) {
    for (const record of ball?.fadeMaterials || []) finishMaterial(record.material);
    return ball;
  }
  for (const ball of g.ballPool || []) finishPooledBall(ball);
  const originalPooledBall = g.createPooledBall;
  if (typeof originalPooledBall === 'function') {
    g.createPooledBall = function(...args) { return finishPooledBall(originalPooledBall.apply(this, args)); };
  }

  const app = document.getElementById('app');
  document.body.classList.add('azure-finish');
  function labelSurface(element, key, fallbackLabel) {
    if (!element || !images.has(key)) return;
    element.classList.add('azure-cta-surface');
    element.style.setProperty('--azure-cta-surface', cssImage(configured.get(key)));
    // End-card art uses inline backgrounds, so update that surface explicitly.
    element.style.backgroundImage = cssImage(configured.get(key));
    let label = element.querySelector(':scope > .azure-cta-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'azure-cta-label';
      label.setAttribute('aria-hidden', 'true');
      label.textContent = fallbackLabel;
      element.appendChild(label);
    }
  }
  function applyUiSurfaces() {
    for (const [key, variable] of Object.entries(BADGE_VARIABLES)) {
      if (images.has(key)) app?.style.setProperty(variable, cssImage(configured.get(key)));
    }
    labelSurface(g.ui?.playNowCta || document.getElementById('playNowCta'), 'playNowSurface', 'Play Now');
    labelSurface(g.ui?.failRetry || document.getElementById('failRetry'), 'retrySurface', 'Retry');
    labelSurface(document.querySelector('#endCard .ecPlay'), 'playNowSurface', 'Play Now');
  }
  const originalApplyUi = g.applyUiSprites;
  if (typeof originalApplyUi === 'function') g.applyUiSprites = function(...args) {
    const result = originalApplyUi.apply(this, args); applyUiSurfaces(); return result;
  };
  for (const name of ['showEndCard', 'addFailRetryButton']) {
    const original = g[name];
    if (typeof original === 'function') g[name] = function(...args) {
      const result = original.apply(this, args); applyUiSurfaces(); return result;
    };
  }
  const originalDrawBadge = g.drawMovesBadge;
  if (typeof originalDrawBadge === 'function') {
    g.drawMovesBadge = function(...args) {
      // Assign just before the original draw, so the source asynchronous image
      // completion cannot overwrite our image choice during startup/remount.
      for (const layer of this.movesBadge?.layers || []) if (images.has(layer.name)) layer.img = images.get(layer.name);
      const result = originalDrawBadge.apply(this, args);
      const badge = this.movesBadge;
      if (result && badge?.ready && images.has('badgeSkin')) {
        const canvas = badge.canvas;
        const context = canvas.getContext('2d');
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(images.get('badgeSkin'), 0, 0, canvas.width, canvas.height);
        context.restore();
        diagnostics.ui.badgeDraws++;
        diagnostics.ui.badgeCanvas = {width: canvas.width, height: canvas.height,
          cssWidth: canvas.style.width, cssHeight: canvas.style.height, cssTop: canvas.style.top};
      }
      return result;
    };
  }
  applyUiSurfaces();
  g.drawMovesBadge?.();
  diagnostics.ui.mode = images.has('badgeSkin') ? 'source-sized composite with native text'
    : Object.keys(BADGE_VARIABLES).some(key => images.has(key)) ? 'original nine-slice images with native text' : 'original badge artwork';
  diagnostics.ui.nativeText = ['movesLabel', 'movesUnder', 'movesValue', 'movesFace'].map(id => {
    const node = document.getElementById(id); return {id, text: node?.textContent || '', present: !!node};
  });
  diagnostics.ui.contract = {badgeDesignSize: [259.11, 254.51], ctaDesignSize: [563, 201],
    layoutChanged: false, handlersChanged: false, nativeCountRetained: true};

  // Material snapshot changes intentionally require one final render-batch
  // rebuild. This engine routine uses its own UUID RNG; its physics is untouched.
  if (g.pieceInstances?.rebuild) {
    diagnostics.batchesBefore = g.pieceInstances.stats?.();
    allocate(() => g.pieceInstances.rebuild(g.objects));
    diagnostics.batchRebuilds++;
    diagnostics.batchesAfter = g.pieceInstances.stats?.();
  }
  diagnostics.errors.push(...diagnostics.ui.errors);
  diagnostics.ready = diagnostics.errors.length === 0;
  if (diagnostics.errors.length) state.errors?.push(...diagnostics.errors.map(error => `[Azure finish] ${error}`));
  return diagnostics;
}
