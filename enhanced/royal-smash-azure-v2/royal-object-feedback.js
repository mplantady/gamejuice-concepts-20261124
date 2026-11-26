/* Azure Coast v2.1: integrated presentation-only object feedback.
 * Source contract: original-game.js tT.sync, handleBallObject, activateBall,
 * attachCannonBallTrail and Il. See checks/vfx-source-integration-audit.json.
 *
 * const feedback = createRoyalObjectFeedback(g, state, artAllocation);
 * feedback.tryInstall();                       // retry from render startup
 * const token = feedback.captureContact(ball, object, contactPoint);
 * const result = originalHandle.apply(this, args); // exactly once
 * const anchor = feedback.acceptContact(token); // null unless source accepted
 * feedback.resolveAnchor(anchor, reusableXYZ);  // after displayed matrices sync
 * feedback.refineBallTrail(actualBall);          // after accepted createBall
 * feedback.reset();                             // before loadLevel/clearStage
 * feedback.dispose();                           // remove our sync hook
 *
 * No source material, geometry, transforms, visibility, source RNG, physics,
 * trail sampling, input or clocks are changed. Source sync returns/throws pass
 * through unchanged. Singleton/fallback pieces use the caller's attached cue;
 * this module deliberately does not animate a shared-material fallback.
 */

const knownAttributes = new WeakMap();
const CAN_TYPES = new Set([1, 2, 3]);
const WHITE = {toArray(array, offset = 0) {
  array[offset] = array[offset + 1] = array[offset + 2] = 1;
  return array;
}};
const finiteXYZ = p => p && [p.x, p.y, p.z].every(Number.isFinite);
const now = () => performance.now();

function visibleToScene(mesh, scene) {
  for (let node = mesh; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === scene) return true;
  }
  return false;
}

// Source Zw visibility and tT.sync compaction, in the same order. Source
// entry.suppressed is insufficient: invisible entries are suppressed too.
function compactEntries(batch, scene) {
  const slots = [];
  for (const entry of batch.entries || []) {
    if (entry.piece.fallback || entry.piece.poseFallback) continue;
    if (visibleToScene(entry.mesh, scene)) slots.push(entry);
  }
  return slots;
}

function localPoint(point, body) {
  const p = body?.position, q = body?.quaternion;
  if (!finiteXYZ(point) || !finiteXYZ(p) || !finiteXYZ(q) || !Number.isFinite(q.w)) return null;
  const lengthSq = q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w;
  if (!(lengthSq > 1e-12)) return null;
  const norm = Math.sqrt(lengthSq);
  const x = -q.x/norm, y = -q.y/norm, z = -q.z/norm, w = q.w/norm;
  const vx = point.x-p.x, vy = point.y-p.y, vz = point.z-p.z;
  const tx = 2*(y*vz-z*vy), ty = 2*(z*vx-x*vz), tz = 2*(x*vy-y*vx);
  return {x:vx+w*tx+y*tz-z*ty, y:vy+w*ty+z*tx-x*tz, z:vz+w*tz+x*ty-y*tx};
}

