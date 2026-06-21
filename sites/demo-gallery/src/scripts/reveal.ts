/**
 * Scroll-reveal script — adds [data-revealed] to elements as they enter the
 * viewport so CSS can animate them (spec §5.2). Framework-free, tiny.
 *
 * The script is a no-op when prefers-reduced-motion: reduce matches, so
 * it never fights the hard @media block in global.css.
 *
 * Usage: import this script in BaseLayout (client:load or defer).
 *   Elements: add [data-reveal] to sections/elements you want revealed.
 *   CSS: style [data-reveal] (initial hidden/translated state) and
 *        [data-reveal][data-revealed] (final visible state) using
 *        --motion-fade, --motion-rise, and --motion-ease tokens.
 */

// Initialize reveal behavior for both [data-reveal] and .reveal-section elements.
// Called on first load and after each View-Transitions navigation (astro:page-load).
function initReveal(): void {
  if (
    typeof window === 'undefined' ||
    typeof IntersectionObserver === 'undefined'
  ) {
    return;
  }

  // Signal the BaseLayout head guard that the reveal logic is alive, so its 4s
  // failsafe won't unhide everything. Set as early as possible — the moment this
  // module executes — so even the reduced-motion path below counts as "ready".
  (window as unknown as { __revealReady?: boolean }).__revealReady = true;

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motionQuery.matches) {
    // Mark everything as revealed immediately so layouts aren't broken by the
    // initial hidden state. Also mark .reveal-section as visible.
    document.querySelectorAll('[data-reveal], [data-reveal-stagger]').forEach((el) => {
      (el as HTMLElement).dataset.revealed = '';
    });
    document.querySelectorAll('.reveal-section').forEach((el) => {
      el.classList.add('is-visible');
    });
    return;
  }

  // Observer for legacy [data-reveal] / [data-reveal-stagger] elements.
  const dataRevealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          el.dataset.revealed = '';
          // Once revealed, no need to keep observing.
          dataRevealObserver.unobserve(el);
        }
      }
    },
    {
      // Start triggering slightly before the element enters the viewport.
      rootMargin: '0px 0px -60px 0px',
      threshold: 0.05,
    },
  );

  // Observer for new .reveal-section elements (higher threshold, same margin).
  const sectionRevealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          sectionRevealObserver.unobserve(entry.target);
        }
      }
    },
    {
      rootMargin: '0px 0px -60px 0px',
      threshold: 0.15,
    },
  );

  // Observe all elements present at call time.
  document.querySelectorAll('[data-reveal], [data-reveal-stagger]').forEach((el) => {
    dataRevealObserver.observe(el);
  });
  document.querySelectorAll('.reveal-section').forEach((el) => {
    sectionRevealObserver.observe(el);
  });

  // Also handle any elements added after initial load (e.g. lazy components).
  // Use a MutationObserver to watch for new [data-reveal] and .reveal-section elements.
  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.dataset.reveal !== undefined) {
          dataRevealObserver.observe(node);
        }
        if (node.classList.contains('reveal-section')) {
          sectionRevealObserver.observe(node);
        }
        node.querySelectorAll('[data-reveal], [data-reveal-stagger]').forEach((el) => {
          dataRevealObserver.observe(el);
        });
        node.querySelectorAll('.reveal-section').forEach((el) => {
          sectionRevealObserver.observe(el);
        });
      }
    }
  });

  mutationObserver.observe(document.body, { childList: true, subtree: true });

  // Also re-check on motionQuery change (user changes OS preference at runtime).
  motionQuery.addEventListener('change', (e) => {
    if (e.matches) {
      dataRevealObserver.disconnect();
      sectionRevealObserver.disconnect();
      mutationObserver.disconnect();
      document.querySelectorAll('[data-reveal], [data-reveal-stagger]').forEach((el) => {
        (el as HTMLElement).dataset.revealed = '';
      });
      document.querySelectorAll('.reveal-section').forEach((el) => {
        el.classList.add('is-visible');
      });
    }
  });
}

(function () {
  // Honor prefers-reduced-motion — bail out entirely; CSS hard-block handles
  // the reset for any already-styled elements.
  if (
    typeof window === 'undefined' ||
    typeof IntersectionObserver === 'undefined'
  ) {
    return;
  }

  // Run on initial page load.
  initReveal();

  // Re-run after each View-Transitions navigation (Astro's client-side routing).
  // Each navigation delivers a fresh DOM so we reinitialize observers.
  document.addEventListener('astro:page-load', initReveal);
})();
