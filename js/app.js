/**
 * KepKat Mini — Main Application Controller
 * Wires all engines together: renderer, timeline, visualizer, subtitles, overlays, exporter
 */

import { Renderer }        from './engine/renderer.js';
import { Timeline }        from './engine/timeline.js';
import { Visualizer }      from './engine/visualizer.js';
import { Exporter }        from './engine/exporter.js';
import { SubtitleManager } from './subtitle/subtitle.js';
import { TimelineUI }      from './ui/timeline-ui.js';
import { OverlayManager }  from './overlay/overlay.js';

/* ─── BUILT-IN EMOJI STICKER SETS ─── */
const STICKER_SETS = {
  emoji: ['😀','😂','🥰','😎','🤩','🔥','💯','✨','🎉','🎊','🎵','🎶','💜','💙','💛','🌈','⚡','🚀','💪','👑','🌟','❤️','😍','🤣','😭','👀','🙌','💎'],
  shapes: ['⬛','⬜','🔴','🟠','🟡','🟢','🔵','🟣','🔶','🔷','🔸','🔹','▪','▫','◾','◽','🔲','🔳'],
};

/* ─── TOAST UTILITY ─── */
function toast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/* ─── SPLASH SCREEN ─── */
function showSplash() {
  const bar    = document.getElementById('splash-bar');
  const status = document.getElementById('splash-status');
  const msgs = [
    [0,   'Memuat mesin rendering...'],
    [30,  'Menyiapkan pipeline WebGL2...'],
    [60,  'Memuat komponen UI...'],
    [85,  'Hampir siap...'],
    [100, 'Siap!'],
  ];
  return new Promise(resolve => {
    let i = 0;
    function next() {
      if (i >= msgs.length) { resolve(); return; }
      const [pct, msg] = msgs[i++];
      bar.style.width = `${pct}%`;
      status.textContent = msg;
      setTimeout(next, 300 + Math.random() * 200);
    }
    next();
  });
}

function hideSplash() {
  const splash = document.getElementById('splash-screen');
  if (splash) {
    splash.classList.add('fade-out');
    setTimeout(() => splash.remove(), 600);
  }
  const app = document.getElementById('app');
  if (app) app.classList.remove('hidden');
}

/* ─── MEDIA STORE ─── */
const mediaStore = new Map(); // id → { file, url, type, duration, name, thumbnailUrl }

/* ─── MAIN APP CLASS ─── */
class KepKatApp {
  constructor() {
    this.canvas    = document.getElementById('preview-canvas');
    this.renderer  = new Renderer(this.canvas);
    this.timeline  = new Timeline();
    this.visualizer = new Visualizer(this.canvas);
    this.exporter  = new Exporter(this.renderer, this.timeline, this.visualizer);
    this.subtitles = new SubtitleManager();
    this.overlayMgr = new OverlayManager(
      document.getElementById('preview-wrapper'),
      this.canvas
    );
    this.timelineUI = new TimelineUI(this.timeline, {
      onClipSelect:  (clip) => this._onClipSelect(clip),
      onSeek:        (t)    => this._seekTo(t),
      onContextMenu: (e, clip) => this._showContextMenu(e, clip),
    });

    this._rafId = null;
    this._videoElements = new Map(); // clipId → HTMLVideoElement
    this._mediaElementConnected = false;
    this._whisperWorker = null;
    this._selectedClip = null;
    this._activeEffectsPerClip = new Map();

    this._bind();
    this._startRenderLoop();
    this.timelineUI.renderAll();
    this._renderSubtitleList();
    this._initStickerGrid('emoji');
  }

