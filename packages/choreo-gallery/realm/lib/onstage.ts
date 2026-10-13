import { modifier } from 'ember-modifier';

/**
 * Tell a demo whether anyone can see it.
 *
 * The gallery renders forty-two live demos at once. Most of them are cheap —
 * they are a handful of elements that move when you press something and sit
 * still otherwise. A few are not: Long Take and the mockup each own a WebGL
 * context and a render loop, and Drift runs a fixed-step integrator at 120Hz
 * with a canvas under it. Three of those scrolled off the top of the page are
 * three render loops burning frames for nobody.
 *
 * The cheapest fix would be to unmount them, and it is the wrong one: a stage
 * that unmounts loses the tune you gave it, the marks you laid and the laps you
 * set, and scrolling past your own work should not delete it. So the stage
 * stays mounted and stops WORKING — which is also what makes this safe to reach
 * for. Nothing here changes what a demo is, only whether it is running.
 *
 * `rootMargin` is generous on purpose. A demo that starts the instant its top
 * edge crosses the fold arrives already moving; one that waits for the exact
 * boundary arrives frozen and then jerks into life a frame later, which reads
 * as a bug rather than as an optimisation. The margin is measured against the
 * element that actually scrolls the stage — in the host that is the stack item
 * the card sits in, not the viewport — so a stage just below the item's edge is
 * already running when it scrolls in.
 */
/**
 * The nearest ancestor set to scroll, taken to be the one that does. That
 * holds where the gallery renders: a card's stack item is sized to its pane
 * and scrolls its content. The choice is made when the stage mounts, before
 * the content above and below it has necessarily rendered, so it goes by the
 * overflow style rather than by whether the box overflows yet. An ancestor
 * set to scroll that instead grows with its content clips nothing, and every
 * stage under it counts as visible: they keep running, which costs frames but
 * never freezes a demo someone is looking at.
 */
export function scrollRoot(el: Element): Element | null {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function roomOwner(el: Element): HTMLElement | null {
  const local = el.closest<HTMLElement>('[data-widget-active]');
  if (local) {
    return local;
  }
  try {
    const frame = el.ownerDocument.defaultView?.frameElement;
    return frame ? roomOwner(frame) : null;
  } catch {
    return null;
  }
}

/** Room focus overrides viewport visibility; the ordinary 2D gallery is unchanged. */
export function observeStage(
  el: Element,
  tell: (visible: boolean) => void,
  options: IntersectionObserverInit = { rootMargin: '200px' },
) {
  const owner = roomOwner(el);
  let intersecting = false;
  let previous: boolean | undefined;
  const update = () => {
    const visible = owner
      ? owner.dataset.widgetActive === 'true'
      : intersecting;
    if (visible !== previous) {
      previous = visible;
      tell(visible);
    }
  };
  const io = new IntersectionObserver(
    (entries) => {
      intersecting = entries.some((entry) => entry.isIntersecting);
      update();
    },
    { root: scrollRoot(el), ...options },
  );
  const changes = new MutationObserver(update);
  if (owner) {
    changes.observe(owner, {
      attributes: true,
      attributeFilter: ['data-widget-active'],
    });
  }
  let connected = true;
  io.observe(el);
  // Visibility may update tracked demo state; run after Glimmer's render pass.
  queueMicrotask(() => {
    if (connected) {
      update();
    }
  });
  return {
    disconnect() {
      connected = false;
      io.disconnect();
      changes.disconnect();
    },
  };
}

export const onStage = modifier(
  (el: HTMLElement, [tell]: [(visible: boolean) => void]) => {
    const observer = observeStage(el, tell);
    return () => {
      observer.disconnect();
      tell(false);
    };
  },
);

/**
 * Stop a card's CSS animations while nobody can see it.
 *
 * `onStage` above is for demos that own a loop and can be told to stop. This is
 * for the other twenty-odd, which own no loop at all and animate purely in CSS
 * — and between them, on an idle gallery, they were running twenty-five
 * animations at once with fourteen of those coming from one stage. Nothing was
 * broken; it is simply that a page of forty-two live demos is a page of
 * forty-two things that never rest, and the crossing has to share a thread with
 * all of them.
 *
 * It toggles a class rather than touching the animations, because
 * `animation-play-state` is inherited-by-selector and pauses a whole subtree in
 * one declaration — including animations that were declared by a stage this
 * file has never heard of. Pausing is also the right verb: a paused animation
 * keeps its position, so a card scrolled away and back does not restart its
 * decoration from frame zero, which would be a worse artefact than the cost it
 * saves.
 *
 * Web Animations — Motion's own — need the second half, because
 * `animation-play-state` cannot reach them: they are script-driven and have no
 * CSS animation to pause. The ordinary gallery pauses only endless effects,
 * allowing finite transitions to settle offscreen. The 3D room instead holds
 * every effect at its current frame until that one tile receives camera focus.
 *
 * `iterations` reads as `Infinity` or, for some engines, `null` — both mean the
 * same thing here and both are checked.
 */
const endless = (a: Animation) => {
  const n = a.effect?.getTiming?.().iterations;
  return n === Infinity || n === null;
};

// Batch geometry/style reads for every affected tile before changing any of
// their animation states. One subtree scan per frame, never one per style write.
const pendingRest = new Map<HTMLElement, (animations: Animation[]) => void>();
let restFrame = 0;
function scheduleRest(
  el: HTMLElement,
  apply: (animations: Animation[]) => void,
) {
  pendingRest.set(el, apply);
  if (restFrame) {
    return;
  }
  restFrame = requestAnimationFrame(() => {
    restFrame = 0;
    const reads = [...pendingRest].map(([element, fn]) => ({
      fn,
      animations: element.getAnimations({ subtree: true }),
    }));
    pendingRest.clear();
    for (const { fn, animations } of reads) {
      fn(animations);
    }
  });
}

export const restWhenOff = modifier((el: HTMLElement) => {
  const room = !!roomOwner(el);
  let active = false;
  const paused = new Set<Animation>();
  let closed = false;
  const apply = (animations: Animation[]) => {
    if (closed) {
      return;
    }
    el.classList.toggle('is-resting', !active);
    for (const animation of animations) {
      if (!room && !endless(animation)) {
        continue;
      }
      if (!active && animation.playState === 'running') {
        animation.pause();
        paused.add(animation);
      }
    }
    if (active) {
      for (const animation of paused) {
        if (animation.playState === 'paused') {
          animation.play();
        }
      }
      paused.clear();
    }
  };
  const settle = () => scheduleRest(el, apply);
  const observer = observeStage(el, (visible) => {
    active = visible;
    settle();
  });
  // Catch animations created by a pending render while this card is frozen.
  const changes = new MutationObserver(() => {
    if (!active) {
      settle();
    }
  });
  changes.observe(el, {
    childList: true,
    subtree: true,
    attributes: room,
    attributeFilter: room ? ['style'] : undefined,
  });
  el.addEventListener('animationstart', settle);
  return () => {
    observer.disconnect();
    changes.disconnect();
    el.removeEventListener('animationstart', settle);
    pendingRest.delete(el);
    active = true;
    apply([]);
    closed = true;
  };
});

export default onStage;
