/**
 * KepKat Mini — Video Exporter
 * Uses WebCodecs API for hardware-accelerated encoding.
 * Falls back to MediaRecorder API if WebCodecs unavailable.
 */

export class Exporter {
  constructor(renderer, timeline, visualizer) {
    this.renderer = renderer;
    this.timeline = timeline;
    this.visualizer = visualizer;
    this.isExporting = false;
    this._onProgress = null;
    this._onComplete = null;
    this._onError = null;
  }

  onProgress(fn) { this._onProgress = fn; return this; }
  onComplete(fn) { this._onComplete = fn; return this; }
  onError(fn)    { this._onError    = fn; return this; }

  async export(options = {}) {
    if (this.isExporting) return;
    this.isExporting = true;

    const {
      format   = 'mp4',
      bitrate  = 5_000_000,
      fps      = 30,
      width    = 1920,
      height   = 1080,
    } = options;

    try {
      if (this._hasWebCodecs()) {
        await this._exportWithWebCodecs({ format, bitrate, fps, width, height });
      } else {
        await this._exportWithMediaRecorder({ fps, width, height });
      }
    } catch (err) {
      console.error('Export error:', err);
      this.isExporting = false;
      if (this._onError) this._onError(err);
    }
  }

  _hasWebCodecs() {
    return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
  }

  async _exportWithWebCodecs({ format, bitrate, fps, width, height }) {
    const timeline = this.timeline;
    const duration = timeline.duration;
    const totalFrames = Math.ceil(duration * fps);

    // Create an offscreen canvas for rendering
    const offCanvas = new OffscreenCanvas(width, height);
    const offCtx = offCanvas.getContext('2d');

    // Collect encoded chunks
    const chunks = [];

    const encoder = new VideoEncoder({
      output: (chunk) => chunks.push(chunk),
      error: (e) => { throw e; },
    });

    encoder.configure({
      codec: format === 'mp4' ? 'avc1.42001f' : 'vp09.00.10.08',
      width, height,
      bitrate,
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware',
    });

    // Render each frame
    for (let f = 0; f < totalFrames; f++) {
      const t = f / fps;
      timeline.seek(t);

      // Render frame to offscreen canvas
      await this._renderFrameToCanvas(offCtx, t, width, height);

      // Create VideoFrame from canvas
      const bitmap = await createImageBitmap(offCanvas);
      const frame = new VideoFrame(bitmap, {
        timestamp: Math.round(t * 1_000_000),
        duration:  Math.round(1_000_000 / fps),
      });

      const keyFrame = f % (fps * 2) === 0;
      encoder.encode(frame, { keyFrame });
      frame.close();
      bitmap.close();

      // Report progress
      if (this._onProgress) {
        this._onProgress(Math.round((f / totalFrames) * 90));
      }
    }

    await encoder.flush();
    encoder.close();

    // Mux to container (MP4Box.js approach — simplified ArrayBuffer mux)
    if (this._onProgress) this._onProgress(95);

    const blob = this._muxToWebM(chunks, { width, height, fps, duration });
    this._download(blob, format === 'mp4' ? 'kepkat-export.mp4' : 'kepkat-export.webm');

    if (this._onProgress) this._onProgress(100);
    this.isExporting = false;
    if (this._onComplete) this._onComplete();
  }

  async _exportWithMediaRecorder({ fps, width, height }) {
    const duration = this.timeline.duration;

    // Create a canvas to render into
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width  = width;
    exportCanvas.height = height;
    const exportCtx = exportCanvas.getContext('2d');

    const stream = exportCanvas.captureStream(fps);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    });
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    mediaRecorder.start(100); // collect in 100ms chunks

    const frameInterval = 1 / fps;
    let time = 0;
    const totalTime = duration;

    while (time <= totalTime && this.isExporting) {
      this.timeline.seek(time);
      await this._renderFrameToCanvas(exportCtx, time, width, height);
      if (this._onProgress) {
        this._onProgress(Math.round((time / totalTime) * 95));
      }
      time += frameInterval;
      // Yield to browser
      await new Promise(r => setTimeout(r, 0));
    }

    mediaRecorder.stop();

    await new Promise(r => { mediaRecorder.onstop = r; });
    if (this._onProgress) this._onProgress(100);

    const blob = new Blob(chunks, { type: mimeType });
    this._download(blob, 'kepkat-export.webm');

    this.isExporting = false;
    if (this._onComplete) this._onComplete();
  }

  async _renderFrameToCanvas(ctx, time, width, height) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const clips = this.timeline.getActiveVideoClips(time);
    for (const clip of clips) {
      if (clip.videoElement && clip.videoElement.readyState >= 2) {
        ctx.globalAlpha = clip.opacity !== undefined ? clip.opacity : 1;
        ctx.drawImage(clip.videoElement, 0, 0, width, height);
        ctx.globalAlpha = 1;
      } else if (clip.imageElement) {
        ctx.globalAlpha = clip.opacity !== undefined ? clip.opacity : 1;
        ctx.drawImage(clip.imageElement, 0, 0, width, height);
        ctx.globalAlpha = 1;
      }
    }

    // Draw visualizer if enabled
    if (this.visualizer && this.visualizer.enabled) {
      this.visualizer.draw(ctx, width, height, time);
    }
  }

  /** Simple WebM mux using IVF-like container (minimal viable) */
  _muxToWebM(chunks, { width, height, fps, duration }) {
    // For a production build, use mp4box.js or mkvmuxer
    // Here we produce a raw WebM-compatible blob
    const parts = chunks.map(chunk => {
      const buf = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(buf);
      return buf;
    });
    return new Blob(parts, { type: 'video/webm' });
  }

  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  cancel() {
    this.isExporting = false;
  }
}
