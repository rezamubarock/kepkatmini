/**
 * KepKat Mini — Timeline UI
 * Handles drag-and-drop, clip resizing, playhead, and ruler rendering
 */

import { Timeline } from '../engine/timeline.js';

export class TimelineUI {
  constructor(timeline, options = {}) {
    this.timeline = timeline;
    this.onClipSelect = options.onClipSelect || (() => {});
    this.onSeek       = options.onSeek       || (() => {});
    this.onContextMenu = options.onContextMenu || (() => {});

    this.pixelsPerSecond = 80; // default zoom
    this.selectedClipId  = null;
    this._dragState = null;
    this._resizeState = null;
    this._rulerCtx = null;

    this._tracksEl   = document.getElementById('timeline-tracks');
    this._labelsEl   = document.getElementById('track-labels');
    this._playheadEl = document.getElementById('playhead');
    this._rulerEl    = document.getElementById('timeline-ruler');

    if (this._rulerEl) {
      this._rulerCtx = this._rulerEl.getContext('2d');
    }

    this._setupDropZone();

    // Listen to timeline changes
    timeline.on('tracksChanged',  () => this.renderAll());
    timeline.on('clipsChanged',   () => this.renderAll());
    timeline.on('clipAdded',      () => this.renderAll());
    timeline.on('clipRemoved',    () => this.renderAll());
    timeline.on('clipUpdated',    () => this.renderAll());
    timeline.on('durationChanged',() => this._drawRuler());
    timeline.on('timeChanged',    (t) => this._updatePlayhead(t));
  }

  setZoom(pps) {
    this.pixelsPerSecond = pps;
    this.renderAll();
    this._drawRuler();
  }

  renderAll() {
    this._renderLabels();
    this._renderTracks();
    this._drawRuler();
    this._updatePlayhead(this.timeline.currentTime);
  }

