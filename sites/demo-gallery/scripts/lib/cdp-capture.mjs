/**
 * cdp-capture.mjs — true full-page screenshots via the Chrome DevTools Protocol.
 *
 * Headless Chrome's `--screenshot` flag only grabs the window, so a tall page
 * gets clipped at the window height (our old 3600px cap dropped the contact form
 * + footer on long demos). CDP's `Page.captureScreenshot { captureBeyondViewport }`
 * renders the WHOLE document. We drive CDP over a WebSocket — both `fetch` and
 * `WebSocket` are global in Node 18+/24, so this stays zero-dependency.
 *
 * Usage:
 *   await withChrome(chromePath, port, async (conn) => {
 *     const { foldPng, fullPng } = await capturePage(conn, 'http://localhost:4321/p/x');
 *     writeFileSync('fold.png', foldPng); writeFileSync('full.png', fullPng);
 *   });
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

/** Kill a process AND its children. `child.kill()` orphans Chrome's ~10 helper
 *  processes on Windows (--headless=new spawns gpu/renderer/utility procs), so
 *  they pile up across runs; taskkill /T tears the whole tree down. */
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { child.kill('SIGKILL'); } catch {}
  }
}

/** Launch headless Chrome with a debugging port; returns the child process. */
export function launchChrome(chromePath, port) {
  return spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*', // some Chrome builds reject the WS handshake without this
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
}

/** Minimal CDP JSON-RPC client over a single WebSocket (supports flat sessions). */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('CDP websocket failed to open'));
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else {
      for (const l of listeners) l(m);
    }
  };
  // Every call is bounded: a stalled or crashed renderer otherwise leaves the
  // promise pending forever (Page.captureScreenshot on a tall page is the usual
  // culprit), which would hang the whole capture loop with no way to recover.
  const send = (method, params = {}, sessionId, timeoutMs = 45000) =>
    new Promise((res, rej) => {
      const _id = ++id;
      const timer = setTimeout(() => {
        if (pending.delete(_id)) rej(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(_id, {
        res: (v) => { clearTimeout(timer); res(v); },
        rej: (e) => { clearTimeout(timer); rej(e); },
      });
      try {
        ws.send(JSON.stringify({ id: _id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(_id);
        rej(e);
      }
    });
  const onEvent = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  return { send, onEvent, close: () => ws.close() };
}

/** Boot Chrome, run `fn(conn)`, always tear the browser down. */
export async function withChrome(chromePath, port, fn) {
  const child = launchChrome(chromePath, port);
  try {
    let version;
    for (let i = 0; i < 80 && !version; i++) {
      try {
        version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      } catch {
        await sleep(250);
      }
    }
    if (!version) throw new Error('Chrome DevTools endpoint never came up');
    const conn = await connect(version.webSocketDebuggerUrl);
    try {
      return await fn(conn);
    } finally {
      conn.close();
    }
  } finally {
    killTree(child);
  }
}

/**
 * Capture a URL: a fold shot (viewport) AND a true full-page shot.
 * @returns {Promise<{foldPng: Buffer, fullPng: Buffer, fullHeight: number}>}
 */
export async function capturePage(conn, url, { width = 1440, foldHeight = 900, settleMs = 1200 } = {}) {
  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (method, params) => conn.send(method, params, sessionId);
  try {
    await S('Page.enable', {});
    await S('Emulation.setDeviceMetricsOverride', {
      width,
      height: foldHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const loaded = new Promise((res) => {
      const off = conn.onEvent((m) => {
        if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') {
          off();
          res();
        }
      });
    });
    await S('Page.navigate', { url });
    await Promise.race([loaded, sleep(8000)]);
    await sleep(settleMs); // let fonts + lazy images settle

    // Neutralize scroll-reveal: [data-reveal] elements start at opacity:0 and only
    // get [data-revealed] when scrolled into view (IntersectionObserver). A static
    // capture never scrolls, so below-fold content would shoot as blank bands.
    // Force the final visible state so the judge sees the real page.
    await S('Runtime.evaluate', {
      expression: `(() => {
        const s = document.createElement('style');
        s.textContent = '[data-reveal]{opacity:1!important;transform:none!important}[data-reveal-stagger]>*{opacity:1!important;transform:none!important}';
        document.head.appendChild(s);
        document.querySelectorAll('[data-reveal],[data-reveal-stagger]').forEach(el => { el.dataset.revealed = ''; });
      })()`,
    }).catch(() => {});
    await sleep(250); // let the override paint

    const metrics = await S('Page.getLayoutMetrics', {});
    const size = metrics.cssContentSize ?? metrics.contentSize;
    // Cap high enough to show contact + footer on a long demo, but not so tall
    // that encoding a giant PNG stalls the renderer (a 1440×30000 shot is ~43MP).
    const fullHeight = Math.min(Math.ceil(size?.height ?? foldHeight), 16000);

    const shoot = (height) =>
      S('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 },
      }).then((r) => Buffer.from(r.data, 'base64'));

    // Capture the fold first and keep it: if the full-page shot stalls (a very
    // tall page can wedge the renderer), the judge still gets the cold-link
    // first impression instead of losing the page entirely.
    const foldPng = await shoot(foldHeight);
    let fullPng = foldPng;
    let captured = foldHeight;
    try {
      fullPng = await shoot(fullHeight);
      captured = fullHeight;
    } catch (e) {
      console.log(`    ⚠ full-page shot failed (${e.message}); kept fold only`);
    }
    return { foldPng, fullPng, fullHeight: captured };
  } finally {
    await conn.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}
