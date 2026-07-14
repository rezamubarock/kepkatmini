/**
 * KepKat Mini — Whisper Web Worker
 * Runs Whisper via @xenova/transformers in a Web Worker
 * so it doesn't block the main UI thread.
 *
 * Communication protocol (postMessage):
 *  → { type: 'transcribe', audioData: Float32Array, lang: 'auto' }
 *  ← { type: 'progress', value: 0-100, text: string }
 *  ← { type: 'result', segments: [{start, end, text}] }
 *  ← { type: 'error', message: string }
 */

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/dist/transformers.min.js';

// Configure transformers.js
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.proxy = false;

let transcriber = null;

/** Load model (cached after first load) */
async function loadModel(onProgress) {
  if (transcriber) return transcriber;

  onProgress(5, 'Memuat model Whisper Tiny...');

  transcriber = await pipeline(
    'automatic-speech-recognition',
    'Xenova/whisper-tiny',
    {
      revision: 'main',
      progress_callback: (data) => {
        if (data.status === 'downloading') {
          const pct = data.loaded && data.total
            ? Math.round((data.loaded / data.total) * 70) + 5
            : 10;
          onProgress(pct, `Mengunduh model... ${pct}%`);
        }
        if (data.status === 'ready') {
          onProgress(80, 'Model siap, memproses audio...');
        }
      }
    }
  );

  return transcriber;
}

self.addEventListener('message', async (e) => {
  const { type, audioData, lang = 'auto' } = e.data;

  if (type !== 'transcribe') return;

  try {
    const notify = (value, text) => {
      self.postMessage({ type: 'progress', value, text });
    };

    // Load model
    const model = await loadModel(notify);

    notify(85, 'Menjalankan pengenalan suara...');

    // Run transcription
    const result = await model(audioData, {
      language: lang === 'auto' ? undefined : lang,
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      generate_kwargs: {
        max_new_tokens: 256,
      },
    });

    notify(100, 'Selesai!');

    // Transform output to segments format
    let segments = [];
    if (result.chunks && result.chunks.length > 0) {
      segments = result.chunks.map(chunk => ({
        start: chunk.timestamp[0] || 0,
        end:   chunk.timestamp[1] || (chunk.timestamp[0] + 2) || 2,
        text:  chunk.text.trim(),
      })).filter(s => s.text);
    } else if (result.text) {
      // Fallback: single segment
      segments = [{ start: 0, end: 10, text: result.text.trim() }];
    }

    self.postMessage({ type: 'result', segments });

  } catch (err) {
    console.error('[WhisperWorker]', err);
    self.postMessage({ type: 'error', message: err.message || 'Gagal memproses audio' });
  }
});

// Notify ready
self.postMessage({ type: 'ready' });
