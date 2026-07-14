/**
 * KepKat Mini — Whisper Web Worker (ES Module version)
 * Runs Whisper via @xenova/transformers.
 */

let pipeline = null;
let env = null;
let initError = null;
const errorsCollected = [];

async function initTransformers() {
  // Use absolute URL constructed from worker's location for the local copy
  const workerDir = self.location.href.substring(0, self.location.href.lastIndexOf('/') + 1);
  const localUrl = workerDir + 'transformers.min.js';

  const targets = [
    { name: 'Local Repo', url: localUrl },
    { name: 'JSDelivr CDN', url: 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js' },
    { name: 'Unpkg CDN', url: 'https://unpkg.com/@xenova/transformers@2.17.2/dist/transformers.min.js' }
  ];

  for (const target of targets) {
    try {
      console.log(`[WhisperWorker] Attempting import from ${target.name}:`, target.url);
      const module = await import(target.url);
      
      // Some webpack/UMD builds export named bindings, others set globals
      const activePipeline = module?.pipeline || self.transformers?.pipeline;
      const activeEnv = module?.env || self.transformers?.env;

      if (activePipeline) {
        pipeline = activePipeline;
        env = activeEnv;
        console.log(`[WhisperWorker] Loaded successfully from ${target.name} ✅`);
        return true;
      } else {
        errorsCollected.push(`${target.name}: Import succeeded but pipeline is not exported`);
      }
    } catch (e) {
      const msg = `${target.name} failed: ${e.message}`;
      console.warn('[WhisperWorker]', msg);
      errorsCollected.push(msg);
    }
  }
  return false;
}

// Top-level await is fully supported in ES Module Workers
const loaded = await initTransformers();

if (loaded && pipeline) {
  try {
    env.allowLocalModels = false;
    env.useBrowserCache  = true;
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/';
  } catch (e) {
    initError = 'Config error: ' + e.message;
    console.error('[WhisperWorker]', initError);
  }
} else {
  initError = 'Gagal memuat library Whisper.\nDetail Error:\n' + errorsCollected.join('\n');
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
