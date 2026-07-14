/**
 * KepKat Mini — Whisper Web Worker
 * Runs Whisper via @xenova/transformers in a Web Worker.
 */

// Construct absolute URL for local transformers.min.js based on worker's location
const workerDir = self.location.href.substring(0, self.location.href.lastIndexOf('/') + 1);
const LOCAL_TRANSFORMERS = workerDir + 'transformers.min.js';

const CDN_FALLBACKS = [
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js',
  'https://unpkg.com/@xenova/transformers@2.17.2/dist/transformers.min.js',
];

let pipeline = null;
let env = null;
let initError = null;
const errorsCollected = [];

function tryLoadTransformers() {
  // 1. Try local copy first (most reliable, same-origin)
  try {
    console.log('[WhisperWorker] Attempting local load from:', LOCAL_TRANSFORMERS);
    importScripts(LOCAL_TRANSFORMERS);
    if (self.transformers) {
      console.log('[WhisperWorker] Loaded transformers from local repo ✅');
      return true;
    } else {
      errorsCollected.push('Local load succeeded but self.transformers is undefined');
    }
  } catch (e) {
    const msg = `Local load failed (${LOCAL_TRANSFORMERS}): ${e.message}`;
    console.warn('[WhisperWorker]', msg);
    errorsCollected.push(msg);
  }

  // 2. Fallback to CDNs
  for (const url of CDN_FALLBACKS) {
    try {
      console.log('[WhisperWorker] Attempting CDN load from:', url);
      importScripts(url);
      if (self.transformers) {
        console.log('[WhisperWorker] Loaded transformers from CDN ✅:', url);
        return true;
      } else {
        errorsCollected.push(`CDN load succeeded but self.transformers is undefined for ${url}`);
      }
    } catch (e) {
      const msg = `CDN load failed for ${url}: ${e.message}`;
      console.warn('[WhisperWorker]', msg);
      errorsCollected.push(msg);
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
    env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/';
  } catch (e) {
    initError = 'Transformers config error: ' + e.message;
    console.error('[WhisperWorker]', initError);
  }
} else {
  initError = 'Gagal memuat library Whisper. Detail Error:\n' + errorsCollected.join('\n');
  console.error('[WhisperWorker]', initError);
}

// ── Model loader ─────────────────────────────────────────────────────────────

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
