/**
 * hero-webgl.ts — the flagship "wow" layer painted ON TOP of the already-painted
 * static hero. Hand-rolled WebGL (raw context + inline GLSL, no npm dep) with a
 * canvas-2D fallback, reading the resolved per-prospect brand palette off :root.
 *
 * TWO modes, chosen from the hero variant the markup already declares:
 *   • EDITORIAL (photo-less)  → a slow, organic aurora / flowing-mesh gradient in
 *     the brand palette, painted as the hero backdrop behind the type. The
 *     centerpiece. Soft, never garish; legibility of dark text preserved.
 *   • FULLBLEED (photo hero)  → a very restrained grain-drift + faint flowmap
 *     shimmer layered OVER the photo (screen-ish blend, low opacity) so a
 *     mediocre scraped photo gains motion + cohesion without wrecking the image
 *     or the white text legibility.
 *
 * HARD RULES (mirrors hero-cinematic.ts exactly):
 *   - SSR / no-window safe.
 *   - prefers-reduced-motion → hard no-op (canvas never mounts; static base shows).
 *   - Never hides / replaces the LCP hero — the canvas is an absolutely-positioned
 *     decorative layer BEHIND the hero text, painted after first paint. If WebGL
 *     is unavailable, JS is off, or reduce is set, the existing static hero shows
 *     completely unchanged.
 *   - Full teardown on astro:before-swap (GL context loss + rAF cancel); re-init
 *     on astro:page-load.
 *   - Pauses its rAF loop while the hero is scrolled off-screen and while the tab
 *     is hidden (no background battery burn).
 */

type Cleanup = () => void;

const hasWindow = typeof window !== 'undefined';
const reduceQuery = hasWindow
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

let teardown: Cleanup[] = [];

function destroyAll() {
  for (const fn of teardown.splice(0)) {
    try {
      fn();
    } catch {
      /* one failed teardown must never strand the others */
    }
  }
}

/* ----------------------------------------------------------- palette read -- */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse any CSS color string the browser can resolve into linear-ish 0..1 RGB. */
function readColor(probe: HTMLElement, value: string, fallback: Rgb): Rgb {
  if (!value) return fallback;
  probe.style.color = '';
  probe.style.color = value;
  const resolved = getComputedStyle(probe).color; // → "rgb(r, g, b)" / "rgba(...)"
  const m = /rgba?\(([^)]+)\)/.exec(resolved);
  if (!m) return fallback;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return fallback;
  return { r: parts[0] / 255, g: parts[1] / 255, b: parts[2] / 255 };
}

/**
 * Pull the three brand stops off :root via getComputedStyle on a throwaway probe.
 * We resolve through the probe so color-mix()/var() chains collapse to concrete
 * rgb() the WebGL/2D layer can use. Falls back to a tasteful neutral set.
 */
function readBrandPalette(): { a: Rgb; b: Rgb; c: Rgb } {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const probe = document.createElement('span');
  probe.style.cssText =
    'position:absolute;left:-9999px;top:-9999px;width:0;height:0;visibility:hidden';
  document.body.appendChild(probe);

  const brand = cs.getPropertyValue('--brand').trim();
  const brandVivid = cs.getPropertyValue('--brand-vivid').trim();
  const brandDark = cs.getPropertyValue('--brand-dark').trim();
  const accent = cs.getPropertyValue('--accent').trim();

  const a = readColor(probe, brandVivid || brand, { r: 0.12, g: 0.42, b: 0.27 });
  const b = readColor(probe, accent || brand, { r: 0.16, g: 0.55, b: 0.42 });
  const c = readColor(probe, brandDark || brand, { r: 0.07, g: 0.14, b: 0.23 });

  probe.remove();
  return { a, b, c };
}

/* ------------------------------------------------------- capability gate --- */

