/**
 * effects.ts — the page-wide "motion depth" layer over the premium kit.
 *
 * Pure progressive enhancement on TOP of an already-painted, fully-static page.
 * Three engines, all compositor-only (transform / opacity / CSS custom props):
 *
 *   TILT      — subtle perspective tilt of .card / [data-tilt] toward the
 *               cursor, with an eased spring-back on leave. Drives the CSS vars
 *               --tilt-rx / --tilt-ry (+ gloss --gx/--gy) consumed by effects.css.
 *   SPOTLIGHT — a soft radial glow that follows the cursor across .section--ink
 *               dark bands, via per-section --mx/--my custom properties.
 *   ACCENTS   — toggles the page into `.reveal-armed` parity for the self-drawing
 *               accent lines (eyebrow rules / underlines) which are CSS-driven by
 *               the existing [data-reveal] .is-visible state; this module just
 *               makes sure pointer-only enhancements stay off touch/reduced-motion.
 *
 * HARD RULES (copied verbatim from hero-cinematic.ts's contract):
 *   - SSR/no-window safe.
 *   - prefers-reduced-motion: hard no-op (bails; static base shows).
 *   - hover + fine-pointer gated (tilt & spotlight never run on touch).
 *   - Never hides content — everything paints on TOP of the static layout.
 *   - Full teardown on astro:before-swap so nothing leaks across page swaps.
 *   - Re-inits on astro:page-load.
 *   - rAF-throttled pointer handlers; will-change managed; self-clearing.
 */

type Cleanup = () => void;

const reduceQuery =
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

const finePointer =
  typeof window !== 'undefined'
    ? window.matchMedia('(hover: hover) and (pointer: fine)')
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

const clamp = (v: number, min: number, max: number) =>
  v < min ? min : v > max ? max : v;

/* ----------------------------------------------------------------- TILT --- */
/**
 * 3D tilt on .card and [data-tilt]. We attach ONE delegated pointermove per
 * element-group lazily: on pointerenter we start tracking that element; on
 * pointermove we write its tilt vars (rAF-throttled); on pointerleave we ease
 * back to flat. Compositor-only — only CSS custom props + the .is-tilting class
 * gate (the transform itself lives in effects.css, fine-pointer guarded there).
 */
function initTilt() {
  const targets = Array.from(
    document.querySelectorAll<HTMLElement>('.premium .card, .premium [data-tilt]'),
  ).filter((el) => !el.hasAttribute('data-tilt-off'));

  if (!targets.length) return;

  // Max rotation in degrees — subtle, premium (not a toy flip).
  const MAX = 5;

  const wired: Cleanup[] = [];

  for (const el of targets) {
    let raf = 0;
    let pending: { x: number; y: number } | null = null;
    let resetTimer = 0;

    const apply = () => {
      raf = 0;
      if (!pending) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // normalized -0.5..0.5 from center
      const px = (pending.x - rect.left) / rect.width - 0.5;
      const py = (pending.y - rect.top) / rect.height - 0.5;
      const ry = clamp(px * MAX * 2, -MAX, MAX); // left/right → rotateY
      const rx = clamp(-py * MAX * 2, -MAX, MAX); // up/down → rotateX
      el.style.setProperty('--tilt-ry', `${ry.toFixed(2)}deg`);
      el.style.setProperty('--tilt-rx', `${rx.toFixed(2)}deg`);
      // gloss follows the raw pointer position over the card face
      el.style.setProperty('--gx', `${(((pending.x - rect.left) / rect.width) * 100).toFixed(1)}%`);
      el.style.setProperty('--gy', `${(((pending.y - rect.top) / rect.height) * 100).toFixed(1)}%`);
    };

    const onMove = (e: PointerEvent) => {
      pending = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onEnter = () => {
      if (resetTimer) {
        window.clearTimeout(resetTimer);
        resetTimer = 0;
      }
      el.classList.remove('is-resetting');
      el.classList.add('is-tilting');
    };

    const onLeave = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      pending = null;
      // ease back to flat: keep .is-tilting (so the transform rule still wins)
      // but add .is-resetting (slower transition) and zero the vars.
      el.classList.add('is-resetting');
      el.style.setProperty('--tilt-rx', '0deg');
      el.style.setProperty('--tilt-ry', '0deg');
      // after the spring-back completes, drop the classes so :hover lift (from
      // premium.css) takes back over cleanly for non-pointer interactions.
      resetTimer = window.setTimeout(() => {
        el.classList.remove('is-tilting', 'is-resetting');
        el.style.removeProperty('--tilt-rx');
        el.style.removeProperty('--tilt-ry');
        el.style.removeProperty('--gx');
        el.style.removeProperty('--gy');
        resetTimer = 0;
      }, 560);
    };

    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);

    wired.push(() => {
      if (raf) cancelAnimationFrame(raf);
      if (resetTimer) window.clearTimeout(resetTimer);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.classList.remove('is-tilting', 'is-resetting');
      el.style.removeProperty('--tilt-rx');
      el.style.removeProperty('--tilt-ry');
      el.style.removeProperty('--gx');
      el.style.removeProperty('--gy');
    });
  }

  teardown.push(() => {
    for (const fn of wired) fn();
  });
}

