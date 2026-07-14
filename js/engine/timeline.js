/**
 * KepKat Mini — Timeline Engine
 * Manages clips, tracks, playback timing, and state
 */

export class Timeline {
  constructor() {
    this.tracks = [];
    this.duration = 0;
    this.currentTime = 0;
    this.playing = false;
    this.playbackRate = 1;
    this.volume = 1;
    this.zoom = 3; // pixels per second
    this._raf = null;
    this._lastTimestamp = null;
    this._listeners = {};
    this._nextId = 1;

    this._initDefaultTracks();
  }

  _initDefaultTracks() {
    this.addTrack('video', 'Video 1');
    this.addTrack('video', 'Video 2');
    this.addTrack('audio', 'Audio 1');
  }

  addTrack(type, name) {
    const track = {
      id: `track_${this._nextId++}`,
      type,
      name,
      clips: [],
      muted: false,
      locked: false,
    };
    this.tracks.push(track);
    this._emit('tracksChanged', this.tracks);
    return track;
  }

  removeTrack(trackId) {
    this.tracks = this.tracks.filter(t => t.id !== trackId);
    this._updateDuration();
    this._emit('tracksChanged', this.tracks);
  }

  addClip(trackId, clip) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track) return null;
    const newClip = {
      id: `clip_${this._nextId++}`,
      trackId,
      type: clip.type || track.type,
      name: clip.name || 'Clip',
      start: clip.start ?? 0,
      duration: clip.duration ?? 5,
      srcStart: clip.srcStart ?? 0,
      // Source refs
      file: clip.file || null,
      mediaUrl: clip.mediaUrl || null,
      audioData: clip.audioData || null,
      videoElement: clip.videoElement || null,
      imageElement: clip.imageElement || null,
      audioBuffer: clip.audioBuffer || null,
      // Appearance
      opacity: clip.opacity !== undefined ? clip.opacity : 1,
      scale: clip.scale ?? 100,
      rotation: clip.rotation ?? 0,
      x: clip.x ?? 0, y: clip.y ?? 0,
      volume: clip.volume !== undefined ? clip.volume : 1,
      // Effects & transitions
      effects: {},
      transition: null,
      transitionDuration: 0.5,
      // Texture (WebGL)
      texture: null,
      thumbnailUrl: null,
    };
    track.clips.push(newClip);
    track.clips.sort((a, b) => a.start - b.start);
    this._updateDuration();
    this._emit('clipsChanged', track);
    this._emit('clipAdded', newClip);
    return newClip;
  }

  removeClip(clipId) {
    for (const track of this.tracks) {
      const idx = track.clips.findIndex(c => c.id === clipId);
      if (idx !== -1) {
        track.clips.splice(idx, 1);
        this._updateDuration();
        this._emit('clipsChanged', track);
        this._emit('clipRemoved', clipId);
        return true;
      }
    }
    return false;
  }

  updateClip(clipId, updates) {
    const clip = this.getClip(clipId);
    if (!clip) return;
    Object.assign(clip, updates);
    if ('start' in updates || 'duration' in updates) {
      const track = this.getTrackForClip(clipId);
      if (track) track.clips.sort((a, b) => a.start - b.start);
      this._updateDuration();
    }
    this._emit('clipUpdated', clip);
    return clip;
  }

  getClip(clipId) {
    for (const track of this.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  }

  getTrackForClip(clipId) {
    return this.tracks.find(t => t.clips.some(c => c.id === clipId)) || null;
  }

  splitClip(clipId, time) {
    const clip = this.getClip(clipId);
    const track = this.getTrackForClip(clipId);
    if (!clip || !track) return;
    if (time <= clip.start || time >= clip.start + clip.duration) return;

    const leftDur  = time - clip.start;
    const rightDur = clip.duration - leftDur;

    // Modify existing to be left half
    clip.duration = leftDur;

    // Create right half
    const rightClip = this.addClip(track.id, {
      ...clip,
      id: undefined,
      start: time,
      duration: rightDur,
      srcStart: clip.srcStart + leftDur,
    });
    this._emit('clipsChanged', track);
    return rightClip;
  }

  addEffectToClip(clipId, effectName, params = {}) {
    const clip = this.getClip(clipId);
    if (!clip) return;
    clip.effects[effectName] = { enabled: true, value: 0.5, ...params };
    this._emit('clipUpdated', clip);
  }

  removeEffectFromClip(clipId, effectName) {
    const clip = this.getClip(clipId);
    if (!clip) return;
    delete clip.effects[effectName];
    this._emit('clipUpdated', clip);
  }

  setTransition(clipId, transitionName, duration = 0.5) {
    const clip = this.getClip(clipId);
    if (!clip) return;
    clip.transition = transitionName;
    clip.transitionDuration = duration;
    this._emit('clipUpdated', clip);
  }

  /** Get all clips active at the given time, sorted by track order */
  getActiveClips(time) {
    const active = [];
    for (const track of this.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (time >= clip.start && time < clip.start + clip.duration) {
          active.push({ ...clip, trackType: track.type });
        }
      }
    }
    return active;
  }

  getActiveVideoClips(time) {
    return this.getActiveClips(time).filter(c => c.trackType === 'video');
  }

  getActiveAudioClips(time) {
    return this.getActiveClips(time).filter(c => c.trackType === 'audio' || (c.trackType === 'video' && c.videoElement));
  }

  /** Compute transition progress for a clip at given time */
  getTransitionProgress(clip, time) {
    if (!clip.transition) return null;
    const td = clip.transitionDuration;
    // Start of clip
    const startProgress = (time - clip.start) / td;
    if (startProgress >= 0 && startProgress <= 1) {
      return { type: 'in', progress: startProgress };
    }
    // End of clip
    const endT = clip.start + clip.duration - td;
    const endProgress = (time - endT) / td;
    if (endProgress >= 0 && endProgress <= 1) {
      return { type: 'out', progress: endProgress };
    }
    return null;
  }

  play() {
    if (this.playing) return;
    if (this.currentTime >= this.duration) this.currentTime = 0;
    this.playing = true;
    this._lastTimestamp = performance.now();
    this._tick();
    this._emit('playStateChanged', true);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._emit('playStateChanged', false);
  }

  seek(time) {
    this.currentTime = Math.max(0, Math.min(time, this.duration));
    this._emit('timeChanged', this.currentTime);
  }

  _tick() {
    if (!this.playing) return;
    const now = performance.now();
    const delta = (now - this._lastTimestamp) / 1000;
    this._lastTimestamp = now;
    this.currentTime += delta * this.playbackRate;
    if (this.currentTime >= this.duration) {
      this.currentTime = this.duration;
      this.playing = false;
      this._emit('playStateChanged', false);
      this._emit('ended');
    }
    this._emit('timeChanged', this.currentTime);
    if (this.playing) {
      this._raf = requestAnimationFrame(() => this._tick());
    }
  }

  _updateDuration() {
    let max = 0;
    for (const track of this.tracks) {
      for (const clip of track.clips) {
        max = Math.max(max, clip.start + clip.duration);
      }
    }
    this.duration = max || 0;
    this._emit('durationChanged', this.duration);
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

  /** Format seconds to HH:MM:SS.mmm */
  static formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
  }

  /** Parse HH:MM:SS.mmm to seconds */
  static parseTime(str) {
    const parts = str.split(':');
    if (parts.length < 2) return parseFloat(str) || 0;
    let [h, m, s] = parts;
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s || 0);
  }

  toJSON() {
    return {
      duration: this.duration,
      tracks: this.tracks.map(t => ({
        ...t,
        clips: t.clips.map(c => ({
          ...c,
          videoElement: undefined,
          imageElement: undefined,
          texture: undefined,
          file: undefined,
        }))
      }))
    };
  }
}
