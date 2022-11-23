import { FPS } from '@cardstack/boxel-motion/behaviors/base';
import LinearBehavior from '@cardstack/boxel-motion/behaviors/linear';
import SpringBehavior from '@cardstack/boxel-motion/behaviors/spring';
import {
  Opacity,
  OpacityOptions,
} from '@cardstack/boxel-motion/motions/opacity';

import { assert } from '@ember/debug';

import Motion from '../motions/base';
import { CssMotion, CssMotionOptions } from '../motions/css-motion';
import { Move, MoveOptions } from '../motions/move';
import { Resize, ResizeOptions } from '../motions/resize';

import { CopiedCSS, Snapshot } from '../utils/measurement';

import { Animator } from './animator';
import ContextAwareBounds, {
  Bounds,
  BoundsDelta,
} from './context-aware-bounds';
import { SpriteAnimation } from './sprite-animation';

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

export type MotionProperty = 'opacity' | 'position' | 'size' | 'style';
export type MotionOptions = Partial<
  OpacityOptions | MoveOptions | ResizeOptions | CssMotionOptions
>;

export default class Sprite {
  element: HTMLElement;
  identifier: SpriteIdentifier;
  type: SpriteType | null = null;
  counterpart: Sprite | null = null;
  motions: Motion[] = [];
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
      lastAttached?: Snapshot;
    },
    type: SpriteType,
    public callbacks: {
      onAnimationStart(animation: Animation): void;
    }
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
      animator._state.initial && animator._state.final
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

  get lastAttachedBounds(): ContextAwareBounds | undefined {
    if (this._state.lastAttached) {
      if (!this._defaultParentState?.initial) {
        throw new Error('Unexpected missing default parent initial bounds');
      }

      return new ContextAwareBounds({
        element: this._state.lastAttached.bounds,
        parent: this._defaultParentState.initial.bounds,
        contextElement: this._contextElementState.initial.bounds,
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

  get canBeGarbageCollected(): boolean {
    return this.type === SpriteType.Removed && this.hidden;
  }

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
  hide(): void {
    this.hidden = true;
    this.element.style.opacity = '0';
    this.element.setAttribute('data-sprite-hidden', 'true');
    this.element.getAnimations().forEach((a) => a.cancel());
    this.motions = [];
  }

  setupAnimation(property: MotionProperty, opts: MotionOptions): void {
    // TODO: this applies to any "non-Tween" based behavior, currently only Spring
    assert(
      'Passing a duration is not necessary when using a Spring behavior',
      (opts.duration === undefined &&
        opts.behavior instanceof SpringBehavior) ||
        !(opts.behavior instanceof SpringBehavior)
    );
    // TODO: this applies to any "Tween" based behavior, currently only Linear
    assert(
      'You must pass a duration when using a Linear behavior',
      (opts.duration !== undefined &&
        opts.behavior instanceof LinearBehavior) ||
        !(opts.behavior instanceof LinearBehavior)
    );

    switch (property) {
      case 'opacity':
        this.motions.push(new Opacity(this, opts));
        break;
      case 'position':
        this.motions.push(new Move(this, opts));
        break;
      case 'size':
        this.motions.push(new Resize(this, opts));
        break;
      case 'style':
        this.motions.push(new CssMotion(this, opts));
        break;
      default:
        // noop
        break;
    }
  }

  /**
   * Compiles the current motions setup on the Sprite into a single set of keyframes.
   */
  compileCurrentAnimations() {
    if (!this.motions.length) {
      return;
    }

    assert('Hidden sprite cannot be animated', !this.hidden);
    let keyframes = this.motions.reduce((lastKeyframes, motion) => {
      motion.applyBehavior(undefined);

      let count = Math.max(lastKeyframes.length, motion.keyframes.length);
      let result: Keyframe[] = [];
      for (let i = 0; i < count; i++) {
        // TODO: this merge algorithm is too naïve, it implies we can have only 1 of each CSS property or it will be overridden
        // we copy the final frame of a motion if there is another motion that takes longer
        result.push({
          ...(lastKeyframes?.[i] ?? lastKeyframes[lastKeyframes.length - 1]),
          ...(motion.keyframes?.[i] ??
            motion.keyframes[motion.keyframes.length - 1]),
        });
      }
      return result;
    }, [] as Keyframe[]);

    // We can clear these as we've compiled them already.
    this.motions = [];

    // calculate "real" duration based on amount of keyframes at the given FPS
    let duration = Math.max(0, (keyframes.length - 1) / FPS);

    return {
      keyframes,
      duration,
    };
  }

  compileAnimation({
    time,
  }: {
    time?: number;
  } = {}): SpriteAnimation | undefined {
    if (!this.motions.length) {
      return;
    }

    assert('Hidden sprite cannot be animated', !this.hidden);
    let keyframes = this.motions.reduce((previousKeyframes, motion) => {
      motion.applyBehavior(time);

      let count = Math.max(previousKeyframes.length, motion.keyframes.length);
      let result: Keyframe[] = [];
      for (let i = 0; i < count; i++) {
        // TODO: this merge algorithm is too naïve, it implies we can have only 1 of each CSS property or it will be overridden
        // we copy the final frame of a motion if there is another motion that takes longer
        result.push({
          ...(previousKeyframes?.[i] ??
            previousKeyframes[previousKeyframes.length - 1]),
          ...(motion.keyframes?.[i] ??
            motion.keyframes[motion.keyframes.length - 1]),
        });
      }
      return result;
    }, [] as Keyframe[]);

    // We can clear these as we've compiled them already.
    this.motions = [];

    // calculate "real" duration based on amount of keyframes at the given FPS
    let duration = Math.max(0, (keyframes.length - 1) / FPS);

    let keyframeAnimationOptions = {
      easing: 'linear',
      duration,
    };

    // TODO: We need the animationstart callback passed in here
    return new SpriteAnimation(
      this,
      keyframes,
      keyframeAnimationOptions,
      this.callbacks.onAnimationStart
    );
  }
}

export enum SpriteType {
  Inserted = 'inserted',
  Removed = 'removed',
  Kept = 'kept',
  Intermediate = 'intermediate',
}
