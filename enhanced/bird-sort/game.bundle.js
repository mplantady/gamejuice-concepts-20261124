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


// Shared by the interactive renderer and the twelve-second guided demonstration.
// Coordinates/times match the approved video generator's TRANSFERS and TAPS.
const BIRD_VIDEO_DEMO = Object.freeze({
  durationMs: 12000,
  taps: [
    { atMs: 1050, x: 596, y: 581 }, { atMs: 1480, x: 344, y: 839 },
    { atMs: 4220, x: 654, y: 577 }, { atMs: 4650, x: 306, y: 156 },
    { atMs: 7460, x: 778, y: 594 }, { atMs: 7900, x: 853, y: 826 },
  ],
  steps: [
    { fromId: 'R3', toId: 'L4', sourceTapMs: 1050, destinationTapMs: 1480, flightStartMs: 1800, flightEndMs: 3700, arc: -100, audioVariant: 0,
      paths: [{ fromIndex: 4, from: { x: 617, y: 646 }, to: { x: 344, y: 875 } }] },
    { fromId: 'R3', toId: 'L1', sourceTapMs: 4220, destinationTapMs: 4650, flightStartMs: 4950, flightEndMs: 6850, arc: -85, audioVariant: 1,
      paths: [{ fromIndex: 3, from: { x: 657, y: 644 }, to: { x: 306, y: 194 } }] },
    { fromId: 'R3', toId: 'R4', sourceTapMs: 7460, destinationTapMs: 7900, flightStartMs: 8200, flightEndMs: 9920, arc: -65, audioVariant: 2,
      paths: [{ fromIndex: 2, from: { x: 742, y: 638 }, to: { x: 816, y: 859 } }, { fromIndex: 1, from: { x: 820, y: 638 }, to: { x: 897, y: 859 } }] },
  ],
});

function sampleBirdMotion(spec, timeMs) {
  const { from, to, startMs, endMs, arc } = spec;
  if (timeMs < startMs) {
    const anticipation = Math.exp(-(((timeMs - (startMs - 100)) / 75) ** 2));
    return { x: from.x, y: from.y, scaleX: 1 + 0.065 * anticipation, scaleY: 1 - 0.09 * anticipation, facing: spec.sourceFacing, flying: false, phase: 'anticipation' };
  }
  if (timeMs <= endMs) {
    const u = (timeMs - startMs) / (endMs - startMs), travel = smooth(u);
    return { x: lerp(from.x, to.x, travel), y: lerp(from.y, to.y, travel) + arc * Math.sin(Math.PI * u), scaleX: 1, scaleY: 1,
      facing: u < 0.45 ? spec.sourceFacing : spec.destinationFacing, flying: true, phase: 'flight' };
  }
  const age = (timeMs - endMs) / 1000, squash = 0.06 * Math.exp(-(((age - 0.035) / 0.055) ** 2));
  return { x: to.x, y: to.y - 9 * Math.exp(-age * 7) * Math.sin(age * 20), scaleX: 1 + squash, scaleY: 1 - squash, facing: spec.destinationFacing, flying: false, phase: 'settle' };
}

