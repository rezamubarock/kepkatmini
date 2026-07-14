/**
 * KepKat Mini — WebGL2 Renderer
 * GPU-accelerated compositor for real-time video preview
 */

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.programs = {};
    this.textures = new Map();
    this.framebuffer = null;
    this.offscreenTex = null;
    this.width = 1920;
    this.height = 1080;
    this._init();
  }

  _init() {
    const opts = { alpha: false, premultipliedAlpha: false, antialias: false };
    this.gl = this.canvas.getContext('webgl2', opts) 
           || this.canvas.getContext('webgl', opts);
    if (!this.gl) {
      console.warn('WebGL not available, falling back to 2D Canvas');
      this.ctx2d = this.canvas.getContext('2d');
      return;
    }
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Compile shader programs
    this.programs.base       = this._createProgram(VERT_SHADER, FRAG_BASE);
    this.programs.brightness = this._createProgram(VERT_SHADER, FRAG_BRIGHTNESS);
    this.programs.contrast   = this._createProgram(VERT_SHADER, FRAG_CONTRAST);
    this.programs.saturation = this._createProgram(VERT_SHADER, FRAG_SATURATION);
    this.programs.blur       = this._createProgram(VERT_SHADER, FRAG_BLUR);
    this.programs.vignette   = this._createProgram(VERT_SHADER, FRAG_VIGNETTE);
    this.programs.grain      = this._createProgram(VERT_SHADER, FRAG_GRAIN);
    this.programs.sharpen    = this._createProgram(VERT_SHADER, FRAG_SHARPEN);
    this.programs.glitch     = this._createProgram(VERT_SHADER, FRAG_GLITCH);
    this.programs.cinematic  = this._createProgram(VERT_SHADER, FRAG_CINEMATIC);
    this.programs.warm       = this._createProgram(VERT_SHADER, FRAG_WARM);
    this.programs.cool       = this._createProgram(VERT_SHADER, FRAG_COOL);
    this.programs.invert     = this._createProgram(VERT_SHADER, FRAG_INVERT);
    // Transitions
    this.programs.fade       = this._createProgram(VERT_SHADER, FRAG_TRANS_FADE);
    this.programs.crossfade  = this._createProgram(VERT_SHADER, FRAG_TRANS_CROSSFADE);
    this.programs['wipe-left'] = this._createProgram(VERT_SHADER, FRAG_TRANS_WIPE_LEFT);
    this.programs['wipe-right'] = this._createProgram(VERT_SHADER, FRAG_TRANS_WIPE_RIGHT);
    this.programs['zoom-in']  = this._createProgram(VERT_SHADER, FRAG_TRANS_ZOOM_IN);
    this.programs['zoom-out'] = this._createProgram(VERT_SHADER, FRAG_TRANS_ZOOM_OUT);
    this.programs.glitch_trans = this._createProgram(VERT_SHADER, FRAG_TRANS_GLITCH);
    this.programs['slide-up'] = this._createProgram(VERT_SHADER, FRAG_TRANS_SLIDE_UP);
    this.programs['slide-down']= this._createProgram(VERT_SHADER, FRAG_TRANS_SLIDE_DOWN);
    this.programs.spin        = this._createProgram(VERT_SHADER, FRAG_TRANS_SPIN);

    // Full-screen quad
    this._quad = this._createQuad();

    // Offscreen framebuffer for ping-pong effects
    this._setupFramebuffer();
  }

  _createProgram(vertSrc, fragSrc) {
    const gl = this.gl;
    const vert = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vert, vertSrc);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
      console.error('Vert shader error:', gl.getShaderInfoLog(vert));
    }
    const frag = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(frag, fragSrc);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
      console.error('Frag shader error:', gl.getShaderInfoLog(frag));
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  _createQuad() {
    const gl = this.gl;
    const vao = gl.createVertexArray ? gl.createVertexArray() : null;
    if (vao) gl.bindVertexArray(vao);

    const positions = new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const enableAttribs = (prog) => {
      const posLoc = gl.getAttribLocation(prog, 'a_position');
      const uvLoc  = gl.getAttribLocation(prog, 'a_uv');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
      if (uvLoc >= 0) {
        gl.enableVertexAttribArray(uvLoc);
        gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);
      }
    };

    if (vao) gl.bindVertexArray(null);
    return { vao, buf, enableAttribs };
  }

  _setupFramebuffer() {
    const gl = this.gl;
    if (!gl) return;
    this.framebuffer = gl.createFramebuffer();
    this.offscreenTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.offscreenTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.offscreenTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Create / update a texture from a video, canvas, or image element */
  uploadTexture(id, source) {
    const gl = this.gl;
    if (!gl) return null;
    let tex = this.textures.get(id);
    if (!tex) {
      tex = gl.createTexture();
      this.textures.set(id, tex);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  deleteTexture(id) {
    const gl = this.gl;
    if (!gl) return;
    const tex = this.textures.get(id);
    if (tex) { gl.deleteTexture(tex); this.textures.delete(id); }
  }

  /**
   * Main render function — called every animation frame
   * @param {Object} state - { clips, overlays, subtitleText, subtitleStyle, visualizerData, visualizerSettings, time }
   */
  render(state) {
    if (!this.gl) {
      this._render2D(state);
      return;
    }
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const { clips, overlays, subtitleText, subtitleStyle, visualizerData, visualizerSettings, time } = state;

    // 1. Draw each video/image clip with effects
    for (const clip of clips) {
      if (!clip.texture) continue;
      this._drawClipWithEffects(clip, time);
    }

    // 2. Draw overlays (stickers/images) on top
    if (overlays && overlays.length > 0) {
      for (const overlay of overlays) {
        if (overlay.texture) this._drawOverlay(overlay);
      }
    }

    // 3. Draw audio visualizer
    if (visualizerData && visualizerSettings && visualizerSettings.enabled) {
      this._drawVisualizerGL(visualizerData, visualizerSettings, time);
    }

    // 4. Draw subtitle text (via 2D Canvas overlay, then upload as texture)
    if (subtitleText) {
      this._drawSubtitle(subtitleText, subtitleStyle);
    }
  }

  _drawClipWithEffects(clip, time) {
    const gl = this.gl;
    const effects = clip.effects || {};

    // Determine shader program based on primary effect
    let progName = 'base';
    const effectNames = Object.keys(effects).filter(k => effects[k]?.enabled);
    if (effectNames.length > 0) progName = effectNames[0];

    // Handle transition
    if (clip.transition && clip.transitionProgress !== undefined) {
      this._drawTransition(clip, time);
      return;
    }

    const prog = this.programs[progName] || this.programs.base;
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._quad.buf);
    this._quad.enableAttribs(prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, clip.texture);
    const uTex = gl.getUniformLocation(prog, 'u_texture');
    if (uTex) gl.uniform1i(uTex, 0);

    // Set transform (position, scale, rotation, opacity)
    const uTransform = gl.getUniformLocation(prog, 'u_transform');
    if (uTransform) {
      const mat = this._buildMatrix(clip.x||0, clip.y||0, clip.scale||1, clip.rotation||0);
      gl.uniformMatrix3fv(uTransform, false, mat);
    }
    const uOpacity = gl.getUniformLocation(prog, 'u_opacity');
    if (uOpacity) gl.uniform1f(uOpacity, clip.opacity !== undefined ? clip.opacity : 1.0);

    // Effect-specific uniforms
    const params = effects[progName] || {};
    this._setEffectUniforms(prog, progName, params, time);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _setEffectUniforms(prog, name, params, time) {
    const gl = this.gl;
    const loc = (n) => gl.getUniformLocation(prog, n);
    const f1 = (n, v) => { const l = loc(n); if (l !== null) gl.uniform1f(l, v); };
    const f2 = (n, a, b) => { const l = loc(n); if (l !== null) gl.uniform2f(l, a, b); };
    
    switch (name) {
      case 'brightness': f1('u_brightness', params.value ?? 0.0); break;
      case 'contrast':   f1('u_contrast',   params.value ?? 1.0); break;
      case 'saturation': f1('u_saturation', params.value ?? 1.0); break;
      case 'blur':       f1('u_blurRadius', params.value ?? 2.0);
                         f2('u_resolution', this.canvas.width, this.canvas.height); break;
      case 'vignette':   f1('u_vignStrength', params.value ?? 0.5); break;
      case 'grain':      f1('u_grainAmount', params.value ?? 0.1); f1('u_time', time); break;
      case 'sharpen':    f1('u_sharpenAmount', params.value ?? 0.5);
                         f2('u_resolution', this.canvas.width, this.canvas.height); break;
      case 'glitch':     f1('u_glitchTime', time); f1('u_glitchStrength', params.value ?? 0.3); break;
      case 'invert':     break;
      case 'cinematic':  f1('u_lut_strength', params.value ?? 1.0); break;
      case 'warm':       f1('u_warmAmount', params.value ?? 0.5); break;
      case 'cool':       f1('u_coolAmount', params.value ?? 0.5); break;
    }
  }

  _drawTransition(clip, time) {
    const gl = this.gl;
    const prog = this.programs[clip.transition] || this.programs.fade;
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._quad.buf);
    this._quad.enableAttribs(prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, clip.texture);
    const uTex = gl.getUniformLocation(prog, 'u_texture');
    if (uTex) gl.uniform1i(uTex, 0);

    if (clip.nextTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, clip.nextTexture);
      const uTex2 = gl.getUniformLocation(prog, 'u_texture2');
      if (uTex2) gl.uniform1i(uTex2, 1);
    }

    const uProgress = gl.getUniformLocation(prog, 'u_progress');
    if (uProgress) gl.uniform1f(uProgress, clip.transitionProgress);
    const uTime = gl.getUniformLocation(prog, 'u_time');
    if (uTime) gl.uniform1f(uTime, time);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _drawOverlay(overlay) {
    const gl = this.gl;
    const prog = this.programs.base;
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._quad.buf);
    this._quad.enableAttribs(prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, overlay.texture);
    const uTex = gl.getUniformLocation(prog, 'u_texture');
    if (uTex) gl.uniform1i(uTex, 0);

    const uTransform = gl.getUniformLocation(prog, 'u_transform');
    if (uTransform) {
      // Convert overlay position (0-1 space) to NDC
      const x = (overlay.x / this.canvas.width) * 2 - 1;
      const y = 1 - (overlay.y / this.canvas.height) * 2;
      const sx = (overlay.width / this.canvas.width);
      const sy = (overlay.height / this.canvas.height);
      const mat = this._buildMatrix(x, y, 1, overlay.rotation || 0, sx, sy);
      gl.uniformMatrix3fv(uTransform, false, mat);
    }

    const uOpacity = gl.getUniformLocation(prog, 'u_opacity');
    if (uOpacity) gl.uniform1f(uOpacity, overlay.opacity !== undefined ? overlay.opacity : 1.0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _drawSubtitle(text, style) {
    if (!this._subCanvas) {
      this._subCanvas = document.createElement('canvas');
      this._subCanvas.width  = this.canvas.width;
      this._subCanvas.height = this.canvas.height;
      this._subCtx = this._subCanvas.getContext('2d');
    }
    const ctx = this._subCtx;
    ctx.clearRect(0, 0, this._subCanvas.width, this._subCanvas.height);

    const fontSize = style.size || 48;
    const font = style.font || 'Inter';
    const color = style.color || '#ffffff';
    const bgColor = style.bgColor || '#000000';
    const bgAlpha = style.bgAlpha !== undefined ? style.bgAlpha / 100 : 0.6;
    const position = style.position || 'bottom';

    ctx.font = `bold ${fontSize}px "${font}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lines = text.split('\n');
    const lineH = fontSize * 1.4;
    const totalH = lines.length * lineH;
    const canW = this._subCanvas.width;
    const canH = this._subCanvas.height;

    let baseY;
    if (position === 'bottom') baseY = canH - totalH / 2 - 40;
    else if (position === 'top') baseY = totalH / 2 + 40;
    else baseY = canH / 2;

    lines.forEach((line, i) => {
      const metrics = ctx.measureText(line);
      const tw = metrics.width;
      const tx = canW / 2;
      const ty = baseY + (i - (lines.length - 1) / 2) * lineH;

      // Background box
      if (bgAlpha > 0) {
        ctx.fillStyle = `rgba(${parseInt(bgColor.slice(1,3),16)},${parseInt(bgColor.slice(3,5),16)},${parseInt(bgColor.slice(5,7),16)},${bgAlpha})`;
        ctx.fillRect(tx - tw / 2 - 12, ty - fontSize / 2 - 4, tw + 24, fontSize + 8);
      }

      // Text stroke
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(line, tx, ty);
      // Text fill
      ctx.fillStyle = color;
      ctx.fillText(line, tx, ty);
    });

    // Upload subtitle canvas as texture
    const gl = this.gl;
    if (!this._subTex) this._subTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._subTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLIED_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._subCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Draw full-screen overlay
    const prog = this.programs.base;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quad.buf);
    this._quad.enableAttribs(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._subTex);
    const uTex = gl.getUniformLocation(prog, 'u_texture');
    if (uTex) gl.uniform1i(uTex, 0);
    const uTransform = gl.getUniformLocation(prog, 'u_transform');
    if (uTransform) gl.uniformMatrix3fv(uTransform, false, [1,0,0, 0,1,0, 0,0,1]);
    const uOpacity = gl.getUniformLocation(prog, 'u_opacity');
    if (uOpacity) gl.uniform1f(uOpacity, 1.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _drawVisualizerGL(data, settings, time) {
    // Delegate to a 2D canvas overlay for visualizer drawing
    // (WebGL visualizer is an enhancement — see visualizer.js for canvas approach)
  }

  _buildMatrix(tx, ty, scale, rot, sx = 1, sy = 1) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [
      c * scale * sx,  s * scale * sy, 0,
     -s * scale * sx,  c * scale * sy, 0,
      tx, ty, 1
    ];
  }

  /** Fallback 2D Canvas renderer (when WebGL is not available) */
  _render2D(state) {
    const ctx = this.ctx2d;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    for (const clip of state.clips || []) {
      if (clip.videoElement && clip.videoElement.readyState >= 2) {
        ctx.globalAlpha = clip.opacity !== undefined ? clip.opacity : 1;
        ctx.drawImage(clip.videoElement, 0, 0, w, h);
        ctx.globalAlpha = 1;
      } else if (clip.imageElement) {
        ctx.globalAlpha = clip.opacity !== undefined ? clip.opacity : 1;
        ctx.drawImage(clip.imageElement, 0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    }

    if (state.subtitleText) {
      this._draw2DSubtitle(ctx, state.subtitleText, state.subtitleStyle, w, h);
    }
  }

  _draw2DSubtitle(ctx, text, style, w, h) {
    const fontSize = style?.size || 48;
    ctx.font = `bold ${fontSize}px "${style?.font || 'Inter'}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = style?.color || '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(text, w / 2, h - 40);
    ctx.fillText(text, w / 2, h - 40);
  }

  resize(w, h) {
    this.canvas.width  = w;
    this.canvas.height = h;
    this.width = w; this.height = h;
    this._setupFramebuffer();
  }
}

/* ===================== GLSL SHADERS ===================== */

const VERT_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
uniform mat3 u_transform;
out vec2 v_uv;
void main() {
  vec3 pos = u_transform * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_uv = a_uv;
}`;

const FRAG_BASE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_texture, v_uv);
  fragColor = vec4(c.rgb, c.a * u_opacity);
}`;

const FRAG_BRIGHTNESS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_brightness;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_texture, v_uv);
  fragColor = vec4(clamp(c.rgb + u_brightness, 0.0, 1.0), c.a * u_opacity);
}`;

const FRAG_CONTRAST = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_contrast;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec3 rgb = (c.rgb - 0.5) * u_contrast + 0.5;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a * u_opacity);
}`;

