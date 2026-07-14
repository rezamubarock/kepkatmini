/**
 * KepKat Mini — Fast Client-side Audio Extractor
 *
 * Strategy for MP4/AAC (fastest — most music videos):
 *   1. Stream-parse with MP4Box to extract raw AAC frames (no video data needed)
 *   2. Wrap frames in an ADTS container (7-byte header per frame — trivial)
 *   3. Decode the resulting ~50-100MB audio file via AudioContext.decodeAudioData
 *      → runs at CPU speed, 100× faster than real-time playback
 *
 * Fallback for WebM/Opus/other formats:
 *   MediaElement at 16× speed (browser universal fallback)
 *
 * For a 1-hour AAC music video:
 *   Old approach: ~225 seconds (real-time at 16×)
 *   New approach: ~5-15 seconds (CPU decode of ~57 MB audio track)
 */

const TARGET_SR = 16000; // Whisper requires 16 kHz mono

// ─── MP4Box CDN loader ───────────────────────────────────────────────────────

function loadMP4Box() {
  return new Promise((resolve, reject) => {
    if (window.MP4Box) return resolve(window.MP4Box);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js';
    s.onload  = () => window.MP4Box ? resolve(window.MP4Box) : reject(new Error('MP4Box init failed'));
    s.onerror = () => reject(new Error('Cannot load MP4Box from CDN'));
    document.head.appendChild(s);
  });
}

// ─── ADTS sampling-frequency table ──────────────────────────────────────────

const FREQ_TABLE = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Extract 16 kHz mono PCM from a video/audio file.
 * @param {File|Blob|string} source  File, Blob, or blob: URL string
 * @param {Function} onProgress     (percent:number, text:string) => void
 * @returns {Promise<Float32Array>}
 */
export async function extractAudioWebCodecs(source, onProgress) {
  // Resolve to a File/Blob + a URL we can give to <video>
  let file = null;
  let videoSrc = null;
  let ownedUrl = null;

  if (source instanceof File || source instanceof Blob) {
    file = source;
    ownedUrl = URL.createObjectURL(source);
    videoSrc = ownedUrl;
  } else if (typeof source === 'string') {
    videoSrc = source;
  } else {
    throw new Error('extractAudioWebCodecs: invalid source');
  }

  const releaseUrl = () => { if (ownedUrl) { URL.revokeObjectURL(ownedUrl); ownedUrl = null; } };

  try {
    // ── Fast path: MP4Box + ADTS + decodeAudioData ────────────────────────
    if (file) {
      try {
        const result = await extractViaADTS(file, onProgress);
        releaseUrl();
        return result;
      } catch (err) {
        console.warn('[AudioExtractor] ADTS path failed, falling back to MediaElement:', err.message);
        // fall through to MediaElement
      }
    }

    // ── Slow fallback: MediaElement at 16× ────────────────────────────────
    if (!videoSrc) throw new Error('No media source available');
    const result = await extractViaMediaElement(videoSrc, onProgress);
    releaseUrl();
    return result;

  } catch (err) {
    releaseUrl();
    throw err;
  }
}

// ─── Fast path: MP4Box → ADTS → decodeAudioData ──────────────────────────────

async function extractViaADTS(file, onProgress) {
  const prog = (p, t) => { if (onProgress) onProgress(p, t); };

  prog(2, 'Memuat parser MP4...');
  const MP4Box = await loadMP4Box();

  const mp4boxfile = MP4Box.createFile();
  let audioTrack = null;
  let sampleRate = 44100;
  let channels   = 2;
  let freqIndex  = 4;
  const rawFrames = []; // Array of Uint8Array (raw AAC/ADTS frames)

  // Deferred signals
  let onReadyOk, onReadyFail;
  const readyPromise = new Promise((res, rej) => { onReadyOk = res; onReadyFail = rej; });

  mp4boxfile.onError = (e) => onReadyFail(new Error('MP4Box: ' + e));

  mp4boxfile.onReady = (info) => {
    audioTrack = info.tracks.find(t => t.type === 'audio');
    if (!audioTrack) { onReadyFail(new Error('No audio track found')); return; }
    if (!audioTrack.codec.startsWith('mp4a')) {
      onReadyFail(new Error('Non-AAC codec: ' + audioTrack.codec + ' — skipping fast path'));
      return;
    }
    sampleRate = audioTrack.audio.sample_rate;
    channels   = audioTrack.audio.channel_count;
    const fi   = FREQ_TABLE.indexOf(sampleRate);
    freqIndex  = fi !== -1 ? fi : 4;

    mp4boxfile.setExtractionOptions(audioTrack.id, null, { nbSamples: 1000 });
    mp4boxfile.start();
    onReadyOk();
  };

  mp4boxfile.onSamples = (trackId, ref, samples) => {
    for (const s of samples) {
      // s.data may be ArrayBuffer or Uint8Array depending on mp4box version
      const data = s.data instanceof Uint8Array
        ? s.data
        : new Uint8Array(s.data.buffer ?? s.data, s.data.byteOffset ?? 0, s.data.byteLength ?? s.data.length);
      rawFrames.push(data);
    }
    mp4boxfile.releaseUsedSamples(trackId, samples.length);
  };

  // ── Stream file through MP4Box in 8 MB chunks ─────────────────────────────
  const CHUNK = 8 * 1024 * 1024;
  let offset  = 0;
  const total  = file.size;

  while (offset < total) {
    const buf = await file.slice(offset, offset + CHUNK).arrayBuffer();
    buf.fileStart = offset;
    mp4boxfile.appendBuffer(buf);
    offset += CHUNK;
    prog(Math.min(45, Math.round((offset / total) * 45) + 2), `Membaca audio... ${Math.round((offset / total) * 100)}%`);
  }
  mp4boxfile.flush();

  // Wait for onReady (should have fired synchronously during appendBuffer)
  await Promise.race([
    readyPromise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('onReady timeout — not a standard MP4')), 15000))
  ]);

  if (rawFrames.length === 0) throw new Error('No audio frames extracted');

  prog(50, `Membangun stream audio (${rawFrames.length} frame)...`);

  // ── Build ADTS stream from raw AAC frames ─────────────────────────────────
  // ADTS header = 7 bytes per frame, no CRC (protection_absent=1)
  const profile = 1; // AAC-LC = audioObjectType(2) - 1

  let totalBytes = 0;
  for (const f of rawFrames) totalBytes += 7 + f.byteLength;

  const adts = new Uint8Array(totalBytes);
  let pos = 0;

  for (const frame of rawFrames) {
    const frameLen = frame.byteLength + 7;
    adts[pos++] = 0xFF;
    adts[pos++] = 0xF1; // ID=0 (MPEG-4), Layer=00, protection_absent=1
    adts[pos++] = (profile << 6) | (freqIndex << 2) | ((channels >> 2) & 1);
    adts[pos++] = ((channels & 3) << 6) | ((frameLen >> 11) & 3);
    adts[pos++] = (frameLen >> 3) & 0xFF;
    adts[pos++] = ((frameLen & 7) << 5) | 0x1F;
    adts[pos++] = 0xFC;
    adts.set(frame, pos);
    pos += frame.byteLength;
  }

  prog(60, 'Mendekode audio secara cepat...');

  // ── Decode ADTS with AudioContext — runs at CPU speed ────────────────────
  const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuf;
  try {
    audioBuf = await decodeCtx.decodeAudioData(adts.buffer);
  } finally {
    try { decodeCtx.close(); } catch (_) {}
  }

  prog(88, 'Menyesuaikan sample rate ke 16 kHz...');

  // Get mono (left channel) and resample to TARGET_SR
  const raw       = audioBuf.getChannelData(0);
  const resampled = resampleBuffer(raw, audioBuf.sampleRate, TARGET_SR);

  prog(100, 'Ekstraksi audio selesai!');
  return resampled;
}