export function createRoyalObjectFeedback(g, state, artAllocation) {
  if (!g || !state || typeof artAllocation !== 'function') {
    throw new TypeError('Object feedback requires game, state and synchronous private artAllocation');
  }
  const diagnostics = state.objectFeedback = {
    version:'royal-object-feedback-1', installed:false, disposed:false,
    acceptedContacts:0, rejectedContacts:0, activePulses:0, mappedHitInstances:0,
    fallbackHitPieces:0, initializedBatches:0, liveOwnedBatches:0,
    mappingMismatches:0, foreignColorBatches:0, refinedTrails:0,
    liveRefinedTrails:0, staleTrailsReleased:0, resets:0, errors:[],
  };
  const pulses = new Map(), attributes = new Map(), trails = new Map();
  const pendingContacts = new WeakSet();
  const foreignBatches = new WeakSet();
  let disposed = false, manager = null, originalSync = null, syncWrapper = null, epoch = 0;

  function error(where, value) {
    if (diagnostics.errors.length < 12) diagnostics.errors.push({where, message:String(value?.message || value)});
  }
  function isObjectLive(object, sequence) {
    return sequence === g.fireSeq && object && CAN_TYPES.has(Number(object.type)) &&
      !object.cleared && !object.beingDestroyed && !object.sinking &&
      g.objects?.includes(object) && object.group && visibleToScene(object.group, g.scene);
  }
  function isLaunchLive(record) {
    return record.epoch === epoch && record.fireSeq === g.fireSeq && record.ball?.active && !record.ball.destroyed &&
      record.ball.launchSeq === record.launchSeq;
  }
  function flushAttribute(record, changed) {
    if (!changed) return;
    record.attribute.clearUpdateRanges?.();
    record.attribute.addUpdateRange?.(0, record.attribute.array.length);
    record.attribute.needsUpdate = true;
  }
  function neutral(record) {
    if (record.mesh.instanceColor !== record.attribute) return;
    const array = record.attribute.array;
    let changed = false;
    for (let i = 0; i < array.length; i++) if (array[i] !== 1) { array[i] = 1; changed = true; }
    flushAttribute(record, changed);
  }
  function neutralSafely(record) {
    try { neutral(record); } catch (failure) { error('neutral', failure); }
  }
  function ensureAttribute(mesh) {
    if (attributes.has(mesh)) {
      const record = attributes.get(mesh);
      if (record.attribute === mesh.instanceColor) return record;
      attributes.delete(mesh);
    }
    if (mesh.instanceColor && knownAttributes.get(mesh) !== mesh.instanceColor) {
      if (!foreignBatches.has(mesh)) { foreignBatches.add(mesh); diagnostics.foreignColorBatches++; }
      return null; // another presentation owns it; do not overwrite its colors
    }
    if (!mesh.instanceColor) {
      const capacity = mesh.instanceMatrix?.count;
      if (!Number.isInteger(capacity) || capacity < 1 || typeof mesh.setColorAt !== 'function') return null;
      // Native setColorAt constructs the original engine's InstancedBufferAttribute.
      // All capacity slots become neutral before any source render can use them.
      artAllocation(() => mesh.setColorAt(0, WHITE));
      if (!mesh.instanceColor?.array || mesh.instanceColor.array.length !== capacity*3) return null;
      knownAttributes.set(mesh, mesh.instanceColor);
      diagnostics.initializedBatches++;
    }
    const record = {mesh, attribute:mesh.instanceColor};
    attributes.set(mesh, record);
    neutral(record);
    return record;
  }
  function restoreTrail(trail, record) {
    if (trail.descriptor === record.owned) trail.descriptor = record.original;
    trails.delete(trail);
  }
  function pruneTrails() {
    const effects = g.effects?.systemEffects || [];
    for (const [trail, record] of trails) {
      if (!isLaunchLive(record) || !trail.active || !record.ball.group?.parent ||
          trail.ownerRoot !== record.ball.group || !effects.includes(record.effect) ||
          !record.effect.trails?.includes(trail)) {
        restoreTrail(trail, record);
        diagnostics.staleTrailsReleased++;
      }
    }
    diagnostics.liveRefinedTrails = trails.size;
  }
  function strength(object, time) {
    const pulse = pulses.get(object);
    if (!pulse) return 0;
    if (!isObjectLive(object, pulse.fireSeq) || !isLaunchLive(pulse)) { pulses.delete(object); return 0; }
    const elapsed = Math.max(0, time-pulse.acceptedAt);
    const duration = state.lowMotion ? 110 : 240;
    if (elapsed >= duration) { pulses.delete(object); return 0; }
    // A single gentle luminance cue in Calm; no motion, repeated flashing or
    // new geometry. Normal mode has a 28ms onset and one decaying highlight.
    if (state.lowMotion) return .12 * (1-elapsed/duration);
    const attack = Math.min(1, elapsed/28);
    const decay = Math.max(0, 1-(elapsed-28)/(duration-28));
    return .31 * attack * decay * decay;
  }
  function afterSync(sourceManager, time) {
    pruneTrails();
    const liveMeshes = new Set((sourceManager.batches || []).map(batch => batch.mesh));
    for (const [mesh, record] of attributes) if (!liveMeshes.has(mesh)) { neutral(record); attributes.delete(mesh); }
    for (const object of pulses.keys()) strength(object, time);
    let hitInstances = 0;
    const mappedObjects = new Set();
    for (const batch of sourceManager.batches || []) {
      const record = ensureAttribute(batch.mesh);
      if (!record) continue;
      const slots = compactEntries(batch, g.scene);
      if (slots.length !== batch.mesh.count || slots.length*3 > record.attribute.array.length) {
        diagnostics.mappingMismatches++;
        neutral(record);
        continue;
      }
      const array = record.attribute.array;
      let changed = false;
      // Whiten unused capacity too, so compaction and later reuse cannot expose
      // an old hit color. Never write instanceMatrix, count or mesh visibility.
      for (let slot = 0; slot < array.length/3; slot++) {
        const object = slots[slot]?.piece.object;
        const pulse = object ? strength(object, time) : 0;
        if (pulse > 0) hitInstances++;
        if (object && pulses.has(object)) mappedObjects.add(object);
        for (let channel = 0; channel < 3; channel++) {
          const index = slot*3+channel;
          const value = Math.fround(1+pulse*(channel === 0 ? 1 : channel === 1 ? .86 : .57));
          if (array[index] !== value) { array[index] = value; changed = true; }
        }
      }
      flushAttribute(record, changed);
    }
    diagnostics.activePulses = pulses.size;
    diagnostics.mappedHitInstances = hitInstances;
    diagnostics.fallbackHitPieces = [...pulses.keys()].filter(object => !mappedObjects.has(object)).length;
    diagnostics.liveOwnedBatches = attributes.size;
  }
  function detach() {
    if (manager?.sync === syncWrapper) manager.sync = originalSync;
    manager = originalSync = syncWrapper = null;
    diagnostics.installed = false;
  }
  function tryInstall() {
    if (disposed) return false;
    const next = g.pieceInstances;
    if (!next || typeof next.sync !== 'function') return false;
    if (manager === next) return true;
    for (const record of attributes.values()) neutralSafely(record);
    attributes.clear();
    detach();
    manager = next;
    originalSync = next.sync;
    const sourceSync = originalSync, target = next;
    syncWrapper = function(...args) {
      // Source throw is intentionally outside our catch. Presentation failure
      // cannot replace the source return value, throw or invocation count.
      const result = sourceSync.apply(this, args);
      if (!disposed && manager === target && this === target) {
        try { afterSync(target, now()); }
        catch (failure) {
          error('afterSync', failure);
          for (const record of attributes.values()) neutralSafely(record);
        }
      }
      return result;
    };
    next.sync = syncWrapper;
    diagnostics.installed = true;
    // Warm attributes without invoking sync, changing counts or requiring a
    // source render. Call again each frame; the wrapper finds later rebuilds.
    try { for (const batch of next.batches || []) ensureAttribute(batch.mesh); }
    catch (failure) { error('initialize', failure); }
    return true;
  }
  function captureContact(ball, object, contactPoint) {
    if (disposed || !ball?.active || ball.destroyed || !isObjectLive(object, g.fireSeq)) return null;
    const world = contactPoint || ball.body?.position;
    const local = localPoint(world, object.body);
    if (!local || !Number.isFinite(ball.launchSeq) || !Number.isFinite(ball.obstacleHits)) return null;
    const token = {ball, object, epoch, fireSeq:g.fireSeq, launchSeq:ball.launchSeq,
      beforeHits:ball.obstacleHits, local, world:{x:world.x,y:world.y,z:world.z}};
    pendingContacts.add(token);
    return token;
  }
  function acceptContact(token) {
    if (disposed || !token || !pendingContacts.has(token)) return null;
    pendingContacts.delete(token);
    if (token.epoch !== epoch || token.fireSeq !== g.fireSeq || token.ball.launchSeq !== token.launchSeq ||
        !(token.ball.obstacleHits > token.beforeHits)) { diagnostics.rejectedContacts++; return null; }
    const anchor = {...token, acceptedAt:now()};
    diagnostics.acceptedContacts++;
    if (isObjectLive(anchor.object, anchor.fireSeq) && isLaunchLive(anchor)) pulses.set(anchor.object, anchor);
    return anchor;
  }
  function resolveAnchor(anchor, out = {}) {
    if (disposed || !anchor || !isObjectLive(anchor.object, anchor.fireSeq) || !isLaunchLive(anchor)) return null;
    const e = anchor.object.group.matrixWorld?.elements, p = anchor.local;
    if (!e || e.length !== 16 || !finiteXYZ(p) || !e.every(Number.isFinite)) return null;
    // Read the displayed matrix only. Do not update world matrices here: caller
    // owns rendering, including any temporary presentation transforms.
    out.x = e[0]*p.x+e[4]*p.y+e[8]*p.z+e[12];
    out.y = e[1]*p.x+e[5]*p.y+e[9]*p.z+e[13];
    out.z = e[2]*p.x+e[6]*p.y+e[10]*p.z+e[14];
    return out;
  }
  function refineBallTrail(ball) {
    if (disposed || !ball?.active || ball.destroyed || !Number.isFinite(ball.launchSeq) ||
        !ball.group?.parent || !g.balls?.includes(ball)) return 0;
    pruneTrails();
    let count = 0;
    for (const effect of g.effects?.systemEffects || []) {
      if (effect.ownerRoot !== ball.group) continue;
      for (const trail of effect.trails || []) {
        if (trails.has(trail) || !trail.active || trail.bouncer || trail.ownerRoot !== ball.group ||
            trail.descriptor?.materialName !== 'M_TrailBall' || !trail.descriptor.enabled) continue;
        const original = trail.descriptor;
        // No new trail, renderer object, material, geometry, sampling, alpha,
        // width or lifetime. Source segment count/allocation schedule is exact.
        const owned = artAllocation(() => ({...original, colorGradient:{
          ...(original.colorGradient || {}),
          colors:[{time:0,color:[.71,.88,1,1]}, {time:.58,color:[.89,.95,1,1]},
            {time:1,color:[1,.91,.72,1]}],
          alphas:(original.colorGradient?.alphas || []).map(key => ({...key})),
        }}));
        trail.descriptor = owned;
        trails.set(trail, {original, owned, effect, ball, epoch, launchSeq:ball.launchSeq, fireSeq:g.fireSeq});
        diagnostics.refinedTrails++;
        count++;
      }
    }
    diagnostics.liveRefinedTrails = trails.size;
    return count;
  }
  function reset() {
    epoch++;
    pulses.clear();
    for (const record of attributes.values()) neutralSafely(record);
    for (const [trail, record] of trails) {
      try { restoreTrail(trail, record); }
      catch (failure) { error('restoreTrail', failure); trails.delete(trail); }
    }
    diagnostics.activePulses = diagnostics.mappedHitInstances = diagnostics.fallbackHitPieces = 0;
    diagnostics.liveRefinedTrails = 0;
    diagnostics.resets++;
  }
  function dispose() {
    if (disposed) return;
    reset();
    disposed = true;
    diagnostics.disposed = true;
    detach();
    attributes.clear();
    diagnostics.liveOwnedBatches = 0;
    // White attributes remain source-owned until native batch.dispose().
    // Removing them here can orphan a renderer buffer; white is pixel-neutral.
  }
  return {tryInstall, captureContact, acceptContact, resolveAnchor, refineBallTrail,
    reset, dispose, diagnostics};
}
