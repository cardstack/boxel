/**
 * A memory: an element that has left, kept on screen for as long as its exit
 * plays. `<Presence @mode="snapshot">` keeps a copy of its leaver as one, and
 * a layer that parks removed elements itself (Choreo's orphan layer) keeps
 * each element it parks as one, so a leaver looks and behaves the same
 * whichever layer let it go.
 *
 * A memory shows the frame its element last showed, and nothing in it acts:
 *
 * - Its CSS animations hold still. An element put back in the document
 *   restarts every stylesheet animation on it, so an entrance that had
 *   finished would play again while the element leaves. Each animation the
 *   element was showing pauses at the time it had reached, and any other (one
 *   that had finished, or one the re-insertion started) jumps to its end.
 *   Animations on a scroll timeline follow the restored scroll offsets. The
 *   engine's own animations are not stylesheet animations, and are left
 *   alone.
 * - Its scroll offsets are restored: an element taken out of the document
 *   loses them.
 * - Its backdrop filters are off. A backdrop filter re-samples whatever is
 *   behind it on every frame, at full price inside a moving, fading element,
 *   and what is behind a memory is the scene that replaced it.
 * - It is composited as one texture (`will-change: transform, opacity`).
 * - It is inert and hidden from assistive technology.
 * - Its HTML elements carry no ids, `autofocus` or form-control names. A
 *   duplicate id that comes first in the document is what `getElementById`
 *   and `<label for>` find, and a checked radio button joining the document
 *   unchecks the live one in its group. Its SVG elements keep their ids,
 *   which its own fills, clips, masks and `<use>` references resolve through.
 *   Its iframes are blank, and its media neither plays nor loads.
 * - Its test hooks carry a suffix: `data-test-title` becomes
 *   `data-test-title-memory`, with its value. A test's selector finds only the
 *   live element, which is what replaced the leaver or nothing, and a test that
 *   means the leaver names it with the suffix. `live()` and `liveAll()` in
 *   `glimmer-motion/test-support` skip memories for every other selector.
 *
 * Custom elements in a memory are connected again, and run their
 * `connectedCallback`.
 */

/** the attribute every memory carries */
export const MEMORY_ATTRIBUTE = 'data-motion-memory';

/** what a memory's `data-test-*` hooks are renamed with */
export const MEMORY_HOOK_SUFFIX = '-memory';

export interface ScrollPosition {
  left: number;
  top: number;
}

/** a CSS animation on the document timeline that an element was showing */
export interface ShownAnimation {
  finished: boolean;
  /** its `animation-name` */
  name: string;
  /** the pseudo-element it runs on, or null for the element itself */
  pseudoElement: string | null;
  /** its current time, in milliseconds */
  time: number;
}

/** what a subtree showed before the render that removed it, for its memory to show */
export interface Shown {
  /** the CSS animations each element was showing */
  animations: { get(el: Element): readonly ShownAnimation[] | undefined };
  /** each element's scroll offset */
  scrolls: { get(el: Element): ScrollPosition | undefined };
}

/** form controls whose name would join a live radio group or form submission */
const NAMED_CONTROLS =
  'input, select, textarea, button, fieldset, output, object, form, iframe';

/** the element and every element inside it, in document order */
export function elementsOf(root: Element): Element[] {
  return [root, ...root.querySelectorAll('*')];
}

/** a stylesheet animation on the document timeline: a scroll-driven one follows its scroller instead */
function onDocumentTimeline(animation: Animation): animation is CSSAnimation {
  return (
    animation instanceof CSSAnimation &&
    animation.timeline === document.timeline
  );
}

/**
 * The CSS animations on the document timeline that `root` and the elements
 * inside it are showing, by the element each runs on. Read it while `root` is
 * still in the document: a removed element has none.
 */
export function readAnimations(root: Element): Map<Element, ShownAnimation[]> {
  const shown = new Map<Element, ShownAnimation[]>();
  for (const animation of root.getAnimations({ subtree: true })) {
    const effect = animation.effect;
    if (
      !onDocumentTimeline(animation) ||
      !(effect instanceof KeyframeEffect) ||
      !effect.target
    ) {
      continue;
    }
    const list = shown.get(effect.target) ?? [];
    list.push({
      finished: animation.playState === 'finished',
      name: animation.animationName,
      pseudoElement: effect.pseudoElement,
      time: Number(animation.currentTime ?? 0),
    });
    shown.set(effect.target, list);
  }
  return shown;
}

/** the scroll offsets of `root` and of every element inside it that is scrolled */
export function readScrolls(root: Element): Map<Element, ScrollPosition> {
  const scrolls = new Map<Element, ScrollPosition>();
  for (const el of elementsOf(root)) {
    if (el.scrollTop || el.scrollLeft) {
      scrolls.set(el, { top: el.scrollTop, left: el.scrollLeft });
    }
  }
  return scrolls;
}

/** what `root` shows now. Read it while `root` is still in the document. */
export function readShown(root: Element): Shown {
  return { animations: readAnimations(root), scrolls: readScrolls(root) };
}