// ─── Slow fallback: MediaElement at 16× ──────────────────────────────────────

function extractViaMediaElement(videoSrc, onProgress) {
  const prog = (p, t) => { if (onProgress) onProgress(p, t); };

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;';
    video.muted       = false;
    video.playbackRate = 16;
    video.preload     = 'auto';
    document.body.appendChild(video);

    let audioCtx   = null;
    let srcNode    = null;
    let processor  = null;
    const chunks   = [];
    let totalSamples = 0;
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return; cleaned = true;
      try { processor?.disconnect(); } catch (_) {}
      try { srcNode?.disconnect(); } catch (_) {}
      try { audioCtx?.close(); } catch (_) {}
      try { video.pause(); video.src = ''; document.body.removeChild(video); } catch (_) {}
    };
    const fail = (msg) => { cleanup(); reject(new Error(msg)); };

    video.addEventListener('loadedmetadata', () => {
      if (!isFinite(video.duration) || video.duration <= 0) {
        fail('Tidak dapat membaca durasi video — format tidak didukung browser ini.'); return;
      }
      try {
        audioCtx  = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_SR });
        srcNode   = audioCtx.createMediaElementSource(video);
        processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          const d = new Float32Array(e.inputBuffer.getChannelData(0));
          chunks.push(d); totalSamples += d.length;
        };
        srcNode.connect(processor);
        processor.connect(audioCtx.destination);
      } catch (err) { fail('Audio context error: ' + err.message); return; }

      prog(2, 'Mengekstrak audio (mode lambat — format tidak standar)...');
      const resume = () => audioCtx?.state === 'suspended' ? audioCtx.resume() : Promise.resolve();
      resume().then(() => video.play().catch(e => fail('Gagal play video: ' + e.message)));
    });

    video.addEventListener('timeupdate', () => {
      if (!video.duration) return;
      const p = Math.min(95, Math.round((video.currentTime / video.duration) * 93) + 2);
      prog(p, `Mengekstrak audio... ${p}%`);
    });

    video.addEventListener('ended', () => {
      setTimeout(() => {
        try { processor?.disconnect(); srcNode?.disconnect(); } catch (_) {}
        if (totalSamples === 0) { fail('Tidak ada data audio.'); return; }
        prog(98, 'Menggabungkan audio...');
        const out = new Float32Array(totalSamples);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        prog(100, 'Selesai!');
        cleanup(); resolve(out);
      }, 400);
    });

    video.addEventListener('error', () => {
      const c = video.error?.code ?? '?', m = video.error?.message ?? 'unknown';
      fail(`Video error (MediaError ${c}: ${m})`);
    });

    video.src = videoSrc;
    video.load();
  });
}

// ─── Linear resampler ─────────────────────────────────────────────────────────

function resampleBuffer(input, fromSR, toSR) {
  if (fromSR === toSR) return input;
  const ratio  = fromSR / toSR;
  const outLen = Math.round(input.length / ratio);
  const out    = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx  = i * ratio;
    const lo   = Math.floor(idx);
    const frac = idx - lo;
    const hi   = lo + 1 < input.length ? lo + 1 : lo;
    out[i] = input[lo] + frac * (input[hi] - input[lo]);
  }
  return out;
}
