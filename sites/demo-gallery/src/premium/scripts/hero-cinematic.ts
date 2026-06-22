/**
 * hero-cinematic.ts — the jaw-drop layer for the premium hero + first scroll.
 *
 * Two engines, both pure progressive enhancement over an already-painted hero:
 *
 *   1. AURORA — a drifting brand-light field rendered behind the photo-less dark
 *      "title-card" hero. Tries a tiny WebGL fragment shader (smooth, GPU); falls
 *      back to a 2D-canvas blob field; falls back again to nothing (the static
 *      CSS gradient band stays). Brand color is read from the resolved --p-primary
 *      / --p-structure tokens so it re-themes per business with zero config.
 *
 *   2. SCROLL — a hand-rolled smooth-scroll substrate (rAF lerp toward the native
 *      scroll target) that yields an eased position + velocity, used to drive:
 *        • hero photo parallax (background drifts slower than content → depth),
 *        • a subtle velocity-skew on scrolling section media,
 *      All compositor-only transforms, rAF-throttled, self-clearing off-screen.
 *
 * HARD RULES honored:
 *   - SSR/no-window safe.
 *   - prefers-reduced-motion: hard no-op (both engines bail; static base shows).
 *   - Never hides the LCP hero — everything paints on TOP of the static layout.
 *   - Full teardown on astro:before-swap so nothing leaks across page swaps.
 *   - Re-inits on astro:page-load.
 */

type Cleanup = () => void;

const reduceQuery =
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

let teardown: Cleanup[] = [];

function destroyAll() {
  for (const fn of teardown.splice(0)) {
    try {
      fn();
    } catch {
      /* never let one teardown break the others */
    }
  }
}

/* ------------------------------------------------------------------ utils -- */

