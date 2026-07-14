/**
 * KepKat Mini — Client-side Audio Extractor
 * Uses mp4box.js (demuxing) and WebCodecs AudioDecoder (decoding)
 * to extract raw PCM audio from video files without loading the full video into memory.
 */

// Load MP4Box.js from CDN dynamically
function loadMP4Box() {
  return new Promise((resolve, reject) => {
    if (window.MP4Box) return resolve(window.MP4Box);
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js';
    script.onload = () => {
      if (window.MP4Box) {
        resolve(window.MP4Box);
      } else {
        reject(new Error('Gagal menginisialisasi MP4Box dari CDN'));
      }
    };
    script.onerror = () => reject(new Error('Gagal memuat MP4Box dari CDN. Harap periksa koneksi internet Anda.'));
    document.head.appendChild(script);
  });
}

const SAMPLING_FREQUENCIES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350
];

function getAACConfigDescriptor(audioObjectType, sampleRate, channelCount) {
  const refIndex = SAMPLING_FREQUENCIES.indexOf(sampleRate);
  const freqIndex = refIndex !== -1 ? refIndex : 4;
  const byte1 = (audioObjectType << 3) | (freqIndex >> 1);
  const byte2 = ((freqIndex & 1) << 7) | (channelCount << 3);
  return new Uint8Array([byte1, byte2]);
}

