/**
 * scrollProgress / InView for Glimmer — Motion's value/use-scroll.ts and utils/use-in-view.ts over the
 * vendored scroll() / inView() (src/dom). React refs become modifiers placed on the elements:
 *
 *   s = scrollProgress({ offset: ['start end', 'end start'] })
 *   <div {{s.container}}> <section {{s.target}}> … </section> </div>   → s.scrollYProgress is a MotionValue
 *   <div {{s.track}}>                                                   → window scroll, no container/target
 *
 *   v = new InView({ once: true })
 *   <div {{v.observe}}>                                                 → v.isInView is tracked
 *
 * `useScroll` / `useInView` are React's names for React's rules-of-hooks; there
 * are no hooks here, and a `use` prefix on something you call once in a class
 * body is a translation artefact. Both names survive as deprecated aliases.
 */
import { tracked } from '@glimmer/tracking';
import { type FunctionBasedModifier, modifier } from 'ember-modifier';
import { type MotionValue, motionValue } from 'motion-dom';

import { scroll } from './dom/scroll/index.ts';
import type { ScrollInfo, ScrollInfoOptions } from './dom/scroll/types.ts';
import { inView, type InViewOptions } from './dom/viewport.ts';

export type UseScrollOptions = Omit<ScrollInfoOptions, 'container' | 'target'>;

/** a modifier with no arguments: `<div {{s.container}}>` */
export type ElementModifier = FunctionBasedModifier<{
  Args: { Named: Record<string, never>; Positional: [] };
  Element: Element;
}>;

export interface ScrollValues {
  /** the scrollable element (default: the document) */
  container: ElementModifier;
  scrollX: MotionValue<number>;
  scrollXProgress: MotionValue<number>;
  scrollY: MotionValue<number>;
  scrollYProgress: MotionValue<number>;
  start(): void;
  stop(): void;
  /** the element whose position within the container is tracked */
  target: ElementModifier;
  /** track the document scroll without a container or target — place it anywhere that lives as long as the values */
  track: ElementModifier;
}

export function scrollProgress(options: UseScrollOptions = {}): ScrollValues {
  const values = {
    scrollX: motionValue(0),
    scrollY: motionValue(0),
    scrollXProgress: motionValue(0),
    scrollYProgress: motionValue(0),
  };
  let container: Element | undefined, target: Element | undefined;
  let stop: VoidFunction | undefined;
  let attached = 0;
  const start = () => {
    stop?.();
    stop = scroll(
      (_progress: number, { x, y }: ScrollInfo) => {
        values.scrollX.set(x.current);
        values.scrollXProgress.set(x.progress);
        values.scrollY.set(y.current);
        values.scrollYProgress.set(y.progress);
      },
      { ...options, container, target },
    );
  };
  const end = () => {
    stop?.();
    stop = undefined;
  };
  const attach = (set: (el: Element | undefined) => void): ElementModifier =>
    modifier<{
      Args: { Named: Record<string, never>; Positional: [] };
      Element: Element;
    }>((el) => {
      set(el);
      attached++;
      start(); // refs attach in any order; each one restarts tracking with what is known so far
      return () => {
        set(undefined);
        if (--attached) {
          start();
        } else {
          end();
        }
      };
    });
  return {
    ...values,
    container: attach((el) => {
      container = el;
    }),
    target: attach((el) => {
      target = el;
    }),
    track: attach(() => {}),
    start,
    stop: end,
  };
}

export interface UseInViewOptions extends Omit<InViewOptions, 'root'> {
  initial?: boolean;
  once?: boolean;
  root?: Element | Document | { current: Element | null };
}

export class InView {
  @tracked isInView: boolean;
  private options: UseInViewOptions;
  constructor(options: UseInViewOptions = {}) {
    this.options = options;
    this.isInView = options.initial ?? false;
  }
  observe: ElementModifier = modifier<{
    Args: { Named: Record<string, never>; Positional: [] };
    Element: Element;
  }>((el) => {
    const { root, margin, amount, once = false } = this.options;
    if (once && this.isInView) {
      return;
    }
    return inView(
      el,
      () => {
        this.isInView = true;
        return once
          ? undefined
          : () => {
              this.isInView = false;
            };
      },
      {
        root: (root && 'current' in root ? root.current : root) || undefined,
        margin,
        amount,
      },
    );
  });
}

/** @deprecated React's name for it. Use `scrollProgress()`. */
export const useScroll = scrollProgress;

/** @deprecated React's name for it. Use `new InView(options)`. */
export const useInView = (options?: UseInViewOptions) => new InView(options);