/** what `original` showed, moved onto the matching elements of `copy`, a deep clone of it */
export function shownOnCopy(
  shown: Shown,
  original: Element,
  copy: Element,
): Shown {
  const from = elementsOf(original);
  const to = elementsOf(copy);
  const animations = new Map<Element, readonly ShownAnimation[]>();
  const scrolls = new Map<Element, ScrollPosition>();
  from.forEach((el, i) => {
    const counterpart = to[i];
    if (!counterpart) {
      return;
    }
    const animation = shown.animations.get(el);
    if (animation) {
      animations.set(counterpart, animation);
    }
    const scroll = shown.scrolls.get(el);
    if (scroll) {
      scrolls.set(counterpart, scroll);
    }
  });
  return { animations, scrolls };
}

/**
 * Records the scroll offset of every element inside `root` as it scrolls. For
 * a layer that learns which elements left only after the render that removed
 * them, by when their offsets are gone.
 */
export function trackScrolls(root: Element): {
  scrolls: Shown['scrolls'];
  stop(): void;
} {
  const scrolls = new WeakMap<Element, ScrollPosition>();
  const record = (event: Event) => {
    const el = event.target;
    if (el instanceof Element) {
      scrolls.set(el, { top: el.scrollTop, left: el.scrollLeft });
    }
  };
  // scroll events do not bubble, but they do pass ancestors while capturing
  root.addEventListener('scroll', record, { capture: true, passive: true });
  return {
    scrolls,
    stop: () => root.removeEventListener('scroll', record, { capture: true }),
  };
}

let memoryStyle: HTMLStyleElement | undefined;

function ensureMemoryStyle() {
  if (memoryStyle?.isConnected) {
    return;
  }
  const m = `[${MEMORY_ATTRIBUTE}]`;
  memoryStyle = document.createElement('style');
  memoryStyle.setAttribute('data-motion-memory-style', '');
  memoryStyle.textContent =
    `${m},${m}::before,${m}::after,${m} *,${m} *::before,${m} *::after` +
    '{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}';
  document.head.appendChild(memoryStyle);
}

/** nothing in a memory can be found by id or test hook, submitted, focused, loaded or played */
function neutralize(el: Element) {
  for (const name of el.getAttributeNames()) {
    if (name === 'data-test' || name.startsWith('data-test-')) {
      el.setAttribute(`${name}${MEMORY_HOOK_SUFFIX}`, el.getAttribute(name)!);
      el.removeAttribute(name);
    }
  }
  if (!(el instanceof SVGElement)) {
    el.removeAttribute('id');
  }
  el.removeAttribute('autofocus');
  if (el.matches(NAMED_CONTROLS)) {
    el.removeAttribute('name');
  }
  if (el instanceof HTMLIFrameElement) {
    el.removeAttribute('srcdoc');
    el.src = 'about:blank';
  } else if (el instanceof HTMLMediaElement) {
    el.removeAttribute('autoplay');
    el.preload = 'none';
  }
}

/** each stylesheet animation pauses where it was shown, or jumps to its end */
function holdAnimations(root: Element, shown: Shown['animations']) {
  for (const animation of root.getAnimations({ subtree: true })) {
    const effect = animation.effect;
    if (!onDocumentTimeline(animation) || !(effect instanceof KeyframeEffect)) {
      continue;
    }
    const was = effect.target
      ? shown
          .get(effect.target)
          ?.find(
            (a) =>
              a.name === animation.animationName &&
              a.pseudoElement === effect.pseudoElement,
          )
      : undefined;
    try {
      if (was && !was.finished) {
        animation.pause();
        animation.currentTime = was.time;
      } else {
        animation.finish();
      }
    } catch {
      // an endless animation has no end to jump to
      animation.cancel();
    }
  }
}

/**
 * Makes `root` a memory of what `shown` describes, and puts it back in the
 * document with `insert`. Ids, form-control names and test hooks are changed
 * before `insert` runs, so none of them joins the document even for a moment;
 * scroll offsets and animations are restored after it, in the same task, so
 * no frame shows them reset. Whatever is already in a memory (a leaver lifted
 * out of one that left with it, a copy still fading inside a leaver) is put
 * back and restored, and not changed twice.
 */
export function keepAsMemory(
  root: HTMLElement | SVGElement,
  shown: Shown,
  insert: () => void,
) {
  ensureMemoryStyle();
  const elements = elementsOf(root);
  for (const el of elements) {
    if (!el.closest(`[${MEMORY_ATTRIBUTE}]`)) {
      neutralize(el);
    }
  }
  root.setAttribute(MEMORY_ATTRIBUTE, '');
  root.setAttribute('inert', '');
  root.setAttribute('aria-hidden', 'true');
  root.style.willChange = 'transform, opacity';
  insert();
  for (const el of elements) {
    const scroll = shown.scrolls.get(el);
    if (scroll) {
      el.scrollTop = scroll.top;
      el.scrollLeft = scroll.left;
    }
  }
  holdAnimations(root, shown.animations);
}
