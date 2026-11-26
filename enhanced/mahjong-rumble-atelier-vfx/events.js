/** Actual source-event observation. This module never simulates movement, draws,
 * consumes randomness, changes transforms, schedules gameplay, or owns input.
 * Call tick after the native source update and before presentation rendering.
 */
export function createFeedbackDirector(A, callbacks = {}) {
  const token = Symbol('mahjong-feedback-director');
  const wrapped = new WeakMap();
  let game = null, scene = null, epoch = 0, serial = 0, matchContext = null;
  let flightRecords = [], bomRecords = [], fallBatches = [], actors = [], panel = null;
  let rankingSeen = false, endingSeen = false, ids = new WeakMap();
  const counts = {}, errors = [];
  const MAX_TRACKED = 96, EPSILON = 0.00001;
  const alive = node => !!node && node.isValid !== false && !node._destroyed;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const near = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= EPSILON;
  const rememberError = error => { if (errors.length < 32) errors.push(String(error)); };
  function now() {
    try {
      const value = callbacks.now ? callbacks.now() : performance.now() / 1000;
      if (finite(value)) return value;
      throw new Error('Feedback clock must return finite performance seconds');
    } catch (error) { rememberError(error); return performance.now() / 1000; }
  }
  function call(name, args) {
    try { callbacks[name]?.(...args); } catch (error) { rememberError(name + ': ' + error); }
  }
  const id = node => ids.get(node) ?? (Number.isFinite(node?.id) ? node.id : null);
  const nodeDetails = nodes => ({ids:nodes.map(id), types:nodes.map(node => node?.name ?? null)});
  function emit(name, at, detail, args) {
    counts[name] = (counts[name] || 0) + 1;
    call('record', [name, {at, epoch, ...detail}]);
    call(name, args);
  }
  function visible(node) {
    if (!alive(node) || node.activeInHierarchy === false) return false;
    for (let current = node; current; current = current.parent) {
      if (current.active === false || current._active === false || current.opacity === 0) return false;
    }
    return true;
  }
  function cap(list) {
    // A presentation-only bound. Native objects/actions are never destroyed.
    if (list.length > MAX_TRACKED) {
      list.splice(0, list.length - MAX_TRACKED);
      rememberError('Decorative tracking bound reached');
    }
  }
  function wrap(name, observe) {
    const current = game[name];
    if (typeof current !== 'function' || wrapped.get(current) === token) return;
    const original = current;
    const wrapper = function(...args) {
      // Stale scene methods remain callable with their exact native behavior.
      // They must not emit feedback into a replacement scene.
      if (this !== game || this.cardLayer !== scene) return original.apply(this, args);
      return observe.call(this, original, args);
    };
    wrapped.set(wrapper, token);
    game[name] = wrapper;
  }
  function attach() {
    const current = A?.game;
    if (!current?.cardLayer) return false;
    if (current !== game || current.cardLayer !== scene) {
      game = current; scene = current.cardLayer; epoch++;
      flightRecords = []; bomRecords = []; fallBatches = []; actors = []; panel = null;
      rankingSeen = false; endingSeen = Boolean(game.isShowOver); matchContext = null;
      ids = new WeakMap();
      for (const [key, node] of Object.entries(A.nodes || {})) {
        if (node && (typeof node === 'object' || typeof node === 'function')) ids.set(node, Number(key));
      }
      const at = now(); emit('reset', at, {}, [epoch]);
    }
    wrap('onCreateLight', function(original, args) {
      const at = now(), node = args[0];
      const result = original.apply(this, args);
      emit('select', at, nodeDetails([node]), [node, at]);
      return result;
    });
    wrap('onError', function(original, args) {
      const at = now(), nodes = [...(this.selectBoxArr || [])];
      const result = original.apply(this, args);
      emit('mismatch', at, nodeDetails(nodes), [nodes, at]);
      return result;
    });
    wrap('onSuccess', function(original, args) {
      const at = now(), nodes = [...(this.selectBoxArr || [])], nextMatch = this.matchCount + 1;
      const previous = matchContext;
      matchContext = {serial:++serial, epoch, born:at};
      let result;
      try { result = original.apply(this, args); } finally { matchContext = previous; }
      emit('match', at, {...nodeDetails(nodes), match:nextMatch}, [nodes, at, nextMatch]);
      return result;
    });
    wrap('getFallMoves', function(original, args) {
      const moves = original.apply(this, args);
      if (matchContext && Array.isArray(moves)) {
        const tracked = moves.filter(move => alive(move?.node) && finite(move.targetY))
          .map(move => ({node:move.node, targetY:move.targetY, reached:false}));
        if (tracked.length) { fallBatches.push({...matchContext, moves:tracked}); cap(fallBatches); }
      }
      return moves; // Native array identity and entries remain untouched.
    });
    wrap('onCreateBomEffect', function(original, args) {
      const at = now(), layer = this.effectLayer, before = new Set(layer?.children || []);
      const result = original.apply(this, args);
      for (const node of layer?.children || []) {
        if (!before.has(node) && node.particle && alive(node)) {
          bomRecords.push({node, source:args[0], serial:++serial, born:at, epoch});
        }
      }
      cap(bomRecords);
      return result;
    });
    wrap('onFlyBrain', function(original, args) {
      const at = now(), node = args[1], receiver = this.moneyLabel?.node;
      const result = original.apply(this, args);
      if (alive(node) && receiver) {
        flightRecords.push({node, receiver, serial:++serial, born:at, epoch}); cap(flightRecords);
      }
      return result;
    });
    wrap('onAddMoney', function(original, args) {
      const at = now(), receiver = this.moneyLabel?.node;
      // The native flyer callback first destroys its node at local (0,0), then
      // invokes this method. Ranking counters are not currency-flight receipts.
      const flight = args[0] === this.moneyLabel ? flightRecords.find(item =>
        item.epoch === epoch && item.receiver === receiver && item.node._destroyed &&
        near(item.node.x, 0) && near(item.node.y, 0)) : null;
      const popupComplete = panel && args[0] === this.overMoneyLabel;
      const result = original.apply(this, args);
      if (flight) {
        flightRecords.splice(flightRecords.indexOf(flight), 1);
        emit('winnings', at, {amount:args[1], receiverId:id(receiver), flightSerial:flight.serial}, [receiver, at, args[1]]);
      }
      // The source calls this label only inside its popup scale completion.
      // Merely crossing scale 1 during the bounce is not a completed landing.
      if (popupComplete && panel) panel.sourceComplete = true;
      return result;
    });
    wrap('showOverScene', function(original, args) {
      const at = now(), wasOver = Boolean(this.isShowOver);
      const result = original.apply(this, args);
      if (!wasOver && this.isShowOver && !endingSeen) {
        endingSeen = true;
        const node = this.overScaleNode || A.nodes?.[92];
        panel = node ? {node, epoch, sourceComplete:false} : null;
        emit('ending', at, {matches:this.matchCount}, [at, this.matchCount]);
      }
      return result;
    });
    wrap('onRankingListAnim', function(original, args) {
      const at = now();
      const result = original.apply(this, args);
      if (!rankingSeen && endingSeen) {
        rankingSeen = true;
        const specs = [[this.oneLayer?.children?.[1] || A.nodes?.[77],330],
          [this.twoLayer?.children?.[1] || A.nodes?.[83],200],
          [this.threeLayer?.children?.[1] || A.nodes?.[89],130]];
        actors = specs.filter(([node]) => alive(node)).map(([node,targetY]) => ({node,targetY,epoch}));
        emit('ranking', at, {ids:actors.map(item => id(item.node))}, [at]);
      }
      return result;
    });
    return true;
  }
  function tick() {
    if (!attach()) return;
    const at = now();
    // Source updates and deferred cleanup already ran. Observe only the actual
    // target transforms; no duration guesses, extra actions or synthetic path.
    const pendingFalls = [];
    for (const batch of fallBatches) {
      for (const move of batch.moves) if (alive(move.node) && near(move.node.y, move.targetY)) move.reached = true;
      if (batch.moves.every(move => move.reached || !alive(move.node))) {
        const nodes = batch.moves.filter(move => move.reached && alive(move.node)).map(move => move.node);
        if (nodes.length) emit('contact', at, {...nodeDetails(nodes), batchSerial:batch.serial}, [nodes, at]);
      } else pendingFalls.push(batch);
    }
    fallBatches = pendingFalls;
    const pendingActors = [];
    for (const actor of actors) {
      if (!alive(actor.node)) continue;
      if (near(actor.node.y, actor.targetY) && visible(actor.node)) {
        emit('actorArrival', at, {id:id(actor.node), targetY:actor.targetY}, [actor.node, at]);
      } else pendingActors.push(actor);
    }
    actors = pendingActors;
    if (panel && (!alive(panel.node) || (panel.sourceComplete && visible(panel.node) &&
      near(panel.node.scaleX, 1) && near(panel.node.scaleY, 1)))) {
      const settled = panel; panel = null;
      if (alive(settled.node)) emit('panelLanding', at, {id:id(settled.node)}, [settled.node, at]);
    }
    flightRecords = flightRecords.filter(item => item.epoch === epoch && alive(item.node));
    bomRecords = bomRecords.filter(item => item.epoch === epoch && alive(item.node));
  }
  return {
    attach, tick,
    get flights() { return flightRecords.filter(item => alive(item.node)); },
    get boms() { return bomRecords.filter(item => alive(item.node)); },
    diagnostics() { return {epoch, attached:!!scene, events:{...counts}, errors:[...errors],
      trackedFlights:flightRecords.filter(item => alive(item.node)).length,
      trackedBoms:bomRecords.filter(item => alive(item.node)).length,
      pendingFallBatches:fallBatches.length, pendingActors:actors.length, panelPending:!!panel}; }
  };
}
