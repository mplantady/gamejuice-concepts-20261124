'use strict';
(() => {
const Engine = (() => {
/** Bird Sort rules, independent of rendering, time, audio and network access.
 * Branch arrays run from the trunk toward the open end. See rules-evidence.json.
 */

const CAPACITY = 5;
const BRANCH_IDS = Object.freeze(
  Array.from({ length: 7 }, (_, i) => [`L${i + 1}`, `R${i + 1}`]).flat(),
);
const SPECIES = Object.freeze([
  'Red-and-yellow bird', 'Brown owl', 'Small blue bird', 'Purple crested bird',
  'Orange-crested bird', 'Green crested bird', 'Gray bird', 'Pink bird',
  'Yellow-billed toucan', 'Blue-and-yellow macaw',
].map((name, id) => Object.freeze({ id, name })));
const SPECIES_NAMES = Object.freeze(SPECIES.map(({ name }) => name));

const INITIAL_BRANCHES = Object.freeze(Object.fromEntries(
  BRANCH_IDS.map((id, i) => [id, Object.freeze([
    [8, 2, 4], [0, 0, 4, 4, 5], [1, 7, 6, 2, 6], [9, 7, 7],
    [2, 7, 8, 3], [9, 0, 0, 4, 9], [7, 4, 3, 9], [],
    [1, 1, 8], [0, 6, 1], [6, 5, 9], [3, 3, 6, 1, 8],
    [2, 5, 8, 3], [5, 2, 5],
  ][i])]),
));

const DEMO_MOVES = Object.freeze([
  { fromId: 'R3', toId: 'L4' },
  { fromId: 'R3', toId: 'L1' },
  { fromId: 'R3', toId: 'R4' },
].map(Object.freeze));

// Freezing each new container makes old states safe to retain for animation/undo.
function freezeBranches(branches) {
  return Object.freeze(Object.fromEntries(BRANCH_IDS.map(id => [id, Object.freeze(branches[id])])));
}
function freezeState(state) {
  return Object.freeze({ ...state, branches: freezeBranches(state.branches),
    cleared: Object.freeze(state.cleared), history: Object.freeze(state.history) });
}
function snapshot(state) {
  return Object.freeze({ branches: state.branches, cleared: state.cleared, moves: state.moves });
}
function hasBranch(id) { return BRANCH_IDS.includes(id); }
function result(state, event) { return { state, event: Object.freeze(event) }; }

/** Optional numeric-array layout is useful for small rule fixtures. Missing branches are empty. */
function createGame(layout = INITIAL_BRANCHES) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    throw new TypeError('A layout must be an object keyed by branch ID.');
  }
  for (const id of Object.keys(layout)) {
    if (!hasBranch(id)) throw new RangeError(`Unknown branch: ${id}`);
  }
  let sequence = 0;
  const branches = Object.fromEntries(BRANCH_IDS.map(id => {
    const species = layout[id] ?? [];
    if (!Array.isArray(species) || species.length > CAPACITY) {
      throw new RangeError(`${id} must contain an array of at most ${CAPACITY} birds.`);
    }
    return [id, species.map(value => {
      if (!Number.isInteger(value) || value < 0 || value >= SPECIES.length) {
        throw new RangeError(`Invalid bird species: ${value}`);
      }
      return Object.freeze({ id: `bird-${sequence++}`, species: value });
    })];
  }));
  const initialBranches = freezeBranches(branches);
  return freezeState({ branches: initialBranches, initialBranches,
    selected: null, moves: 0, cleared: [], history: [], totalBirds: sequence });
}

/** Selected group in pop/flight order: open-end bird first. */
function getEndGroup(state, branchId) {
  const branch = state.branches[branchId];
  if (!hasBranch(branchId) || !branch.length) return [];
  const species = branch.at(-1).species;
  const group = [];
  for (let i = branch.length - 1; i >= 0 && branch[i].species === species; i--) group.push(branch[i]);
  return group;
}

function isWon(state) {
  return BRANCH_IDS.every(id => state.branches[id].length === 0);
}

/** Inspect a move without changing selection, history or the board. */
function getMove(state, fromId, toId) {
  const invalid = reason => ({ legal: false, reason, fromId, toId });
  if (!hasBranch(fromId) || !hasBranch(toId)) return invalid('unknown-branch');
  if (fromId === toId) return invalid('same-branch');
  if (isWon(state)) return invalid('game-won');
  const source = state.branches[fromId];
  const destination = state.branches[toId];
  if (!source.length) return invalid('empty-source');
  if (destination.length >= CAPACITY) return invalid('full-destination');
  const species = source.at(-1).species;
  if (destination.length && destination.at(-1).species !== species) return invalid('species-mismatch');
  const birds = getEndGroup(state, fromId).slice(0, CAPACITY - destination.length);
  const count = birds.length;
  const willComplete = destination.length + count === CAPACITY &&
    destination.every(bird => bird.species === species);
  return { legal: true, fromId, toId, species, count, birds,
    fromIndices: birds.map((_, i) => source.length - 1 - i),
    toIndices: birds.map((_, i) => destination.length + i), willComplete };
}

/** Apply one legal transfer. Completed five-bird groups leave atomically and remain in cleared. */
function move(state, fromId, toId) {
  const candidate = getMove(state, fromId, toId);
  if (!candidate.legal) return result(state, { type: 'invalid', ...candidate, selectedId: state.selected });
  const { birds, count, species, fromIndices, toIndices } = candidate;
  const branches = { ...state.branches,
    [fromId]: state.branches[fromId].slice(0, -count),
    [toId]: [...state.branches[toId], ...birds] };
  let cleared = [];
  if (candidate.willComplete) {
    cleared = [Object.freeze({ branchId: toId, species,
      birds: Object.freeze(branches[toId]), move: state.moves + 1 })];
    branches[toId] = [];
  }
  const next = freezeState({ ...state, branches, selected: null, moves: state.moves + 1,
    cleared: [...state.cleared, ...cleared], history: [...state.history, snapshot(state)] });
  return result(next, { type: 'move', fromId, toId, species, count,
    birds: Object.freeze(birds), fromIndices: Object.freeze(fromIndices), toIndices: Object.freeze(toIndices),
    completedBranches: Object.freeze(cleared.map(group => group.branchId)),
    cleared: Object.freeze(cleared), won: isWon(next) });
}

/** Original two-tap interaction: tap source, then destination; invalid destinations become selected. */
function select(state, branchId) {
  if (!hasBranch(branchId)) return result(state, { type: 'invalid', reason: 'unknown-branch', toId: branchId });
  if (isWon(state)) return result(state, { type: 'invalid', reason: 'game-won', toId: branchId });
  if (state.selected === branchId) {
    return result(freezeState({ ...state, selected: null }), { type: 'deselect', branchId });
  }
  const birds = Object.freeze(getEndGroup(state, branchId));
  if (state.selected) {
    const moved = move(state, state.selected, branchId);
    if (moved.event.type === 'move') return moved;
    const selected = birds.length ? branchId : null;
    return result(freezeState({ ...state, selected }), {
      ...moved.event, selectedId: selected, birds,
    });
  }
  if (!birds.length) return result(state, { type: 'noop', reason: 'empty-branch', branchId });
  return result(freezeState({ ...state, selected: branchId }), {
    type: 'select', branchId, birds, previousId: state.selected,
  });
}

/** Undo an accepted move, including any group that flew away. Selection itself is not history. */
function undo(state) {
  if (!state.history.length) return result(state, { type: 'noop', reason: 'no-history' });
  const previous = state.history.at(-1);
  const next = freezeState({ ...state, ...previous, selected: null, history: state.history.slice(0, -1) });
  return result(next, { type: 'undo', won: isWon(next) });
}

/** Return this game's original deal with the same stable bird IDs. */
function reset(state) {
  const next = freezeState({ ...state, branches: state.initialBranches,
    selected: null, moves: 0, cleared: [], history: [] });
  return result(next, { type: 'reset', won: isWon(next) });
}

function getLegalMoves(state) {
  const moves = [];
  for (const fromId of BRANCH_IDS) for (const toId of BRANCH_IDS) {
    const candidate = getMove(state, fromId, toId);
    if (candidate.legal) moves.push(candidate);
  }
  return moves;
}

/** A deterministic local suggestion, not a guarantee of a complete solution. */
function getHint(state) {
  const candidates = getLegalMoves(state).filter(candidate => {
    const source = state.branches[candidate.fromId];
    const destination = state.branches[candidate.toId];
    // Shifting an entire uniform branch into an empty branch makes no progress.
    return destination.length || candidate.count < source.length || candidate.willComplete;
  });
  const score = candidate => {
    const destination = state.branches[candidate.toId];
    const source = state.branches[candidate.fromId];
    return (candidate.willComplete ? 1000 : 0) +
      (destination.length ? 100 : 0) +
      (candidate.count === source.length ? 40 : 0) + candidate.count * 3;
  };
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0] ?? null;
}

function getStats(state) {
  const birdsRemaining = BRANCH_IDS.reduce((n, id) => n + state.branches[id].length, 0);
  const birdsCleared = state.cleared.reduce((n, group) => n + group.birds.length, 0);
  return { moves: state.moves, birdsRemaining, birdsCleared, completed: state.cleared.length,
    totalBirds: state.totalBirds, totalGroups: state.totalBirds / CAPACITY,
    canUndo: state.history.length > 0, won: isWon(state) };
}

return {CAPACITY, BRANCH_IDS, SPECIES, SPECIES_NAMES, INITIAL_BRANCHES, DEMO_MOVES, createGame, getEndGroup, isWon, getMove, move, select, undo, reset, getLegalMoves, getHint, getStats};
})();
const Renderer = (() => {
/* Native canvas presentation. Engine state remains authoritative and immutable. */
const SCENE_WIDTH = 940;
const SCENE_HEIGHT = 1673;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
const lerp = (a, b, amount) => a + (b - a) * amount;

function copyState(state) {
  return { ...state, branches: Object.fromEntries(Object.entries(state?.branches || {}).map(([id, birds]) => [id, birds.map(bird => ({ ...bird }))])) };
}

function endGroup(birds = []) {
  if (!birds.length) return [];
  const species = birds[birds.length - 1].species;
  let first = birds.length - 1;
  while (first > 0 && birds[first - 1].species === species) first--;
  return birds.slice(first);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load Bird Sort artwork: ${url}`));
    image.src = url;
  });
}

function wingPalette(species) {
  if (species.wingColor) return [species.wingColor, species.wingShade || species.wingColor];
  const name = String(species.name || '').toLowerCase();
  if (/macaw|blue.yellow/.test(name)) return ['#358acb', '#23649c'];
  if (/orange/.test(name)) return ['#ffbc4c', '#f28d29'];
  if (/pink/.test(name)) return ['#f37a9c', '#cb517b'];
  if (/purple/.test(name)) return ['#7774b6', '#52568c'];
  if (/owl|brown/.test(name)) return ['#bb874b', '#8c5b2d'];
  if (/toucan/.test(name)) return ['#404955', '#262b35'];
  if (/gray|grey|pelican/.test(name)) return ['#a7b3c3', '#738293'];
  if (/green/.test(name)) return ['#8bcf3e', '#569930'];
  if (/blue/.test(name)) return ['#35a6e3', '#247fbc'];
  return ['#ffda3a', '#dfa522'];
}

/**
 * @param {{canvas:HTMLCanvasElement, manifest?:Object, assetBase?:string,
 *          onBranchTap?:(id:string)=>void}} options
 * Manifest is supplied by the page (or window.BirdSortAssets); no fetch is used.
 */
async function createRenderer({ canvas, manifest = globalThis.BirdSortAssets, assetBase = './assets/', onBranchTap = () => {} }) {
  if (!canvas?.getContext) throw new TypeError('Bird Sort needs a canvas element.');
  if (!manifest?.background || !manifest?.species || !manifest?.branches) throw new Error('Bird Sort artwork manifest is missing.');
  const width = manifest.width || SCENE_WIDTH, height = manifest.height || SCENE_HEIGHT;
  const base = new URL(assetBase, document.baseURI);
  const urlFor = file => new URL(file, base).href;
  const backgroundPromise = loadImage(urlFor(manifest.background));
  const speciesEntries = await Promise.all(Object.entries(manifest.species).map(async ([id, spec]) => [String(id), { ...spec, image: await loadImage(urlFor(spec.file)), colors: wingPalette(spec) }]));
  const sprites = new Map(speciesEntries);
  const background = await backgroundPromise;
  const hand = manifest.hand ? { ...manifest.hand, image: await loadImage(urlFor(manifest.hand.file)) } : null;
  const branchList = manifest.branches.map(branch => ({ ...branch, slots: branch.slots.map(point => ({ ...point })) }));
  const branchMap = new Map(branchList.map(branch => [branch.id, branch]));
  const orderedBranches = branchList.slice().sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)) || a.id.localeCompare(b.id));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser cannot create the game canvas.');
  let state = { branches: Object.fromEntries(branchList.map(branch => [branch.id, []])), selected: null };
  let selectedId = null, hoveredId = null, hint = null, focusId = orderedBranches[0]?.id;
  let animation = null, dirty = true, destroyed = false, pointer = null, raf = 0;
  let backingScale = 1, offsetX = 0, offsetY = 0, cssScale = 1, cssOffsetX = 0, cssOffsetY = 0;
  let soundEnabled = true, audioContext = null, master = null, soundNodes = new Set();
  let lastDpr = 0, selectionAt = 0, invalidAt = -Infinity;

  canvas.width = width;
  canvas.height = height;
  canvas.style.touchAction = 'none';
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
  if (!canvas.hasAttribute('aria-label')) canvas.setAttribute('aria-label', 'Bird Sort game board. Arrow keys choose a branch; Enter selects it.');

  function resize() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || width, cssHeight = rect.height || cssWidth * height / width;
    lastDpr = window.devicePixelRatio || 1;
    const dpr = Math.min(2.5, lastDpr);
    const targetWidth = Math.max(1, Math.round(cssWidth * dpr)), targetHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) { canvas.width = targetWidth; canvas.height = targetHeight; }
    backingScale = Math.min(targetWidth / width, targetHeight / height);
    offsetX = (targetWidth - width * backingScale) / 2;
    offsetY = (targetHeight - height * backingScale) / 2;
    cssScale = Math.min(cssWidth / width, cssHeight / height);
    cssOffsetX = (cssWidth - width * cssScale) / 2;
    cssOffsetY = (cssHeight - height * cssScale) / 2;
    dirty = true;
  }

  function unlockAudio() {
    if (!soundEnabled || destroyed) return;
    if (!audioContext) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      try { audioContext = new Audio(); master = audioContext.createGain(); master.gain.value = 0.28; master.connect(audioContext.destination); } catch { return; }
    }
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  }

  function tone(frequency, duration, volume, pan = 0, bend = 1, delay = 0, type = 'sine') {
    if (!soundEnabled || !audioContext || audioContext.state !== 'running') return;
    const start = audioContext.currentTime + delay, oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * bend), start + duration);
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume, start + 0.008); gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    const panner = audioContext.createStereoPanner?.();
    if (panner) { panner.pan.value = clamp(pan, -1, 1); gain.connect(panner); panner.connect(master); } else gain.connect(master);
    soundNodes.add(oscillator);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); panner?.disconnect(); soundNodes.delete(oscillator); };
    oscillator.start(start); oscillator.stop(start + duration + 0.02);
  }

  function flutter(duration, pan = 0) {
    if (!soundEnabled || !audioContext || audioContext.state !== 'running') return;
    const rate = audioContext.sampleRate, buffer = audioContext.createBuffer(1, Math.ceil(rate * duration), rate), samples = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate, u = i / samples.length;
      previous = previous * 0.72 + (Math.random() * 2 - 1) * 0.28;
      samples[i] = previous * (0.15 + 0.85 * Math.sin(t * Math.PI * 15) ** 2) * Math.sin(u * Math.PI) * 0.18;
    }
    const source = audioContext.createBufferSource(), gain = audioContext.createGain(), panner = audioContext.createStereoPanner?.();
    source.buffer = buffer; gain.gain.value = 0.25; source.connect(gain);
    if (panner) { panner.pan.value = clamp(pan, -1, 1); gain.connect(panner); panner.connect(master); } else gain.connect(master);
    soundNodes.add(source); source.onended = () => { source.disconnect(); gain.disconnect(); panner?.disconnect(); soundNodes.delete(source); };
    source.start();
  }

  function stopSounds() {
    for (const node of soundNodes) { try { node.stop(); } catch {} }
    soundNodes.clear();
  }

  function spriteInfo(bird) {
    const sprite = sprites.get(String(bird.species));
    if (!sprite) throw new Error(`Missing artwork for bird species ${bird.species}`);
    return sprite;
  }

  function drawWing(sprite, point, facing, clock, strength = 1) {
    const imageWidth = sprite.width || sprite.image.width, imageHeight = sprite.height || sprite.image.height;
    const anchor = sprite.anchor || [imageWidth / 2, imageHeight * 0.8];
    const side = facing === 'left' ? 1 : -1;
    const length = Math.min(46, imageWidth * 0.48) * strength;
    const flap = Math.sin(clock * 0.034), baseY = point.y - Math.min(anchor[1] * 0.48, imageHeight * 0.43);
    context.save(); context.translate(point.x, baseY); context.scale(side, 1);
    context.beginPath(); context.moveTo(-3, 0); context.quadraticCurveTo(length * 0.28, -14 - flap * 10, length, -26 - flap * 24); context.lineTo(length * 0.94, -5 - flap * 14); context.lineTo(length * 0.65, 6); context.lineTo(length * 0.24, 10); context.closePath();
    context.fillStyle = sprite.colors[0]; context.fill(); context.strokeStyle = '#242633'; context.lineWidth = 2.4; context.lineJoin = 'round'; context.stroke();
    context.beginPath(); context.moveTo(-3, 0); context.lineTo(length * 0.94, -5 - flap * 14); context.lineTo(length * 0.65, 6); context.lineTo(length * 0.24, 10); context.closePath(); context.fillStyle = sprite.colors[1]; context.fill();
    context.restore();
  }

  function drawBird(bird, point, facing, options = {}) {
    const sprite = spriteInfo(bird), imageWidth = sprite.width || sprite.image.width, imageHeight = sprite.height || sprite.image.height;
    const anchor = sprite.anchor || [imageWidth / 2, imageHeight * 0.8];
    const mirror = (sprite.facing || 'right') !== facing;
    if (options.flying) drawWing(sprite, point, facing, options.clock, options.wingStrength || 1);
    context.save(); context.translate(point.x, point.y); context.rotate(options.rotation || 0); context.scale((mirror ? -1 : 1) * (options.scaleX || 1), options.scaleY || 1);
    if (options.alpha !== undefined) context.globalAlpha *= options.alpha;
    if (options.selected || options.hovered) { context.shadowColor = options.selected ? '#fff2b5' : '#d8eef0'; context.shadowBlur = options.selected ? 7 : 3; }
    context.drawImage(sprite.image, -anchor[0], -anchor[1], imageWidth, imageHeight);
    context.restore();
  }

  function drawBurst(point, age, seed = 0, large = false) {
    const duration = large ? 420 : 300;
    if (age < 0 || age > duration) return;
    const u = age / duration, radius = 14 + (large ? 35 : 22) * u;
    context.save(); context.globalAlpha = (1 - u) * 0.9; context.strokeStyle = '#ffe4a0'; context.fillStyle = '#ffe7ad'; context.lineWidth = 2.3;
    const count = large ? 8 : 5;
    for (let i = 0; i < count; i++) {
      const angle = (i / count * Math.PI * 2) + seed * 0.7;
      const x = point.x + Math.cos(angle) * radius, y = point.y - 14 + Math.sin(angle) * radius * 0.7;
      context.beginPath(); context.moveTo(x, y); context.lineTo(x + Math.cos(angle) * 6, y + Math.sin(angle) * 6); context.stroke();
      if (large && i % 2 === 0) { context.beginPath(); context.moveTo(x, y - 3); context.lineTo(x + 3, y); context.lineTo(x, y + 3); context.lineTo(x - 3, y); context.closePath(); context.fill(); }
    }
    context.restore();
  }

  function drawBranchCue(branchId, color, opacity, now) {
    const branch = branchMap.get(branchId);
    if (!branch) return;
    const birds = state.branches[branchId] || [], point = branch.slots[Math.min(birds.length, branch.slots.length - 1)] || branch.slots[0];
    const radius = 19 + Math.sin(now / 240) * 2;
    context.save(); context.globalAlpha = opacity; context.strokeStyle = color; context.lineWidth = 2.5;
    context.beginPath(); context.ellipse(point.x, point.y - 12, radius, radius * 0.48, 0, 0, Math.PI * 2); context.stroke(); context.restore();
  }

  function drawHint(now) {
    if (!hint || animation) return;
    drawBranchCue(hint.fromId, '#fff0ad', 0.62, now);
    drawBranchCue(hint.toId, '#9df0d3', 0.48, now + 200);
    if (!hand) return;
    const source = branchMap.get(hint.fromId), destination = branchMap.get(hint.toId);
    if (!source || !destination) return;
    const sourceBirds = state.branches[hint.fromId] || [], destinationBirds = state.branches[hint.toId] || [];
    const from = source.slots[Math.max(0, sourceBirds.length - 1)], to = destination.slots[Math.min(destinationBirds.length, destination.slots.length - 1)];
    const cycle = (now - hint.startedAt) % 3600, transition = smooth((cycle - 1300) / 650);
    let alpha = cycle > 3050 ? 1 - smooth((cycle - 3050) / 450) : smooth(cycle / 260);
    const point = { x: lerp(from.x, to.x, transition), y: lerp(from.y - 65, to.y - 20, transition) + Math.sin(now / 180) * 2 };
    const anchor = hand.anchor || [hand.width * 0.17, hand.height * 0.1], scale = hand.scale || 0.72;
    context.save(); context.globalAlpha = alpha * 0.94; context.translate(point.x, point.y); context.scale(scale, scale); context.drawImage(hand.image, -anchor[0], -anchor[1], hand.width || hand.image.width, hand.height || hand.image.height); context.restore();
  }

  function drawFrame(now) {
    context.setTransform(1, 0, 0, 1, 0, 0); context.fillStyle = '#101622'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(backingScale, 0, 0, backingScale, offsetX, offsetY);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(background, 0, 0, width, height);
    const current = animation, age = current ? now - current.startedAt : 0;
    const departing = current && current.cleared.length && age >= current.departAt;
    const hiddenIds = new Set(current?.actors.map(actor => actor.bird.id) || []);
    if (departing) for (const group of current.cleared) for (const bird of group.birds) hiddenIds.add(bird.id);
    const selectedBirds = new Set(endGroup(state.branches[selectedId] || []).map(bird => bird.id));
    for (const branch of orderedBranches) {
      const birds = state.branches[branch.id] || [];
      birds.forEach((bird, index) => {
        if (hiddenIds.has(bird.id)) return;
        const slot = branch.slots[index]; if (!slot) return;
        const selected = !current && branch.id === selectedId && selectedBirds.has(bird.id);
        const lift = selected ? 7 + Math.sin((now - selectionAt) / 190) * 1.5 : 0;
        const shake = now - invalidAt < 270 && branch.id === selectedId ? Math.sin((now - invalidAt) / 25) * 4 * (1 - (now - invalidAt) / 270) : 0;
        drawBird(bird, { x: slot.x + shake, y: slot.y - lift }, branch.facing, { selected, hovered: !current && branch.id === hoveredId });
      });
    }
    if (current && !departing) {
      current.actors.forEach((actor, index) => {
        const local = age - actor.delay, t = clamp((local - current.anticipation) / current.flight);
        const flying = local >= current.anticipation && t < 1;
        let point = { ...actor.from }, scaleX = 1, scaleY = 1, rotation = 0, facing = actor.sourceFacing;
        if (local < current.anticipation) {
          const amount = Math.sin(clamp(local / current.anticipation) * Math.PI);
          scaleX = 1 + amount * 0.06; scaleY = 1 - amount * 0.09;
        } else if (t < 1) {
          const travel = smooth(t), arc = Math.min(112, 58 + Math.hypot(actor.to.x - actor.from.x, actor.to.y - actor.from.y) * 0.07);
          point = { x: lerp(actor.from.x, actor.to.x, travel), y: lerp(actor.from.y, actor.to.y, travel) - Math.sin(t * Math.PI) * arc + Math.sin(local / 45) * 1.6 };
          rotation = Math.sign(actor.to.x - actor.from.x) * Math.sin(t * Math.PI) * 0.075;
          facing = t < 0.68 ? actor.sourceFacing : actor.destinationFacing;
          scaleX = 1 - Math.exp(-(((t - 0.68) / 0.055) ** 2)) * 0.10;
        } else {
          const landing = local - current.anticipation - current.flight, bounce = -8 * Math.exp(-landing / 115) * Math.sin(landing / 40);
          point = { x: actor.to.x, y: actor.to.y + bounce }; facing = actor.destinationFacing;
          const squash = Math.exp(-(((landing - 35) / 55) ** 2)) * 0.06; scaleX = 1 + squash; scaleY = 1 - squash;
          drawBurst(actor.to, landing, index);
          if (!actor.landed) { actor.landed = true; tone(1060 + index * 110, 0.16, 0.1, actor.to.x / width * 1.4 - 0.7, 1.4); tone(650 + index * 90, 0.2, 0.055, 0, 1, 0.055); }
        }
        if (flying && !actor.launched) { actor.launched = true; flutter(current.flight / 1000, actor.from.x / width * 1.4 - 0.7); }
        drawBird(actor.bird, point, facing, { scaleX, scaleY, rotation, flying, clock: local + index * 23 });
      });
    }
    if (departing) {
      current.cleared.forEach(group => {
        const branch = branchMap.get(group.branchId);
        group.birds.forEach((bird, index) => {
          const local = age - current.departAt - index * 80, u = clamp(local / 1050), slot = branch.slots[index];
          if (!slot || u >= 1) return;
          const travel = smooth(u), targetX = lerp(slot.x, width / 2, 0.48);
          const point = { x: lerp(slot.x, targetX, travel), y: lerp(slot.y, -230, travel) - Math.sin(u * Math.PI) * 35 };
          drawBurst(slot, local, index, true);
          drawBird(bird, point, branch.facing, { flying: local > 0, clock: local + index * 29, rotation: Math.sin(u * Math.PI) * (branch.facing === 'left' ? -0.05 : 0.05) });
        });
      });
      if (!current.departSound) { current.departSound = true; flutter(1.05); [660, 825, 990].forEach((frequency, i) => tone(frequency, 0.28, 0.08, 0, 1.1, i * 0.07)); }
    }
    if (!current) {
      if (hoveredId) drawBranchCue(hoveredId, '#f5dfa7', 0.28, now);
      if (document.activeElement === canvas && focusId) drawBranchCue(focusId, '#d8f5ec', 0.65, now);
      drawHint(now);
    }
    if (current && age >= current.totalDuration) {
      const after = current.afterState, resolve = current.resolve; animation = null; state = copyState(after); selectedId = state.selected || null; dirty = true; resolve({ cancelled: false });
    }
  }

  function tick(now) {
    if (destroyed) return;
    if ((window.devicePixelRatio || 1) !== lastDpr) resize();
    if (dirty || animation || selectedId || hint || hoveredId || document.activeElement === canvas) { dirty = false; drawFrame(now); }
    raf = requestAnimationFrame(tick);
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left - cssOffsetX) / cssScale, y: (event.clientY - rect.top - cssOffsetY) / cssScale };
  }

  function hitTest(point) {
    if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) return null;
    const side = point.x < width * 0.47 ? 'L' : point.x > width * 0.53 ? 'R' : null;
    if (!side) return null;
    let nearest = null, score = Infinity;
    for (const branch of branchList) {
      if (!branch.id.startsWith(side)) continue;
      const y = branch.slots.reduce((sum, slot) => sum + slot.y, 0) / branch.slots.length;
      const distance = Math.abs(point.y - (y - 48));
      if (distance < score && point.y >= y - 164 && point.y <= y + 65) { nearest = branch.id; score = distance; }
    }
    return nearest;
  }

  function pointerDown(event) {
    if (event.button !== 0 || animation || destroyed) return;
    unlockAudio(); const point = pointFromEvent(event); const id = hitTest(point);
    if (!id) return;
    pointer = { pointerId: event.pointerId, id, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture?.(event.pointerId); event.preventDefault();
  }
  function pointerMove(event) {
    if (event.pointerType === 'touch') return;
    hoveredId = animation ? null : hitTest(pointFromEvent(event)); canvas.style.cursor = hoveredId ? 'pointer' : 'default'; dirty = true;
  }
  function pointerUp(event) {
    if (!pointer || event.pointerId !== pointer.pointerId) return;
    const tap = pointer; pointer = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!animation && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 14 && hitTest(pointFromEvent(event)) === tap.id) { focusId = tap.id; onBranchTap(tap.id); }
    event.preventDefault();
  }
  function pointerLeave() { hoveredId = null; canvas.style.cursor = 'default'; dirty = true; }
  function pointerCancel() { pointer = null; }
  function keyDown(event) {
    if (animation || destroyed) return;
    const id = focusId || orderedBranches[0].id, row = Number(id.slice(1));
    let next = id;
    if (event.key === 'ArrowUp') next = id[0] + Math.max(1, row - 1);
    else if (event.key === 'ArrowDown') next = id[0] + Math.min(7, row + 1);
    else if (event.key === 'ArrowLeft') next = 'L' + row;
    else if (event.key === 'ArrowRight') next = 'R' + row;
    else if (event.key === 'Enter' || event.key === ' ') { unlockAudio(); onBranchTap(id); }
    else if (event.key === 'Escape' && selectedId) onBranchTap(selectedId);
    else return;
    event.preventDefault(); if (branchMap.has(next)) focusId = next; dirty = true;
  }

  const listeners = [['pointerdown', pointerDown], ['pointermove', pointerMove], ['pointerup', pointerUp], ['pointerleave', pointerLeave], ['pointercancel', pointerCancel], ['keydown', keyDown], ['focus', () => { dirty = true; }], ['blur', () => { dirty = true; }]];
  listeners.forEach(([name, callback]) => canvas.addEventListener(name, callback));
  document.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
  document.addEventListener('keydown', unlockAudio, { capture: true, passive: true });
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas); window.addEventListener('resize', resize);
  resize(); raf = requestAnimationFrame(tick);

  function cancelAnimation() {
    if (!animation) return;
    const pending = animation; animation = null; state = copyState(pending.afterState); selectedId = state.selected || null; stopSounds(); dirty = true; pending.resolve({ cancelled: true });
  }

  return {
    setState(nextState) {
      cancelAnimation();
      const previousSelection = selectedId;
      state = copyState(nextState); selectedId = state.selected || null;
      if (selectedId && selectedId !== previousSelection) {
        selectionAt = performance.now();
        tone(1050, 0.075, 0.075, selectedId.startsWith('L') ? -0.2 : 0.2, 1.1);
      }
      dirty = true;
    },
    animate(event, beforeState, afterState) {
      cancelAnimation();
      if (destroyed) return Promise.resolve({ cancelled: true });
      if (event?.type !== 'move') {
        const previousSelection = selectedId;
        state = copyState(afterState); selectedId = state.selected || null; dirty = true;
        if (event?.type === 'invalid') { invalidAt = performance.now(); tone(240, 0.09, 0.075, 0, 0.8); }
        else if (selectedId && selectedId !== previousSelection) { selectionAt = performance.now(); tone(1050, 0.075, 0.075, 0, 1.1); }
        return Promise.resolve({ cancelled: false });
      }
      const from = branchMap.get(event.fromId), to = branchMap.get(event.toId);
      if (!from || !to) throw new Error('Move refers to an unknown branch.');
      state = copyState(beforeState); selectedId = null; hoveredId = null; hint = null;
      const birds = event.birds || endGroup(state.branches[event.fromId]);
      const fromIndices = event.fromIndices || birds.map((_, i) => state.branches[event.fromId].length - 1 - i);
      const toIndices = event.toIndices || birds.map((_, i) => state.branches[event.toId].length + i);
      const actors = birds.map((bird, index) => {
        const sourceSlot = from.slots[fromIndices[index]], targetSlot = to.slots[toIndices[index]];
        if (!sourceSlot || !targetSlot) throw new Error('Move exceeds the branch slot count.');
        return { bird: { ...bird }, from: { ...sourceSlot }, to: { ...targetSlot }, sourceFacing: from.facing, destinationFacing: to.facing, delay: index * 80, landed: false, launched: false };
      });
      const anticipation = 140, flight = 1260, settle = 320, latestLanding = anticipation + flight + Math.max(0, actors.length - 1) * 80;
      const cleared = (event.cleared || []).map(group => ({ ...group, birds: group.birds.map(bird => ({ ...bird })) }));
      const departAt = latestLanding + settle + 900;
      const totalDuration = cleared.length ? departAt + 1050 + 4 * 80 : latestLanding + settle;
      if (navigator.userActivation?.isActive) unlockAudio();
      tone(850, 0.065, 0.065, from.slots[0].x / width - 0.5, 1.12);
      return new Promise(resolve => { animation = { event, actors, beforeState: copyState(beforeState), afterState: copyState(afterState), cleared, startedAt: performance.now(), anticipation, flight, departAt, totalDuration, resolve, departSound: false }; dirty = true; });
    },
    setSelected(id) {
      const next = branchMap.has(id) ? id : null;
      if (next !== selectedId) { selectedId = next; selectionAt = performance.now(); if (next) tone(1050, 0.075, 0.075, next.startsWith('L') ? -0.2 : 0.2, 1.1); }
      dirty = true;
    },
    setHint(value) { hint = value && branchMap.has(value.fromId) && branchMap.has(value.toId) ? { ...value, startedAt: performance.now() } : null; dirty = true; },
    setSound(enabled) { soundEnabled = Boolean(enabled); if (master) master.gain.setTargetAtTime(soundEnabled ? 0.28 : 0, audioContext.currentTime, 0.03); if (soundEnabled && navigator.userActivation?.isActive) unlockAudio(); },
    cancelAnimation,
    getDebugState() { return { ready: true, busy: Boolean(animation), selectedId, hoveredId, hint: hint ? { fromId: hint.fromId, toId: hint.toId } : null, state: copyState(state), drawnBirds: Object.values(state.branches).reduce((sum, birds) => sum + birds.length, 0), logicalSize: [width, height], backingSize: [canvas.width, canvas.height], soundEnabled, audioState: audioContext?.state || 'not-started', animation: animation ? { fromId: animation.event.fromId, toId: animation.event.toId, count: animation.actors.length, clears: animation.cleared.map(group => group.branchId), durationMs: animation.totalDuration } : null }; },
    destroy() { if (destroyed) return; cancelAnimation(); destroyed = true; cancelAnimationFrame(raf); observer?.disconnect(); window.removeEventListener('resize', resize); listeners.forEach(([name, callback]) => canvas.removeEventListener(name, callback)); document.removeEventListener('pointerdown', unlockAudio, true); document.removeEventListener('keydown', unlockAudio, true); stopSounds(); audioContext?.close().catch(() => {}); }
  };
}

return {createRenderer};
})();
const {createRenderer} = Renderer;

const $ = id => document.getElementById(id);
const manifest = window.BirdSortAssets;
let state = Engine.createGame();
let renderer;
let busy = false;
let demoPlaying = false;
let generation = 0;
let soundEnabled = true;
try { soundEnabled = localStorage.getItem('gamejuice-bird-sound') !== 'off'; } catch {}
const voice = new Audio('./assets/' + (manifest?.audio?.demoNarration || 'demo-narration.wav'));
voice.preload = 'metadata';
voice.volume = .8;
const branchButtons = new Map();
const wait = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const branchName = id => `${id[0] === 'L' ? 'Left' : 'Right'} branch ${id.slice(1)}`;
const say = message => { $('status').textContent = message; };

function sync() {
  const stats = Engine.getStats(state);
  $('moves').textContent = stats.moves;
  $('flocks').textContent = stats.completed;
  $('undo').disabled = busy || demoPlaying || !stats.canUndo;
  $('hint').disabled = busy || demoPlaying || stats.won;
  $('sound').setAttribute('aria-pressed', String(soundEnabled));
  $('sound-label').textContent = soundEnabled ? 'Sound on' : 'Sound off';
  $('demo-label').textContent = demoPlaying ? 'Stop the demo' : 'Watch the moves';
  $('scene').dataset.busy = String(busy);
  $('scene').dataset.moves = String(stats.moves);
  $('scene').dataset.completed = String(stats.completed);
  for (const [id, button] of branchButtons) {
    const birds = state.branches[id] || [];
    const tip = birds.at(-1);
    const species = manifest?.species?.[tip?.species];
    const tipName = Engine.SPECIES_NAMES[tip?.species] || species?.label || species?.name || (tip ? 'a bird' : 'empty');
    button.setAttribute('aria-label', `${branchName(id)}: ${birds.length} of 5 birds${tip ? ', ' + tipName + ' at the tip' : ', empty'}`);
    button.setAttribute('aria-pressed', String(state.selected === id));
    button.setAttribute('aria-disabled', String(busy || demoPlaying || stats.won));
  }
}

function messageFor(event) {
  if (!event) return 'Choose a branch to move its birds.';
  if (event.type === 'move') {
    if (event.won) return 'Every flock is together. Beautifully sorted!';
    if (event.completedBranches?.length) return 'A flock of five! Off they go.';
    return `${event.count} ${event.count === 1 ? 'bird has' : 'birds have'} landed. Your move.`;
  }
  if (event.type === 'invalid') return 'Try an empty branch or a matching bird with room to land.';
  if (state.selected) return 'Now choose an empty branch or the same bird at the tip.';
  return 'Choose a branch, then a matching bird or an empty branch.';
}

async function accept(result, before, token = generation) {
  state = result.state;
  const event = result.event;
  renderer.setHint(null);
  if (event?.type !== 'move') {
    renderer.animate(event, before, state).catch(error => console.error('Bird feedback:', error));
    renderer.setSelected(state.selected);
    say(messageFor(event));
    sync();
    return event;
  }
  busy = true;
  renderer.setSelected(null);
  say(event.count > 1 ? 'A little flock, on the move…' : 'Coming in to land…');
  sync();
  try {
    await renderer.animate(event, before, state);
  } catch (error) {
    console.error('Bird animation:', error);
  }
  if (token !== generation) return event;
  busy = false;
  renderer.setState(state);
  say(messageFor(event));
  sync();
  if (Engine.isWon(state)) {
    $('win-description').textContent = `All ten flocks found their place in ${state.moves} moves.`;
    if (!$('win').open) $('win').showModal();
  }
  return event;
}

async function chooseBranch(id) {
  if (!renderer || busy || demoPlaying || Engine.isWon(state)) return;
  renderer.setSound(soundEnabled);
  const before = state;
  await accept(Engine.select(state, id), before);
}

function stopDemo() {
  demoPlaying = false;
  generation++;
  voice.pause();
  voice.currentTime = 0;
  renderer?.cancelAnimation();
  busy = false;
  renderer?.setState(state);
  renderer?.setHint(null);
  renderer?.setSelected(state.selected);
  say('Your turn. Keep the birds moving.');
  sync();
}

function restart(announce = true) {
  generation++;
  demoPlaying = false;
  busy = false;
  voice.pause();
  voice.currentTime = 0;
  renderer?.cancelAnimation();
  const reset = Engine.reset(state);
  state = reset.state || reset;
  renderer?.setState(state);
  renderer?.setSelected(null);
  renderer?.setHint(null);
  if ($('win').open) $('win').close();
  if (announce) say('A fresh start. Choose a branch to begin.');
  sync();
}

async function watchDemo() {
  if (!renderer) return;
  if (demoPlaying) { stopDemo(); return; }
  restart(false);
  demoPlaying = true;
  const token = generation;
  const start = performance.now();
  renderer.setSound(soundEnabled);
  if (soundEnabled) { voice.currentTime = 0; voice.play().catch(() => {}); }
  say('Watch three moves, then carry on playing.');
  sync();
  const steps = [
    {fromId: 'R3', toId: 'L4', at: 1050, gap: 430},
    {fromId: 'R3', toId: 'L1', at: 4220, gap: 430},
    {fromId: 'R3', toId: 'R4', at: 7460, gap: 440},
  ];
  for (const step of steps) {
    await wait(step.at - (performance.now() - start));
    if (!demoPlaying || token !== generation) return;
    renderer.setSelected(step.fromId);
    renderer.setHint({fromId: step.fromId, toId: step.toId});
    say(`${branchName(step.fromId)} → ${branchName(step.toId)}.`);
    await wait(step.gap);
    if (!demoPlaying || token !== generation) return;
    const before = state;
    await accept(Engine.move(state, step.fromId, step.toId), before, token);
    if (token !== generation) return;
  }
  demoPlaying = false;
  renderer.setSelected(null);
  renderer.setHint(null);
  say('Your turn. The same rules work on every branch.');
  sync();
}

function makeBranchControls() {
  // Branch-sized hit regions also make the scene playable with a keyboard.
  const rows = [190, 421, 646, 870, 1096, 1320, 1544];
  for (const id of Engine.BRANCH_IDS) {
    const row = Number(id.slice(1)) - 1;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.branch = id;
    button.style.left = id[0] === 'L' ? '0%' : '55%';
    button.style.width = '45%';
    button.style.top = `${(rows[row] - 150) / 1673 * 100}%`;
    button.style.height = `${195 / 1673 * 100}%`;
    button.addEventListener('click', () => chooseBranch(id));
    $('branch-controls').append(button);
    branchButtons.set(id, button);
  }
}

async function start() {
  if (!manifest) throw new Error('Missing local Bird Sort asset manifest.');
  renderer = await createRenderer({canvas: $('game'), manifest, assetBase: './assets/', onBranchTap: chooseBranch});
  renderer.setState(state);
  renderer.setSound(false);
  makeBranchControls();
  $('loading').hidden = true;
  $('hint').addEventListener('click', () => {
    const hint = Engine.getHint ? Engine.getHint(state) : Engine.getLegalMoves(state)[0];
    if (!hint) { say('No move is available. Try Undo or Restart.'); return; }
    const fromId = hint.fromId || hint.from;
    const toId = hint.toId || hint.to;
    renderer.setHint({fromId, toId});
    say(`Try ${branchName(fromId).toLowerCase()} → ${branchName(toId).toLowerCase()}.`);
  });
  $('undo').addEventListener('click', () => {
    if (busy || demoPlaying) return;
    generation++;
    const result = Engine.undo(state);
    state = result.state || result;
    renderer.setState(state);
    renderer.setSelected(state.selected);
    renderer.setHint(null);
    say('One move back. Try a different landing.');
    sync();
  });
  $('restart').addEventListener('click', () => restart());
  $('sound').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    renderer.setSound(soundEnabled);
    voice.muted = !soundEnabled;
    try { localStorage.setItem('gamejuice-bird-sound', soundEnabled ? 'on' : 'off'); } catch {}
    sync();
  });
  $('demo').addEventListener('click', watchDemo);
  $('play-again').addEventListener('click', () => restart());
  $('keep-looking').addEventListener('click', () => $('win').close());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && demoPlaying) stopDemo();
  });
  window.addEventListener('pagehide', () => { voice.pause(); renderer.setSound(false); });
  sync();
}
start().catch(error => {
  console.error(error);
  $('loading').innerHTML = '<div class="error-state"><p>The forest could not load.</p><p>Refresh the page to try again.</p></div>';
  say('The game could not start.');
});

})();
