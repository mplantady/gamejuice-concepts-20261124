/* Presentation-only cabinet surfaces. The source nodes retain input and live text. */
const installations = new WeakMap();
const serif = 'Georgia, "Times New Roman", serif';
const ink = [43, 42, 66, 255];
const ivory = [255, 239, 199, 255];

export function installCabinetUI(api, g, textures = {}) {
  if (g && installations.has(g)) return installations.get(g);
  const created = new Map(), hidden = new Map(), labels = new Map(), opacities = new Map();
  let disposed = false, changes = 0, game = g || null;
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const valid = node => !!node && node.isValid !== false;
  const child = (node, name) => node?.getChildByName?.(name) || node?.children?.find(n => n.name === name);
  const dirty = () => { changes++; api.dirty?.(); };
  const usable = tex => !!tex && (tex.userData?.w || tex.image?.width || 0) > 0
    && (tex.userData?.h || tex.image?.height || 0) > 0;

  function hideVisual(node) {
    if (!node?.sprite) return;
    if (!hidden.has(node)) hidden.set(node, {
      sprite: node.sprite, color: node.sprite.color, opacity: node.sprite.mesh.material.opacity,
    });
    // il() recomputes material opacity every render; sprite alpha is its durable input.
    if (node.sprite.color[3] !== 0) {
      // Source sprites may share a palette array; isolate this visual's alpha.
      node.sprite.color = [...node.sprite.color.slice(0, 3), 0];
      node.sprite.mesh.material.opacity = 0;
      dirty();
    }
  }

  function surface(key, parent, tex, width, height, x = 0, y = 0) {
    if (!valid(parent) || !usable(tex) || !api.sprite) return null;
    let node = created.get(key);
    if (!valid(node)) {
      // Omit rect: every supplied image already has clean full-UV bounds.
      node = api.sprite(`cabinet_${key}`, tex, { w: width, h: height, color: [255, 255, 255, 255] }, parent);
      node.setSiblingIndex(0);
      created.set(key, node);
      dirty();
    }
    if (node.sprite.tex !== tex) {
      node.sprite.tex = tex;
      node.sprite.mesh.material.map = tex;
      node.sprite.mesh.material.needsUpdate = true;
      dirty();
    }
    if (node.w !== width || node.h !== height || node.x !== x || node.y !== y) {
      node.w = width; node.h = height; node.x = x; node.y = y;
      dirty();
    }
    return node;
  }

  function replaceVisual(key, node, tex, width = node?.w, height = node?.h) {
    const replacement = surface(key, node, tex, width, height);
    if (replacement) hideVisual(node);
    return replacement;
  }

  function styleLabel(node, style, maxWidth) {
    if (!valid(node) || !node.label || !api.refresh) return;
    let record = labels.get(node);
    if (!record) {
      record = { original: copy(node.label), style: copy(style), maxWidth, fittedSize: null };
      labels.set(node, record);
    }
    const wanted = { ...record.style, ...(record.fittedSize ? { fontSize: record.fittedSize } : {}) };
    if (Object.keys(wanted).every(k => JSON.stringify(node.label[k]) === JSON.stringify(wanted[k]))) return;
    // Qc reads node.label; Xc later updates only label.string, so live values retain this style.
    Object.assign(node.label, copy(wanted));
    api.refresh(node);
    if (maxWidth && node.w > maxWidth) {
      record.fittedSize = Math.max(12, Math.floor(node.label.fontSize * maxWidth / node.w));
      node.label.fontSize = record.fittedSize;
      api.refresh(node);
    }
    dirty();
  }

  function opaqueSurfaceParent(node) {
    if (!valid(node)) return;
    if (!opacities.has(node)) opacities.set(node, { hadOpacity: !!node.uiop, value: node.opacity });
    if (node.opacity !== 255) { node.ensureOpacity().opacity = 255; dirty(); }
  }

  function update() {
    if (disposed) return;
    game = game || api.game?.();
    if (!valid(game?.node)) return;
    const top = game.bg_1 || child(game.bgNode, 'bg_1');
    if (valid(top)) {
      // The crest consumes the upper atlas area. Center its blank face on the
      // unchanged live headline; source bg_1 y445 + local83 = plaque world528.
      surface('header', top, textures.header, 700, 300, 0, 83);
      styleLabel(child(top, 'Label_IQ'), {
        family: serif, fontSize: 48, lineHeight: 50, bold: true,
        color: ink, outline: null,
      }, 560);
      styleLabel(game._iqNode || child(top, 'Num_IQ'), {
        family: serif, fontSize: 50, lineHeight: 50, bold: true,
        color: [204, 21, 18, 255], outline: { color: [91, 31, 30, 255], width: 0.6 },
      });
    }

    const footer = game.downloadLayer;
    if (valid(footer)) {
      const panel = game._bgBlack || child(footer, 'bg_black');
      if (replaceVisual('footer', panel, textures.footer, panel?.w, 100)) opaqueSurfaceParent(panel);
      replaceVisual('footer_icon', child(footer, 'icon'), textures.icon);
      styleLabel(child(footer, 'label_free'), {
        family: serif, fontSize: 44, lineHeight: 60, bold: true,
        color: ink, outline: { color: ivory, width: 1.5 },
      }, 355);
      const button = game._btnDownload || child(footer, 'btn_download');
      replaceVisual('install_button', button, textures.button);
      // The source has two same-named siblings: a lowered dark shadow and its face.
      const installLabels = button?.children?.filter(n => n.name === 'label_Install' && n.label) || [];
      installLabels.forEach((node, index) => styleLabel(node, {
        family: serif, fontSize: 40, lineHeight: 50, bold: true,
        color: index === 0 ? [40, 50, 34, 255] : ivory,
        outline: { color: [40, 58, 30, 255], width: index === 0 ? 1.5 : 1 },
      }, 175));
    }

    const endcard = game.layerOver;
    if (valid(endcard)) {
      replaceVisual('endcard_icon', child(endcard, 'icon'), textures.icon);
      styleLabel(child(endcard, 'label'), {
        family: serif, fontSize: 76, lineHeight: 100, bold: true,
        color: ivory, outline: { color: [38, 34, 54, 255], width: 2 },
      }, 580);
      replaceVisual('endcard_play',child(child(endcard,'btn_jumpStore'),'Background'),textures.play);
      // The source triangle/action and all hit bounds remain unchanged.
      // Landscape printed mascot logos and tutorial transforms are also untouched.
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const node of created.values()) if (valid(node)) node.destroy();
    for (const [node, saved] of hidden) if (valid(node) && node.sprite === saved.sprite) {
      node.sprite.color = saved.color;
      node.sprite.mesh.material.opacity = saved.opacity;
    }
    for (const [node, saved] of opacities) if (valid(node)) {
      if (saved.hadOpacity) node.ensureOpacity().opacity = saved.value;
      else node.uiop = null;
    }
    for (const [node, record] of labels) if (valid(node) && node.label) {
      const liveString = node.label.string;
      node.label = { ...copy(record.original), string: liveString };
      api.refresh(node);
    }
    if (game && installations.get(game) === controller) installations.delete(game);
    api.dirty?.();
  }

  function snapshot() {
    return {
      installed: !!game?.node && !disposed, disposed, changes,
      readyTextures: Object.fromEntries(['header', 'footer', 'button', 'icon'].map(k => [k, usable(textures[k])])),
      surfaces: [...created].filter(([, node]) => valid(node)).map(([key, node]) => ({
        key, name: node.name, width: node.w, height: node.h, x: node.x, y: node.y,
        fullUV: node.sprite?.rect == null,
      })),
      labels: [...labels].filter(([node]) => valid(node)).map(([node]) => ({
        name: node.name, string: node.label.string, family: node.label.family,
        fontSize: node.label.fontSize, color: [...node.label.color],
      })),
      installHitBounds: game?._btnDownload ? { width: game._btnDownload.w, height: game._btnDownload.h, active: game._btnDownload.active } : null,
    };
  }

  const controller = { update, dispose, snapshot };
  if (g) installations.set(g, controller);
  update();
  return controller;
}
