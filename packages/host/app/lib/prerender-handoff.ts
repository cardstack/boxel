// Hands a host-mode page over from the server's prerendered HTML to the live
// app without a blank frame, a reflow or a scroll jump.
//
// The prerendered markup sits between the two `x/boundary` scripts in
// index.html. While the app boots it stays in the page flow, visible and
// clickable, so its links work and the page scrolls at window level. The live
// host-mode element is pinned over the viewport, invisible and taking no
// pointer events, so it can load its card, fonts and images behind the
// prerender. When the primary card reports itself ready (or errored, or the
// wait times out), the visitor's scroll offset is carried onto the live
// scroll container, the live element fades in over the prerender, and only
// then is the prerendered markup removed and the live element put back in
// flow.

const READY_SELECTOR =
  '[data-host-mode-card-state="ready"], [data-host-mode-card-state="error"]';
const SCROLL_CONTAINER_SELECTOR = '[data-host-mode-card-scroll-container]';
const POLL_MS = 50;
const READY_TIMEOUT_MS = 15_000;
const MEDIA_TIMEOUT_MS = 1_500;
const FADE_MS = 180;

const PINNED_STYLE: Partial<Record<keyof CSSStyleDeclaration, string>> = {
  position: 'fixed',
  inset: '0',
  opacity: '0',
  pointerEvents: 'none',
  zIndex: '1',
};

export function prerenderedNodes(doc: Document = document): ChildNode[] {
  let start = doc.getElementById('boxel-isolated-start');
  let end = doc.getElementById('boxel-isolated-end');
  if (!start || !end) {
    return [];
  }
  let nodes: ChildNode[] = [];
  for (let node = start.nextSibling; node && node !== end; ) {
    nodes.push(node);
    node = node.nextSibling;
  }
  return nodes;
}

function hasVisiblePrerender(nodes: ChildNode[]) {
  return nodes.some(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE ||
      (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()),
  );
}

function prerenderScrollTop(nodes: ChildNode[]) {
  let scrollTop = window.scrollY;
  for (let node of nodes) {
    if (node instanceof HTMLElement) {
      scrollTop = Math.max(scrollTop, node.scrollTop);
    }
  }
  return scrollTop;
}

// The handoff waits for real paints, not the runloop. It only runs when the
// server sent prerendered markup, which tests don't.
function nextFrame() {
  // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waits for a paint before revealing the live page
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function withTimeout(promise: Promise<unknown>, ms: number) {
  return Promise.race([
    promise.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

// Fonts and the images already in the live card, so the first live frame
// looks like the prerender instead of popping them in after the swap.
async function mediaSettled(live: HTMLElement) {
  let images = [...live.querySelectorAll('img')].filter((img) => !img.complete);
  await withTimeout(
    Promise.all([document.fonts?.ready, ...images.map((img) => img.decode())]),
    MEDIA_TIMEOUT_MS,
  );
}

function waitForReady(live: HTMLElement, isCancelled: () => boolean) {
  return new Promise<void>((resolve) => {
    let started = Date.now();
    let check = () => {
      if (isCancelled()) {
        return resolve();
      }
      if (
        live.querySelector(READY_SELECTOR) ||
        Date.now() - started > READY_TIMEOUT_MS
      ) {
        return resolve();
      }
      setTimeout(check, POLL_MS);
    };
    check();
  });
}

// Starts the handoff for `live`, the host-mode content element. Returns a
// function that cancels it and puts the live element back in flow. Does
// nothing when the server sent no prerendered markup.
export function startPrerenderHandoff(live: HTMLElement): () => void {
  let nodes = prerenderedNodes();
  if (!hasVisiblePrerender(nodes)) {
    for (let node of nodes) {
      node.remove();
    }
    return () => {};
  }

  let saved = new Map<string, string>();
  for (let [key, value] of Object.entries(PINNED_STYLE)) {
    saved.set(key, (live.style as any)[key]);
    (live.style as any)[key] = value;
  }
  live.dataset.boxelHandoff = 'pending';

  let cancelled = false;
  let unpin = () => {
    for (let [key, value] of saved) {
      (live.style as any)[key] = value;
    }
    delete live.dataset.boxelHandoff;
  };

  (async () => {
    await waitForReady(live, () => cancelled);
    if (cancelled) {
      return;
    }
    await mediaSettled(live);
    await nextFrame();
    await nextFrame();
    if (cancelled) {
      return;
    }

    // Read the offset now, not at boot: the visitor may have scrolled the
    // prerender while the app loaded.
    let scrollTop = prerenderScrollTop(nodes);
    let scrollContainer =
      live.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR) ?? live;
    scrollContainer.scrollTop = scrollTop;

    let reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (!reduceMotion && typeof live.animate === 'function') {
      live.style.opacity = '1';
      await live
        .animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: FADE_MS,
          easing: 'ease-out',
        })
        .finished.catch(() => undefined);
    }
    if (cancelled) {
      return;
    }

    for (let node of nodes) {
      node.remove();
    }
    window.scrollTo(0, 0);
    unpin();
    // Back in flow the container is the same size, but re-apply in case the
    // browser clamped it while the element was pinned.
    scrollContainer.scrollTop = scrollTop;
  })();

  return () => {
    cancelled = true;
    for (let node of nodes) {
      node.remove();
    }
    unpin();
  };
}