function sampleDemoHand(timeMs) {
  let point = { x: 592, y: 646 }, alpha = timeMs > 1650 ? 0 : 1;
  for (let i = 0; i < BIRD_VIDEO_DEMO.taps.length; i++) {
    const tap = BIRD_VIDEO_DEMO.taps[i], previous = i ? BIRD_VIDEO_DEMO.taps[i - 1] : { x: 592, y: 646 };
    if (timeMs >= tap.atMs - 350 && timeMs <= tap.atMs + 170) {
      const u = smooth((timeMs - (tap.atMs - 350)) / 280);
      point = { x: lerp(previous.x, tap.x, u), y: lerp(previous.y, tap.y, u) };
      alpha = 1;
      break;
    }
  }
  return { ...point, alpha, scale: .82 };
}

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
  const speciesEntries = await Promise.all(Object.entries(manifest.species).map(async ([id, spec]) => {
    const animation = spec.animation ? { ...spec.animation, image: await loadImage(urlFor(spec.animation.file)) } : null;
    return [String(id), { ...spec, image: await loadImage(urlFor(spec.file)), animation, colors: wingPalette(spec) }];
  }));
  const sprites = new Map(speciesEntries);
  const instances = new Map(await Promise.all(Object.entries(manifest.instances || {}).map(async ([id, spec]) => [id, { ...spec, image: await loadImage(urlFor(spec.file)) }])));
  const background = await backgroundPromise;
  const openingImage = manifest.openingImage ? await loadImage(urlFor(manifest.openingImage)) : null;
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
  let soundEnabled = true, audioActivated = false, demoTimeline = null;
  const soundNodes = new Set(), lastLandings = new Map();
  let lastDpr = 0, invalidAt = -Infinity;
  let activeActorIds = new Set();

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

  const audioSpec = manifest.audio || {};
  function makeAudio(file, loop = false) {
    const audio = new Audio(urlFor(file)); audio.preload = 'auto'; audio.volume = 1; audio.loop = loop; return audio;
  }
  const audioBank = {
    tap: makeAudio(audioSpec.tap || 'audio/tap.wav'),
    flutters: (audioSpec.flutters || ['audio/flutter-1.wav', 'audio/flutter-2.wav', 'audio/flutter-3.wav']).map(file => makeAudio(file)),
    landings: (audioSpec.landings || ['audio/landing-1.wav', 'audio/landing-2.wav', 'audio/landing-3.wav']).map(file => makeAudio(file)),
    music: makeAudio(audioSpec.musicBed || 'audio/music-bed.wav', true),
  };
  function playMusic() {
    if (!soundEnabled || !audioActivated || demoTimeline || destroyed || !audioBank.music.paused) return;
    audioBank.music.play().catch(() => {});
  }
  function unlockAudio() { audioActivated = true; playMusic(); }
  function playCue(kind, variant = 0) {
    if (!soundEnabled || !audioActivated || demoTimeline || destroyed) return;
    const template = kind === 'tap' ? audioBank.tap : audioBank[kind]?.[variant];
    if (!template) return;
    const audio = template.cloneNode(true); audio.volume = 1; soundNodes.add(audio);
    const ended = () => { soundNodes.delete(audio); audio.removeEventListener('ended', ended); };
    audio.addEventListener('ended', ended); audio.play().catch(ended);
  }
  function stopSounds(includeMusic = false) {
    for (const audio of soundNodes) { audio.pause(); audio.currentTime = 0; }
    soundNodes.clear();
    if (includeMusic) { audioBank.music.pause(); audioBank.music.currentTime = 0; }
  }
  function sourceInstance(bird, branchId, index) {
    const instance = instances.get(bird.id);
    return instance && instance.sourceBranch === branchId && instance.sourceIndex === index ? instance : null;
  }
  function birdFoot(bird, branch, index) {
    const instance = sourceInstance(bird, branch.id, index);
    const override = demoTimeline?.sourcePoses.get(bird.id);
    if (override && override.branchId === branch.id && override.index === index) return override.point;
    return instance?.sourceFoot || branch.slots[index];
  }
  function spriteInfo(bird, options = {}) {
    const species = sprites.get(String(bird.species));
    if (!species) throw new Error(`Missing artwork for bird species ${bird.species}`);
    if (options.flying || options.forceSpecies) return species;
    const instance = instances.get(bird.id);
    const contextIntact = instance && (instance.sourceRequires || []).every(id => {
      const donor = instances.get(id);
      return donor && !activeActorIds.has(id) && state.branches[donor.sourceBranch]?.[donor.sourceIndex]?.id === id;
    });
    if (instance && contextIntact && (!instance.sourceOnly || sourceInstance(bird, options.branchId, options.index))) return { ...instance, colors: species.colors };
    return species;
  }
  function drawWing(sprite, bird, point, clock) {
    // Only a source-video fallback. A declared atlas replaces the whole bird.
    const red = bird.species === 0, length = red ? 26 : 32, pulse = Math.sin(clock / 1000 * 22);
    const x = point.x + 8, y = point.y - (red ? 42 : 57);
    const points = [[x,y],[x+length*.4,y-5-pulse*9],[x+length,y-24-pulse*18],[x+length*.93,y-4-pulse*10],[x+length*.66,y+5],[x+length*.3,y+8]];
    context.save(); context.beginPath(); points.forEach(([px,py],i) => i ? context.lineTo(px,py) : context.moveTo(px,py)); context.closePath(); context.fillStyle = sprite.colors[0]; context.fill(); context.lineWidth = 3; context.strokeStyle = '#211e27'; context.stroke();
    context.beginPath(); [points[0],points[3],points[4],points[5]].forEach(([px,py],i) => i ? context.lineTo(px,py) : context.moveTo(px,py)); context.closePath(); context.fillStyle = sprite.colors[1]; context.fill(); context.restore();
  }
  function drawBird(bird, point, facing, options = {}) {
    const sprite = spriteInfo(bird, options), animation = options.flying ? sprites.get(String(bird.species)).animation : null;
    const imageWidth = animation?.frameWidth || sprite.width || sprite.image.width, imageHeight = animation?.frameHeight || sprite.height || sprite.image.height;
    const anchor = animation?.anchor || sprite.anchor || [imageWidth / 2, imageHeight * .8];
    const displayScale = animation?.displayScale ?? sprite.scale ?? 1;
    const mirror = (animation?.facing || sprite.facing || 'right') !== facing;
    if (options.flying && !animation) drawWing(sprite, bird, point, options.clock);
    context.save(); context.translate(point.x, point.y); context.scale((mirror ? -1 : 1) * (options.scaleX ?? 1) * displayScale, (options.scaleY ?? 1) * displayScale);
    if (options.alpha !== undefined) context.globalAlpha *= options.alpha;
    if (!sprite.nativePatch && !demoTimeline && (options.selected || options.hovered)) { context.shadowColor = options.selected ? '#fff2b5' : '#d8eef0'; context.shadowBlur = options.selected ? 5 : 2; }
    if (animation) {
      const count = animation.frames, cycle = animation.cycleMs || Math.PI * 2 / 22 * 1000;
      const frame = ((Math.floor(options.clock / cycle * count) % count) + count) % count;
      const sx = (frame % animation.columns) * imageWidth, sy = Math.floor(frame / animation.columns) * imageHeight;
      context.drawImage(animation.image, sx, sy, imageWidth, imageHeight, -anchor[0], -anchor[1], imageWidth, imageHeight);
    } else context.drawImage(sprite.image, -anchor[0], -anchor[1], imageWidth, imageHeight);
    context.restore();
  }
  function drawLanding(point, ageMs) {
    if (ageMs < 0 || ageMs >= 320) return;
    const u = ageMs / 320, radius = 15 + 10 * u;
    context.save(); context.strokeStyle = `rgba(255,232,169,${210 / 255 * (1-u)})`; context.lineWidth = 2;
    for (const degrees of [-155,-115,-65,-25]) { const angle = degrees * Math.PI / 180; context.beginPath(); context.moveTo(point.x + Math.cos(angle)*radius, point.y + Math.sin(angle)*radius); context.lineTo(point.x + Math.cos(angle)*(radius+6), point.y + Math.sin(angle)*(radius+6)); context.stroke(); }
    context.restore();
  }
  function drawTap(point, ageMs) {
    if (ageMs < 0 || ageMs >= 270) return;
    const u = ageMs / 270, radius = 10 + 14 * u;
    context.save(); context.strokeStyle = `rgba(255,235,171,${220 / 255 * (1-u)})`; context.lineWidth = 3; context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.stroke(); context.restore();
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

  function drawHand(point, alpha = 1, scale = .82) {
    if (!hand || alpha <= 0) return;
    context.save(); context.globalAlpha = alpha; context.translate(point.x, point.y); context.scale(scale, scale); context.drawImage(hand.image, -21, -14, hand.width || hand.image.width, hand.height || hand.image.height); context.restore();
  }
  function drawHint(now) {
    if (!hint || animation || demoTimeline) return;
    drawBranchCue(hint.fromId, '#fff0ad', .5, now); drawBranchCue(hint.toId, '#9df0d3', .4, now + 200);
    const source = branchMap.get(hint.fromId), destination = branchMap.get(hint.toId);
    if (!source || !destination) return;
    const birds = state.branches[hint.fromId] || [], targetBirds = state.branches[hint.toId] || [];
    const from = birds.length ? birdFoot(birds.at(-1), source, birds.length-1) : source.slots[0], to = destination.slots[Math.min(targetBirds.length,4)];
    const elapsed = (now-hint.startedAt) % 2500, travel = smooth((elapsed-700)/280), alpha = elapsed > 1600 ? 1-smooth((elapsed-1600)/270) : smooth(elapsed/180);
    drawHand({x:lerp(from.x,to.x,travel),y:lerp(from.y-65,to.y-25,travel)},alpha);
  }
  function drawDemo(timeMs) {
    if (!demoTimeline) return;
    if (canvas.dataset) canvas.dataset.demoTime = (Math.max(0,timeMs)/1000).toFixed(3);
    for (const tap of BIRD_VIDEO_DEMO.taps) drawTap(tap,timeMs-tap.atMs);
    const handPose = sampleDemoHand(timeMs);
    drawHand(handPose, handPose.alpha, handPose.scale);
    if (openingImage) {
      // The video keeps its illustrative download icon during the demo only.
      context.drawImage(openingImage,845,1580,95,93,845,1580,95,93);
      if (timeMs<950) {context.save();context.globalAlpha=1-smooth((timeMs-700)/250);context.drawImage(openingImage,0,0,width,height);context.restore();}
    }
  }
  function drawFrame(now) {
    context.setTransform(1,0,0,1,0,0);context.fillStyle='#101622';context.fillRect(0,0,canvas.width,canvas.height);context.setTransform(backingScale,0,0,backingScale,offsetX,offsetY);
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(background,0,0,width,height);
    for (const [id, landing] of lastLandings) if (now - landing.at >= 1500) lastLandings.delete(id);
    const current=animation,time=current?current.clock():0,departing=current&&current.cleared.length&&time>=current.departAt;
    const hiddenIds=new Set(current?.actors.map(actor=>actor.bird.id)||[]);
    if(departing)for(const group of current.cleared)for(const bird of group.birds)hiddenIds.add(bird.id);
    activeActorIds = hiddenIds;
    const selectedBirds=new Set(endGroup(state.branches[selectedId]||[]).map(bird=>bird.id));
    for(const branch of orderedBranches){(state.branches[branch.id]||[]).forEach((bird,index)=>{
      if(hiddenIds.has(bird.id))return;
      const slot=birdFoot(bird,branch,index);if(!slot)return;
      const selected=!current&&!demoTimeline&&branch.id===selectedId&&selectedBirds.has(bird.id);
      const landing=lastLandings.get(bird.id),age=landing?now-landing.at:Infinity;
      const pose=landing&&age<1500?sampleBirdMotion({...landing.spec,startMs:-1,endMs:0},age):{x:slot.x,y:slot.y,scaleX:1,scaleY:1};
      const shake=!demoTimeline&&now-invalidAt<270&&branch.id===selectedId?Math.sin((now-invalidAt)/25)*4*(1-(now-invalidAt)/270):0;
      drawBird(bird,{x:pose.x+shake,y:pose.y},branch.facing,{scaleX:pose.scaleX,scaleY:pose.scaleY,selected,hovered:!current&&!demoTimeline&&branch.id===hoveredId,branchId:branch.id,index,forceSpecies:Boolean(demoTimeline?.sourcePoses.has(bird.id))||Boolean(landing)||Boolean(shake)});
    });}
    if(current&&!departing){
      current.actors.forEach((actor,index)=>{
        const pose=sampleBirdMotion(actor,time);drawBird(actor.bird,pose,pose.facing,{scaleX:pose.scaleX,scaleY:pose.scaleY,flying:pose.flying,clock:time,forceSpecies:true,branchId:actor.fromId,index:actor.fromIndex});
        drawLanding(actor.to,time-actor.endMs);
        if(time>=actor.endMs&&!actor.landed){actor.landed=true;lastLandings.set(actor.bird.id,{at:now-(time-actor.endMs),spec:actor});}
      });
      if(time>=current.firstFlight&&!current.flightSound){current.flightSound=true;if(!current.suppressAudio)playCue('flutters',current.audioVariant);}
      if(time>=current.lastLanding&&!current.landingSound){current.landingSound=true;if(!current.suppressAudio)playCue('landings',current.audioVariant);}
    }
    if(departing){current.cleared.forEach(group=>{const branch=branchMap.get(group.branchId);group.birds.forEach((bird,index)=>{
      const local=time-current.departAt-index*80,u=clamp(local/1050),slot=branch.slots[index];if(!slot||u>=1)return;
      const travel=smooth(u),point={x:lerp(slot.x,lerp(slot.x,width/2,.48),travel),y:lerp(slot.y,-230,travel)-Math.sin(u*Math.PI)*35};
      drawBurst(slot,local,index,true);drawBird(bird,point,branch.facing,{flying:local>0,clock:time,forceSpecies:true});
    });});if(!current.departSound){current.departSound=true;if(!current.suppressAudio)playCue('flutters',current.audioVariant);}}
    if(!current&&!demoTimeline){if(hoveredId)drawBranchCue(hoveredId,'#f5dfa7',.28,now);if(document.activeElement===canvas&&focusId)drawBranchCue(focusId,'#d8f5ec',.65,now);drawHint(now);}
    if(demoTimeline)drawDemo(demoTimeline.clock());
    if(current&&time>=current.endTime){const after=current.afterState,resolve=current.resolve;animation=null;state=copyState(after);selectedId=state.selected||null;dirty=true;resolve({cancelled:false});}
  }

  function tick(now) {
    if (destroyed) return;
    if ((window.devicePixelRatio || 1) !== lastDpr) resize();
    if (dirty || animation || demoTimeline || lastLandings.size || selectedId || hint || hoveredId || document.activeElement === canvas) { dirty = false; drawFrame(now); }
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
    lastLandings.clear(); stopSounds();
    if (!animation) return;
    const pending=animation;animation=null;state=copyState(pending.afterState);selectedId=state.selected||null;dirty=true;pending.resolve({cancelled:true});
  }

  return {
    setState(nextState) {
      if(animation)cancelAnimation();
      if (JSON.stringify(state.branches) !== JSON.stringify(nextState.branches)) lastLandings.clear();
      state=copyState(nextState);selectedId=state.selected||null;dirty=true;
    },
    animate(event,beforeState,afterState,config={}) {
      cancelAnimation();if(destroyed)return Promise.resolve({cancelled:true});
      if(event?.type!=='move'){
        state=copyState(afterState);selectedId=state.selected||null;dirty=true;
        if(event?.type==='invalid')invalidAt=performance.now();
        if(!config.suppressAudio)playCue('tap');
        return Promise.resolve({cancelled:false});
      }
      const from=branchMap.get(event.fromId),to=branchMap.get(event.toId);if(!from||!to)throw new Error('Move refers to an unknown branch.');
      state=copyState(beforeState);selectedId=null;hoveredId=null;hint=null;
      const step=config.demoStep==null?null:BIRD_VIDEO_DEMO.steps[config.demoStep];
      const startedAt=performance.now(),clock=step?(config.clock||demoTimeline?.clock):()=>performance.now()-startedAt;
      if(step&&!clock)throw new Error('An exact demo move requires its timeline clock.');
      const birds=event.birds||endGroup(state.branches[event.fromId]).reverse();
      const fromIndices=event.fromIndices||birds.map((_,i)=>state.branches[event.fromId].length-1-i),toIndices=event.toIndices||birds.map((_,i)=>state.branches[event.toId].length+i);
      const startMs=step?.flightStartMs??(config.anticipationMs??300),duration=step?step.flightEndMs-step.flightStartMs:(config.flightMs??(event.species===0?1720:1900));
      const arc=step?.arc??config.arc??(event.species===9?-100:event.species===4?-85:event.species===0?-65:-85),stagger=step?0:(config.staggerMs??0);
      const actors=birds.map((bird,index)=>{
        const path=step?.paths.find(item=>item.fromIndex===fromIndices[index]);
        const sourceSlot=path?.from||birdFoot(bird,from,fromIndices[index]),targetSlot=path?.to||to.slots[toIndices[index]];
        if(!sourceSlot||!targetSlot)throw new Error('Move exceeds branch capacity.');
        return{bird:{...bird},fromId:event.fromId,fromIndex:fromIndices[index],toId:event.toId,toIndex:toIndices[index],from:{...sourceSlot},to:{...targetSlot},startMs:startMs+index*stagger,endMs:startMs+duration+index*stagger,arc,sourceFacing:from.facing,destinationFacing:to.facing,landed:false};
      });
      const cleared=(event.cleared||[]).map(group=>({...group,birds:group.birds.map(bird=>({...bird}))}));
      const firstFlight=Math.min(...actors.map(actor=>actor.startMs)),lastLanding=Math.max(...actors.map(actor=>actor.endMs)),settle=config.settleMs??400,departAt=lastLanding+settle+900,endTime=cleared.length?departAt+1050+320:lastLanding+settle;
      const suppressAudio=Boolean(step||config.suppressAudio),audioVariant=step?.audioVariant??(event.species===4?1:event.species===0?2:0);
      if(!suppressAudio)playCue('tap');
      return new Promise(resolve=>{animation={event,actors,afterState:copyState(afterState),cleared,startedAt,clock,firstFlight,lastLanding,departAt,endTime,resolve,suppressAudio,audioVariant,flightSound:false,landingSound:false,departSound:false};dirty=true;});
    },
    setSelected(id) { selectedId=branchMap.has(id)?id:null;dirty=true; },
    setHint(value) {hint=value&&branchMap.has(value.fromId)&&branchMap.has(value.toId)?{...value,startedAt:performance.now()}:null;dirty=true;},
    setDemoTimeline(value) {
      stopSounds(true);lastLandings.clear();
      if(value){const sourcePoses=new Map();for(const step of BIRD_VIDEO_DEMO.steps)for(const path of step.paths){const bird=state.branches[step.fromId]?.[path.fromIndex];if(bird)sourcePoses.set(bird.id,{branchId:step.fromId,index:path.fromIndex,point:{...path.from}});}demoTimeline={...value,sourcePoses};}
      else{demoTimeline=null;if(canvas.dataset)delete canvas.dataset.demoTime;playMusic();}
      dirty=true;
    },
    setSound(enabled) {soundEnabled=Boolean(enabled);if(!soundEnabled){stopSounds();audioBank.music.pause();}else if(navigator.userActivation?.isActive){unlockAudio();}else playMusic();},
    cancelAnimation,
    getDebugState() {return {ready:true,busy:Boolean(animation),selectedId,hoveredId,hint:hint?{fromId:hint.fromId,toId:hint.toId}:null,state:copyState(state),drawnBirds:Object.values(state.branches).reduce((sum,birds)=>sum+birds.length,0),logicalSize:[width,height],backingSize:[canvas.width,canvas.height],soundEnabled,audioState:audioActivated?'activated':'not-started',demoTimeMs:demoTimeline?.clock()??null,animatedSpecies:[...sprites].filter(([,sprite])=>sprite.animation).map(([id])=>id),animation:animation?{fromId:animation.event.fromId,toId:animation.event.toId,count:animation.actors.length,clears:animation.cleared.map(group=>group.branchId),firstFlightMs:animation.firstFlight,lastLandingMs:animation.lastLanding,endTimeMs:animation.endTime,actors:animation.actors.map(actor=>({birdId:actor.bird.id,fromIndex:actor.fromIndex,toIndex:actor.toIndex,from:actor.from,to:actor.to,startMs:actor.startMs,endMs:actor.endMs,arc:actor.arc,pose:sampleBirdMotion(actor,animation.clock())}))}:null};},
    destroy() {if(destroyed)return;cancelAnimation();destroyed=true;cancelAnimationFrame(raf);observer?.disconnect();window.removeEventListener('resize',resize);listeners.forEach(([name,callback])=>canvas.removeEventListener(name,callback));document.removeEventListener('pointerdown',unlockAudio,true);document.removeEventListener('keydown',unlockAudio,true);stopSounds(true);}

  };
}

