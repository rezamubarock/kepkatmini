/**
 * KepKat Mini — Client-side Audio Extractor
 *
 * Strategy:
 *  1. Create a hidden <video> element with the file's blob URL.
 *  2. Tap the audio stream via AudioContext.createMediaElementSource().
 *  3. Use a ScriptProcessorNode to collect raw PCM (Float32) samples
 *     as the video plays at 16× speed.
 *  4. Merge all captured samples and downsample to 16 kHz mono for Whisper.
 *
 * This approach:
 *  - Works with ANY format the browser's native video/audio decoder supports
 *    (MP4/H.264+AAC, WebM/VP9+Opus, MKV, MOV, etc.)
 *  - Streams from disk — no full-file RAM load → no OOM crash on 1-hour videos
 *  - Is entirely client-side, hardware-accelerated, no CDN dependencies
 */

const TARGET_SR = 16000; // Whisper requires 16 kHz mono

/**
 * Extract audio from a File or Blob as a 16 kHz mono Float32Array.
 * @param {File|Blob} file
 * @param {Function} onProgress  (percent 0-100, statusText) => void
 * @returns {Promise<Float32Array>}
 */
export async function extractAudioWebCodecs(file, onProgress) {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(file);

    // Hidden video element — browser handles all demuxing/decoding
    const video = document.createElement('video');
    video.style.display = 'none';
    video.muted = false;       // must NOT be muted for media element source to work
    video.playbackRate = 16;   // fast-forward to reduce wall-clock capture time
    video.crossOrigin = 'anonymous';
    document.body.appendChild(video);

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_SR });
    const bufferSize = 4096;
    const source = audioCtx.createMediaElementSource(video);

    // ScriptProcessorNode captures decoded PCM frames
    const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    const pcmChunks = [];
    let totalSamples = 0;

    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(inputData.length);
      copy.set(inputData);
      pcmChunks.push(copy);
      totalSamples += copy.length;
    };

    // Route: video → processor → destination (silent output)
    source.connect(processor);
    processor.connect(audioCtx.destination);

    const cleanup = () => {
      try { processor.disconnect(); } catch (_) {}
      try { source.disconnect(); } catch (_) {}
      try { audioCtx.close(); } catch (_) {}
      try { video.pause(); video.src = ''; } catch (_) {}
      try { document.body.removeChild(video); } catch (_) {}
      URL.revokeObjectURL(blobUrl);
    };

    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration;
      if (!isFinite(duration) || duration === 0) {
        cleanup();
        reject(new Error('Tidak dapat membaca durasi video.'));
        return;
      }
      if (onProgress) onProgress(2, 'Memulai ekstraksi audio...');

      // Resumed AudioContext if needed (browser autoplay policy)
      if (audioCtx.state === 'suspended') audioCtx.resume();

      video.play().catch(err => {
        cleanup();
        reject(new Error('Gagal memainkan video untuk ekstraksi audio: ' + err.message));
      });
    });

    video.addEventListener('timeupdate', () => {
      if (!isFinite(video.duration) || video.duration === 0) return;
      const pct = Math.min(95, Math.round((video.currentTime / video.duration) * 93) + 2);
      if (onProgress) onProgress(pct, `Mengekstrak audio... ${pct}%`);
    });

    video.addEventListener('ended', async () => {
      try {
        // Let the processor flush its last buffer
        await new Promise(r => setTimeout(r, 300));
        processor.disconnect();
        source.disconnect();
        await audioCtx.close();

        if (totalSamples === 0) {
          cleanup();
          reject(new Error('Tidak ada data audio yang berhasil diekstrak.'));
          return;
        }

        if (onProgress) onProgress(98, 'Menggabungkan data audio...');

        // Merge all chunks into one Float32Array
        const merged = new Float32Array(totalSamples);
        let offset = 0;
        for (const chunk of pcmChunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        // AudioContext was already created at TARGET_SR so no resampling needed
        if (onProgress) onProgress(100, 'Ekstraksi audio selesai.');
        cleanup();
        resolve(merged);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    video.addEventListener('error', (e) => {
      cleanup();
      const code = video.error ? video.error.code : '?';
      const msg  = video.error ? video.error.message : 'Unknown';
      reject(new Error(`Video tidak dapat dimuat (MediaError ${code}): ${msg}. Format mungkin tidak didukung browser.`));
    });

    video.src = blobUrl;
    video.load();
  });
}
