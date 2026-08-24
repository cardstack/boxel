/**
 * Text delivery — `@by='word' | 'character' | 'paragraph'` (§4.3).
 *
 * The split is a run-time costume, not a render: the sprite's own text
 * nodes are lifted out whole and kept (Glimmer still owns them — a tracked
 * update mid-flight writes into the detached node and comes back at
 * restore), stand-in spans deliver the animation, and the restore puts the
 * original nodes back exactly where they were. Assistive tech reads the
 * full text throughout: the container carries it as a label while the
 * chopped-up copy is hidden.
 *
 * Slots play on the platform's own animations (WAAPI), not the engine:
 * they are ephemeral, their schedule is computed once, and a spring's
 * clock arrives pre-sampled through the generator — the same shape the
 * native driver uses for everything.
 */
import {
  calcGeneratorDuration,
  generateLinearEasing,
  maxGeneratorDuration,
  spring,
} from 'motion-dom';

import type {
  Cue,
  DeliveryBy,
  Easing,
  PropValue,
  SpringSpec,
} from './types.ts';

type EasingFunction = (t: number) => number;
import { ladder } from './compile.ts';

interface Slot {
  el: HTMLElement;
}

interface Split {
  /** put the original nodes back; safe to call twice */
  restore(): void;
  slots: Slot[];
}

const spanFor = (text: string): HTMLElement => {
  const span = document.createElement('span');
  span.textContent = text;
  span.setAttribute('aria-hidden', 'true');
  span.style.display = 'inline-block';
  span.style.whiteSpace = 'pre';
  return span;
};

function textNodesOf(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.textContent ?? '').length) {
      out.push(n as Text);
    }
  }
  return out;
}

