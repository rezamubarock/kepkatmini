/**
 * KepKat Mini — Overlay Manager
 * Handles sticker/image overlay: drag, resize, rotate on preview canvas
 */

export class OverlayManager {
  constructor(previewWrapper, previewCanvas) {
    this.previewWrapper = previewWrapper;
    this.previewCanvas  = previewCanvas;
    this.overlays = [];
    this._nextId = 1;
    this._selectedId = null;
    this._listeners = {};
    this._interactionLayer = document.getElementById('overlay-layer');
    this._handles = new Map(); // id -> DOM element
  }

  addOverlay(source, options = {}) {
    const cw = this.previewCanvas.offsetWidth  || 1920;
    const ch = this.previewCanvas.offsetHeight || 1080;
    const defaultSize = Math.min(cw, ch) * 0.15;

    const overlay = {
      id: `ov_${this._nextId++}`,
      src: source,
      type: options.type || 'image',
      x: options.x ?? (cw / 2 - defaultSize / 2),
      y: options.y ?? (ch / 2 - defaultSize / 2),
      width:  options.width  ?? defaultSize,
      height: options.height ?? defaultSize,
      rotation: options.rotation ?? 0,
      opacity: options.opacity ?? 1,
      emoji: options.emoji || null,
      startTime: options.startTime ?? 0,
      endTime: options.endTime ?? null,
      // WebGL texture (filled by app)
      texture: null,
      imageElement: null,
    };

    this.overlays.push(overlay);
    this._createHandle(overlay);
    this._emit('changed', this.overlays);
    return overlay;
  }

  removeOverlay(id) {
    this.overlays = this.overlays.filter(o => o.id !== id);
    const handle = this._handles.get(id);
    if (handle) { handle.remove(); this._handles.delete(id); }
    if (this._selectedId === id) this._selectedId = null;
    this._emit('changed', this.overlays);
  }

  updateOverlay(id, updates) {
    const ov = this.overlays.find(o => o.id === id);
    if (!ov) return;
    Object.assign(ov, updates);
    this._syncHandle(ov);
    this._emit('changed', this.overlays);
  }

  getActiveOverlays(time) {
    return this.overlays.filter(o => {
      const s = o.startTime ?? 0;
      const e = o.endTime ?? Infinity;
      return time >= s && time <= e;
    });
  }

  _createHandle(overlay) {
    const layer = this._interactionLayer;
    if (!layer) return;
    layer.classList.add('has-overlays');

    const el = document.createElement('div');
    el.className = 'overlay-handle';
    el.dataset.id = overlay.id;

    // Content
    if (overlay.emoji) {
      el.innerHTML = `<span style="font-size:60px;line-height:1;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">${overlay.emoji}</span>`;
    } else if (overlay.type === 'svg' && overlay.src.startsWith('<svg')) {
      el.innerHTML = overlay.src;
    } else {
      const img = document.createElement('img');
      img.src = overlay.src;
      img.draggable = false;
      el.appendChild(img);
    }

    // Resize corners
    ['tl','tr','bl','br'].forEach(pos => {
      const corner = document.createElement('div');
      corner.className = `overlay-resize-corner ${pos}`;
      corner.dataset.corner = pos;
      el.appendChild(corner);
      this._setupResize(corner, overlay, el);
    });

    // Rotate handle
    const rotHandle = document.createElement('div');
    rotHandle.className = 'overlay-rotate-handle';
    rotHandle.innerHTML = `<svg viewBox="0 0 24 24"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5A10 10 0 0 1 21.5 8M22 12.5A10 10 0 0 1 2.5 16"/></svg>`;
    el.appendChild(rotHandle);
    this._setupRotate(rotHandle, overlay, el);

    // Move
    this._setupMove(el, overlay);

    // Select on click
    el.addEventListener('mousedown', () => this.selectOverlay(overlay.id));

    layer.appendChild(el);
    this._handles.set(overlay.id, el);
    this._syncHandle(overlay);
  }

