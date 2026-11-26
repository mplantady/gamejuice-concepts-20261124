/**
 * Articulated, presentation-only latch replacement for Rotate Rings.
 *
 * const rig = createLatchRig({ Node, sprite, dirty, scale,
 *   onContact: (owner, name) => playSettleSound(owner, name) });
 * rig.attach(game, { socketTexture, jawTexture }); // after setupLevel/assets
 * // Wrap the real link operation: oldBreak(owner,name); rig.release(owner,name,time);
 * rig.update(timeInSeconds, reducedMotion); // same monotonic render clock
 *
 * Textures are full-UV transparent images. Socket: logical14x45. Jaw:34x31.
 * The unchanged arm owns position, rejection wobble, escape and opacity.
 * This module never changes ring data, links, scores, input or source timers.
 */
export function createLatchRig(api) {
  if (typeof api?.Node !== 'function' || typeof api?.sprite !== 'function') {
    throw new TypeError('createLatchRig requires the source Node and sprite API');
  }

  const REST_ANGLE = 12;
  const CONTACT_TIME = .19;
  const SETTLE_TIME = .4;
  const rigs = new Map();
  let game = null, generation = 0, clock = 0, reduced = false, ready = false;
  let releases = 0, contacts = 0, rejectedReleases = 0;
  let maxHingeError = 0, maxSocketError = 0;
  let maxPaintedJawError = 0, maxPaintedSocketError = 0, maxPaintedJointError = 0;
  let artRegistration = null;
  let events = [], errors = [];

  // Measured landmarks in assets-source/latch-parts.png, using the exact crops
  // and 2px aspect-fit gutter from cabinet-assets.js. The pin-axis landmarks
  // are visual estimates, not alpha bounds: jaw knuckle center (576,604), fixed
  // barrel axis x315 at the socket crop's vertical center y580.5. Runtime canvas
  // dimensions come from the actual texture; normalized Y is bottom-up because
  // the source sprite renderer uses (.5-ay)*height with world positive Y up.
  const PAINTED_PARTS = {
    socket: { crop: [103,168,364,993], canvas: [128,416], landmark: [315,580.5] },
    jaw: { crop: [513,323,1229,848], canvas: [384,352], landmark: [576,604] },
  };

  function paintedMapping(texture, part) {
    const spec = PAINTED_PARTS[part];
    const width = texture.image?.width || texture.userData?.w || spec.canvas[0];
    const height = texture.image?.height || texture.userData?.h || spec.canvas[1];
    const cropWidth = spec.crop[2]-spec.crop[0], cropHeight = spec.crop[3]-spec.crop[1];
    const fit = Math.min((width-4)/cropWidth, (height-4)/cropHeight);
    const fittedWidth = cropWidth*fit, fittedHeight = cropHeight*fit;
    const left = (width-fittedWidth)/2, top = (height-fittedHeight)/2;
    return { sourceCropPx: [...spec.crop], targetCanvasPx: [width,height],
      targetContentPx: [left,top,left+fittedWidth,top+fittedHeight],
      paintedLandmarkAtlasPx: [...spec.landmark], landmarkIsVisualEstimate: true,
      paintedLandmarkNormalized: {
        x: (left+(spec.landmark[0]-spec.crop[0])*fit)/width,
        y: 1-(top+(spec.landmark[1]-spec.crop[1])*fit)/height,
      } };
  }

  const keyFor = (owner, name) => `${owner}:${name}`;
  const note = (event, data = {}) => {
    events.push({ event, time: clock, generation, ...data });
    if (events.length > 120) events.shift();
  };
  const dirty = () => { if (typeof api.dirty === 'function') api.dirty(); };
  const alive = node => {
    if (!node) return false;
    for (let n = node; n; n = n.parent) if (n.isValid === false) return false;
    return true;
  };
  const couplingFor = (owner, name) => game?._linkSys?.couplings?.find(
    c => c.ownerRingId === owner && c.connectNode === name
  );

  function localPoint(transform, point) {
    const a = (transform.angle || 0) * Math.PI / 180;
    const x = point.x * (transform.sx ?? 1), y = point.y * (transform.sy ?? 1);
    return { x: (transform.x || 0) + Math.cos(a) * x - Math.sin(a) * y,
             y: (transform.y || 0) + Math.sin(a) * x + Math.cos(a) * y };
  }

  // Calculate from live local transforms, not wm matrices from a prior render.
  function worldPoint(node, point = { x: 0, y: 0 }) {
    let result = point;
    for (let n = node; n; n = n.parent) result = localPoint(n, result);
    return result;
  }

  function registration(r) {
    const hinge = worldPoint(r.jawPivot);
    const expectedHinge = worldPoint(r.arm, localPoint(r.restRig, { x: -10, y: 0 }));
    const socket = worldPoint(r.socket);
    const expectedSocket = worldPoint(r.arm, localPoint(r.restRig, { x: -17, y: 0 }));
    const hingeError = Math.hypot(hinge.x - expectedHinge.x, hinge.y - expectedHinge.y);
    const socketError = Math.hypot(socket.x - expectedSocket.x, socket.y - expectedSocket.y);
    // Check the actual painted landmark through current sprite anchors, width,
    // height and all live transforms. This detects art drift even when the
    // logical jaw_hinge/socket Nodes themselves remain perfectly registered.
    const paintedPoint = (node, mapping) => worldPoint(node, {
      x: (mapping.paintedLandmarkNormalized.x-node.ax)*node.w,
      y: (mapping.paintedLandmarkNormalized.y-node.ay)*node.h,
    });
    const paintedJaw = paintedPoint(r.jaw, r.art.jaw);
    const paintedSocket = paintedPoint(r.socket, r.art.socket);
    const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
    const paintedJawError = distance(paintedJaw,expectedHinge);
    const paintedSocketError = distance(paintedSocket,expectedHinge);
    const paintedJointError = distance(paintedJaw,paintedSocket);
    maxHingeError = Math.max(maxHingeError, hingeError);
    maxSocketError = Math.max(maxSocketError, socketError);
    maxPaintedJawError = Math.max(maxPaintedJawError, paintedJawError);
    maxPaintedSocketError = Math.max(maxPaintedSocketError, paintedSocketError);
    maxPaintedJointError = Math.max(maxPaintedJointError, paintedJointError);
    const scale = typeof api.scale === 'function' ? api.scale() : null;
    return { hingeWorld: hinge, expectedHingeWorld: expectedHinge,
      socketWorld: socket, expectedSocketWorld: expectedSocket,
      visualAnchors: { socket: { ax:r.socket.ax, ay:r.socket.ay },
                       jaw: { ax:r.jaw.ax, ay:r.jaw.ay } },
      paintedJawKnuckleWorld: paintedJaw, paintedSocketBarrelWorld: paintedSocket,
      paintedJawHingeErrorWorld: paintedJawError, paintedSocketHingeErrorWorld: paintedSocketError,
      paintedJointErrorWorld: paintedJointError,
      paintedJawHingeErrorPixels: Number.isFinite(scale) ? paintedJawError * scale : null,
      paintedSocketHingeErrorPixels: Number.isFinite(scale) ? paintedSocketError * scale : null,
      paintedJointErrorPixels: Number.isFinite(scale) ? paintedJointError * scale : null,
      hingeErrorWorld: hingeError, socketErrorWorld: socketError,
      hingeErrorPixels: Number.isFinite(scale) ? hingeError * scale : null,
      socketErrorPixels: Number.isFinite(scale) ? socketError * scale : null };
  }

  function removeRig(r) {
    // Color arrays are shared in the source; restore the original reference.
    if (alive(r.source) && r.source.sprite?.color === r.hiddenColor) {
      r.source.sprite.color = r.originalColor;
      if (r.source.sprite.mesh) {
        r.source.sprite.mesh.visible = r.originalVisible;
        r.source.sprite.mesh.material.opacity = r.originalOpacity;
      }
    }
    // setupLevel destroys arm descendants itself; do not dispose them twice.
    if (alive(r.root)) r.root.destroy();
  }

  function clear() {
    for (const r of rigs.values()) removeRig(r);
    rigs.clear();
    ready = false;
  }

  function attach(nextGame, textures = {}) {
    clear();
    game = nextGame || null;
    generation++;
    releases = contacts = rejectedReleases = 0;
    maxHingeError = maxSocketError = 0;
    maxPaintedJawError = maxPaintedSocketError = maxPaintedJointError = 0;
    artRegistration = null;
    events = []; errors = [];
    const { socketTexture, jawTexture } = textures;
    // Safe during normal asynchronous startup; root can attach after load/setup.
    if (!game?._connectArmNodes || !socketTexture || !jawTexture) return snapshot();
    artRegistration = { socket:paintedMapping(socketTexture,'socket'),
                        jaw:paintedMapping(jawTexture,'jaw') };

    for (const coupling of game._linkSys?.couplings || []) {
      const owner = coupling.ownerRingId, name = coupling.connectNode;
      const key = keyFor(owner, name), arm = game._connectArmNodes.get(key);
      const source = arm?.getChildByName('connect');
      if (!alive(arm) || !source?.sprite) continue;
      const root = new api.Node(`restyle_latch_${owner}_${name}`);
      // Copy the source part's rest transform; the arm/offset/slot remain intact.
      const restRig = { x: source.x, y: source.y, angle: source.angle,
                        sx: source.sx, sy: source.sy };
      Object.assign(root, restRig);
      arm.addChild(root);
      const socket = api.sprite('fixed_socket', socketTexture,
        { w: 14, h: 45, color: [255, 255, 255, 255] }, root);
      socket.setPosition(-17, 0);
      // Keep the socket Node at -17,0; move its painted barrel to -10,0 by
      // setting ax=0.802502394636-.5. Closed artwork stays inside 48×45.
      socket.ax = artRegistration.socket.paintedLandmarkNormalized.x-.5;
      socket.ay = .5;
      const jawPivot = new api.Node('jaw_hinge');
      jawPivot.setPosition(-10, 0);
      root.addChild(jawPivot);
      const jaw = api.sprite('articulated_jaw', jawTexture,
        { w: 34, h: 31, color: [255, 255, 255, 255] }, jawPivot);
      // Anchor the painted knuckle, not the transparent/painted left edge:
      // ax=0.092280609870, ay=0.472106716607 for the fitted 384×352 texture.
      // The logical pivot is still exactly -10,0, and the jaw remains 34×31.
      jaw.ax = artRegistration.jaw.paintedLandmarkNormalized.x;
      jaw.ay = artRegistration.jaw.paintedLandmarkNormalized.y;
      jaw.setPosition(0, 0);
      const originalColor = source.sprite.color;
      const hiddenColor = [...originalColor]; hiddenColor[3] = 0;
      const originalVisible = source.sprite.mesh.visible;
      const originalOpacity = source.sprite.mesh.material.opacity;
      source.sprite.color = hiddenColor;
      source.sprite.mesh.visible = false;
      source.sprite.mesh.material.opacity = 0;
      const broken = !coupling.linked;
      jawPivot.angle = broken ? REST_ANGLE : 0;
      const r = { owner, name, arm, source, root, socket, jawPivot, jaw, restRig,
        art:artRegistration,
        originalColor, hiddenColor, originalVisible, originalOpacity,
        coupling, broken, animated: broken, contactFired: broken,
        startedAt: null, fromAngle: jawPivot.angle, suppressMotion: false,
        phase: broken ? 'open' : 'closed' };
      rigs.set(key, r);
      registration(r);
    }
    ready = rigs.size > 0;
    note('attached', { latchCount: rigs.size });
    dirty();
    return snapshot();
  }

  function release(owner, name, time = clock) {
    const r = rigs.get(keyFor(owner, name));
    if (!r || !alive(r.root)) return false;
    // Must be called after the authoritative break; reject visual-only unlocks.
    if (couplingFor(owner, name)?.linked !== false) {
      rejectedReleases++; note('release-rejected-linked', { owner, name });
      return false;
    }
    if (r.animated) return false;
    const at = Number.isFinite(time) ? time : clock;
    r.broken = true; r.animated = true; r.contactFired = false;
    r.startedAt = at; r.fromAngle = r.jawPivot.angle;
    r.suppressMotion = reduced;
    r.phase = reduced ? 'reduced-open' : 'anticipation';
    if (reduced) r.jawPivot.angle = REST_ANGLE;
    releases++;
    note('release', { owner, name, eventTime: at });
    dirty();
    return true;
  }

  function pose(r, elapsed) {
    // Tension, opening impulse, contact overshoot, damped settle; no scale/bob.
    const frames = [[0, r.fromAngle], [.035, -3], [.11, 31],
                    [CONTACT_TIME, 8], [.255, 16], [SETTLE_TIME, REST_ANGLE]];
    for (let i = 1; i < frames.length; i++) {
      if (elapsed <= frames[i][0]) {
        const a = frames[i - 1], b = frames[i];
        const t = Math.max(0, Math.min(1, (elapsed - a[0]) / (b[0] - a[0])));
        const ease = t * t * (3 - 2 * t);
        return a[1] + (b[1] - a[1]) * ease;
      }
    }
    return REST_ANGLE;
  }

  function update(time, reducedMotion = false) {
    if (!Number.isFinite(time)) return;
    const rewound = time < clock - 1e-6;
    clock = time; reduced = !!reducedMotion;
    let moving = false;
    for (const [key, r] of rigs) {
      if (!alive(r.root) || game?._connectArmNodes?.get(key) !== r.arm) {
        removeRig(r); rigs.delete(key); continue;
      }
      const coupling = couplingFor(r.owner, r.name);
      if (!coupling) { removeRig(r); rigs.delete(key); continue; }
      if (coupling !== r.coupling || rewound || coupling.linked) {
        // Reset/rebuild/rewind cancels every pending contact and stale reaction.
        r.coupling = coupling; r.broken = !coupling.linked;
        r.animated = r.broken; r.startedAt = null; r.contactFired = true;
        r.jawPivot.angle = r.broken ? REST_ANGLE : 0;
        r.phase = r.broken ? 'open' : 'closed';
      } else if (r.startedAt !== null) {
        const elapsed = Math.max(0, clock - r.startedAt);
        // Entering reduced mode completes the visual and never catches up later.
        if (reduced) r.suppressMotion = true;
        r.jawPivot.angle = r.suppressMotion ? REST_ANGLE : pose(r, elapsed);
        r.phase = r.suppressMotion ? 'reduced-open' :
          elapsed < .035 ? 'anticipation' : elapsed < .11 ? 'opening' :
          elapsed < CONTACT_TIME ? 'recoil' : elapsed < SETTLE_TIME ? 'settle' : 'open';
        if (!r.contactFired && elapsed >= CONTACT_TIME) {
          r.contactFired = true; contacts++;
          note('contact', { owner: r.owner, name: r.name,
                           scheduledTime: r.startedAt + CONTACT_TIME });
          try { api.onContact?.(r.owner, r.name); }
          catch (error) { errors.push(`onContact: ${error?.message || error}`); }
        }
        if (elapsed >= SETTLE_TIME) {
          r.jawPivot.angle = REST_ANGLE; r.phase = 'open'; r.startedAt = null;
        }
        moving = true;
      } else if (!coupling.linked) {
        // Cascade unlinking without release() is real state, not a new effect.
        r.broken = true; r.animated = true; r.contactFired = true;
        r.jawPivot.angle = REST_ANGLE; r.phase = 'open';
      }
      registration(r);
    }
    ready = rigs.size > 0;
    if (moving) dirty();
  }

  function snapshot() {
    const latches = [...rigs.values()].map(r => ({ owner:r.owner, name:r.name,
      linked:couplingFor(r.owner,r.name)?.linked, jawAngleDegrees:r.jawPivot.angle,
      phase:r.phase, contactFired:r.contactFired,
      sourceSpriteHidden:r.source.sprite?.color?.[3] === 0,
      ...registration(r) }));
    return { ready, generation, time: clock, reducedMotion: reduced,
      releases, contacts, rejectedReleases, maxHingeErrorWorld: maxHingeError,
      maxSocketErrorWorld: maxSocketError,
      maxPaintedJawHingeErrorWorld:maxPaintedJawError,
      maxPaintedSocketHingeErrorWorld:maxPaintedSocketError,
      maxPaintedJointErrorWorld:maxPaintedJointError,
      artRegistration, errors: [...errors], latches, events: [...events] };
  }

  function dispose() {
    clear(); game = null;
    note('disposed'); dirty();
  }

  return { attach, release, update, snapshot, dispose };
}