function unitsOf(text: string, by: 'character' | 'word'): string[] {
  if (by === 'character') {
    return Array.from(text);
  }
  // words keep their trailing whitespace so the line reassembles exactly
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export function split(el: HTMLElement, by: Exclude<DeliveryBy, 'item'>): Split {
  if (by === 'paragraph') {
    // each element child is a slot; nothing is rewritten
    const slots = Array.from(el.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement,
    );
    if (!slots.length) {
      throw new Error(
        "choreo: @by='paragraph' needs child elements to deliver",
      );
    }
    return { restore() {}, slots: slots.map((s) => ({ el: s })) };
  }
  const originals = textNodesOf(el);
  if (!originals.length) {
    throw new Error(`choreo: @by='${by}' needs text to deliver`);
  }
  const label = el.getAttribute('aria-label');
  el.setAttribute('aria-label', el.textContent ?? '');
  const slots: Slot[] = [];
  const undo: (() => void)[] = [];
  for (const node of originals) {
    const parent = node.parentNode!;
    const marker = document.createComment('choreo-delivery');
    parent.replaceChild(marker, node);
    const spans: HTMLElement[] = [];
    for (const unit of unitsOf(node.textContent ?? '', by)) {
      const span = spanFor(unit);
      parent.insertBefore(span, marker);
      spans.push(span);
      if (by === 'character' && /^\s+$/.test(unit)) {
        continue; // whitespace travels, but is not a slot of its own
      }
      slots.push({ el: span });
    }
    undo.push(() => {
      for (const span of spans) {
        span.remove();
      }
      marker.parentNode?.replaceChild(node, marker);
    });
  }
  let restored = false;
  return {
    restore() {
      if (restored) {
        return;
      }
      restored = true;
      undo.reverse().forEach((fn) => fn());
      if (label === null) {
        el.removeAttribute('aria-label');
      } else {
        el.setAttribute('aria-label', label);
      }
    },
    slots,
  };
}

/* ---- the slot schedule: windows inside the step's span (§4.3) ---- */

export interface Window {
  at: number;
  ms: number;
}

/**
 * `@stagger` seconds between starts, window = what remains of the span; with
 * no stagger, the Build Order demo's policy: a 0.55-of-span window with the
 * starts distributed across the remainder.
 */
export function windows(n: number, span: number, stagger: number): Window[] {
  if (n <= 1 || span <= 0) {
    return Array.from({ length: n }, () => ({ at: 0, ms: span }));
  }
  if (stagger > 0) {
    const ms = Math.max(1, span - (n - 1) * stagger);
    return Array.from({ length: n }, (_, i) => ({ at: i * stagger, ms }));
  }
  const ms = span * 0.55;
  return Array.from({ length: n }, (_, i) => ({
    at: (i * (span - ms)) / (n - 1),
    ms,
  }));
}

/* ---- keyframes and easing for the platform's animations ---- */

const UNITLESS = new Set(['opacity', 'scale', 'scaleX', 'scaleY']);
const TRANSFORMS: Record<string, (v: string) => string> = {
  rotate: (v) => `rotate(${v}deg)`,
  scale: (v) => `scale(${v})`,
  x: (v) => `translateX(${v}px)`,
  y: (v) => `translateY(${v}px)`,
};

/** cue.target, as WAAPI property-indexed keyframes */
export function keyframesOf(
  target: Record<string, unknown>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const transforms = new Map<string, string[]>();
  for (const key in target) {
    const raw = target[key];
    const values = (Array.isArray(raw) ? raw : [raw]).map(String);
    if (TRANSFORMS[key]) {
      transforms.set(key, values);
    } else {
      out[UNITLESS.has(key) || isNaN(Number(values[0])) ? key : key] = values;
    }
  }
  if (transforms.size) {
    const length = Math.max(...[...transforms.values()].map((v) => v.length));
    const frames: string[] = [];
    for (let i = 0; i < length; i++) {
      const parts: string[] = [];
      for (const [key, values] of transforms) {
        parts.push(TRANSFORMS[key]!(values[Math.min(i, values.length - 1)]!));
      }
      frames.push(parts.join(' '));
    }
    out['transform'] = frames;
  }
  return out;
}

const NAMED: Record<string, string> = {
  easeIn: 'ease-in',
  easeInOut: 'ease-in-out',
  easeOut: 'ease-out',
  linear: 'linear',
};

export function cssEasing(ease: Easing | undefined, ms: number): string {
  if (ease === undefined) {
    return 'ease-in-out';
  }
  if (typeof ease === 'string') {
    return NAMED[ease] ?? 'ease-in-out';
  }
  if (Array.isArray(ease)) {
    return `cubic-bezier(${ease.join(',')})`;
  }
  return generateLinearEasing(ease as EasingFunction, ms);
}

/** a spring's clock, pre-sampled: its real duration and a linear() easing */
export function springEasing(spec: SpringSpec | undefined): {
  easing: string;
  ms: number;
} {
  const generator = spring({ keyframes: [0, 100], ...(spec ?? {}) });
  const ms = Math.min(calcGeneratorDuration(generator), maxGeneratorDuration);
  const progress: EasingFunction = (t: number) =>
    generator.next(t * ms).value / 100;
  return { easing: generateLinearEasing(progress, ms), ms };
}

export interface Delivery {
  cancel(): void;
  finished: Promise<void>;
}

/** play one delivery cue: split, animate the slots, restore, land the end values */
export function deliver(cue: Cue, speed: number): Delivery {
  const { by, order, stagger } = cue.delivery!;
  if (by === 'item') {
    throw new Error('choreo: item delivery is the ladder, not a split');
  }
  const parts = split(cue.sprite.element, by);
  const ranks = ladder(parts.slots.length, order);
  const spans = windows(parts.slots.length, cue.duration, stagger);
  const keyframes = keyframesOf(cue.target ?? {});
  const isSpring = cue.kind === 'spring';
  const sprung = isSpring
    ? springEasing(cue.transition as SpringSpec | undefined)
    : undefined;
  const animations: Animation[] = [];
  for (const [index, slot] of parts.slots.entries()) {
    const w = spans[ranks[index] ?? index]!;
    const ms = sprung ? Math.min(sprung.ms, w.ms) : w.ms;
    animations.push(
      slot.el.animate(keyframes as PropertyIndexedKeyframes, {
        delay: w.at * speed,
        duration: Math.max(1, ms * speed),
        easing: sprung
          ? sprung.easing
          : cssEasing(
              (cue.transition as { ease?: Easing } | undefined)?.ease,
              ms,
            ),
        fill: 'both',
      }),
    );
  }
  let done = false;
  const land = () => {
    if (done) {
      return;
    }
    done = true;
    // the whole sprite sits at the delivery's end values once the slots go
    const ve = cue.sprite.node.visualElement;
    if (ve && cue.target) {
      for (const key in cue.target) {
        const raw = cue.target[key];
        const end = Array.isArray(raw) ? raw[raw.length - 1] : raw;
        ve.getValue(key, end as PropValue)!.jump(end as PropValue);
      }
      ve.render();
    }
    parts.restore();
  };
  const finished = Promise.all(
    animations.map((a) => a.finished.catch(() => {})),
  ).then(land);
  return {
    cancel() {
      done = true; // interrupted: original nodes back, stylesheet's values
      animations.forEach((a) => a.cancel());
      parts.restore();
    },
    finished,
  };
}