return {BIRD_VIDEO_DEMO, sampleBirdMotion, sampleDemoHand, createRenderer};
})();
const {createRenderer, BIRD_VIDEO_DEMO} = Renderer;

const $ = id => document.getElementById(id);
const manifest = window.BirdSortAssets;
let state = Engine.createGame();
let renderer;
let busy = false;
let demoPlaying = false;
let generation = 0;
let soundEnabled = true;
try { soundEnabled = localStorage.getItem('gamejuice-bird-sound') !== 'off'; } catch {}
// The approved video mix contains its narration, music and effects already.
// Its playback clock also drives the demonstration, so visuals cannot drift.
const demoAudio = new Audio('./assets/' + (manifest?.audio?.demoPremix || 'audio/demo-premix.wav'));
demoAudio.preload = 'auto';
demoAudio.volume = 1;
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

async function accept(result, before, token = generation, animationOptions = {}) {
  state = result.state;
  const event = result.event;
  renderer.setHint(null);
  if (event?.type !== 'move') {
    renderer.animate(event, before, state, animationOptions).catch(error => console.error('Bird feedback:', error));
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
    await renderer.animate(event, before, state, animationOptions);
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
  demoAudio.pause();
  demoAudio.currentTime = 0;
  renderer?.setDemoTimeline(null);
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
  demoAudio.pause();
  demoAudio.currentTime = 0;
  renderer?.setDemoTimeline(null);
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
  let fallbackStartedAt = performance.now(), audioClock = true;
  const clock = () => {
    if (audioClock && demoAudio.error) {
      fallbackStartedAt = performance.now() - demoAudio.currentTime * 1000;
      audioClock = false;
    }
    if (audioClock && demoAudio.ended) return BIRD_VIDEO_DEMO.durationMs;
    return audioClock ? Math.min(BIRD_VIDEO_DEMO.durationMs, demoAudio.currentTime * 1000) : Math.min(BIRD_VIDEO_DEMO.durationMs, performance.now() - fallbackStartedAt);
  };
  renderer.setDemoTimeline({ clock });
  renderer.setSound(soundEnabled);
  demoAudio.muted = !soundEnabled;
  demoAudio.currentTime = 0;
  // Invoke play directly from the click. Muting keeps the same clock/timeline.
  const playing = demoAudio.play();
  say('Watch three moves, then carry on playing.');
  sync();
  try { await playing; } catch {
    audioClock = false;
    fallbackStartedAt = performance.now();
  }
  if (!demoPlaying || token !== generation) return;
  const until = async timeMs => {
    while (demoPlaying && token === generation && clock() < timeMs) {
      await wait(Math.min(24, Math.max(4, timeMs - clock())));
    }
    return demoPlaying && token === generation;
  };
  for (const [index, step] of BIRD_VIDEO_DEMO.steps.entries()) {
    if (!await until(step.sourceTapMs)) return;
    renderer.setSelected(step.fromId);
    say(`${branchName(step.fromId)} → ${branchName(step.toId)}.`);
    if (!await until(step.destinationTapMs)) return;
    const before = state;
    await accept(Engine.move(state, step.fromId, step.toId), before, token, { demoStep: index, clock, suppressAudio: true });
    if (!demoPlaying || token !== generation) return;
  }
  if (!await until(BIRD_VIDEO_DEMO.durationMs)) return;
  demoPlaying = false;
  demoAudio.pause();
  renderer.setDemoTimeline(null);
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
    demoAudio.muted = !soundEnabled;
    try { localStorage.setItem('gamejuice-bird-sound', soundEnabled ? 'on' : 'off'); } catch {}
    sync();
  });
  $('demo').addEventListener('click', watchDemo);
  $('play-again').addEventListener('click', () => restart());
  $('keep-looking').addEventListener('click', () => $('win').close());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && demoPlaying) stopDemo();
  });
  window.addEventListener('pagehide', () => { if (demoPlaying) stopDemo(); demoAudio.pause(); renderer.setSound(false); });
  sync();
}
start().catch(error => {
  console.error(error);
  $('loading').innerHTML = '<div class="error-state"><p>The forest could not load.</p><p>Refresh the page to try again.</p></div>';
  say('The game could not start.');
});

})();
