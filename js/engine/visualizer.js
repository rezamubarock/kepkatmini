/**
 * KepKat Mini — Audio Visualizer Engine
 * WebAudio API + Canvas-based rendering (5 modes)
 */

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audioCtx = null;
    this.analyser = null;
    this.source = null;
    this.gainNode = null;
    this.dataArray = null;
    this.bufferLength = 0;
    this.enabled = false;
    this.mode = 'bars';
    this.settings = {
      color1: '#a855f7',
      color2: '#06b6d4',
      sensitivity: 5,
      barCount: 64,
      spacing: 2,
      opacity: 1.0,
    };
    this._time = 0;
  }

  _ensureAudioCtx() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(this.bufferLength);
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.connect(this.audioCtx.destination);
      this.analyser.connect(this.gainNode);
    }
    return this.audioCtx;
  }

  /** Connect a media element (HTMLVideoElement or HTMLAudioElement) */
  connectMediaElement(mediaEl) {
    this._ensureAudioCtx();
    if (this.source) {
      try { this.source.disconnect(); } catch(e) {}
    }
    try {
      this.source = this.audioCtx.createMediaElementSource(mediaEl);
      this.source.connect(this.analyser);
    } catch (e) {
      // Already connected or cross-origin
      console.warn('Visualizer: Could not connect media element', e);
    }
  }

  /** Connect an AudioBuffer directly */
  connectBuffer(audioBuffer) {
    this._ensureAudioCtx();
    if (this.source) {
      try { this.source.disconnect(); } catch(e) {}
    }
    const bufSource = this.audioCtx.createBufferSource();
    bufSource.buffer = audioBuffer;
    bufSource.loop = true;
    bufSource.connect(this.analyser);
    bufSource.start(0);
    this.source = bufSource;
  }

  disconnectAll() {
    if (this.source) {
      try { this.source.disconnect(); } catch(e) {}
      this.source = null;
    }
  }

  resume() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  setMode(mode) { this.mode = 'bars'; }
  setSettings(s) { Object.assign(this.settings, s); }
  setEnabled(v) { this.enabled = v; }

  /** Get current frequency data */
  getData() {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this.dataArray);
    return this.dataArray;
  }

  /**
   * Draw the visualizer onto the given canvas context
   * Called from the main render loop
   */
  draw(targetCtx, canvasW, canvasH, time) {
    if (!this.enabled || !this.analyser) return;
    this._time = time;

    const data = this.getData();
    if (!data) return;

    const s = this.settings;
    const sens = s.sensitivity;

    targetCtx.save();
    
    // Draw Bars with custom barCount, spacing, and opacity
    const count = Math.min(data.length, s.barCount || 64);
    const spacing = s.spacing !== undefined ? s.spacing : 2;
    const totalSpacing = spacing * (count - 1);
    const barW = Math.max(1, (canvasW - totalSpacing) / count);
    const maxH = canvasH - 4; // leave 4px margin at top to prevent flat crop
    
    targetCtx.shadowBlur = 8;
    targetCtx.shadowColor = s.color1;
    targetCtx.globalAlpha = s.opacity !== undefined ? s.opacity : 1.0;
    
    for (let i = 0; i < count; i++) {
      const rawVal = data[i] / 255;
      // Compress scaling so it fluctuates beautifully without flat-lining at maxH
      const val = Math.min(1.0, Math.pow(rawVal, 1.2) * (sens * 0.15 + 0.45));
      const h = Math.max(2, val * maxH);
      const x = i * (barW + spacing);
      const y = canvasH - h;
      
      const grad = targetCtx.createLinearGradient(x, y, x, canvasH);
      grad.addColorStop(0, s.color1);
      grad.addColorStop(1, s.color2 + '44');
      
      targetCtx.fillStyle = grad;
      targetCtx.beginPath();
      if (targetCtx.roundRect) {
        targetCtx.roundRect(x, y, barW, h, [2, 2, 0, 0]);
      } else {
        targetCtx.rect(x, y, barW, h);
      }
      targetCtx.fill();
    }
    
    targetCtx.restore();
  }

  _gradient(ctx, x1, y1, x2, y2) {
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, this.settings.color1);
    g.addColorStop(1, this.settings.color2);
    return g;
  }

  _radialGradient(ctx, cx, cy, r) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, this.settings.color1);
    g.addColorStop(1, this.settings.color2);
    return g;
  }

  destroy() {
    this.disconnectAll();
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