/* ------------------------------------------------------------ SPOTLIGHT --- */
/**
 * Mouse spotlight across .section--ink dark bands. On pointermove within a band
 * we set --mx/--my (%) and toggle .is-spotlit; effects.ts paints the glow via
 * ::before (in effects.css). rAF-throttled, one listener per band, self-clears.
 */
function initSpotlight() {
  const bands = Array.from(
    document.querySelectorAll<HTMLElement>('.premium .section--ink'),
  );
  if (!bands.length) return;

  const wired: Cleanup[] = [];

  for (const band of bands) {
    let raf = 0;
    let pending: { x: number; y: number } | null = null;

    const apply = () => {
      raf = 0;
      if (!pending) return;
      const rect = band.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const mx = clamp(((pending.x - rect.left) / rect.width) * 100, 0, 100);
      const my = clamp(((pending.y - rect.top) / rect.height) * 100, 0, 100);
      band.style.setProperty('--mx', `${mx.toFixed(1)}%`);
      band.style.setProperty('--my', `${my.toFixed(1)}%`);
    };

    const onMove = (e: PointerEvent) => {
      pending = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onEnter = () => band.classList.add('is-spotlit');
    const onLeave = () => {
      band.classList.remove('is-spotlit');
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      pending = null;
    };

    band.addEventListener('pointerenter', onEnter);
    band.addEventListener('pointermove', onMove);
    band.addEventListener('pointerleave', onLeave);

    wired.push(() => {
      if (raf) cancelAnimationFrame(raf);
      band.removeEventListener('pointerenter', onEnter);
      band.removeEventListener('pointermove', onMove);
      band.removeEventListener('pointerleave', onLeave);
      band.classList.remove('is-spotlit');
      band.style.removeProperty('--mx');
      band.style.removeProperty('--my');
    });
  }

  teardown.push(() => {
    for (const fn of wired) fn();
  });
}

/* -------------------------------------------------------------- bootstrap -- */

function init() {
  if (typeof window === 'undefined') return;
  destroyAll();
  if (reduceQuery?.matches) return; // hard no-op → static base state
  if (!finePointer?.matches) return; // tilt + spotlight are pointer-only

  // Defer the (one-time) wiring to main-thread idle so its cost lands OUTSIDE
  // the load/TBT window — same discipline as hero-cinematic.ts / the count-up.
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout?: number }) => number;
  };
  const idle = (cb: () => void) =>
    w.requestIdleCallback ? w.requestIdleCallback(cb, { timeout: 450 }) : window.setTimeout(cb, 1);

  idle(() => {
    if (reduceQuery?.matches || !finePointer?.matches) return;
    initTilt();
    initSpotlight();
  });
}

if (typeof window !== 'undefined') {
  document.addEventListener('astro:page-load', init);
  document.addEventListener('astro:before-swap', destroyAll);
  // React to runtime changes in motion / pointer capability.
  reduceQuery?.addEventListener('change', () => {
    if (reduceQuery.matches) destroyAll();
    else init();
  });
  finePointer?.addEventListener('change', () => {
    if (!finePointer.matches) destroyAll();
    else init();
  });
}
