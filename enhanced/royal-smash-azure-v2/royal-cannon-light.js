/* Isolated presentation helper; this file does not install itself.
 *
 * const light = createRoyalCannonLight(g, state);
 * light.tryInstall(); // retry during normal startup until g.effects exists
 * light.dispose();    // stop future attenuation; native particles finish normally
 *
 * Prerequisite: forward playCannonFireParticles options unchanged. The source
 * systemTweaks.tint multiplies shared constant startColor.maxColor in place;
 * do not use it for these cannon systems. This helper adds no tint/options.
 *
 * Original emitParticleCount arguments, this, return and thrown objects pass
 * through. Only two native newborn Sprite records get independent alpha:
 * Glow x .35, ImpactCircle x .45. No source descriptor, material color, count,
 * lifetime, emission schedule, random source, transforms or gameplay changes.
 */

const FACTORS = Object.freeze({Glow:.35, ImpactCircle:.45});
const instances = new WeakMap();

export function createRoyalCannonLight(g, state) {
  if (!g || !state) throw new TypeError('Cannon light requires game and presentation state');
  const prior = instances.get(g);
  if (prior && !prior.diagnostics.disposed) {
    state.cannonLight = prior.diagnostics;
    return prior;
  }
  const diagnostics = state.cannonLight = {
    version:'royal-cannon-light-1', installed:false, disposed:false,
    observedCalls:0, targetedCalls:0, attenuatedBirths:0,
    bySystem:{Glow:{factor:.35,births:0},ImpactCircle:{factor:.45,births:0}},
    skipped:{unexpectedTint:0,unsupportedRecord:0,alreadyApplied:0,arrayReplaced:0},
    errors:[],
  };
  const processed = new WeakSet();
  let owner = null, nativeEmit = null, wrapper = null, disposed = false;

  function error(where, failure) {
    if (diagnostics.errors.length < 12) diagnostics.errors.push({where,message:String(failure?.message || failure)});
  }
  function detach() {
    if (owner?.emitParticleCount === wrapper) owner.emitParticleCount = nativeEmit;
    owner = nativeEmit = wrapper = null;
    diagnostics.installed = false;
  }
  function prepare(receiver, target, args) {
    if (disposed || owner !== target || receiver !== target || g.effects !== target) return null;
    diagnostics.observedCalls++;
    const [effect,,system] = args;
    const factor = Object.hasOwn(FACTORS, system?.name) ? FACTORS[system.name] : 0;
    if (!factor || effect?.root?.name !== 'CannonFireParticle' || effect.unity || !Array.isArray(effect.particles)) return null;
    // Native Kx has no tint. If another modifier adds one, the original call
    // still runs unchanged, but this helper refuses to compound that mutation.
    if (effect.systemTweaks?.[system.name]?.tint) {
      diagnostics.skipped.unexpectedTint++;
      return null;
    }
    diagnostics.targetedCalls++;
    return {effect, system, factor, particles:effect.particles, first:effect.particles.length};
  }
  function applyBirths(record) {
    const {effect, system, factor, particles, first} = record;
    if (effect.particles !== particles || particles.length < first) {
      diagnostics.skipped.arrayReplaced++;
      return;
    }
    for (let index = first; index < particles.length; index++) {
      const particle = particles[index];
      if (!particle || typeof particle !== 'object') { diagnostics.skipped.unsupportedRecord++; continue; }
      if (processed.has(particle)) { diagnostics.skipped.alreadyApplied++; continue; }
      const color = particle.startColor, material = particle.sprite?.material;
      // The actual Glow (native roundBillboard) and ImpactCircle use this path.
      // Other emitter implementations fail closed rather than editing a shared
      // mesh material or assuming their alpha update has the same contract.
      if (particle.system !== system || particle.unity || particle.localQuad || particle.hidden || particle.meshParticle ||
          particle.sharedMeshMaterial || !particle.sprite?.isSprite ||
          !material?.isSpriteMaterial || !color || typeof color !== 'object' ||
          !Number.isFinite(color.a) || color.a < 0 || color.a > 1 ||
          !Number.isFinite(material.opacity) || material.opacity < 0 || material.opacity > 1) {
        diagnostics.skipped.unsupportedRecord++;
        continue;
      }
      const birthOpacity = material.opacity;
      // jg(state=0) returns the descriptor's shared maxColor. A plain own copy
      // is essential: mutating color.a would alter siblings and later shots.
      const ownColor = {...color, a:color.a*factor};
      try {
        particle.startColor = ownColor;
        material.opacity = birthOpacity*factor;
        processed.add(particle);
        diagnostics.attenuatedBirths++;
        diagnostics.bySystem[system.name].births++;
      } catch (failure) {
        error('birth alpha', failure);
        // Best-effort rollback; presentation failures never replace a native
        // return or prevent its caller from completing the accepted action.
        try { particle.startColor = color; } catch (restoreFailure) { error('restore color', restoreFailure); }
        try { material.opacity = birthOpacity; } catch (restoreFailure) { error('restore opacity', restoreFailure); }
      }
    }
  }
  function tryInstall() {
    if (disposed) return false;
    const next = g.effects;
    if (!next || typeof next.emitParticleCount !== 'function') return false;
    if (owner === next) return true;
    detach();
    owner = next;
    nativeEmit = next.emitParticleCount;
    const source = nativeEmit, target = next;
    wrapper = function(...args) {
      let record = null;
      try { record = prepare(this, target, args); }
      catch (failure) { error('prepare', failure); }
      const result = source.apply(this, args); // intentionally outside catches
      if (record && !disposed && owner === target) {
        try { applyBirths(record); }
        catch (failure) { error('apply births', failure); }
      }
      return result;
    };
    next.emitParticleCount = wrapper;
    diagnostics.installed = true;
    return true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    diagnostics.disposed = true;
    detach();
    // No live material/descriptor restoration is needed: original particle
    // lifetime and pool release own cleanup. Existing own colors are harmless.
  }
  const api = {tryInstall, dispose, diagnostics};
  instances.set(g, api);
  return api;
}