function createGl(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  const opts: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: false,
  };
  try {
    return (
      (canvas.getContext('webgl', opts) as WebGLRenderingContext | null) ??
      (canvas.getContext('experimental-webgl', opts) as WebGLRenderingContext | null)
    );
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- shaders -- */

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/**
 * EDITORIAL aurora. Layered value-noise (simplex-ish via hashed gradients) warped
 * over time produces slow organic flowing bands; the three brand stops are mixed
 * by the field value. Output alpha is gentle so the light hero stays legible.
 */
const FRAG_AURORA = `
precision highp float;
varying vec2 v_uv;
uniform vec2  u_res;
uniform float u_time;
uniform vec3  u_a;     // brand vivid
uniform vec3  u_b;     // accent
uniform vec3  u_c;     // brand dark
uniform float u_alpha; // master opacity

vec3 hash3(vec2 p){
  vec3 q = vec3(dot(p, vec2(127.1,311.7)),
                dot(p, vec2(269.5,183.3)),
                dot(p, vec2(419.2,371.9)));
  return fract(sin(q)*43758.5453);
}
float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash3(i + vec2(0.0,0.0)).x;
  float b = hash3(i + vec2(1.0,0.0)).x;
  float c = hash3(i + vec2(0.0,1.0)).x;
  float d = hash3(i + vec2(1.0,1.0)).x;
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0;
  float amp = 0.55;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for(int i=0;i<5;i++){
    v += amp * noise(p);
    p = rot * p * 1.9 + 0.15;
    amp *= 0.5;
  }
  return v;
}
void main(){
  vec2 uv = v_uv;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);

  float t = u_time * 0.045;
  // domain warp → flowing, liquid aurora
  vec2 q = vec2(fbm(p * 1.6 + vec2(0.0, t)),
                fbm(p * 1.6 + vec2(5.2, -t * 0.8)));
  float f = fbm(p * 2.1 + q * 1.4 + vec2(t * 0.6, -t * 0.4));

  // brand stops mixed by the field, biased toward the lighter pair so it glows
  vec3 col = mix(u_c, u_a, smoothstep(0.18, 0.72, f));
  col = mix(col, u_b, smoothstep(0.45, 0.95, f) * 0.7);

  // soft vignette so the band sits behind type, brightest off-center
  float vig = smoothstep(1.25, 0.15, distance(uv, vec2(0.32, 0.42)));

  // gentle banding ripple for organic depth
  float band = 0.5 + 0.5 * sin((f * 4.0 + uv.y * 2.0) + u_time * 0.18);
  float a = u_alpha * mix(0.55, 1.0, band) * mix(0.35, 1.0, vig);

  gl_FragColor = vec4(col * a, a);
}`;

/**
 * FULLBLEED shimmer. A near-monochrome flowing grain + faint warm/cool drift in
 * the brand color, ultra-low alpha, designed to be layered (screen-ish via
 * premultiplied additive) OVER the photo. It must read as "alive texture", never
 * a color wash — alpha is intentionally tiny.
 */
const FRAG_SHIMMER = `
precision highp float;
varying vec2 v_uv;
uniform vec2  u_res;
uniform float u_time;
uniform vec3  u_a;
uniform vec3  u_b;
uniform float u_alpha;

vec2 hash2(vec2 p){
  p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3)));
  return fract(sin(p)*43758.5453);
}
float vnoise(vec2 p){
  vec2 i=floor(p); vec2 f=fract(p);
  vec2 u=f*f*(3.0-2.0*f);
  float a=hash2(i).x, b=hash2(i+vec2(1.,0.)).x;
  float c=hash2(i+vec2(0.,1.)).x, d=hash2(i+vec2(1.,1.)).x;
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
void main(){
  vec2 uv = v_uv;
  float t = u_time * 0.05;
  // drifting low-frequency flow → very slow "breathing" sheen
  float flow = vnoise(uv * 2.4 + vec2(t * 0.4, -t * 0.25));
  // fine animated grain to kill banding + add life
  float g = vnoise(uv * u_res.xy * 0.18 + u_time * 1.7);
  vec3 col = mix(u_a, u_b, flow);
  // sheen pools toward the upper area, fades over the text/copy zone (lower-left)
  float pool = smoothstep(0.0, 0.9, uv.y) * smoothstep(0.0, 0.6, uv.x);
  float a = u_alpha * (0.45 + 0.55 * flow) * (0.7 + 0.3 * pool);
  // blend grain in as additive sparkle
  vec3 outc = col * a + vec3(g - 0.5) * 0.05 * u_alpha;
  gl_FragColor = vec4(outc, a);
}`;

function compile(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function makeProgram(gl: WebGLRenderingContext, frag: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

/* ------------------------------------------------------- WebGL renderer ---- */

interface MountResult {
  cleanup: Cleanup;
}

function mountWebgl(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  mode: 'aurora' | 'shimmer',
): MountResult | null {
  const gl = createGl(canvas);
  if (!gl) return null;

  const prog = makeProgram(gl, mode === 'aurora' ? FRAG_AURORA : FRAG_SHIMMER);
  if (!prog) return null;

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // full-screen triangle (covers clip space, cheaper than a quad)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  const uRes = gl.getUniformLocation(prog, 'u_res');
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uA = gl.getUniformLocation(prog, 'u_a');
  const uB = gl.getUniformLocation(prog, 'u_b');
  const uC = gl.getUniformLocation(prog, 'u_c');
  const uAlpha = gl.getUniformLocation(prog, 'u_alpha');

  let pal = readBrandPalette();
  const masterAlpha = mode === 'aurora' ? 0.92 : 0.16;

  // Cap DPR so big retina heroes don't melt the GPU; aurora is smooth so 1.5 is
  // plenty, shimmer is high-frequency grain so 1.0 is fine + cheaper.
  const dprCap = mode === 'aurora' ? 1.5 : 1;
  let raf = 0;
  let running = false;
  let visible = true;
  let started = performance.now();
  let elapsed = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const w = Math.max(1, Math.round(host.clientWidth * dpr));
    const h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function frame(now: number) {
    raf = 0;
    if (!running || !visible) return;
    elapsed += (now - started) / 1000;
    started = now;

    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, elapsed);
    gl.uniform3f(uA, pal.a.r, pal.a.g, pal.a.b);
    gl.uniform3f(uB, pal.b.r, pal.b.g, pal.b.b);
    if (uC) gl.uniform3f(uC, pal.c.r, pal.c.g, pal.c.b);
    gl.uniform1f(uAlpha, masterAlpha);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    started = performance.now();
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  resize();

  // Pause when the hero scrolls off-screen.
  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible) start();
      else stop();
    },
    { threshold: 0.01 },
  );
  io.observe(host);

  // Pause on hidden tab.
  const onVis = () => {
    if (document.hidden) stop();
    else if (visible) start();
  };
  document.addEventListener('visibilitychange', onVis);

  const ro = new ResizeObserver(() => resize());
  ro.observe(host);

  // Re-read palette if it ever changes (e.g. View Transition into a sibling).
  const onContextLost = (e: Event) => {
    e.preventDefault();
    stop();
  };
  const onContextRestored = () => {
    pal = readBrandPalette();
    resize();
    if (visible) start();
  };
  canvas.addEventListener('webglcontextlost', onContextLost as EventListener);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  // Reveal the canvas now that GL is live + painting (CSS keeps it at 0 until
  // armed, so a failed mount never flashes an empty layer).
  host.classList.add('hero-fx-armed');
  start();

  return {
    cleanup() {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onContextLost as EventListener);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      host.classList.remove('hero-fx-armed');
    },
  };
}