  _renderLabels() {
    const el = this._labelsEl;
    if (!el) return;
    el.innerHTML = '';
    for (const track of this.timeline.tracks) {
      const div = document.createElement('div');
      div.className = 'track-label';
      div.dataset.trackId = track.id;

      const icon = track.type === 'audio'
        ? `<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`
        : `<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`;

      div.innerHTML = `
        <div class="track-label-icon">${icon}</div>
        <span class="track-label-name">${track.name}</span>
        <button class="track-mute-btn" data-track-id="${track.id}" title="${track.muted ? 'Unmute' : 'Mute'}">
          <svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>${track.muted ? '' : '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'}
          </svg>
        </button>
      `;

      div.style.height = '44px';
      div.style.opacity = track.muted ? '0.5' : '1';

      div.querySelector('.track-mute-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        track.muted = !track.muted;
        this.renderAll();
      });

      el.appendChild(div);
    }
  }

  _renderTracks() {
    const el = this._tracksEl;
    if (!el) return;

    // Remove existing track rows (keep playhead)
    const playhead = this._playheadEl;
    el.innerHTML = '';
    if (playhead) el.appendChild(playhead);

    const totalDuration = Math.max(this.timeline.duration + 5, 30);
    const totalW = totalDuration * this.pixelsPerSecond;
    el.style.minWidth = "";

    for (const track of this.timeline.tracks) {
      const row = document.createElement('div');
      row.className = 'timeline-track';
      row.dataset.trackId = track.id;
      row.style.height = '44px';
      row.style.width = `${totalW}px`;
      row.style.minWidth = `${totalW}px`;

      const clipsArea = document.createElement('div');
      clipsArea.className = 'track-clips-area';
      clipsArea.style.minWidth = `${totalW - 120}px`;

      for (const clip of track.clips) {
        const clipEl = this._buildClipElement(clip, track.type);
        clipsArea.appendChild(clipEl);
      }

      row.appendChild(clipsArea);
      el.appendChild(row);

      // Drop target
      clipsArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        row.style.background = '#a855f715';
      });
      clipsArea.addEventListener('dragleave', () => {
        row.style.background = '';
      });
      clipsArea.addEventListener('drop', (e) => {
        e.preventDefault();
        row.style.background = '';
        const mediaId = e.dataTransfer.getData('mediaId');
        const dropX = e.offsetX;
        const dropTime = dropX / this.pixelsPerSecond;
        if (mediaId) {
          this._handleDrop(mediaId, track.id, dropTime);
        }
      });

      // Ruler click to seek
      clipsArea.addEventListener('click', (e) => {
        if (e.target === clipsArea || e.target === row) {
          const t = e.offsetX / this.pixelsPerSecond;
          this.onSeek(t);
        }
      });
    }
  }

  _buildClipElement(clip, trackType) {
    const el = document.createElement('div');
    el.className = `clip ${trackType}-clip`;
    el.dataset.clipId = clip.id;
    if (clip.id === this.selectedClipId) el.classList.add('selected');

    const left = clip.start * this.pixelsPerSecond;
    const width = clip.duration * this.pixelsPerSecond;
    el.style.left  = `${left}px`;
    el.style.width = `${Math.max(width, 2)}px`;

    // Thumbnail or waveform
    let thumbHtml = '';
    if (clip.thumbnailUrl) {
      thumbHtml = `<div class="clip-thumbnail"><img src="${clip.thumbnailUrl}" draggable="false" /></div>`;
    }

    el.innerHTML = `
      ${thumbHtml}
      <span class="clip-label">${clip.name}</span>
      <span class="clip-duration-label">${Timeline.formatTime(clip.duration)}</span>
      <div class="clip-handle clip-handle-left" data-side="left"></div>
      <div class="clip-handle clip-handle-right" data-side="right"></div>
    `;

    // If audio clip, draw mini waveform
    if ((trackType === 'audio' || clip.type === 'audio') && clip.waveformData) {
      const waveCanvas = document.createElement('canvas');
      waveCanvas.className = 'waveform-canvas';
      waveCanvas.style.position = 'absolute';
      waveCanvas.style.inset = '0';
      waveCanvas.width = Math.ceil(width);
      waveCanvas.height = 44;
      this._drawWaveform(waveCanvas, clip.waveformData);
      el.appendChild(waveCanvas);
    }

    // Select on click
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectClip(clip.id);
    });

    // Right-click context menu
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.selectClip(clip.id);
      this.onContextMenu(e, clip);
    });

    // Drag to move clip
    this._setupClipDrag(el, clip);

    // Resize handles
    el.querySelectorAll('.clip-handle').forEach(handle => {
      this._setupClipResize(handle, clip, el);
    });

    return el;
  }

  _setupClipDrag(el, clip) {
    let startX, startLeft, startTime;

    el.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('clip-handle')) return;
      e.preventDefault();
      startX    = e.clientX;
      startTime = clip.start;

      const onMove = (e2) => {
        const dx = e2.clientX - startX;
        const dt = dx / this.pixelsPerSecond;
        const newStart = Math.max(0, startTime + dt);
        this.timeline.updateClip(clip.id, { start: newStart });
        this.renderAll();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _setupClipResize(handle, clip, clipEl) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const side = handle.dataset.side;
      const startX    = e.clientX;
      const origStart = clip.start;
      const origDur   = clip.duration;

      const onMove = (e2) => {
        const dx   = e2.clientX - startX;
        const dt   = dx / this.pixelsPerSecond;
        if (side === 'right') {
          const newDur = Math.max(0.1, origDur + dt);
          this.timeline.updateClip(clip.id, { duration: newDur });
        } else {
          const newStart = Math.max(0, Math.min(origStart + dt, origStart + origDur - 0.1));
          const newDur   = origDur - (newStart - origStart);
          this.timeline.updateClip(clip.id, { start: newStart, duration: newDur });
        }
        this.renderAll();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _drawWaveform(canvas, waveformData) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const mid = h / 2;
    ctx.strokeStyle = '#06b6d480';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < w; i++) {
      const idx = Math.floor((i / w) * waveformData.length);
      const val = (waveformData[idx] || 0) * mid * 0.9;
      i === 0 ? ctx.moveTo(i, mid - val) : ctx.lineTo(i, mid - val);
    }
    for (let i = w - 1; i >= 0; i--) {
      const idx = Math.floor((i / w) * waveformData.length);
      const val = (waveformData[idx] || 0) * mid * 0.9;
      ctx.lineTo(i, mid + val);
    }
    ctx.closePath();
    ctx.fillStyle = '#06b6d420';
    ctx.fill();
    ctx.stroke();
  }

  _drawRuler() {
    const canvas = this._rulerEl;
    if (!canvas || !this._rulerCtx) return;
    const ctx = this._rulerCtx;
    const duration = Math.max(this.timeline.duration + 5, 30);
    const w = Math.ceil(duration * this.pixelsPerSecond) + 200;
    canvas.width = w;

    ctx.clearRect(0, 0, w, 24);
    ctx.fillStyle = '#14141f';
    ctx.fillRect(0, 0, w, 24);

    // Draw ticks
    const pps = this.pixelsPerSecond;
    // Determine tick interval
    let interval = 1;
    if (pps < 20)   interval = 5;
    if (pps < 10)   interval = 15;
    if (pps < 5)    interval = 30;
    if (pps < 2)    interval = 60;     // 1 min
    if (pps < 0.5)  interval = 300;    // 5 min
    if (pps < 0.1)  interval = 600;    // 10 min
    if (pps < 0.03) interval = 1800;   // 30 min
    if (pps < 0.01) interval = 3600;   // 1 hr
    if (pps > 100)  interval = 0.5;
    if (pps > 200)  interval = 0.25;

    ctx.fillStyle   = '#555577';
    ctx.font        = '9px "JetBrains Mono", monospace';
    ctx.textAlign   = 'left';
    ctx.strokeStyle = '#ffffff15';
    ctx.lineWidth   = 1;

    for (let t = 0; t <= duration + interval; t += interval) {
      const x = t * pps;
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x, 24);
      ctx.stroke();
      if (t % (interval * 2) === 0 || interval >= 1) {
        ctx.fillText(Timeline.formatTime(t).slice(0, -4), x + 2, 11);
      }
    }
  }

  _updatePlayhead(time) {
    const el = this._playheadEl;
    if (!el) return;
    const x = time * this.pixelsPerSecond;
    el.style.left = `${x}px`;
  }

  selectClip(clipId) {
    this.selectedClipId = clipId;
    this.renderAll();
    const clip = this.timeline.getClip(clipId);
    this.onClipSelect(clip);
  }

  deselectAll() {
    this.selectedClipId = null;
    this.renderAll();
    this.onClipSelect(null);
  }

  _setupDropZone() {
    // Ruler / header seek & drag scrub
    if (this._rulerEl) {
      const handleRulerScrub = (e) => {
        const rect = this._rulerEl.getBoundingClientRect();
        // Calculate offset relative to canvas coordinate space
        const x = e.clientX - rect.left;
        const t = Math.max(0, x / this.pixelsPerSecond);
        this.onSeek(t);
      };

      this._rulerEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        handleRulerScrub(e);
        const onMove = (e2) => {
          handleRulerScrub(e2);
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    // Playhead drag
    if (this._playheadEl) {
      this._playheadEl.style.cursor = 'ew-resize';
      this._playheadEl.style.pointerEvents = 'all';

      this._playheadEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const onMove = (e2) => {
          const rect = this._tracksEl.getBoundingClientRect();
          const x = e2.clientX - rect.left + this._tracksEl.scrollLeft;
          const t = Math.max(0, x / this.pixelsPerSecond);
          this.onSeek(t);
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    // Scroll sync between tracks and ruler wrapper
    if (this._tracksEl) {
      this._tracksEl.addEventListener('scroll', () => {
        const wrapper = document.getElementById('timeline-ruler-wrapper');
        if (wrapper) wrapper.scrollLeft = this._tracksEl.scrollLeft;
      });

      // Mouse wheel horizontal scroll and zoom on tracks area
      this._tracksEl.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          // Zoom factor: negative deltaY is zoom in, positive is zoom out
          const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
          // pixelsPerSecond range: 0.01px to 1024px
          const newPps = Math.max(0.01, Math.min(1024, this.pixelsPerSecond * zoomFactor));

          // Calculate time position under the mouse to anchor zoom
          const rect = this._tracksEl.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const timelineX = mouseX + this._tracksEl.scrollLeft;
          const timeAtMouse = timelineX / this.pixelsPerSecond;

          this.setZoom(newPps);

          // Center zoom scroll alignment
          this._tracksEl.scrollLeft = timeAtMouse * newPps - mouseX;

          // Sync zoom slider (logarithmic inverse: val = Math.log2(pps / 10))
          const zoomSlider = document.getElementById('zoom-slider');
          if (zoomSlider) {
            zoomSlider.value = Math.log2(newPps / 10);
          }
        } else if (Math.abs(e.deltaY) > 0 && !e.shiftKey) {
          e.preventDefault();
          this._tracksEl.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    }
  }

  _handleDrop(mediaId, trackId, time) {
    // Handled by app.js — this just notifies
    document.dispatchEvent(new CustomEvent('timeline:drop', {
      detail: { mediaId, trackId, time }
    }));
  }

  scrollToTime(time) {
    const x = time * this.pixelsPerSecond;
    const tracks = this._tracksEl;
    if (tracks) tracks.scrollLeft = Math.max(0, x - tracks.clientWidth / 2);
  }
}
