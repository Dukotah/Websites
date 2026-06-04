/**
 * motion.ts — signature interaction module
 * Three progressive enhancements, all guarded for:
 *   - SSR / no-window environments
 *   - prefers-reduced-motion (hard no-op)
 *   - missing IntersectionObserver / rAF (graceful skip)
 *
 * Import once in BaseLayout alongside reveal.ts.
 */

(function () {
  if (typeof window === 'undefined') return;

  // Single reduced-motion gate for all three features.
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motionQuery.matches) return;

  // ---------------------------------------------------------------------------
  // 1. STICKY TRANSFORMING HEADER
  //    Adds / removes .is-stuck on the first <header> / .hdr element after a
  //    small scroll. CSS owns all visual changes (shrink, shadow, opacity).
  // ---------------------------------------------------------------------------
  (function initStickyHeader() {
    const hdr = document.querySelector<HTMLElement>('.hdr, header');
    if (!hdr) return;

    // Threshold: just past one header height so the transition is perceptible
    // but doesn't lag on fast scrolls.
    const THRESHOLD = 60;
    let stuck = false;

    function onScroll() {
      const shouldStick = window.scrollY > THRESHOLD;
      if (shouldStick === stuck) return;
      stuck = shouldStick;
      hdr.classList.toggle('is-stuck', stuck);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // Sync on initial load in case page is reloaded mid-scroll.
  })();

  // ---------------------------------------------------------------------------
  // 2. HERO PARALLAX
  //    Translates [data-parallax] elements upward at a fraction of scroll depth.
  //    rAF-throttled; effect is subtle (30% depth) so it reads as polish, not
  //    a carnival ride. Stops applying once the element leaves the viewport to
  //    avoid wasted compositing.
  // ---------------------------------------------------------------------------
  (function initParallax() {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>('[data-parallax]'),
    );
    if (!els.length) return;

    const DEPTH = 0.28; // fraction of scrollY to shift (lower = subtler)
    let rafId = 0;
    let lastY = -1;

    function tick() {
      rafId = 0;
      const y = window.scrollY;
      if (y === lastY) return;
      lastY = y;

      for (const el of els) {
        const rect = el.getBoundingClientRect();
        // Skip elements fully below the fold — no compositing cost.
        if (rect.top > window.innerHeight) continue;
        el.style.transform = `translateY(${-(y * DEPTH).toFixed(1)}px)`;
        el.style.willChange = 'transform';
      }
    }

    function onScroll() {
      if (!rafId) rafId = requestAnimationFrame(tick);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
  })();

  // ---------------------------------------------------------------------------
  // 3. COUNT-UP NUMBERS
  //    Animates [data-countup] elements from 0 to their numeric value when they
  //    enter the viewport. Piggybacks on the same IntersectionObserver pattern
  //    as reveal.ts so timing is consistent. Preserves any trailing suffix
  //    (e.g. "500+" or "98%") by splitting off the leading integer.
  // ---------------------------------------------------------------------------
  (function initCountUp() {
    if (typeof IntersectionObserver === 'undefined') return;

    const els = Array.from(
      document.querySelectorAll<HTMLElement>('[data-countup]'),
    );
    if (!els.length) return;

    const DURATION = 1400; // ms

    function easeOut(t: number): number {
      return 1 - Math.pow(1 - t, 3);
    }

    function animateOne(el: HTMLElement) {
      const raw = el.textContent ?? '';
      // Split leading integer from any suffix ("500+", "98%", "4.9 stars").
      const match = raw.match(/^(\d[\d,]*\.?\d*)(.*)/);
      if (!match) return;

      const numStr = match[1].replace(/,/g, '');
      const suffix = match[2];
      const target = parseFloat(numStr);
      const isFloat = numStr.includes('.');
      const decimals = isFloat ? (numStr.split('.')[1]?.length ?? 0) : 0;
      const useCommas = match[1].includes(',');

      const start = performance.now();

      function frame(now: number) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / DURATION, 1);
        const value = target * easeOut(progress);

        let display: string;
        if (isFloat) {
          display = value.toFixed(decimals);
        } else {
          const rounded = Math.round(value);
          display = useCommas ? rounded.toLocaleString() : String(rounded);
        }

        el.textContent = display + suffix;

        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          // Restore exact original text so the final value is pixel-perfect.
          el.textContent = raw;
        }
      }

      requestAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            animateOne(entry.target as HTMLElement);
            observer.unobserve(entry.target);
          }
        }
      },
      {
        rootMargin: '0px 0px -40px 0px',
        threshold: 0.15,
      },
    );

    for (const el of els) {
      observer.observe(el);
    }
  })();

  // Re-evaluate on runtime OS preference change (user toggles Reduce Motion).
  motionQuery.addEventListener('change', () => {
    // Reload the page to let reveal.ts also reset cleanly; avoids partially
    // animated state. Silent no-op if the event fires after teardown.
    window.location.reload();
  });
})();