/* ------------------------------------------------ canvas-2D fallback ------- */

/**
 * If WebGL is unavailable we still want SOME life on the editorial hero (the
 * fullbleed shimmer is skipped in 2D — it'd cost too much for too little). A
 * cheap layered-blob 2D gradient drift, brand-colored, low rAF cost.
 */
function mount2d(host: HTMLElement, canvas: HTMLCanvasElement): MountResult | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const pal = readBrandPalette();
  const css = (c: Rgb, a: number) =>
    `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

  let raf = 0;
  let running = false;
  let visible = true;
  let t = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1);
    canvas.width = Math.max(1, Math.round(host.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(host.clientHeight * dpr));
  }
  function frame() {
    raf = 0;
    if (!running || !visible) return;
    t += 0.006;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const blobs: Array<[Rgb, number, number, number]> = [
      [pal.a, 0.32 + 0.12 * Math.sin(t), 0.4 + 0.1 * Math.cos(t * 0.8), 0.9],
      [pal.b, 0.66 + 0.1 * Math.cos(t * 1.1), 0.55 + 0.12 * Math.sin(t * 0.9), 0.8],
      [pal.c, 0.5 + 0.14 * Math.sin(t * 0.7 + 1.0), 0.7 + 0.1 * Math.cos(t), 1.0],
    ];
    for (const [c, x, y, scale] of blobs) {
      const r = Math.max(w, h) * 0.55 * scale;
      const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r);
      g.addColorStop(0, css(c, 0.5));
      g.addColorStop(1, css(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (running) return;
    running = true;
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  resize();
  const io = new IntersectionObserver(
    (e) => {
      visible = e[0]?.isIntersecting ?? true;
      visible ? start() : stop();
    },
    { threshold: 0.01 },
  );
  io.observe(host);
  const onVis = () => {
    if (document.hidden) stop();
    else if (visible) start();
  };
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(() => resize());
  ro.observe(host);

  host.classList.add('hero-fx-armed');
  start();

  return {
    cleanup() {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      host.classList.remove('hero-fx-armed');
    },
  };
}

/* ------------------------------------------------------------- bootstrap --- */

function init() {
  if (!hasWindow) return;
  destroyAll();
  if (reduceQuery?.matches) return; // hard no-op → static base shows

  // The fx canvas host is declared by HeroSection markup with a [data-hero-fx]
  // mode attribute. No host → nothing to do (e.g. split heroes opt out).
  const host = document.querySelector<HTMLElement>('.premium [data-hero-fx]');
  if (!host) return;
  const mode = host.getAttribute('data-hero-fx');
  if (mode !== 'aurora' && mode !== 'shimmer') return;

  // Defer the GL boot to idle so its one-time compile/link cost lands OUTSIDE
  // the load/TBT window (same discipline as hero-cinematic's scroll engine).
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout?: number }) => number;
  };
  const idle = (cb: () => void) =>
    w.requestIdleCallback ? w.requestIdleCallback(cb, { timeout: 600 }) : window.setTimeout(cb, 1);

  idle(() => {
    if (reduceQuery?.matches) return;
    // The host already reserves the box; we only ever create/append the canvas,
    // never touch the static hero DOM behind it → zero CLS, LCP untouched.
    const canvas = document.createElement('canvas');
    canvas.className = 'p-hero__fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    let mounted: MountResult | null = null;
    try {
      mounted = mountWebgl(host, canvas, mode);
    } catch {
      mounted = null;
    }
    // WebGL declined (no context / compile fail / threw) → 2D fallback for the
    // editorial aurora; the fullbleed shimmer simply stays static (the photo +
    // CSS treatment already carry it).
    if (!mounted && mode === 'aurora') {
      try {
        mounted = mount2d(host, canvas);
      } catch {
        mounted = null;
      }
    }
    if (!mounted) {
      canvas.remove(); // leave the static hero pristine
      return;
    }
    teardown.push(() => {
      mounted!.cleanup();
      canvas.remove();
    });
  });
}

if (hasWindow) {
  document.addEventListener('astro:page-load', init);
  document.addEventListener('astro:before-swap', destroyAll);
  reduceQuery?.addEventListener('change', () => {
    if (reduceQuery.matches) destroyAll();
    else init();
  });
}
