import Behavior from '@cardstack/boxel-motion/behaviors/base';
import { Value } from '@cardstack/boxel-motion/value';
import { assert } from '@ember/debug';

import { CopiedCSS, Snapshot } from '../utils/measurement';

import { Animator } from './animator';
import ContextAwareBounds, {
  Bounds,
  BoundsDelta,
} from './context-aware-bounds';

export interface ISpriteModifier {
  id: string;
  role: string | null;
  element: Element; // TODO can we change this to HTMLElement
}
export class SpriteIdentifier {
  id: string | null;
  role: string | null;

  // assign defaults here because we get inconsistent results from non-typesafe arguments from modifiers
  constructor(id: string | null = null, role: string | null = null) {
    this.id = id;
    this.role = role;
  }
  equals(other: SpriteIdentifier): boolean {
    return this.id === other.id && this.role === other.role;
  }
  toString(): string {
    return `id:${this.id};role:${this.role}`;
  }
}

export type MotionProperty = string;

interface InterpolatableMotionOptions {
  from: Value;
  to: Value;
  behavior: Behavior;
  velocity?: number;
}

interface NonInterpolatableMotionOptions {
  value: Value;
}

export interface MotionTiming {
  behavior: Behavior;
  delay?: number;
  duration?: number;
  easing?: string;
}

// TODO: this seems rather awful, let's find a better solution
export type MotionOptions = Partial<
  InterpolatableMotionOptions & NonInterpolatableMotionOptions
>;

export default class Sprite {
  element: HTMLElement;
  identifier: SpriteIdentifier;
  type: SpriteType | null = null;
  counterpart: Sprite | null = null;
  time: number;
  hidden = false;

  animatorAncestors: Animator[] = [];
  defaultAnimator: Animator | undefined = undefined;

  // These ones are non-null asserted because we should have them by the time we animate
  _defaultParentState!: { initial?: Snapshot; final?: Snapshot }; // This is set by the AnimationParticipantManager
  _contextElementState!: {
    initial: Snapshot;
    final: Snapshot;
  };

  constructor(
    element: HTMLElement,
    metadata: { id: string; role: string | null },
    public _state: {
      initial?: Snapshot;
      final?: Snapshot;
    },
    type: SpriteType,
    public callbacks: {
      onAnimationStart(animation: Animation): void;
    },
  ) {
    this.element = element;
    this.identifier = new SpriteIdentifier(metadata.id, metadata.role);
    this.type = type;
    this.time = new Date().getTime();
  }

  // TODO: when a sprite is placed within a context
  // AND it's Removed
  // AND it animates, we should move the DOMRef under the context's DOMRef
  // Also when it clones, this is a more specific case
  within(animator: Animator) {
    // An Animator ALWAYS has initial and final Snapshots
    // Otherwise it should not be eligible to animate (check definition of context.isStable)
    assert(
      'Animator always has initial and final Snapshots',
      animator._state.initial && animator._state.final,
    );

    this._contextElementState = animator._state;
    if (this.counterpart)
      this.counterpart._contextElementState = animator._state;
  }

  get initialBounds(): ContextAwareBounds | undefined {
    if (this._state.initial) {
      if (!this._defaultParentState?.initial) {
        throw new Error('Unexpected missing default parent initial bounds');
      }

      return new ContextAwareBounds({
        element: this._state.initial.bounds,
        parent: this._defaultParentState.initial.bounds,
        contextElement: this._contextElementState.initial.bounds,
      });
    } else {
      return undefined;
    }
  }

  get initialComputedStyle(): CopiedCSS | undefined {
    return this._state.initial?.styles;
  }

  get finalBounds(): ContextAwareBounds | undefined {
    if (this._state.final) {
      if (!this._defaultParentState?.final) {
        throw new Error('Unexpected missing default parent final bounds');
      }

      return new ContextAwareBounds({
        element: this._state.final.bounds,
        parent: this._defaultParentState.final.bounds,
        contextElement: this._contextElementState.final.bounds,
      });
    } else {
      return undefined;
    }
  }