  /* ═══════════════════════════════════════
     EVENT BINDING
  ═══════════════════════════════════════ */
  _bind() {
    // Transport
    document.getElementById('btn-play').addEventListener('click', () => this._togglePlay());
    document.getElementById('btn-rew').addEventListener('click', () => this._seekTo(0));
    document.getElementById('btn-ffw').addEventListener('click', () => this._seekTo(this.timeline.duration));
    document.getElementById('btn-prev-frame').addEventListener('click', () => this._seekTo(this.timeline.currentTime - 1/30));
    document.getElementById('btn-next-frame').addEventListener('click', () => this._seekTo(this.timeline.currentTime + 1/30));

    // Volume / speed / zoom
    document.getElementById('volume-slider').addEventListener('input', (e) => {
      this._setVolume(parseFloat(e.target.value));
    });
    document.getElementById('playback-speed').addEventListener('change', (e) => {
      this.timeline.playbackRate = parseFloat(e.target.value);
    });
    document.getElementById('zoom-slider').addEventListener('input', (e) => {
      const pps = Math.pow(parseFloat(e.target.value), 2) * 10;
      this.timelineUI.setZoom(pps);
    });

    // Fullscreen
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
      const pw = document.getElementById('preview-wrapper');
      if (!document.fullscreenElement) pw.requestFullscreen?.();
      else document.exitFullscreen?.();
    });

    // Mute
    document.getElementById('btn-mute').addEventListener('click', () => {
      const vol = document.getElementById('volume-slider');
      vol.value = vol.value > 0 ? 0 : 1;
      this._setVolume(parseFloat(vol.value));
    });

    // Panel tabs
    document.querySelectorAll('.panel-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panelId = `panel-${btn.dataset.panel}`;
        document.getElementById(panelId)?.classList.add('active');
      });
    });

    // Media import
    const dropZone = document.getElementById('media-drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => this._handleFiles(e.target.files));
    document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
    document.getElementById('btn-add-media').addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop',      (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
      this._handleFiles(e.dataTransfer.files);
    });

    // Global drag & drop onto app
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop',     (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) this._handleFiles(e.dataTransfer.files);
    });

    // Timeline drop (from media panel)
    document.addEventListener('timeline:drop', (e) => {
      const { mediaId, trackId, time } = e.detail;
      this._addMediaToTimeline(mediaId, trackId, time);
    });

    // Add tracks
    document.getElementById('btn-add-video-track').addEventListener('click', () => {
      const n = this.timeline.tracks.filter(t => t.type === 'video').length + 1;
      this.timeline.addTrack('video', `Video ${n}`);
      toast(`Track Video ${n} ditambahkan`, 'info');
    });
    document.getElementById('btn-add-audio-track').addEventListener('click', () => {
      const n = this.timeline.tracks.filter(t => t.type === 'audio').length + 1;
      this.timeline.addTrack('audio', `Audio ${n}`);
      toast(`Track Audio ${n} ditambahkan`, 'info');
    });

    // Effects grid
    document.querySelectorAll('#effects-grid .effect-card').forEach(card => {
      card.addEventListener('click', () => this._applyEffect(card.dataset.effect));
    });

    // Transitions grid
    document.querySelectorAll('#transitions-grid .effect-card').forEach(card => {
      card.addEventListener('dblclick', () => this._applyTransition(card.dataset.transition));
      card.setAttribute('title', 'Double-click untuk terapkan ke klip terpilih');
    });

    // Subtitle actions
    document.getElementById('btn-auto-subtitle').addEventListener('click', () => this._runAutoSubtitle());
    document.getElementById('btn-add-subtitle').addEventListener('click', () => this._addManualSubtitle());
    document.getElementById('btn-import-srt').addEventListener('click', () => {
      document.getElementById('srt-file-input').click();
    });
    document.getElementById('srt-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target.result;
        if (file.name.endsWith('.vtt')) this.subtitles.importVTT(text);
        else this.subtitles.importSRT(text);
        toast('Subtitle berhasil diimpor', 'success');
      };
      reader.readAsText(file);
    });

    // Subtitle style controls
    document.getElementById('sub-font').addEventListener('change', (e) => {
      this.subtitles.setStyle({ font: e.target.value });
    });
    document.getElementById('sub-size').addEventListener('input', (e) => {
      document.getElementById('sub-size-val').textContent = `${e.target.value}px`;
      this.subtitles.setStyle({ size: parseInt(e.target.value) });
    });
    document.getElementById('sub-color').addEventListener('input', (e) => {
      this.subtitles.setStyle({ color: e.target.value });
    });
    document.getElementById('sub-bg-color').addEventListener('input', (e) => {
      this.subtitles.setStyle({ bgColor: e.target.value });
    });
    document.getElementById('sub-bg-alpha').addEventListener('input', (e) => {
      this.subtitles.setStyle({ bgAlpha: parseInt(e.target.value) });
    });
    document.getElementById('sub-position').addEventListener('change', (e) => {
      this.subtitles.setStyle({ position: e.target.value });
    });

    // Subtitle list changes
    this.subtitles.on('changed', () => this._renderSubtitleList());

    // Visualizer controls
    document.getElementById('viz-enabled').addEventListener('change', (e) => {
      this.visualizer.setEnabled(e.target.checked);
      if (e.target.checked) {
        this.visualizer.resume();
        // Add visualizer overlay if not already present
        if (!this.overlayMgr.overlays.some(o => o.id === 'viz_overlay')) {
          this.overlayMgr.addOverlay(null, {
            id: 'viz_overlay',
            type: 'visualizer',
            x: 480, y: 700,
            width: 960, height: 200,
            rotation: 0
          });
        }
        toast('Visualizer diaktifkan (bisa digeser/diskala di player)', 'info');
      } else {
        this.overlayMgr.removeOverlay('viz_overlay');
      }
    });
    document.querySelectorAll('.viz-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.viz-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.visualizer.setMode(btn.dataset.viz);
      });
    });
    const vizSettings = ['viz-color1','viz-color2','viz-sensitivity'];
    vizSettings.forEach(id => {
      document.getElementById(id).addEventListener('input', () => this._updateVisualizerSettings());
    });

    // Sticker categories
    document.querySelectorAll('.sticker-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sticker-cat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._initStickerGrid(btn.dataset.cat);
      });
    });
    document.getElementById('btn-import-sticker').addEventListener('click', () => {
      document.getElementById('sticker-file-input').click();
    });
    document.getElementById('sticker-file-input').addEventListener('change', (e) => {
      const files = e.target.files;
      for (const file of files) {
        const url = URL.createObjectURL(file);
        this.overlayMgr.addOverlay(url, { type: 'image' });
      }
    });

    // Export
    document.getElementById('btn-export').addEventListener('click', () => {
      document.getElementById('export-modal').classList.remove('hidden');
    });
    document.getElementById('export-modal-close').addEventListener('click', () => {
      document.getElementById('export-modal').classList.add('hidden');
    });
    document.getElementById('export-cancel').addEventListener('click', () => {
      document.getElementById('export-modal').classList.add('hidden');
      this.exporter.cancel();
    });
    document.getElementById('export-start').addEventListener('click', () => this._startExport());

    // Context menu
    document.getElementById('ctx-split').addEventListener('click', () => {
      if (this._selectedClip) {
        this.timeline.splitClip(this._selectedClip.id, this.timeline.currentTime);
        toast('Klip dipisah', 'success');
      }
      this._hideContextMenu();
    });
    document.getElementById('ctx-delete').addEventListener('click', () => {
      if (this._selectedClip) {
        this.timeline.removeClip(this._selectedClip.id);
        this._onClipSelect(null);
        toast('Klip dihapus', 'info');
      }
      this._hideContextMenu();
    });
    document.getElementById('ctx-duplicate').addEventListener('click', () => {
      if (this._selectedClip) {
        const c = this._selectedClip;
        const track = this.timeline.getTrackForClip(c.id);
        if (track) {
          this.timeline.addClip(track.id, { ...c, id: undefined, start: c.start + c.duration + 0.1 });
          toast('Klip diduplikat', 'success');
        }
      }
      this._hideContextMenu();
    });
    document.getElementById('ctx-props').addEventListener('click', () => {
      this._hideContextMenu();
    });

    document.addEventListener('click', (e) => {
      const menu = document.getElementById('context-menu');
      if (!menu.contains(e.target)) this._hideContextMenu();
    });

    // New project
    document.getElementById('btn-new').addEventListener('click', () => {
      if (confirm('Mulai proyek baru? Perubahan yang belum tersimpan akan hilang.')) {
        window.location.reload();
      }
    });

    // Properties panel
    ['prop-clip-volume','prop-scale','prop-rotation','prop-opacity'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => this._updateClipProperties());
    });

    // Timeline time change → update timecode
    this.timeline.on('timeChanged', (t) => {
      document.getElementById('timecode').textContent = Timeline.formatTime(t);
      this._syncVideoPlayback(t);
    });
    this.timeline.on('durationChanged', (d) => {
      document.getElementById('duration').textContent = `/ ${Timeline.formatTime(d)}`;
    });
    this.timeline.on('playStateChanged', (playing) => {
      document.getElementById('icon-play').classList.toggle('hidden', playing);
      document.getElementById('icon-pause').classList.toggle('hidden', !playing);
      if (playing) this._connectVisualizerToMedia();
    });
    this.timeline.on('ended', () => {
      this._pauseAllVideo();
    });
  }

  /* ═══════════════════════════════════════
     FILE HANDLING
  ═══════════════════════════════════════ */
  async _handleFiles(files) {
    for (const file of files) {
      const type = file.type.startsWith('video') ? 'video'
                 : file.type.startsWith('audio') ? 'audio'
                 : file.type.startsWith('image') ? 'image'
                 : null;
      if (!type) { toast(`Format tidak didukung: ${file.name}`, 'error'); continue; }

      const id  = `media_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const url = URL.createObjectURL(file);

      let duration = 5;
      let thumbnailUrl = null;

      if (type === 'video' || type === 'audio') {
        duration = await this._getMediaDuration(url);
      }
      if (type === 'video') {
        thumbnailUrl = await this._grabVideoThumbnail(url);
      }
      if (type === 'image') {
        thumbnailUrl = url;
      }

      mediaStore.set(id, { id, file, url, type, duration, name: file.name, thumbnailUrl });
      this._renderMediaItem(id);

      // Auto-add to first available track
      const track = this.timeline.tracks.find(t => t.type === type) ||
                    this.timeline.tracks.find(t => t.type === 'video');
      if (track) {
        const startTime = this.timeline.duration;
        this._addMediaToTimeline(id, track.id, startTime);
      }
      toast(`${file.name} ditambahkan`, 'success');
    }
  }

  _getMediaDuration(url) {
    return new Promise(resolve => {
      const el = document.createElement('video');
      el.src = url;
      el.preload = 'metadata';
      el.onloadedmetadata = () => resolve(el.duration || 5);
      el.onerror = () => resolve(5);
    });
  }

  _grabVideoThumbnail(url) {
    return new Promise(resolve => {
      const video = document.createElement('video');
      video.src = url;
      video.preload = 'metadata';
      video.currentTime = 0.5;
      video.muted = true;
      const canvas = document.createElement('canvas');
      canvas.width  = 96;
      canvas.height = 54;
      video.onseeked = () => {
        try {
          canvas.getContext('2d').drawImage(video, 0, 0, 96, 54);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } catch(e) { resolve(null); }
      };
      video.onerror = () => resolve(null);
    });
  }

  _renderMediaItem(id) {
    const media = mediaStore.get(id);
    if (!media) return;
    const list = document.getElementById('media-list');

    const item = document.createElement('div');
    item.className = 'media-item';
    item.dataset.mediaId = id;
    item.draggable = true;

    const typeIcon = media.type === 'video'
      ? `<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`
      : media.type === 'audio'
        ? `<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`
        : `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

    item.innerHTML = `
      <div class="media-item-thumb">
        ${media.thumbnailUrl
          ? `<img src="${media.thumbnailUrl}" />`
          : `<div class="media-type-icon">${typeIcon}</div>`}
      </div>
      <div class="media-item-info">
        <div class="media-item-name">${media.name}</div>
        <div class="media-item-meta">${media.type} · ${Timeline.formatTime(media.duration)}</div>
      </div>
      <div class="media-item-actions">
        <button class="media-item-btn" title="Hapus" data-id="${id}">✕</button>
      </div>
    `;

    // Drag from media panel
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('mediaId', id);
      e.dataTransfer.effectAllowed = 'copy';
    });

    // Double-click to add to timeline
    item.addEventListener('dblclick', () => {
      const track = this.timeline.tracks.find(t => t.type === media.type)
                 || this.timeline.tracks[0];
      if (track) this._addMediaToTimeline(id, track.id, this.timeline.duration);
    });

    // Remove button
    item.querySelector('.media-item-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      item.remove();
      mediaStore.delete(id);
    });

    const placeholder = document.getElementById('preview-placeholder');
    if (placeholder) placeholder.classList.add('hidden-placeholder');

    list.appendChild(item);
  }

  async _addMediaToTimeline(mediaId, trackId, startTime) {
    const media = mediaStore.get(mediaId);
    if (!media) return;

    let videoElement = null, imageElement = null;

    if (media.type === 'video' || media.type === 'audio') {
      const vid = document.createElement('video');
      vid.src = media.url;
      vid.muted = false;
      vid.preload = 'auto';
      vid.playsInline = true;
      await vid.load();
      videoElement = vid;
    } else if (media.type === 'image') {
      const img = new Image();
      img.src = media.url;
      await new Promise(r => { img.onload = r; img.onerror = r; });
      imageElement = img;
    }

    const clip = this.timeline.addClip(trackId, {
      file: media.file,
      type: media.type,
      name: media.name,
      start: startTime,
      duration: media.duration,
      videoElement,
      imageElement,
      thumbnailUrl: media.thumbnailUrl,
    });

    this._videoElements.set(clip.id, videoElement || imageElement);

    // Upload texture for image clips
    if (imageElement && this.renderer.gl) {
      const tex = this.renderer.uploadTexture(clip.id, imageElement);
      this.timeline.updateClip(clip.id, { texture: tex });
    }
  }

  /* ═══════════════════════════════════════
     RENDER LOOP
  ═══════════════════════════════════════ */
  _startRenderLoop() {
    const loop = (timestamp) => {
      this._render(timestamp / 1000);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _render(timeSeconds) {
    const t = this.timeline.currentTime;
    const gl = this.renderer.gl;

    // Gather active video clips and update textures
    const videoClips = this.timeline.getActiveVideoClips(t);
    const clipStates = [];

    for (const clip of videoClips) {
      const vid = clip.videoElement;
      if (vid && vid.readyState >= 2) {
        // Update texture every frame
        if (gl) {
          const tex = this.renderer.uploadTexture(clip.id, vid);
          clip.texture = tex;
        }
      } else if (clip.imageElement) {
        if (gl && !clip.texture) {
          clip.texture = this.renderer.uploadTexture(clip.id, clip.imageElement);
        }
      }

      // Compute transition progress
      const trans = this.timeline.getTransitionProgress(clip, t);
      const state = { ...clip };
      if (trans) {
        state.transitionProgress = trans.progress;
        // Find next clip for transition
        const track = this.timeline.getTrackForClip(clip.id);
        if (track) {
          const nextClip = track.clips.find(c => c.start > clip.start && c.texture);
          if (nextClip) state.nextTexture = nextClip.texture;
        }
      }
      clipStates.push(state);
    }

    // Subtitle text at current time
    const subtitleText  = this.subtitles.getActiveText(t);
    const subtitleStyle = this.subtitles.style;

    // Active overlays
    const overlays = this.overlayMgr.getActiveOverlays(t);

    // Visualizer rendering inside overlay
    if (this.visualizer.enabled) {
      const vizOverlay = overlays.find(o => o.id === 'viz_overlay');
      if (vizOverlay) {
        if (!this._vizCanvas) {
          this._vizCanvas = document.createElement('canvas');
          this._vizCtx = this._vizCanvas.getContext('2d');
        }
        const ovW = Math.max(64, Math.round(vizOverlay.width));
        const ovH = Math.max(32, Math.round(vizOverlay.height));
        if (this._vizCanvas.width !== ovW || this._vizCanvas.height !== ovH) {
          this._vizCanvas.width  = ovW;
          this._vizCanvas.height = ovH;
        }
        this._vizCtx.clearRect(0, 0, ovW, ovH);
        this.visualizer.draw(this._vizCtx, ovW, ovH, t);

        if (gl) {
          vizOverlay.texture = this.renderer.uploadTexture(vizOverlay.id, this._vizCanvas);
        } else {
          vizOverlay.imageElement = this._vizCanvas;
        }
      }
    }

    // Render everything
    this.renderer.render({
      clips: clipStates,
      overlays,
      subtitleText,
      subtitleStyle,
      time: t,
    });

    // Sync overlay handles to canvas resize
    this.overlayMgr.syncAllHandles();
  }

  /* ═══════════════════════════════════════
     PLAYBACK
  ═══════════════════════════════════════ */
  _togglePlay() {
    if (this.timeline.playing) {
      this.timeline.pause();
      this._pauseAllVideo();
    } else {
      this.timeline.play();
      this._playActiveVideos();
    }
  }

  _seekTo(t) {
    const clamped = Math.max(0, Math.min(t, this.timeline.duration));
    this.timeline.seek(clamped);
    this._syncVideoPlayback(clamped);
    this.timelineUI._updatePlayhead(clamped);
  }

  _syncVideoPlayback(t) {
    for (const track of this.timeline.tracks) {
      for (const clip of track.clips) {
        const vid = clip.videoElement;
        if (!vid) continue;
        const clipTime = t - clip.start + (clip.srcStart || 0);
        if (clipTime >= 0 && clipTime <= clip.duration) {
          if (Math.abs(vid.currentTime - clipTime) > 0.2) {
            vid.currentTime = clipTime;
          }
        } else {
          if (!vid.paused) vid.pause();
        }
      }
    }
  }

  _playActiveVideos() {
    const t = this.timeline.currentTime;
    for (const track of this.timeline.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        const vid = clip.videoElement;
        if (!vid) continue;
        const clipTime = t - clip.start + (clip.srcStart || 0);
        if (clipTime >= 0 && clipTime <= clip.duration) {
          vid.playbackRate = this.timeline.playbackRate;
          vid.volume = clip.volume * this.timeline.volume;
          vid.play().catch(() => {});
        }
      }
    }
  }

  _pauseAllVideo() {
    for (const track of this.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.videoElement && !clip.videoElement.paused) {
          clip.videoElement.pause();
        }
      }
    }
  }

  _setVolume(v) {
    this.timeline.volume = v;
    for (const track of this.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.videoElement) {
          clip.videoElement.volume = Math.min(1, (clip.volume || 1) * v);
        }
      }
    }
  }

  _connectVisualizerToMedia() {
    if (this._mediaElementConnected) return;
    const t = this.timeline.currentTime;
    const activeClips = this.timeline.getActiveVideoClips(t);
    const clip = activeClips.find(c => c.videoElement);
    if (clip && clip.videoElement) {
      this.visualizer.connectMediaElement(clip.videoElement);
      this.visualizer.resume();
      this._mediaElementConnected = true;
    }
  }

  /* ═══════════════════════════════════════
     EFFECTS
  ═══════════════════════════════════════ */
  _applyEffect(effectName) {
    if (!this._selectedClip) {
      toast('Pilih klip di timeline terlebih dahulu', 'warning');
      return;
    }
    this.timeline.addEffectToClip(this._selectedClip.id, effectName, { enabled: true, value: 0.5 });
    this._selectedClip = this.timeline.getClip(this._selectedClip.id);
    this._renderActiveEffects();
    toast(`Efek "${effectName}" diterapkan`, 'success');
  }

  _applyTransition(transitionName) {
    if (!this._selectedClip) {
      toast('Pilih klip di timeline terlebih dahulu', 'warning');
      return;
    }
    this.timeline.setTransition(this._selectedClip.id, transitionName, 0.5);
    toast(`Transisi "${transitionName}" diterapkan`, 'success');
  }

  _renderActiveEffects() {
    const list = document.getElementById('active-effects-list');
    if (!list) return;
    list.innerHTML = '';
    if (!this._selectedClip) return;
    const effects = this._selectedClip.effects || {};
    const names = Object.keys(effects);
    if (names.length === 0) {
      list.innerHTML = '<p class="empty-label">Belum ada efek</p>';
      return;
    }
    names.forEach(name => {
      const item = document.createElement('div');
      item.className = 'active-effect-item';
      item.innerHTML = `
        <span class="active-effect-name">${name}</span>
        <span class="active-effect-remove" data-effect="${name}" title="Hapus">✕</span>
      `;
      item.querySelector('.active-effect-remove').addEventListener('click', () => {
        this.timeline.removeEffectFromClip(this._selectedClip.id, name);
        this._selectedClip = this.timeline.getClip(this._selectedClip.id);
        this._renderActiveEffects();
      });
      list.appendChild(item);
    });
  }

  /* ═══════════════════════════════════════
     CLIP PROPERTIES
  ═══════════════════════════════════════ */
  _onClipSelect(clip) {
    this._selectedClip = clip;
    const noSel  = document.getElementById('no-selection');
    const clipPr = document.getElementById('clip-props');
    if (!clip) {
      noSel?.classList.remove('hidden');
      clipPr?.classList.add('hidden');
      return;
    }
    noSel?.classList.add('hidden');
    clipPr?.classList.remove('hidden');

    document.getElementById('prop-clip-name').textContent = clip.name;
    document.getElementById('prop-clip-start').value = Timeline.formatTime(clip.start);
    document.getElementById('prop-clip-duration').value = Timeline.formatTime(clip.duration);
    document.getElementById('prop-clip-volume').value = (clip.volume || 1) * 100;
    document.getElementById('prop-volume-val').textContent = `${Math.round((clip.volume||1)*100)}%`;
    document.getElementById('prop-scale').value = clip.scale || 100;
    document.getElementById('prop-scale-val').textContent = `${clip.scale || 100}%`;
    document.getElementById('prop-rotation').value = (clip.rotation || 0) * (180 / Math.PI);
    document.getElementById('prop-rotation-val').textContent = `${Math.round((clip.rotation||0) * (180/Math.PI))}°`;
    document.getElementById('prop-opacity').value = (clip.opacity || 1) * 100;
    document.getElementById('prop-opacity-val').textContent = `${Math.round((clip.opacity||1)*100)}%`;

    this._renderActiveEffects();
  }

  _updateClipProperties() {
    if (!this._selectedClip) return;
    const vol = parseInt(document.getElementById('prop-clip-volume').value) / 100;
    const scale = parseInt(document.getElementById('prop-scale').value);
    const rot = parseInt(document.getElementById('prop-rotation').value) * (Math.PI / 180);
    const opacity = parseInt(document.getElementById('prop-opacity').value) / 100;

    document.getElementById('prop-volume-val').textContent = `${Math.round(vol*100)}%`;
    document.getElementById('prop-scale-val').textContent = `${scale}%`;
    document.getElementById('prop-rotation-val').textContent = `${Math.round(rot*(180/Math.PI))}°`;
    document.getElementById('prop-opacity-val').textContent = `${Math.round(opacity*100)}%`;

    this.timeline.updateClip(this._selectedClip.id, { volume: vol, scale, rotation: rot, opacity });
    this._selectedClip = this.timeline.getClip(this._selectedClip.id);
  }

  /* ═══════════════════════════════════════
     AUTO SUBTITLE
  ═══════════════════════════════════════ */
  async _runAutoSubtitle() {
    // Check if any video clip exists
    const clips = [];
    for (const track of this.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.videoElement) clips.push(clip);
      }
    }
    if (clips.length === 0) {
      toast('Import video terlebih dahulu untuk auto subtitle', 'warning');
      return;
    }

    const statusDiv = document.getElementById('whisper-status');
    const barEl     = document.getElementById('whisper-bar');
    const textEl    = document.getElementById('whisper-text');
    statusDiv.classList.remove('hidden');

    // Extract audio from video file
    const clip = clips[0];
    const file = clip.file;

    try {
      if (!file) {
        throw new Error('File sumber klip video tidak ditemukan.');
      }
      const audioData = await this._extractAudio(file);
      textEl.textContent = 'Memuat model AI Whisper...';
      barEl.style.width  = '5%';

      // Terminate previous worker
      if (this._whisperWorker) this._whisperWorker.terminate();
      this._whisperWorker = new Worker('./js/subtitle/whisper-worker.js', { type: 'module' });

      this._whisperWorker.onmessage = (e) => {
        const { type, value, text, segments, message } = e.data;
        if (type === 'progress') {
          barEl.style.width = `${value}%`;
          textEl.textContent = text;
        }
        if (type === 'result') {
          this.subtitles.importWhisperSegments(segments);
          statusDiv.classList.add('hidden');
          toast(`${segments.length} subtitle berhasil dibuat!`, 'success');
          this._whisperWorker.terminate();
          this._whisperWorker = null;
        }
        if (type === 'error') {
          textEl.textContent = `Error: ${message}`;
          setTimeout(() => statusDiv.classList.add('hidden'), 3000);
          toast(`Auto subtitle gagal: ${message}`, 'error');
        }
      };

      this._whisperWorker.postMessage({ type: 'transcribe', audioData, lang: 'auto' });
    } catch (err) {
      console.error(err);
      toast(`Gagal ekstrak audio: ${err.message}`, 'error');
      statusDiv.classList.add('hidden');
    }
  }

  async _extractAudio(file) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const arrayBuf = await file.arrayBuffer();
    const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
    const channelData = audioBuf.getChannelData(0);
    await audioCtx.close();
    return channelData;
  }

  _addManualSubtitle() {
    const t = this.timeline.currentTime;
    this.subtitles.addSubtitle(t, t + 3, 'Subtitle baru...');
    toast('Subtitle ditambahkan', 'success');
  }

  _renderSubtitleList() {
    const list = document.getElementById('subtitle-list');
    if (!list) return;
    list.innerHTML = '';
    if (this.subtitles.subtitles.length === 0) {
      list.innerHTML = '<p class="empty-label">Belum ada subtitle</p>';
      return;
    }
    this.subtitles.subtitles.forEach((sub) => {
      const item = document.createElement('div');
      item.className = 'subtitle-item';
      item.dataset.id = sub.id;
      item.innerHTML = `
        <div class="subtitle-time">${Timeline.formatTime(sub.start)} → ${Timeline.formatTime(sub.end)}</div>
        <textarea class="subtitle-text-input" rows="2">${sub.text}</textarea>
      `;
      item.querySelector('textarea').addEventListener('change', (e) => {
        this.subtitles.updateSubtitle(sub.id, { text: e.target.value });
      });
      item.addEventListener('click', () => {
        this._seekTo(sub.start);
        document.querySelectorAll('.subtitle-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      });
      list.appendChild(item);
    });
  }

  /* ═══════════════════════════════════════
     STICKERS
  ═══════════════════════════════════════ */
  _initStickerGrid(category) {
    const grid = document.getElementById('sticker-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const items = STICKER_SETS[category] || [];
    items.forEach(emoji => {
      const item = document.createElement('div');
      item.className = 'sticker-item';
      item.textContent = emoji;
      item.title = 'Klik untuk tambah ke preview';
      item.addEventListener('click', () => {
        this.overlayMgr.addOverlay(emoji, { type: 'emoji', emoji });
        toast(`Stiker ditambahkan`, 'success');
      });
      grid.appendChild(item);
    });

    if (category === 'text') {
      const textBtn = document.createElement('div');
      textBtn.className = 'sticker-item';
      textBtn.innerHTML = '<span style="font-size:13px;color:#a855f7;font-weight:700">T</span>';
      textBtn.title = 'Tambah teks overlay';
      textBtn.addEventListener('click', () => {
        const text = prompt('Masukkan teks:', 'Hello!');
        if (text) {
          this.overlayMgr.addOverlay(text, { type: 'text' });
        }
      });
      grid.appendChild(textBtn);
    }

    if (items.length === 0 && category !== 'text') {
      grid.innerHTML = '<p class="empty-label">Import stiker dari file</p>';
    }
  }

  /* ═══════════════════════════════════════
     VISUALIZER
  ═══════════════════════════════════════ */
  _updateVisualizerSettings() {
    this.visualizer.setSettings({
      color1:      document.getElementById('viz-color1').value,
      color2:      document.getElementById('viz-color2').value,
      sensitivity: parseInt(document.getElementById('viz-sensitivity').value),
    });
  }

  /* ═══════════════════════════════════════
     EXPORT
  ═══════════════════════════════════════ */
  _startExport() {
    if (this.timeline.duration === 0) {
      toast('Timeline kosong, tidak ada yang diexport', 'warning');
      return;
    }
    const format  = document.querySelector('input[name="export-format"]:checked').value;
    const quality = parseInt(document.getElementById('export-quality').value);
    const fps     = parseInt(document.getElementById('export-fps').value);

    document.getElementById('export-progress-area').classList.remove('hidden');
    document.getElementById('export-start').disabled = true;

    this.exporter
      .onProgress(pct => {
        document.getElementById('export-progress-bar').style.width = `${pct}%`;
        document.getElementById('export-progress-text').textContent = `Memproses... ${pct}%`;
      })
      .onComplete(() => {
        document.getElementById('export-modal').classList.add('hidden');
        document.getElementById('export-start').disabled = false;
        document.getElementById('export-progress-area').classList.add('hidden');
        document.getElementById('export-progress-bar').style.width = '0%';
        toast('Export selesai! File berhasil diunduh.', 'success');
      })
      .onError((err) => {
        document.getElementById('export-start').disabled = false;
        document.getElementById('export-progress-area').classList.add('hidden');
        toast(`Export gagal: ${err.message}`, 'error');
      })
      .export({ format, bitrate: quality, fps });
  }

  /* ═══════════════════════════════════════
     CONTEXT MENU
  ═══════════════════════════════════════ */
  _showContextMenu(e, clip) {
    const menu = document.getElementById('context-menu');
    menu.style.left = `${e.clientX}px`;
    menu.style.top  = `${e.clientY}px`;
    menu.classList.remove('hidden');
  }

  _hideContextMenu() {
    document.getElementById('context-menu').classList.add('hidden');
  }
}

/* ─── BOOTSTRAP ─── */
window.addEventListener('DOMContentLoaded', async () => {
  try {
    await showSplash();
    const app = new KepKatApp();
    window.__kepkat = app;
    setTimeout(hideSplash, 200);
  } catch (err) {
    console.error('KepKat init error:', err);
    document.getElementById('splash-status').textContent = `Error: ${err.message}`;
  }
});
