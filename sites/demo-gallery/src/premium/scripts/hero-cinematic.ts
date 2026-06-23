/**
 * hero-cinematic.ts — the jaw-drop layer for the premium hero + first scroll.
 *
 * One engine, pure progressive enhancement over an already-painted hero:
 *
 *   SCROLL — a hand-rolled smooth-scroll substrate (rAF lerp toward the native
 *      scroll target) that yields an eased position + velocity, used to drive:
 *        • hero photo parallax (background drifts slower than content → depth),
 *        • a subtle velocity-skew on scrolling section media,
 *      All compositor-only transforms, rAF-throttled, self-clearing off-screen.
 *
 * HARD RULES honored:
 *   - SSR/no-window safe.
 *   - prefers-reduced-motion: hard no-op (the engine bails; static base shows).
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

/* --------------------------------------------------- SMOOTH SCROLL ENGINE -- */

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

/* ------------------------------------------------ VARIABLE-FONT HEADLINE -- */

/**
 * Enhance the existing per-word clip-reveal with a variable-axis settle: each
 * word eases its font-weight (wght axis) from light → bold as it rises into
 * place, so the headline doesn't just appear — it "gains presence". Pure
 * font-variation-settings + the existing transform reveal → zero CLS.
 *
 * Guard rails:
 *   - Only runs when the resolved display family is an actual VARIABLE font that
 *     supports the wght axis. We detect this by checking the computed
 *     font-family for a "* Variable" face AND verifying CSS variable-axis support.
 *     Static faces (Spectral / Cormorant / Zilla Slab) degrade to the plain
 *     clip-reveal already in CSS — no axis animation, no harm.
 *   - The font is bumped HEAVIER + the editorial display pushed larger via a
 *     class the CSS reads; this is opacity/transform/variation only, never a size
 *     change that reflows (the box is sized by the static rules; we only animate
 *     the variation axis on top).
 *   - The settle fires once the hero is "in" (.is-hero-in), staggered per word
 *     to ride just behind the rise. Fully no-op under reduced motion (this whole
 *     engine bails before init() reaches here when reduce is set).
 */
function initVariableHeadline() {
  const headings = Array.from(
    document.querySelectorAll<HTMLElement>('.premium .p-hero__heading'),
  );
  if (!headings.length) return;

  // Variable-axis capability: the browser must accept font-variation-settings.
  const axisOk =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('font-variation-settings', '"wght" 700');
  if (!axisOk) return;

  for (const h1 of headings) {
    const fam = getComputedStyle(h1).fontFamily || '';
    // Only when the chosen display face is a real variable font (our registry
    // tags variable faces as "<Name> Variable"). Otherwise leave it to plain CSS.
    if (!/variable/i.test(fam)) continue;

    const words = Array.from(h1.querySelectorAll<HTMLElement>('.p-hero__word'));
    if (!words.length) continue;

    // Flag the heading so scoped CSS can push the display heavier/larger for
    // drama on capable clients, and prime each word's start weight.
    h1.classList.add('p-hero__heading--vf');
    const restWeight = 760; // bold resting presence on variable display faces
    const startWeight = 280; // light, "unsettled" start

    for (const w of words) {
      w.style.fontVariationSettings = `"wght" ${startWeight}`;
    }

    // Drive the settle off the same readiness flag the CSS reveal uses. We poll a
    // microtask after the hero is marked in (.is-hero-in) so weight + transform
    // animate together. The transition itself is declared in CSS (so reduced
    // motion can kill it); here we only flip to the resting axis value, staggered.
    const heroEl = h1.closest<HTMLElement>('.p-hero');
    let raf = 0;
    let timers: number[] = [];

    const settle = () => {
      words.forEach((w, i) => {
        const t = window.setTimeout(() => {
          w.style.fontVariationSettings = `"wght" ${restWeight}`;
        }, i * 40 + 120);
        timers.push(t);
      });
    };

    if (heroEl?.classList.contains('is-hero-in')) {
      settle();
    } else if (heroEl) {
      // Wait for the hero to be marked in (set by the reveal script after paint).
      const obs = new MutationObserver(() => {
        if (heroEl.classList.contains('is-hero-in')) {
          obs.disconnect();
          settle();
        }
      });
      obs.observe(heroEl, { attributes: true, attributeFilter: ['class'] });
      teardown.push(() => obs.disconnect());
    } else {
      // No hero wrapper found → just settle so the headline isn't stuck light.
      settle();
    }

    teardown.push(() => {
      if (raf) cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
      timers = [];
      h1.classList.remove('p-hero__heading--vf');
      for (const w of words) w.style.fontVariationSettings = '';
    });
  }
}

/* -------------------------------------------------------------- bootstrap -- */

function init() {
  if (typeof window === 'undefined') return;
  destroyAll();
  if (reduceQuery?.matches) return; // hard no-op → static base state

  // Variable-font headline settle rides WITH the reveal (not deferred), so the
  // wght axis animates together with the per-word rise. No-op on static faces /
  // browsers without variation-axis support, hard no-op under reduced motion.
  initVariableHeadline();

  // The hero photo entrance + content cascade are pure CSS (already armed by the
  // reveal script the frame after first paint), so the cinematic MOMENT lands
  // immediately. The scroll rAF wiring below is deferred to main-thread idle so
  // its one-time cost lands OUTSIDE the load/TBT window (same pattern as the
  // count-up fix).
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout?: number }) => number;
  };
  const idle = (cb: () => void) =>
    w.requestIdleCallback ? w.requestIdleCallback(cb, { timeout: 450 }) : window.setTimeout(cb, 1);
  idle(() => {
    if (reduceQuery?.matches) return;
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