  get finalComputedStyle(): CopiedCSS | undefined {
    return this._state.final?.styles;
  }

  get id(): string | null {
    return this.identifier.id;
  }
  get role(): string | null {
    return this.identifier.role;
  }

  get initialWidth(): number | undefined {
    return this.initialBounds?.element.width;
  }

  get initialHeight(): number | undefined {
    return this.initialBounds?.element.height;
  }

  get finalHeight(): number | undefined {
    return this.finalBounds?.element.height;
  }

  get finalWidth(): number | undefined {
    return this.finalBounds?.element.width;
  }

  get boundsDelta(): BoundsDelta | undefined {
    if (!this.initialBounds || !this.finalBounds) {
      return undefined;
    }
    let initialBounds = this.initialBounds.relativeToParent;
    let finalBounds = this.finalBounds.relativeToParent;
    return {
      x: finalBounds.left - initialBounds.left,
      y: finalBounds.top - initialBounds.top,
      width: finalBounds.width - initialBounds.width,
      height: finalBounds.height - initialBounds.height,
    };
  }

  get initial(): { [k in string]: Value } {
    let initialBounds = {};
    if (this.initialBounds) {
      let { x, y, width, height, top, right, bottom, left } =
        this.initialBounds.relativeToParent;

      initialBounds = {
        // TODO: maybe also for top/left?
        // TODO: figure out if we want the boundsDelta to be under these properties
        'translate-x': `${-(this.boundsDelta?.x ?? 0)}px`,
        'translate-y': `${-(this.boundsDelta?.y ?? 0)}px`,

        x: `${x}px`,
        y: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        top: `${top}px`,
        right: `${right}px`,
        bottom: `${bottom}px`,
        left: `${left}px`,
      };
    }

    return {
      ...this.initialComputedStyle,
      ...initialBounds,
    };
  }

  get final(): { [k in string]: Value } {
    let finalBounds = {};
    if (this.finalBounds) {
      let { x, y, width, height, top, right, bottom, left } =
        this.finalBounds.relativeToParent;

      finalBounds = {
        // TODO: maybe also for top/left?
        // TODO: figure out if we want the boundsDelta to be under these properties
        'translate-x': `${0}px`,
        'translate-y': `${0}px`,

        x: `${x}px`,
        y: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        top: `${top}px`,
        right: `${right}px`,
        bottom: `${bottom}px`,
        left: `${left}px`,
      };
    }

    return {
      ...this.finalComputedStyle,
      ...finalBounds,
    };
  }

  /*  get canBeGarbageCollected(): boolean {
    return this.type === SpriteType.Removed && this.hidden;
  }*/

  lockStyles(bounds: Bounds | null = null): void {
    if (!bounds) {
      if (this.initialBounds) {
        bounds = this.initialBounds.relativeToContext;
      } else {
        bounds = { left: 0, top: 0, width: 0, height: 0 };
      }
    }
    this.element.style.position = 'absolute';
    this.element.style.left = bounds.left + 'px';
    this.element.style.top = bounds.top + 'px';
    if (bounds.width) {
      this.element.style.width = bounds.width + 'px';
    }
    if (bounds.height) {
      this.element.style.height = bounds.height + 'px';
    }
  }

  unlockStyles(): void {
    this.element.style.removeProperty('position');
    this.element.style.removeProperty('left');
    this.element.style.removeProperty('top');
    this.element.style.removeProperty('width');
    this.element.style.removeProperty('height');
    this.element.style.removeProperty('opacity');
  }

  // hidden things get dropped at interruption
  /*  hide(): void {
    this.hidden = true;
    this.element.style.opacity = '0';
    this.element.setAttribute('data-sprite-hidden', 'true');
    this.element.getAnimations().forEach((a) => a.cancel());
  }*/
}

export enum SpriteType {
  Inserted = 'inserted',
  Removed = 'removed',
  Kept = 'kept',
  Intermediate = 'intermediate',
}