const FRAG_SATURATION = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_saturation;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_texture, v_uv);
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 gray = vec3(lum);
  fragColor = vec4(mix(gray, c.rgb, u_saturation), c.a * u_opacity);
}`;

const FRAG_BLUR = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_blurRadius;
uniform vec2 u_resolution;
out vec4 fragColor;
void main() {
  vec2 texel = 1.0 / u_resolution;
  vec4 color = vec4(0.0);
  float total = 0.0;
  float r = u_blurRadius;
  for (float x = -r; x <= r; x += 1.0) {
    for (float y = -r; y <= r; y += 1.0) {
      float w = exp(-(x*x + y*y) / (2.0 * r * r));
      color += texture(u_texture, v_uv + vec2(x, y) * texel) * w;
      total += w;
    }
  }
  fragColor = vec4((color / total).rgb, (color / total).a * u_opacity);
}`;

const FRAG_VIGNETTE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_vignStrength;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec2 uv = v_uv * 2.0 - 1.0;
  float vign = 1.0 - dot(uv, uv) * u_vignStrength;
  fragColor = vec4(c.rgb * vign, c.a * u_opacity);
}`;

const FRAG_GRAIN = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_grainAmount;
uniform float u_time;
out vec4 fragColor;
float rand(vec2 co) {
  return fract(sin(dot(co.xy + u_time * 0.001, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec4 c = texture(u_texture, v_uv);
  float grain = rand(v_uv) * 2.0 - 1.0;
  fragColor = vec4(clamp(c.rgb + grain * u_grainAmount, 0.0, 1.0), c.a * u_opacity);
}`;