  _syncHandle(overlay) {
    const el = this._handles.get(overlay.id);
    if (!el) return;
    const cw = this.previewCanvas.offsetWidth  || 640;
    const ch = this.previewCanvas.offsetHeight || 360;
    // Overlay coords are in canvas-pixel space; convert to wrapper %
    const scaleX = cw / (this.previewCanvas.width  || 1920);
    const scaleY = ch / (this.previewCanvas.height || 1080);
    const x = overlay.x * scaleX;
    const y = overlay.y * scaleY;
    const w = overlay.width  * scaleX;
    const h = overlay.height * scaleY;
    el.style.left      = `${x}px`;
    el.style.top       = `${y}px`;
    el.style.width     = `${w}px`;
    el.style.height    = `${h}px`;
    el.style.transform = `rotate(${overlay.rotation}rad)`;
    el.style.opacity   = overlay.opacity;
    el.classList.toggle('selected', overlay.id === this._selectedId);
  }

  selectOverlay(id) {
    this._selectedId = id;
    this._handles.forEach((el, eid) => {
      el.classList.toggle('selected', eid === id);
    });
    this._emit('selected', id);
  }

  deselectAll() {
    this._selectedId = null;
    this._handles.forEach(el => el.classList.remove('selected'));
    this._emit('selected', null);
  }

  _setupMove(el, overlay) {
    el.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('overlay-resize-corner') ||
          e.target.classList.contains('overlay-rotate-handle') ||
          e.target.closest('.overlay-rotate-handle')) return;
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const origX = overlay.x, origY = overlay.y;
      const cw = this.previewCanvas.offsetWidth  || 640;
      const ch = this.previewCanvas.offsetHeight || 360;
      const scaleX = (this.previewCanvas.width  || 1920) / cw;
      const scaleY = (this.previewCanvas.height || 1080) / ch;

      const onMove = (e2) => {
        const dx = (e2.clientX - startX) * scaleX;
        const dy = (e2.clientY - startY) * scaleY;
        this.updateOverlay(overlay.id, { x: origX + dx, y: origY + dy });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _setupResize(corner, overlay, el) {
    corner.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const origW = overlay.width, origH = overlay.height;
      const origX = overlay.x, origY = overlay.y;
      const cw = this.previewCanvas.offsetWidth  || 640;
      const ch = this.previewCanvas.offsetHeight || 360;
      const scaleX = (this.previewCanvas.width  || 1920) / cw;
      const scaleY = (this.previewCanvas.height || 1080) / ch;
      const pos = corner.dataset.corner;

      const onMove = (e2) => {
        const dx = (e2.clientX - startX) * scaleX;
        const dy = (e2.clientY - startY) * scaleY;
        let updates = {};
        if (pos === 'br') { updates = { width: Math.max(20, origW + dx), height: Math.max(20, origH + dy) }; }
        if (pos === 'bl') { updates = { x: origX + dx, width: Math.max(20, origW - dx), height: Math.max(20, origH + dy) }; }
        if (pos === 'tr') { updates = { y: origY + dy, width: Math.max(20, origW + dx), height: Math.max(20, origH - dy) }; }
        if (pos === 'tl') { updates = { x: origX + dx, y: origY + dy, width: Math.max(20, origW - dx), height: Math.max(20, origH - dy) }; }
        this.updateOverlay(overlay.id, updates);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _setupRotate(rotHandle, overlay, el) {
    rotHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top  + rect.height / 2;
      const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
      const origRot = overlay.rotation;

      const onMove = (e2) => {
        const angle = Math.atan2(e2.clientY - cy, e2.clientX - cx);
        const delta = angle - startAngle;
        this.updateOverlay(overlay.id, { rotation: origRot + delta });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  syncAllHandles() {
    for (const ov of this.overlays) this._syncHandle(ov);
  }

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    }
  }
  _emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
  }
}
