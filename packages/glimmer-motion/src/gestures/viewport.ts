// @ts-nocheck — vendored verbatim from Motion's packages/framer-motion/src/motion/features/viewport/{index,observers}.ts (motion@bbabb00); imports re-pointed
import type { MotionNodeOptions as MotionProps } from 'motion-dom';
import { Feature } from 'motion-dom';

const thresholdNames = {
  some: 0,
  all: 1,
};

export class InViewFeature extends Feature<Element> {
  private hasEnteredView = false;

  private isInView = false;

  private stopObserver?: () => void;

  private startObserver() {
    this.stopObserver?.();

    const { viewport = {} } = this.node.getProps();
    const { root, margin: rootMargin, amount = 'some', once } = viewport;

    const options = {
      root: root ? root.current : undefined,
      rootMargin,
      threshold: typeof amount === 'number' ? amount : thresholdNames[amount],
    };

    const onIntersectionUpdate = (entry: IntersectionObserverEntry) => {
      const { isIntersecting } = entry;

      /**
       * If there's been no change in the viewport state, early return.
       */
      if (this.isInView === isIntersecting) {
        return;
      }

      this.isInView = isIntersecting;

      /**
       * Handle hasEnteredView. If this is only meant to run once, and
       * element isn't visible, early return. Otherwise set hasEnteredView to true.
       */
      if (once && !isIntersecting && this.hasEnteredView) {
        return;
      } else if (isIntersecting) {
        this.hasEnteredView = true;
      }

      if (this.node.animationState) {
        this.node.animationState.setActive('whileInView', isIntersecting);
      }

      /**
       * Use the latest committed props rather than the ones in scope
       * when this observer is created
       */
      const { onViewportEnter, onViewportLeave } = this.node.getProps();
      const callback = isIntersecting ? onViewportEnter : onViewportLeave;
      callback && callback(entry);
    };

    this.stopObserver = observeIntersection(
      this.node.current!,
      options,
      onIntersectionUpdate,
    );
  }

  mount() {
    this.startObserver();
  }

  update() {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    const { props, prevProps } = this.node;
    const hasOptionsChanged = ['amount', 'margin', 'root'].some(
      hasViewportOptionChanged(props, prevProps),
    );

    if (hasOptionsChanged) {
      this.startObserver();
    }
  }

  unmount() {
    this.stopObserver?.();
    this.hasEnteredView = false;
    this.isInView = false;
  }
}

function hasViewportOptionChanged(
  { viewport = {} }: MotionProps,
  { viewport: prevViewport = {} }: MotionProps = {},
) {
  return (name: keyof typeof viewport) => viewport[name] !== prevViewport[name];
}

type IntersectionHandler = (entry: IntersectionObserverEntry) => void;

interface ElementIntersectionObservers {
  [key: string]: IntersectionObserver;
}

/**
 * Map an IntersectionHandler callback to an element. We only ever make one handler for one
 * element, so even though these handlers might all be triggered by different
 * observers, we can keep them in the same map.
 */
const observerCallbacks = new WeakMap<Element, IntersectionHandler>();

/**
 * Multiple observers can be created for multiple element/document roots. Each with
 * different settings. So here we store dictionaries of observers to each root,
 * using serialised settings (threshold/margin) as lookup keys.
 */
const observers = new WeakMap<
  Element | Document,
  ElementIntersectionObservers
>();

const fireObserverCallback = (entry: IntersectionObserverEntry) => {
  const callback = observerCallbacks.get(entry.target);
  callback && callback(entry);
};

const fireAllObserverCallbacks: IntersectionObserverCallback = (entries) => {
  entries.forEach(fireObserverCallback);
};

function initIntersectionObserver({
  root,
  ...options
}: IntersectionObserverInit): IntersectionObserver {
  const lookupRoot = root || document;

  /**
   * If we don't have an observer lookup map for this root, create one.
   */
  if (!observers.has(lookupRoot)) {
    observers.set(lookupRoot, {});
  }
  const rootObservers = observers.get(lookupRoot)!;

  const key = JSON.stringify(options);

  /**
   * If we don't have an observer for this combination of root and settings,
   * create one.
   */
  if (!rootObservers[key]) {
    rootObservers[key] = new IntersectionObserver(fireAllObserverCallbacks, {
      root,
      ...options,
    });
  }

  return rootObservers[key];
}

function observeIntersection(
  element: Element,
  options: IntersectionObserverInit,
  callback: IntersectionHandler,
) {
  const rootInteresectionObserver = initIntersectionObserver(options);

  observerCallbacks.set(element, callback);
  rootInteresectionObserver.observe(element);

  return () => {
    observerCallbacks.delete(element);
    rootInteresectionObserver.unobserve(element);
  };
}