const FRAG_SHARPEN = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_sharpenAmount;
uniform vec2 u_resolution;
out vec4 fragColor;
void main() {
  vec2 t = 1.0 / u_resolution;
  vec4 c  = texture(u_texture, v_uv);
  vec4 n  = texture(u_texture, v_uv + vec2(0, t.y));
  vec4 s  = texture(u_texture, v_uv - vec2(0, t.y));
  vec4 e  = texture(u_texture, v_uv + vec2(t.x, 0));
  vec4 w  = texture(u_texture, v_uv - vec2(t.x, 0));
  vec4 sharp = c * (1.0 + 4.0 * u_sharpenAmount) - (n + s + e + w) * u_sharpenAmount;
  fragColor = vec4(clamp(sharp.rgb, 0.0, 1.0), c.a * u_opacity);
}`;

const FRAG_GLITCH = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_glitchTime;
uniform float u_glitchStrength;
out vec4 fragColor;
float rand(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 uv = v_uv;
  float s = u_glitchStrength;
  float lineNoise = rand(floor(uv.y * 20.0) + u_glitchTime) * 2.0 - 1.0;
  uv.x += lineNoise * s * 0.04 * step(0.95, rand(u_glitchTime + floor(uv.y * 10.0)));
  vec4 r = texture(u_texture, uv + vec2(s * 0.01, 0));
  vec4 g = texture(u_texture, uv);
  vec4 b = texture(u_texture, uv - vec2(s * 0.01, 0));
  fragColor = vec4(r.r, g.g, b.b, g.a * u_opacity);
}`;

