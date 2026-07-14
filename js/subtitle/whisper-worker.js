/**
 * KepKat Mini — Whisper Web Worker
 * Runs Whisper via @xenova/transformers in a Web Worker.
 *
 * Communication protocol (postMessage):
 *  → { type: 'transcribe', audioData: Float32Array, lang: 'auto' }
 *  ← { type: 'progress', value: 0-100, text: string }
 *  ← { type: 'result', segments: [{start, end, text}] }
 *  ← { type: 'error', message: string }
 */

// ── Try multiple CDN sources for resilience ──────────────────────────────────
const TRANSFORMERS_CDNS = [
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js',
  'https://unpkg.com/@xenova/transformers@2.17.2/dist/transformers.min.js',
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.6.2/dist/transformers.min.js',
  'https://unpkg.com/@xenova/transformers@2.6.2/dist/transformers.min.js',
];

let pipeline = null;
let env = null;
let initError = null;

function tryLoadTransformers() {
  for (const url of TRANSFORMERS_CDNS) {
    try {
      importScripts(url);
      if (self.transformers) {
        console.log('[WhisperWorker] Loaded transformers from:', url);
        return true;
      }
    } catch (e) {
      console.warn('[WhisperWorker] CDN failed:', url, e.message);
    }
  }
  return false;
}

const loaded = tryLoadTransformers();

if (loaded && self.transformers) {
  try {
    ({ pipeline, env } = self.transformers);
    env.allowLocalModels = false;
    env.useBrowserCache  = true;
    env.backends.onnx.wasm.proxy = false;
  } catch (e) {
    initError = 'Transformers init error: ' + e.message;
    console.error('[WhisperWorker]', initError);
  }
} else {
  initError = 'Gagal memuat library Whisper dari semua CDN. Periksa koneksi internet Anda.';
  console.error('[WhisperWorker]', initError);
}

// ── Model loader (cached after first load) ───────────────────────────────────

let transcriber = null;

async function loadModel(onProgress) {
  if (transcriber) return transcriber;
  if (!pipeline) throw new Error(initError || 'pipeline not available');

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
          onProgress(pct, `Mengunduh model Whisper... ${pct}%`);
        }
        if (data.status === 'ready') {
          onProgress(80, 'Model siap, memproses audio...');
        }
      },
    }
  );

  return transcriber;
}

// ── Message handler ──────────────────────────────────────────────────────────

self.addEventListener('message', async (e) => {
  const { type, audioData, lang = 'auto' } = e.data;
  if (type !== 'transcribe') return;

  // Report init error immediately if library failed to load
  if (initError) {
    self.postMessage({ type: 'error', message: initError });
    return;
  }

  try {
    const notify = (value, text) => self.postMessage({ type: 'progress', value, text });

    const model = await loadModel(notify);
    notify(85, 'Menjalankan pengenalan suara...');

    const result = await model(audioData, {
      language: lang === 'auto' ? undefined : lang,
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      generate_kwargs: { max_new_tokens: 256 },
    });

    notify(100, 'Transkripsi selesai!');

    let segments = [];
    if (result.chunks && result.chunks.length > 0) {
      segments = result.chunks
        .map(c => ({
          start: c.timestamp[0] ?? 0,
          end:   c.timestamp[1] ?? ((c.timestamp[0] ?? 0) + 2),
          text:  c.text.trim(),
        }))
        .filter(s => s.text);
    } else if (result.text) {
      segments = [{ start: 0, end: 10, text: result.text.trim() }];
    }

    self.postMessage({ type: 'result', segments });

  } catch (err) {
    console.error('[WhisperWorker]', err);
    self.postMessage({ type: 'error', message: err.message || 'Gagal memproses audio' });
  }
});

self.postMessage({ type: 'ready' });
