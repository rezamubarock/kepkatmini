/**
 * KepKat Mini — Client-side Audio Extractor
 *
 * Strategy:
 *  1. Create a hidden <video> element pointed at the media source (blob URL or File).
 *  2. Tap the audio stream via AudioContext.createMediaElementSource().
 *  3. Use a ScriptProcessorNode to collect raw PCM (Float32) samples
 *     as the video plays at 16× speed.
 *  4. Merge all captured samples — AudioContext is created at 16 kHz
 *     so no resampling needed for Whisper.
 *
 * This approach:
 *  - Works with ANY format the browser's native decoder supports (MP4, WebM, MKV, MOV…)
 *  - Streams from disk — no full-file RAM load → no OOM crash on 1-hour videos
 *  - Entirely client-side, hardware-accelerated, zero CDN dependencies
 *  - Accepts a File/Blob OR a blob: URL string directly — no fetch() needed
 */

const TARGET_SR = 16000; // Whisper requires 16 kHz mono

/**
 * Extract audio from a File, Blob, or blob: URL string as a 16 kHz mono Float32Array.
 * @param {File|Blob|string} source  File, Blob, or blob: URL string
 * @param {Function} onProgress     (percent 0-100, statusText) => void
 * @returns {Promise<Float32Array>}
 */
export function extractAudioWebCodecs(source, onProgress) {
  return new Promise((resolve, reject) => {
    // Resolve the URL to use as video.src
    let videoSrc;
    let ownedBlobUrl = null; // track whether WE created the blob URL (must revoke)

    if (typeof source === 'string') {
      // Caller already has a URL (blob: or otherwise) — use it directly
      videoSrc = source;
    } else if (source instanceof Blob || source instanceof File) {
      ownedBlobUrl = URL.createObjectURL(source);
      videoSrc = ownedBlobUrl;
    } else {
      reject(new Error('extractAudioWebCodecs: sumber tidak valid (bukan File, Blob, atau URL).'));
      return;
    }

    // Hidden video element — browser handles all demuxing/decoding natively
    const video = document.createElement('video');
    video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;';
    video.muted = false;       // must NOT be muted for createMediaElementSource to work
    video.playbackRate = 16;   // fast-forward to reduce wall-clock capture time
    video.preload = 'auto';
    document.body.appendChild(video);

    let audioCtx = null;
    let source_node = null;
    let processor = null;
    const pcmChunks = [];
    let totalSamples = 0;
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { if (processor) processor.disconnect(); } catch (_) {}
      try { if (source_node) source_node.disconnect(); } catch (_) {}
      try { if (audioCtx) audioCtx.close(); } catch (_) {}
      try { video.pause(); video.src = ''; } catch (_) {}
      try { document.body.removeChild(video); } catch (_) {}
      if (ownedBlobUrl) URL.revokeObjectURL(ownedBlobUrl);
    };

    const fail = (msg) => { cleanup(); reject(new Error(msg)); };

    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        fail('Tidak dapat membaca durasi video. Format mungkin tidak didukung.');
        return;
      }

      try {
        audioCtx   = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_SR });
        source_node = audioCtx.createMediaElementSource(video);
        processor  = audioCtx.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          const copy  = new Float32Array(input.length);
          copy.set(input);
          pcmChunks.push(copy);
          totalSamples += copy.length;
        };

        // Route: video → processor → destination (no speakers — silent output)
        source_node.connect(processor);
        processor.connect(audioCtx.destination);
      } catch (err) {
        fail('Gagal membuat audio context: ' + err.message);
        return;
      }

      if (onProgress) onProgress(2, 'Memulai ekstraksi audio...');

      // Resume audio context if browser policy suspended it
      const resume = () => audioCtx && audioCtx.state === 'suspended' ? audioCtx.resume() : Promise.resolve();
      resume().then(() => {
        video.play().catch(err => fail('Gagal memainkan video: ' + err.message));
      });
    });

    video.addEventListener('timeupdate', () => {
      if (!isFinite(video.duration) || video.duration <= 0) return;
      const pct = Math.min(95, Math.round((video.currentTime / video.duration) * 93) + 2);
      if (onProgress) onProgress(pct, `Mengekstrak audio... ${pct}%`);
    });

    video.addEventListener('ended', () => {
      // Give the ScriptProcessorNode time to flush its last buffer
      setTimeout(() => {
        try {
          if (processor) processor.disconnect();
          if (source_node) source_node.disconnect();
        } catch (_) {}

        if (totalSamples === 0) {
          fail('Tidak ada data audio yang berhasil diekstrak dari video ini.');
          return;
        }

        if (onProgress) onProgress(98, 'Menggabungkan data audio...');

        // Merge all PCM chunks into one Float32Array
        const merged = new Float32Array(totalSamples);
        let offset = 0;
        for (const chunk of pcmChunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        if (onProgress) onProgress(100, 'Ekstraksi audio selesai.');
        cleanup();
        resolve(merged);
      }, 500);
    });

    video.addEventListener('error', () => {
      const code = video.error ? video.error.code : '?';
      const msg  = video.error ? video.error.message : 'unknown';
      fail(`Video tidak dapat dimuat (MediaError ${code}: ${msg}). Format video mungkin tidak didukung browser ini.`);
    });

    video.src = videoSrc;
    video.load();
  });
}