const FRAG_CINEMATIC = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_lut_strength;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_texture, v_uv);
  // Simple cinematic: desaturate shadows, warm mids, crushed blacks
  float lum = dot(c.rgb, vec3(0.3, 0.59, 0.11));
  vec3 warm = vec3(1.05, 0.95, 0.88);
  vec3 color = mix(c.rgb, c.rgb * warm, lum * u_lut_strength);
  color = pow(color, vec3(1.05)); // slight gamma
  color.r = mix(c.r, color.r, u_lut_strength);
  fragColor = vec4(clamp(color, 0.0, 1.0), c.a * u_opacity);
}`;

const FRAG_WARM = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_warmAmount;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec3 warm = c.rgb + vec3(u_warmAmount * 0.15, u_warmAmount * 0.05, -u_warmAmount * 0.1);
  fragColor = vec4(clamp(warm, 0.0, 1.0), c.a * u_opacity);
}`;

const FRAG_COOL = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_coolAmount;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec3 cool = c.rgb + vec3(-u_coolAmount * 0.1, u_coolAmount * 0.02, u_coolAmount * 0.15);
  fragColor = vec4(clamp(cool, 0.0, 1.0), c.a * u_opacity);
}`;

const FRAG_INVERT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_texture, v_uv);
  fragColor = vec4(1.0 - c.rgb, c.a * u_opacity);
}`;

