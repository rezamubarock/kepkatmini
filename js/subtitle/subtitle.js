/**
 * KepKat Mini — Subtitle Manager
 * Parses SRT/VTT, manages subtitle track, and provides active text for renderer
 */

export class SubtitleManager {
  constructor() {
    this.subtitles = [];
    this.style = {
      font: 'Inter',
      size: 32,
      color: '#ffffff',
      bgColor: '#000000',
      bgAlpha: 60,
      position: 'bottom',
    };
    this._nextId = 1;
    this._listeners = {};
  }

  /** Parse SRT format string */
  parseSRT(text) {
    const blocks = text.trim().split(/\n\s*\n/);
    const result = [];

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 3) continue;

      // Index line (ignore)
      const timeMatch = lines[1].match(
        /(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/
      );
      if (!timeMatch) continue;

      const start = this._parseSRTTime(timeMatch[1]);
      const end   = this._parseSRTTime(timeMatch[2]);
      const text  = lines.slice(2).join('\n').replace(/<[^>]+>/g, ''); // strip HTML

      result.push({ start, end, text });
    }

    return result;
  }

  /** Parse VTT format string */
  parseVTT(text) {
    const lines = text.split('\n');
    const result = [];
    let i = 0;

    // Skip WEBVTT header
    while (i < lines.length && !lines[i].includes('-->')) i++;

    while (i < lines.length) {
      const timeLine = lines[i];
      const timeMatch = timeLine.match(
        /(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})/
      );
      if (!timeMatch) { i++; continue; }

      const start = this._parseVTTTime(timeMatch[1]);
      const end   = this._parseVTTTime(timeMatch[2]);
      i++;
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
        textLines.push(lines[i]);
        i++;
      }
      const text = textLines.join('\n').replace(/<[^>]+>/g, '');
      if (text.trim()) result.push({ start, end, text });
      i++;
    }

    return result;
  }

  _parseSRTTime(str) {
    // HH:MM:SS,mmm
    const [hms, ms] = str.replace(',', '.').split('.');
    const [h, m, s] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s + parseInt(ms || 0) / 1000;
  }

  _parseVTTTime(str) {
    // HH:MM:SS.mmm or MM:SS.mmm
    const parts = str.split(':');
    if (parts.length === 3) {
      const [h, m, sm] = parts;
      return parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(sm);
    } else {
      const [m, sm] = parts;
      return parseInt(m) * 60 + parseFloat(sm);
    }
  }

  importSRT(text) {
    const parsed = this.parseSRT(text);
    this._addParsed(parsed);
  }

  importVTT(text) {
    const parsed = this.parseVTT(text);
    this._addParsed(parsed);
  }

  _splitSegmentText(text, start, end, maxWords = 4) {
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) {
      return [{ start, end, text }];
    }

    const result = [];
    const totalWords = words.length;
    const duration = end - start;
    const numChunks = Math.ceil(totalWords / maxWords);

    for (let i = 0; i < numChunks; i++) {
      const chunkWords = words.slice(i * maxWords, (i + 1) * maxWords);
      const chunkText = chunkWords.join(' ');

      // Calculate proportional start and end times
      const chunkStart = start + (i * maxWords / totalWords) * duration;
      const chunkEnd   = start + (((i + 1) * maxWords) / totalWords) * duration;

      result.push({
        start: chunkStart,
        end: Math.min(chunkEnd, end),
        text: chunkText,
      });
    }

    return result;
  }

  _addParsed(parsed) {
    for (const s of parsed) {
      const split = this._splitSegmentText(s.text, s.start, s.end, 4);
      for (const item of split) {
        this.subtitles.push({
          id: `sub_${this._nextId++}`,
          start: item.start,
          end: item.end,
          text: item.text,
        });
      }
    }
    this._sortSubtitles();
    this._emit('changed', this.subtitles);
  }

  /** Import from Whisper output (array of {start, end, text} segments) */
  importWhisperSegments(segments) {
    for (const seg of segments) {
      const split = this._splitSegmentText(seg.text, seg.start, seg.end, 4);
      for (const item of split) {
        this.subtitles.push({
          id: `sub_${this._nextId++}`,
          start: item.start,
          end: item.end,
          text: item.text,
        });
      }
    }
    this._sortSubtitles();
    this._emit('changed', this.subtitles);
  }

  addSubtitle(start, end, text = 'Subtitle') {
    const sub = {
      id: `sub_${this._nextId++}`,
      start, end, text,
    };
    this.subtitles.push(sub);
    this._sortSubtitles();
    this._emit('changed', this.subtitles);
    return sub;
  }

  updateSubtitle(id, updates) {
    const sub = this.subtitles.find(s => s.id === id);
    if (!sub) return;
    Object.assign(sub, updates);
    if ('start' in updates || 'end' in updates) this._sortSubtitles();
    this._emit('changed', this.subtitles);
    return sub;
  }

  removeSubtitle(id) {
    this.subtitles = this.subtitles.filter(s => s.id !== id);
    this._emit('changed', this.subtitles);
  }

  clear() {
    this.subtitles = [];
    this._emit('changed', this.subtitles);
  }

  /** Get subtitle text active at the given time */
  getActiveText(time) {
    const active = this.subtitles.filter(s => time >= s.start && time <= s.end);
    if (active.length === 0) return null;
    return active.map(s => s.text).join('\n');
  }

  setStyle(styleUpdates) {
    Object.assign(this.style, styleUpdates);
    this._emit('styleChanged', this.style);
  }

  /** Export to SRT format */
  toSRT() {
    return this.subtitles.map((s, i) => {
      return `${i + 1}\n${this._formatSRTTime(s.start)} --> ${this._formatSRTTime(s.end)}\n${s.text}`;
    }).join('\n\n');
  }

  /** Export to VTT format */
  toVTT() {
    const entries = this.subtitles.map(s =>
      `${this._formatVTTTime(s.start)} --> ${this._formatVTTTime(s.end)}\n${s.text}`
    ).join('\n\n');
    return `WEBVTT\n\n${entries}`;
  }

  _formatSRTTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
  }

  _formatVTTTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
  }

  _sortSubtitles() {
    this.subtitles.sort((a, b) => a.start - b.start);
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

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}