/** Resolve a CSS color token to an [r,g,b] 0..1 triple via a throwaway canvas. */
function readBrandRGB(el: Element, varName: string, fallback: string): [number, number, number] {
  const raw = getComputedStyle(el).getPropertyValue(varName).trim() || fallback;
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const ctx = probe.getContext('2d');
  if (!ctx) return hexToRgb(fallback);
  try {
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch {
    return hexToRgb(fallback);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.replace(/(.)/g, '$1$1') : m, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/* ------------------------------------------------------------ 1. AURORA --- */

const AURORA_FRAG = `
precision mediump float;
uniform vec2  u_res;
uniform float u_time;
uniform vec3  u_brand;
uniform vec3  u_accent;

// cheap value noise
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0,0.0));
  float c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  // 3 octaves is plenty for soft aurora bands and keeps the per-pixel cost low
  // enough to hold 60fps on weak GPUs (5 octaves spiked frame time under throttle).
  float v = 0.0, a = 0.6;
  for(int i=0;i<3;i++){ v += a*noise(p); p *= 2.0; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = uv * 2.6;
  p.x *= u_res.x / u_res.y;
  float t = u_time * 0.045;

  // two slow-drifting noise fields → soft aurora bands
  float n1 = fbm(p + vec2(t, t*0.6));
  float n2 = fbm(p*1.4 + vec2(-t*0.7, t*0.3) + 7.3);
  float band = smoothstep(0.25, 0.95, n1 * 0.7 + n2 * 0.45);

  // concentrate the glow toward the upper-right (matches the static band glow)
  float focus = smoothstep(1.2, 0.0, distance(uv, vec2(0.82, 0.12)));
  band *= 0.35 + focus * 0.95;

  vec3 col = mix(u_brand, u_accent, smoothstep(0.2, 0.85, n2));
  // gentle vertical falloff so the bottom stays calm/dark
  float fall = smoothstep(0.0, 0.85, uv.y + 0.15);
  float a = band * fall;
  gl_FragColor = vec4(col * a, a);
}`;

const AURORA_VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

function startAuroraWebGL(canvas: HTMLCanvasElement, host: HTMLElement): Cleanup | null {
  const glOrNull =
    (canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false }) as
      | WebGLRenderingContext
      | null) ||
    (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
  if (!glOrNull) return null;
  const gl: WebGLRenderingContext = glOrNull;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, AURORA_VERT);
  const fs = compile(gl.FRAGMENT_SHADER, AURORA_FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'u_res');
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uBrand = gl.getUniformLocation(prog, 'u_brand');
  const uAccent = gl.getUniformLocation(prog, 'u_accent');

  const brand = readBrandRGB(host, '--p-primary', '#2f7d52');
  // a lighter, lifted brand tone for the aurora highlight
  const accent: [number, number, number] = [
    Math.min(1, brand[0] * 0.6 + 0.55),
    Math.min(1, brand[1] * 0.6 + 0.62),
    Math.min(1, brand[2] * 0.6 + 0.7),
  ];
  gl.uniform3f(uBrand, brand[0], brand[1], brand[2]);
  gl.uniform3f(uAccent, accent[0], accent[1], accent[2]);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  let raf = 0;
  let running = true;
  const start = performance.now();
  // The aurora is a soft, blurry field — it doesn't need device resolution.
  // Rendering below native DPR slashes fragment-shader work (it's a per-pixel
  // cost) while a CSS blur on the layer hides the lower sampling. We sit at
  // ~0.8x (was 0.6x): the old value dithered into visible banding once the
  // header's backdrop-filter blurred it, so 0.8x + the layer blur reads clean.
  const DPR = Math.min(window.devicePixelRatio || 1, 1) * 0.8;
  // Cap to ~30fps: a drifting aurora is imperceptibly different at 30 vs 60fps,
  // and halving the draw count keeps the main thread/GPU well clear of jank.
  const FRAME_MS = 1000 / 30;
  let lastDraw = 0;

  function resize() {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * DPR));
    const h = Math.max(1, Math.round(r.height * DPR));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
  }
  resize();

  const ro = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  ro?.observe(host);

  // Pause when the hero scrolls out of view (no wasted GPU).
  let visible = true;
  const io =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (e) => {
            visible = e[0]?.isIntersecting ?? true;
            if (visible && running && !raf) raf = requestAnimationFrame(frame);
          },
          { threshold: 0 },
        )
      : null;
  io?.observe(host);

  function frame(now: number) {
    raf = 0;
    if (!running) return;
    if (now - lastDraw >= FRAME_MS) {
      lastDraw = now;
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const onVis = () => {
    if (!document.hidden && visible && running && !raf) raf = requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', onVis);

  canvas.classList.add('is-live');

  return () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    ro?.disconnect();
    io?.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    const ext = gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  };
}

/** 2D-canvas fallback: soft drifting brand blobs (cheaper, still alive). */
function startAuroraCanvas2D(canvas: HTMLCanvasElement, host: HTMLElement): Cleanup | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Match the WebGL path: ~0.8x DPR + the layer's CSS blur keeps the drifting
  // blobs smooth instead of banding when blurred through the header glass.
  const DPR = Math.min(window.devicePixelRatio || 1, 1) * 0.8;
  const FRAME_MS = 1000 / 30;
  let lastDraw = 0;
  const brand = readBrandRGB(host, '--p-primary', '#2f7d52').map((v) => Math.round(v * 255));
  const rgb = `${brand[0]}, ${brand[1]}, ${brand[2]}`;

  type Blob = { x: number; y: number; r: number; vx: number; vy: number; a: number };
  let blobs: Blob[] = [];
  let raf = 0;
  let running = true;
  let W = 0;
  let H = 0;

  function resize() {
    const r = host.getBoundingClientRect();
    W = canvas.width = Math.max(1, Math.round(r.width * DPR));
    H = canvas.height = Math.max(1, Math.round(r.height * DPR));
    blobs = Array.from({ length: 5 }, (_, i) => ({
      x: (0.3 + 0.5 * Math.random()) * W + (i > 2 ? 0.2 * W : 0),
      y: (0.1 + 0.5 * Math.random()) * H,
      r: (0.35 + Math.random() * 0.4) * Math.max(W, H) * 0.5,
      vx: (Math.random() - 0.5) * 0.12 * DPR,
      vy: (Math.random() - 0.5) * 0.1 * DPR,
      a: 0.1 + Math.random() * 0.12,
    }));
  }
  resize();

  const ro = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  ro?.observe(host);
  let visible = true;
  const io =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (e) => {
            visible = e[0]?.isIntersecting ?? true;
            if (visible && running && !raf) raf = requestAnimationFrame(frame);
          },
          { threshold: 0 },
        )
      : null;
  io?.observe(host);

  function frame(now: number) {
    raf = 0;
    if (!running) return;
    if (now - lastDraw < FRAME_MS) {
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
      return;
    }
    lastDraw = now;
    ctx!.clearRect(0, 0, W, H);
    ctx!.globalCompositeOperation = 'lighter';
    for (const b of blobs) {
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < -b.r || b.x > W + b.r) b.vx *= -1;
      if (b.y < -b.r || b.y > H + b.r) b.vy *= -1;
      const g = ctx!.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, `rgba(${rgb}, ${b.a})`);
      g.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx!.fillStyle = g;
      ctx!.beginPath();
      ctx!.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx!.fill();
    }
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  const onVis = () => {
    if (!document.hidden && visible && running && !raf) raf = requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', onVis);

  canvas.classList.add('is-live');
  return () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    ro?.disconnect();
    io?.disconnect();
    document.removeEventListener('visibilitychange', onVis);
  };
}

function initAurora() {
  const canvas = document.querySelector<HTMLCanvasElement>('.premium [data-hero-aurora]');
  if (!canvas) return;
  const host = canvas.closest<HTMLElement>('.p-hero') ?? canvas.parentElement;
  if (!host) return;
  const stop = startAuroraWebGL(canvas, host) ?? startAuroraCanvas2D(canvas, host);
  if (stop) teardown.push(stop);
}

/* ------------------------------------------------ 2. SMOOTH SCROLL ENGINE -- */