/* --- TRANSITION SHADERS --- */
const FRAG_TRANS_FADE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform sampler2D u_texture2;
uniform float u_progress;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec4 a = texture(u_texture, v_uv);
  vec4 b = texture(u_texture2, v_uv);
  fragColor = mix(a, b, u_progress);
}`;

const FRAG_TRANS_CROSSFADE = FRAG_TRANS_FADE;

const FRAG_TRANS_WIPE_LEFT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform sampler2D u_texture2;
uniform float u_progress;
out vec4 fragColor;
void main() {
  float edge = smoothstep(u_progress - 0.05, u_progress + 0.05, v_uv.x);
  vec4 a = texture(u_texture, v_uv);
  vec4 b = texture(u_texture2, v_uv);
  fragColor = mix(a, b, edge);
}`;

const FRAG_TRANS_WIPE_RIGHT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform sampler2D u_texture2;
uniform float u_progress;
out vec4 fragColor;
void main() {
  float edge = smoothstep(u_progress - 0.05, u_progress + 0.05, 1.0 - v_uv.x);
  vec4 a = texture(u_texture, v_uv);
  vec4 b = texture(u_texture2, v_uv);
  fragColor = mix(a, b, edge);
}`;

const FRAG_TRANS_ZOOM_IN = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform sampler2D u_texture2;
uniform float u_progress;
out vec4 fragColor;
void main() {
  vec2 center = vec2(0.5);
  float s = 1.0 + u_progress * 0.4;
  vec2 uv2 = (v_uv - center) / s + center;
  bool inBounds = uv2.x >= 0.0 && uv2.x <= 1.0 && uv2.y >= 0.0 && uv2.y <= 1.0;
  vec4 a = inBounds ? texture(u_texture, uv2) : vec4(0);
  vec4 b = texture(u_texture2, v_uv);
  fragColor = mix(a, b, smoothstep(0.0, 1.0, u_progress));
}`;

