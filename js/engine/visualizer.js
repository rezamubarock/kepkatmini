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
    const sens = s.sensitivity;

    targetCtx.save();
    
    switch (this.mode) {
      case 'bars': {
        const count = Math.min(data.length, 64);
        const barW = canvasW / count;
        const maxH = canvasH * 0.9;
        
        targetCtx.shadowBlur = 8;
        targetCtx.shadowColor = this.settings.color1;
        
        for (let i = 0; i < count; i++) {
          const val = (data[i] / 255) * sens * 0.5;
          const h = Math.max(2, Math.min(maxH, val * maxH));
          const x = i * barW;
          const y = canvasH - h;
          const grad = targetCtx.createLinearGradient(x, y, x, canvasH);
          grad.addColorStop(0, this.settings.color1);
          grad.addColorStop(1, this.settings.color2 + '44');
          targetCtx.fillStyle = grad;
          targetCtx.beginPath();
          if (targetCtx.roundRect) {
            targetCtx.roundRect(x + 1, y, barW - 2, h, [2, 2, 0, 0]);
          } else {
            targetCtx.rect(x + 1, y, barW - 2, h);
          }
          targetCtx.fill();
        }
        break;
      }
      case 'wave': {
        const count = data.length;
        const stepX = canvasW / count;
        
        targetCtx.beginPath();
        targetCtx.lineWidth = 3;
        targetCtx.strokeStyle = this._gradient(targetCtx, 0, 0, canvasW, 0);
        targetCtx.shadowBlur = 10;
        targetCtx.shadowColor = this.settings.color1;
        
        for (let i = 0; i < count; i++) {
          const val = (data[i] / 128 - 1) * canvasH * 0.45 * sens * 0.2;
          const x = i * stepX;
          const y = Math.max(2, Math.min(canvasH - 2, canvasH / 2 + val));
          i === 0 ? targetCtx.moveTo(x, y) : targetCtx.lineTo(x, y);
        }
        targetCtx.stroke();
        break;
      }
      case 'circle': {
        const count = Math.min(data.length, 128);
        const cx = canvasW / 2;
        const cy = canvasH / 2;
        
        // Stretch circle into responsive ellipse matching visualizer box bounds
        const baseRx = canvasW * 0.25;
        const baseRy = canvasH * 0.25;
        const maxDeltaX = canvasW * 0.2;
        const maxDeltaY = canvasH * 0.2;
        const angleStep = (Math.PI * 2) / count;
        
        targetCtx.beginPath();
        targetCtx.lineWidth = 2;
        targetCtx.strokeStyle = this._gradient(targetCtx, cx - baseRx * 2, cy, cx + baseRx * 2, cy);
        targetCtx.shadowBlur = 12;
        targetCtx.shadowColor = this.settings.color1;
        
        for (let i = 0; i <= count; i++) {
          const idx = i % count;
          const val = (data[idx] / 255) * sens * 0.3;
          const rx = baseRx + val * maxDeltaX;
          const ry = baseRy + val * maxDeltaY;
          const angle = angleStep * i - Math.PI / 2;
          const x = cx + rx * Math.cos(angle);
          const y = cy + ry * Math.sin(angle);
          i === 0 ? targetCtx.moveTo(x, y) : targetCtx.lineTo(x, y);
        }
        targetCtx.closePath();
        targetCtx.stroke();
        
        // Inner fill
        const rg = this._radialGradient(targetCtx, cx, cy, Math.min(baseRx, baseRy));
        targetCtx.beginPath();
        targetCtx.ellipse(cx, cy, baseRx, baseRy, 0, 0, Math.PI * 2);
        targetCtx.fillStyle = rg;
        targetCtx.globalAlpha = 0.15;
        targetCtx.fill();
        targetCtx.globalAlpha = 1;
        break;
      }
      case 'spectrum': {
        const count = Math.min(data.length, 64);
        const stepX = canvasW / count;
        const maxH = canvasH * 0.9;
        
        targetCtx.beginPath();
        targetCtx.moveTo(0, canvasH);
        for (let i = 0; i < count; i++) {
          const val = Math.max(0, Math.min(maxH, (data[i] / 255) * maxH * sens * 0.4));
          const x = i * stepX;
          targetCtx.lineTo(x, canvasH - val);
        }
        targetCtx.lineTo(canvasW, canvasH);
        targetCtx.closePath();
        
        const grad = targetCtx.createLinearGradient(0, canvasH - maxH, 0, canvasH);
        grad.addColorStop(0, this.settings.color1 + 'cc');
        grad.addColorStop(0.7, this.settings.color2 + '66');
        grad.addColorStop(1, this.settings.color2 + '00');
        targetCtx.fillStyle = grad;
        targetCtx.shadowBlur = 15;
        targetCtx.shadowColor = this.settings.color1;
        targetCtx.fill();
        break;
      }
      case 'particle': {
        const cx = canvasW / 2;
        const cy = canvasH / 2;
        const sz = Math.min(canvasW, canvasH);
        const energy = data.reduce((a, v) => a + v, 0) / data.length / 255;
        const count = Math.floor(energy * sens * 3);
        
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = energy * sz * 0.05 * sens;
          this._particles.push({
            x: cx, y: cy,
            vx: Math.cos(angle) * speed * (0.5 + Math.random()),
            vy: Math.sin(angle) * speed * (0.5 + Math.random()) - sz * 0.01,
            size: Math.max(1, 2 + Math.random() * 4),
            life: 1.0,
            decay: 0.02 + Math.random() * 0.03,
            color: Math.random() < 0.5 ? this.settings.color1 : this.settings.color2,
          });
        }
        
        this._particles = this._particles.filter(p => p.life > 0);
        for (const p of this._particles) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.1;
          p.life -= p.decay;
          
          p.x = Math.max(0, Math.min(canvasW, p.x));
          p.y = Math.max(0, Math.min(canvasH, p.y));
          
          targetCtx.beginPath();
          targetCtx.globalAlpha = p.life;
          targetCtx.fillStyle = p.color;
          targetCtx.shadowBlur = 8;
          targetCtx.shadowColor = p.color;
          targetCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
          targetCtx.fill();
        }
        targetCtx.globalAlpha = 1;
        break;
      }
    }
    
    targetCtx.restore();
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