export async function extractAudioWebCodecs(file, onProgress) {
  const MP4Box = await loadMP4Box();
  
  return new Promise((resolve, reject) => {
    const mp4boxfile = MP4Box.createFile();
    let audioTrack = null;
    let decoder = null;
    const chunks = [];
    let totalSamples = 0;
    let sampleRate = 44100;
    let isConfigured = false;
    let samplesCount = 0;
    let decodedCount = 0;
    let rejectTimer = null;

    const cleanup = () => {
      if (rejectTimer) clearTimeout(rejectTimer);
    };

    mp4boxfile.onError = (e) => {
      cleanup();
      reject(new Error('MP4Box parser error: ' + e));
    };

    mp4boxfile.onReady = (info) => {
      // Find the first audio track
      audioTrack = info.tracks.find(t => t.type === 'audio');
      if (!audioTrack) {
        cleanup();
        reject(new Error('Tidak ada track audio dalam file video ini.'));
        return;
      }

      sampleRate = audioTrack.audio.sample_rate;
      
      // Setup WebCodecs AudioDecoder
      decoder = new AudioDecoder({
        output: (audioData) => {
          const format = audioData.format;
          const numberOfFrames = audioData.numberOfFrames;
          const channels = audioData.numberOfChannels;
          
          let pcm = new Float32Array(numberOfFrames);
          
          // Extract Left channel (plane 0) and convert to float if necessary
          if (format === 'f32-planar') {
            audioData.copyTo(pcm, { planeIndex: 0 });
          } else if (format === 'f32') {
            const interleaved = new Float32Array(numberOfFrames * channels);
            audioData.copyTo(interleaved, { planeIndex: 0 });
            for (let i = 0; i < numberOfFrames; i++) {
              pcm[i] = interleaved[i * channels];
            }
          } else if (format === 's16-planar') {
            const s16 = new Int16Array(numberOfFrames);
            audioData.copyTo(s16, { planeIndex: 0 });
            for (let i = 0; i < numberOfFrames; i++) {
              pcm[i] = s16[i] / 32768;
            }
          } else if (format === 's16') {
            const interleaved = new Int16Array(numberOfFrames * channels);
            audioData.copyTo(interleaved, { planeIndex: 0 });
            for (let i = 0; i < numberOfFrames; i++) {
              pcm[i] = interleaved[i * channels] / 32768;
            }
          } else {
            // best effort fallback
            const temp = new Float32Array(numberOfFrames);
            try {
              audioData.copyTo(temp, { planeIndex: 0 });
              pcm = temp;
            } catch (err) {
              // Fail silently and use empty/silence buffer to prevent crashes
            }
          }
          
          chunks.push(pcm);
          totalSamples += pcm.length;
          
          decodedCount++;
          if (onProgress && samplesCount > 0) {
            const progress = Math.min(95, 10 + Math.round((decodedCount / samplesCount) * 85));
            onProgress(progress, `Mendecode audio... ${progress}%`);
          }
          
          audioData.close();
        },
        error: (e) => {
          cleanup();
          reject(new Error('AudioDecoder error: ' + e.message));
        }
      });

      // Configure decoder
      try {
        let description = audioTrack.description;
        if (!description && audioTrack.codec.startsWith('mp4a')) {
          description = getAACConfigDescriptor(2, sampleRate, audioTrack.audio.channel_count);
        }
        decoder.configure({
          codec: audioTrack.codec.startsWith('mp4a') ? 'mp4a.40.2' : audioTrack.codec, // Map generic AAC to AAC LC
          numberOfChannels: audioTrack.audio.channel_count,
          sampleRate: sampleRate,
          description: description
        });
        isConfigured = true;
      } catch (err) {
        cleanup();
        reject(new Error('Decoder configuration failed: ' + err.message));
        return;
      }

      mp4boxfile.setExtractionOptions(audioTrack.id);
      mp4boxfile.start();
    };

    mp4boxfile.onSamples = (track_id, ref, samples) => {
      samplesCount += samples.length;
      for (const sample of samples) {
        const chunk = new EncodedAudioChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: (sample.cts * 1000000) / sample.timescale,
          duration: (sample.duration * 1000000) / sample.timescale,
          data: sample.data
        });
        decoder.decode(chunk);
      }
      
      // Free samples from parser memory once they are handed to WebCodecs
      mp4boxfile.releaseUsedSamples(track_id, samples.length);
    };

    // Parse file sequentially in chunks to avoid memory bottlenecks
    (async () => {
      try {
        const chunkSize = 15 * 1024 * 1024; // 15MB chunks
        let offset = 0;
        const fileSize = file.size;

        while (offset < fileSize) {
          const slice = file.slice(offset, offset + chunkSize);
           const buffer = await slice.arrayBuffer();
           buffer.fileStart = offset; // Define fileStart for MP4Box parser!
          
          if (onProgress) {
            const readProgress = Math.min(10, Math.round((offset / fileSize) * 10));
            onProgress(readProgress, `Membaca file video... ${readProgress}%`);
          }

          mp4boxfile.appendBuffer(buffer);
          offset += chunkSize;
        }

        mp4boxfile.flush();
        
        // Wait for WebCodecs decode operations to complete
        if (decoder && isConfigured) {
          await decoder.flush();
          decoder.close();
        }

        cleanup();

        if (totalSamples === 0) {
          reject(new Error('Gagal mengekstrak audio: Data kosong.'));
          return;
        }

        // Merge all PCM chunks into a single Float32Array
        const merged = new Float32Array(totalSamples);
        let writeOffset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, writeOffset);
          writeOffset += chunk.length;
        }

        // Downsample to 16000Hz mono
        if (onProgress) onProgress(98, 'Menyelaraskan sample rate audio...');
        const resampled = resampleBuffer(merged, sampleRate, 16000);
        resolve(resampled);

      } catch (err) {
        cleanup();
        reject(err);
      }
    })();

    // Safety timeout of 10 minutes
    rejectTimer = setTimeout(() => {
      cleanup();
      reject(new Error('Proses ekstraksi timeout.'));
    }, 600000);
  });
}

function resampleBuffer(inputBuffer, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) return inputBuffer;
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(inputBuffer.length / ratio);
  const result = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const nextIndex = i * ratio;
    const index = Math.floor(nextIndex);
    const interpolation = nextIndex - index;
    const nextValue = index + 1 < inputBuffer.length ? inputBuffer[index + 1] : inputBuffer[index];
    result[i] = inputBuffer[index] + interpolation * (nextValue - inputBuffer[index]);
  }
  return result;
}