const FRAG_TRANS_ZOOM_OUT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform sampler2D u_texture2;
uniform float u_progress;
out vec4 fragColor;
void main() {
  vec2 center = vec2(0.5);
  float s = 1.0 - u_progress * 0.3 + 0.01;
  vec2 uv2 = (v_uv - center) / s + center;
  bool inBounds = uv2.x >= 0.0 && uv2.x <= 1.0 && uv2.y >= 0.0 && uv2.y <= 1.0;
  vec4 a = texture(u_texture, v_uv);
  vec4 b = inBounds ? texture(u_texture2, uv2) : vec4(0);
  fragColor = mix(a, b, smoothstep(0.0, 1.0, u_progress));
}`;

const FRAG_TRANS_GLITCH = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform sampler2D u_texture2;
uniform float u_progress;
uniform float u_time;
out vec4 fragColor;
float rand(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  vec2 uv = v_uv;
  float g = sin(u_time * 20.0) * 0.5 + 0.5;
  uv.x += (rand(floor(uv.y * 30.0) + u_time) * 2.0 - 1.0) * 0.06 * g * u_progress;
  vec4 a = texture(u_texture, uv);
  vec4 b = texture(u_texture2, uv);
  fragColor = mix(a, b, u_progress);
}`;

const FRAG_TRANS_SLIDE_UP = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform sampler2D u_texture2;
uniform float u_progress;
out vec4 fragColor;
void main() {
  float p = u_progress;
  vec2 uvA = vec2(v_uv.x, v_uv.y + p);
  vec2 uvB = vec2(v_uv.x, v_uv.y + p - 1.0);
  bool inA = uvA.y <= 1.0;
  bool inB = uvB.y >= 0.0;
  fragColor = inA ? texture(u_texture, uvA) : texture(u_texture2, uvB);
}`;

const FRAG_TRANS_SLIDE_DOWN = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform sampler2D u_texture2;
uniform float u_progress;
out vec4 fragColor;
void main() {
  float p = u_progress;
  vec2 uvA = vec2(v_uv.x, v_uv.y - p);
  vec2 uvB = vec2(v_uv.x, v_uv.y - p + 1.0);
  bool inA = uvA.y >= 0.0;
  fragColor = inA ? texture(u_texture, uvA) : texture(u_texture2, uvB);
}`;

const FRAG_TRANS_SPIN = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform sampler2D u_texture2;
uniform float u_progress;
out vec4 fragColor;
void main() {
  vec2 center = vec2(0.5);
  vec2 uv = v_uv - center;
  float angle = u_progress * 3.14159 * 2.0;
  float c = cos(angle), s = sin(angle);
  vec2 rotUV = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + center;
  float scale = 1.0 - u_progress * 0.5;
  vec2 scaleUV = (v_uv - center) / max(scale, 0.01) + center;
  vec4 a = texture(u_texture, clamp(scaleUV, 0.0, 1.0));
  vec4 b = texture(u_texture2, v_uv);
  fragColor = mix(a, b, smoothstep(0.0, 1.0, u_progress));
}`;
