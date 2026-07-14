# KepKat Mini — Web Video Editor

> 🎬 Video editor berbasis web yang berjalan 100% di browser — tidak ada server, tidak ada upload, privasi terjaga.

[![GitHub Pages](https://img.shields.io/badge/Live-GitHub%20Pages-blue?logo=github)](https://rezamubarock.github.io/kepkatmini)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

## ✨ Fitur

| Fitur | Teknologi |
|---|---|
| 🎬 Real-time preview | **WebGL2** + GLSL Shaders |
| 💬 Auto subtitle AI | **Whisper** via @xenova/transformers (WASM/ONNX) |
| 🖼️ Stiker & Overlay | Canvas drag/resize/rotate |
| 🎵 Audio Visualizer | WebAudio API (5 mode) |
| 🎨 Video Effects | 12 GLSL shader effects |
| 🔀 Transisi | 10 transition shaders |
| 📤 Export HD | **WebCodecs API** + MediaRecorder fallback |
| 🔒 100% Client-side | Tidak ada data yang dikirim ke server |

## 🚀 Cara Pakai

### Online (GitHub Pages)
Buka: **[https://rezamubarock.github.io/kepkatmini](https://rezamubarock.github.io/kepkatmini)**

Recommended browser: **Chrome 113+** atau **Edge 113+** (untuk WebCodecs & WebGL2).

### Local Development
```bash
git clone https://github.com/rezamubarock/kepkatmini.git
cd kepkatmini

# Pakai server lokal (bukan file://, harus HTTP untuk ES Modules)
python -m http.server 8080
# atau
npx serve .
```

Buka `http://localhost:8080`

## 🏗️ Arsitektur

```
kepkatmini/
├── index.html              # SPA Entry Point
├── css/
│   ├── main.css            # Design system (dark theme, tokens)
│   └── components.css      # Semua komponen UI
├── js/
│   ├── app.js              # Main controller
│   ├── engine/
│   │   ├── renderer.js     # WebGL2 compositor + GLSL shaders
│   │   ├── timeline.js     # Multi-track timeline engine
│   │   ├── visualizer.js   # Audio visualizer (5 mode)
│   │   └── exporter.js     # WebCodecs export engine
│   ├── subtitle/
│   │   ├── subtitle.js     # Subtitle manager (SRT/VTT)
│   │   └── whisper-worker.js  # Whisper AI Web Worker
│   ├── overlay/
│   │   └── overlay.js      # Sticker/image overlay manager
│   └── ui/
│       └── timeline-ui.js  # Timeline UI (drag, resize, ruler)
└── .github/
    └── workflows/
        └── deploy.yml      # Auto-deploy ke GitHub Pages
```

## 🎨 Efek Video

- Brightness, Contrast, Saturation
- Blur (Gaussian), Sharpen
- Vignette, Film Grain
- Glitch, Invert
- Color Grading: Cinematic, Warm, Cool

## 🔀 Transisi

- Fade, Crossfade
- Wipe (kiri/kanan), Slide (atas/bawah)
- Zoom In/Out, Spin
- Glitch Transition

## 🎵 Visualizer Mode

1. **Bar** — visualizer bar vertikal klasik
2. **Wave** — gelombang audio
3. **Circle** — visualizer lingkaran
4. **Spectrum** — area spectrum
5. **Particle** — sistem partikel reaktif audio

## 📤 Export

- **WebCodecs API** (hardware-accelerated H.264/VP9) — Chrome 113+
- **MediaRecorder fallback** — semua browser modern
- Format: MP4 (H.264) atau WebM (VP9)
- Resolusi: 480p / 720p / 1080p
- FPS: 24 / 30 / 60

## 🌐 Deployment

### GitHub Pages (Otomatis)
Push ke branch `main` → GitHub Actions otomatis deploy.

Pastikan GitHub Pages diaktifkan:
- Repo Settings → Pages → Source: **GitHub Actions**

### Cloudflare Pages (Mirror)
1. Login ke [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Workers & Pages → Create application → Pages → Connect to Git
3. Pilih repo `kepkatmini`
4. Output directory: `.` (root)
5. Build command: (kosongkan)
6. Deploy!

## 📋 Browser Requirements

| Browser | Minimum | WebCodecs | WebGL2 | WASM |
|---|---|---|---|---|
| Chrome | 113+ | ✅ | ✅ | ✅ |
| Edge | 113+ | ✅ | ✅ | ✅ |
| Firefox | 116+ | ⚠️ partial | ✅ | ✅ |
| Safari | 17+ | ⚠️ partial | ✅ | ✅ |

## 📄 License

MIT License — bebas digunakan, dimodifikasi, dan didistribusikan.

---

Made with ❤️ by [@rezamubarock](https://github.com/rezamubarock)