/**
 * Smooth-scroll substrate, hand-rolled (no dependency). We do NOT hijack the
 * scrollbar position itself (that risks fighting the browser + accessibility);
 * instead we maintain an EASED virtual scroll value that lags the real scroll,
 * and a VELOCITY signal, and feed both to the parallax/skew transforms. This
 * gives the "weighted, premium" scroll feel on the visuals while native scroll,
 * keyboard, and a11y stay 100% intact.
 */
function initScrollEngine() {
  const heroBg = document.querySelector<HTMLElement>('.premium [data-hero-parallax="bg"]');
  const heroFigs = Array.from(
    document.querySelectorAll<HTMLElement>('.premium [data-hero-parallax="figure"]'),
  );
  const skewTargets = Array.from(
    document.querySelectorAll<HTMLElement>('.premium [data-scroll-skew]'),
  );

  if (!heroBg && !heroFigs.length && !skewTargets.length) return;

  let eased = window.scrollY;
  let target = window.scrollY;
  let velocity = 0;
  let skewCurrent = 0;
  let raf = 0;
  let running = true;

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  function tick() {
    raf = 0;
    if (!running) return;
    target = window.scrollY;
    const prev = eased;
    eased = lerp(eased, target, 0.12);
    velocity = eased - prev;

    // Hero background parallax: drifts UP slower than the page → parallax depth.
    if (heroBg) {
      const r = heroBg.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) {
        heroBg.style.transform = `translate3d(0, ${(eased * 0.26).toFixed(1)}px, 0)`;
      }
    }
    // Hero figures (split/editorial): a gentler counter-drift for layered depth.
    for (const fig of heroFigs) {
      const r = fig.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) {
        const photo = fig.querySelector<HTMLElement>('.p-hero__photo') ?? fig;
        photo.style.transform = `translate3d(0, ${(eased * -0.06).toFixed(1)}px, 0)`;
      }
    }
    // Velocity skew on opted-in scrolling media: a subtle whip that follows the
    // scroll speed and relaxes to flat. The clamped velocity is the TARGET; we
    // ease skewCurrent toward it each frame so the whip ramps + settles smoothly
    // instead of snapping to a hard-clamped value (one extra lerp/frame).
    const skewTarget = Math.max(-3.2, Math.min(3.2, velocity * 0.45));
    skewCurrent = lerp(skewCurrent, skewTarget, 0.18);
    for (const el of skewTargets) {
      const r = el.getBoundingClientRect();
      if (r.bottom > -200 && r.top < window.innerHeight + 200) {
        el.style.transform = `skewY(${skewCurrent.toFixed(2)}deg)`;
      }
    }

    // Keep ticking while the eased value is still catching up, there is residual
    // velocity, OR the eased skew has not yet relaxed back to flat; otherwise
    // sleep until the next scroll.
    if (
      Math.abs(target - eased) > 0.4 ||
      Math.abs(velocity) > 0.3 ||
      Math.abs(skewCurrent) > 0.01
    ) {
      raf = requestAnimationFrame(tick);
    } else {
      eased = target;
      velocity = 0;
      skewCurrent = 0;
      // settle skew to flat
      for (const el of skewTargets) el.style.transform = 'skewY(0deg)';
    }
  }

  function onScroll() {
    if (!raf && running) raf = requestAnimationFrame(tick);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  // prime once
  raf = requestAnimationFrame(tick);

  teardown.push(() => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (heroBg) heroBg.style.transform = '';
    for (const fig of heroFigs) {
      const photo = fig.querySelector<HTMLElement>('.p-hero__photo') ?? fig;
      photo.style.transform = '';
    }
    for (const el of skewTargets) el.style.transform = '';
  });
}

/* -------------------------------------------------------------- bootstrap -- */

function init() {
  if (typeof window === 'undefined') return;
  destroyAll();
  if (reduceQuery?.matches) return; // hard no-op → static base state

  // The hero photo entrance + content cascade are pure CSS (already armed by the
  // reveal script the frame after first paint), so the cinematic MOMENT lands
  // immediately. The JS engines below — WebGL shader compile (aurora) + the
  // scroll rAF wiring — are deferred to main-thread idle so their one-time cost
  // lands OUTSIDE the load/TBT window (same pattern as the count-up fix). Visually
  // identical: the aurora fades in a beat after the band is already on screen.
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout?: number }) => number;
  };
  const idle = (cb: () => void) =>
    w.requestIdleCallback ? w.requestIdleCallback(cb, { timeout: 450 }) : window.setTimeout(cb, 1);
  idle(() => {
    if (reduceQuery?.matches) return;
    initAurora();
    initScrollEngine();
  });
}

if (typeof window !== 'undefined') {
  document.addEventListener('astro:page-load', init);
  document.addEventListener('astro:before-swap', destroyAll);
  // If reduce-motion is toggled on at runtime, tear the live engines down.
  reduceQuery?.addEventListener('change', () => {
    if (reduceQuery.matches) destroyAll();
    else init();
  });
}
