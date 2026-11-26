/* Woofdoku presentation bridge. Reads original Luna state and subscribes to its
   QFramework events. Does not invoke gameplay commands or change model fields. */
(() => {
  'use strict';
  if (window.WoofdokuBridge) return;
  const listeners = new Set(), subscriptions = [];
  let controller = null, canvasRoot = null, runtime = null, readyResolve;
  let timer = 0, disposed = false, sequence = 0;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const diagnostic = { connected: false, lastError: '', eventCount: 0 };
  const safely = (read, fallback = null) => { try { return read(); } catch { return fallback; } };
  const prop = (model, key, fallback = 0) => safely(() => {
    const p = model['App$IBoardModel$' + key] ?? model[key];
    if (p == null) return fallback;
    if (typeof p !== 'object' || Array.isArray(p)) return p;
    if (p.Value !== undefined) return p.Value;
    const alias = Object.keys(p).find(k => k.endsWith('$Value'));
    return alias ? p[alias] : fallback;
  }, fallback);
  const model = () => controller?.mBoardModel;
  const gameCanvas = () => document.getElementById('application-canvas');
  function rectOf(rect) {
    return safely(() => {
      if (!rect) return null;
      if (!rect.GetWorldCorners && rect.GetComponent) rect = rect.GetComponent(UnityEngine.RectTransform);
      if (!rect?.GetWorldCorners) return null;
      const canvas = gameCanvas();
      if (!canvas) return null;
      const bounds = canvas.getBoundingClientRect();
      const sw = UnityEngine.Screen.width, sh = UnityEngine.Screen.height;
      if (!(sw > 0 && sh > 0 && bounds.width > 0 && bounds.height > 0)) return null;
      const corners = Array.from({ length: 4 }, () => new UnityEngine.Vector3());
      rect.GetWorldCorners(corners);
      const points = corners.map(point => {
        const p = UnityEngine.RectTransformUtility.WorldToScreenPoint(null, point);
        return { x: bounds.left + p.x / sw * bounds.width,
                 y: bounds.top + (1 - p.y / sh) * bounds.height };
      });
      const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
      const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y));
      if (![left, right, top, bottom].every(Number.isFinite)) return null;
      return { x: (left + right) / 2, y: (top + bottom) / 2,
        left, top, right, bottom, width: right - left, height: bottom - top,
        corners: points, visible: safely(() => rect.gameObject.activeInHierarchy, true) };
    });
  }
  function cellRect(x, y) {
    const size = prop(model(), 'GridSize');
    const view = controller?.mCellViews?.[y * size + x];
    return rectOf(view?.mRectTransform || safely(() => view.transform));
  }
  function uiRect(path) {
    return safely(() => {
      if (!canvasRoot) return null;
      return rectOf(path ? canvasRoot.Find(path) : canvasRoot);
    });
  }
  function snapshot(options = {}) {
    if (!diagnostic.connected || !model()) return null;
    const m = model(), includeRects = options.rects !== false;
    const cells = Array.from(prop(m, 'Cells', [])).map(c => ({
      x: c.X, y: c.Y, color: c.ColorId, region: c.RegionIndex,
      status: c.Status, selected: c.IsSelected, excluded: c.IsExcluded,
      error: c.IsError, isAnswer: c.IsAnswer,
      ...(includeRects && (!options.activeOnly || c.IsSelected || c.IsExcluded || c.IsError) ? {
        rect: cellRect(c.X, c.Y),
        dogRect: rectOf(safely(() => controller.mCellViews[c.Y * prop(m, 'GridSize') + c.X].mPieceIcon.rectTransform)),
        dogVisible: !!safely(() => { const icon = controller.mCellViews[c.Y * prop(m, 'GridSize') + c.X].mPieceIcon; return icon.enabled && icon.gameObject.activeInHierarchy; }, false),
        dogRenderable: !!safely(() => { const icon = controller.mCellViews[c.Y * prop(m, 'GridSize') + c.X].mPieceIcon; const scale = icon.rectTransform.localScale; return icon.enabled && icon.gameObject.activeInHierarchy && Math.abs(scale.x) > 0.005 && Math.abs(scale.y) > 0.005; }, false),
        successFeedbackActive: !!safely(() => controller.mCellViews[c.Y * prop(m, 'GridSize') + c.X].mPlacementSuccessRoutine, false)
      } : {})
    }));
    const result = safely(() => controller.mPlayableResultPanel);
    const hint = safely(() => controller.mIdlePlacementHintView);
    return {
      ready: true, time: performance.now(), level: prop(m, 'LevelId', ''),
      gridSize: prop(m, 'GridSize'), placed: prop(m, 'SelectedCount'),
      excluded: prop(m, 'ExcludedCount'), lives: prop(m, 'LivesRemaining'),
      completed: prop(m, 'IsCompleted', false), revision: prop(m, 'Revision'),
      inputEnabled: !!controller.mBoardInputEnabled,
      elapsedSeconds: safely(() => controller.mBoardSystem.App$IBoardSystem$ActiveLevelElapsedSeconds, 0),
      timeLimitSeconds: safely(() => controller.mBoardSystem.App$IBoardSystem$ActiveLevelTimeLimitSeconds, 120),
      hintVisible: !!safely(() => hint.IsVisible, false),
      resultVisible: !!safely(() => result.IsVisible, false),
      result: safely(() => result.CurrentResult, ''),
      failureReason: safely(() => result.CurrentFailureReason, ''),
      audioMuted: safely(() => controller.mAudioManager.IsMuted, false),
      cells,
      ...(includeRects ? {
        boardRect: rectOf(controller.mBoardRoot),
        hudDogRect: uiRect('TopHud/StatusNodes/QueenNode/QueenContent/QueenIcon'),
        countRect: uiRect('TopHud/StatusNodes/QueenNode/QueenContent/QueenCountLabel'),
        rulesRect: uiRect('TopHud/HintPanel'),
        resultRect: uiRect('CompletePanel'),
        resultIconRect: uiRect('CompletePanel/Icon'),
        resultInfoRect: uiRect('CompletePanel/Info'),
        resultPlayRect: uiRect('CompletePanel/PlayBtn')
      } : {})
    };
  }
  function notify(type, data = {}) {
    const event = Object.freeze({ type, at: performance.now(), sequence: ++sequence, ...data });
    diagnostic.eventCount++;
    for (const listener of [...listeners]) {
      try { listener(event); } catch (error) { console.warn('Woofdoku presentation listener:', error); }
    }
  }
  const eventSpecs = [
    ['BoardCellToggledEvent', 'cell', ['X', 'Y', 'Status', 'IsSelected', 'IsExcluded', 'Changed', 'Source']],
    ['BoardLifeLostEvent', 'invalid', ['X', 'Y', 'LivesRemaining', 'FailureRules', 'LevelId']],
    ['BoardStateChangedEvent', 'state', ['Revision', 'SelectedCount', 'ExcludedCount', 'ConflictCount', 'IsCompleted', 'LevelId']],
    ['BoardCompletedEvent', 'complete', ['LevelId', 'ElapsedSeconds', 'GridSize']],
    ['BoardFailedEvent', 'failed', ['LevelId', 'Reason']],
    ['BoardLevelLoadedEvent', 'load', ['LevelId']],
    ['BoardLevelRestartedEvent', 'reset', ['LevelId']]
  ];
  function connect() {
    if (disposed || diagnostic.connected) return;
    try {
      if (!window.App?.SceneObjectLookup || !window.QFramework || !window.UnityEngine) return;
      const found = App.SceneObjectLookup.FindIncludingInactive(App.BoardViewController);
      if (!found?.mBoardModel || !found.mCellViews?.length || !prop(found.mBoardModel, 'HasLevel', false)) return;
      controller = found;
      const go = UnityEngine.GameObject.Find('GameCanvas');
      canvasRoot = go?.transform || null;
      runtime = App.SceneObjectLookup.FindIncludingInactive(App.RuntimeState);
      for (const [className, type, fields] of eventSpecs) {
        if (!App[className]) continue;
        const token = QFramework.CanRegisterEventExtension.RegisterEvent(App[className], controller, data => {
          const detail = {};
          for (const field of fields) if (data?.[field] !== undefined) detail[field] = data[field];
          notify(type, detail);
        });
        subscriptions.push(token);
      }
      diagnostic.connected = true;
      diagnostic.lastError = '';
      clearInterval(timer);
      readyResolve(api);
      notify('ready');
    } catch (error) {
      diagnostic.lastError = String(error?.message || error);
      // If registration fails partway, unregister before another attempt.
      for (const token of subscriptions.splice(0)) safely(() => token.QFramework$IUnRegister$UnRegister());
    }
  }
  function dispose() {
    disposed = true;
    clearInterval(timer);
    for (const token of subscriptions.splice(0)) safely(() => token.QFramework$IUnRegister$UnRegister());
    listeners.clear();
  }
  const api = Object.freeze({
    ready, snapshot, cellRect, uiRect,
    on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    diagnostics: () => ({ ...diagnostic }),
    dispose
  });
  window.WoofdokuBridge = api;
  timer = setInterval(connect, 100);
  window.addEventListener('luna:build', connect);
  window.addEventListener('luna:start', connect);
  window.addEventListener('pagehide', dispose, { once: true });
  connect();
})();
