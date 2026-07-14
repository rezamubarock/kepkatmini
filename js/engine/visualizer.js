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
      size: 40,
      x: 50,
      y: 85,
    };
    this._time = 0;
    this._particles = [];
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

  setMode(mode) { this.mode = mode; }
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
    const cx = (s.x / 100) * canvasW;
    const cy = (s.y / 100) * canvasH;
    const sz = (s.size / 100) * Math.min(canvasW, canvasH);
    const sens = s.sensitivity;

    targetCtx.save();
    switch (this.mode) {
      case 'bars':     this._drawBars(targetCtx, data, cx, cy, sz, sens, canvasW, canvasH); break;
      case 'wave':     this._drawWave(targetCtx, data, cx, cy, sz, sens, canvasW, canvasH); break;
      case 'circle':   this._drawCircle(targetCtx, data, cx, cy, sz, sens); break;
      case 'spectrum': this._drawSpectrum(targetCtx, data, cx, cy, sz, sens, canvasW, canvasH); break;
      case 'particle': this._drawParticle(targetCtx, data, cx, cy, sz, sens, canvasW, canvasH, time); break;
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

  _drawBars(ctx, data, cx, cy, sz, sens, cw, ch) {
    const count = Math.min(data.length, 64);
    const barW = sz / count;
    const maxH = sz * 1.5;
    const startX = cx - sz / 2;

    ctx.shadowBlur = 8;
    ctx.shadowColor = this.settings.color1;

    for (let i = 0; i < count; i++) {
      const val = (data[i] / 255) * sens * 0.5;
      const h = Math.max(2, val * maxH);
      const x = startX + i * barW;
      const y = cy - h;
      const grad = ctx.createLinearGradient(x, y, x, cy);
      grad.addColorStop(0, this.settings.color1);
      grad.addColorStop(1, this.settings.color2 + '44');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x + 1, y, barW - 2, h, [2, 2, 0, 0])
                    : ctx.rect(x + 1, y, barW - 2, h);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  _drawWave(ctx, data, cx, cy, sz, sens, cw, ch) {
    const count = data.length;
    const startX = cx - sz / 2;
    const stepX = sz / count;

    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = this._gradient(ctx, startX, 0, startX + sz, 0);
    ctx.shadowBlur = 10;
    ctx.shadowColor = this.settings.color1;

    for (let i = 0; i < count; i++) {
      const val = (data[i] / 128 - 1) * sz * 0.3 * sens * 0.3;
      const x = startX + i * stepX;
      const y = cy + val;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  _drawCircle(ctx, data, cx, cy, sz, sens) {
    const count = Math.min(data.length, 128);
    const baseR = sz * 0.4;
    const maxDelta = sz * 0.4;
    const angleStep = (Math.PI * 2) / count;

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this._gradient(ctx, cx - sz, cy, cx + sz, cy);
    ctx.shadowBlur = 12;
    ctx.shadowColor = this.settings.color1;

    for (let i = 0; i <= count; i++) {
      const idx = i % count;
      const val = (data[idx] / 255) * maxDelta * sens * 0.3;
      const r = baseR + val;
      const angle = angleStep * i - Math.PI / 2;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    // Inner fill
    const rg = this._radialGradient(ctx, cx, cy, baseR);
    ctx.beginPath();
    ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
    ctx.fillStyle = rg;
    ctx.globalAlpha = 0.15;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  _drawSpectrum(ctx, data, cx, cy, sz, sens, cw, ch) {
    const count = Math.min(data.length, 64);
    const startX = cx - sz / 2;
    const stepX = sz / count;
    const maxH = sz;

    ctx.beginPath();
    ctx.moveTo(startX, cy);
    for (let i = 0; i < count; i++) {
      const val = (data[i] / 255) * maxH * sens * 0.4;
      const x = startX + i * stepX;
      ctx.lineTo(x, cy - val);
    }
    ctx.lineTo(startX + sz, cy);
    ctx.closePath();

    const grad = ctx.createLinearGradient(startX, cy - maxH, startX, cy);
    grad.addColorStop(0, this.settings.color1 + 'cc');
    grad.addColorStop(0.7, this.settings.color2 + '66');
    grad.addColorStop(1, this.settings.color2 + '00');
    ctx.fillStyle = grad;
    ctx.shadowBlur = 15;
    ctx.shadowColor = this.settings.color1;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  _drawParticle(ctx, data, cx, cy, sz, sens, cw, ch, time) {
    // Emit new particles based on audio energy
    const energy = data.reduce((a, v) => a + v, 0) / data.length / 255;
    const count = Math.floor(energy * sens * 3);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = energy * sz * 0.05 * sens;
      this._particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed * (0.5 + Math.random()),
        vy: Math.sin(angle) * speed * (0.5 + Math.random()) - sz * 0.01,
        size: 2 + Math.random() * 4,
        life: 1.0,
        decay: 0.02 + Math.random() * 0.03,
        color: Math.random() < 0.5 ? this.settings.color1 : this.settings.color2,
      });
    }

    // Update & draw particles
    this._particles = this._particles.filter(p => p.life > 0);
    for (const p of this._particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1; // gravity
      p.life -= p.decay;

      ctx.beginPath();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.color;
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // Keep particle count manageable
    if (this._particles.length > 500) {
      this._particles = this._particles.slice(-500);
    }
  }

  destroy() {
    this.disconnectAll();
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    this._particles = [];
  }
}
