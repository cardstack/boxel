import ContextAwareBounds, {
  Bounds,
  BoundsDelta,
} from './context-aware-bounds';
import {
  CopiedCSS,
  getDocumentPosition,
  calculateBoundsVelocity,
} from '../utils/measurement';
import { SpriteAnimation } from './sprite-animation';
import Motion from '../motions/base';
import { Opacity, OpacityOptions } from 'animations-experiment/motions/opacity';
import { Move, MoveOptions } from '../motions/move';
import { Resize, ResizeOptions } from '../motions/resize';
import { CssMotion, CssMotionOptions } from '../motions/css-motion';
import { FPS } from 'animations-experiment/behaviors/base';
import { assert } from '@ember/debug';
import SpringBehavior from 'animations-experiment/behaviors/spring';
import LinearBehavior from 'animations-experiment/behaviors/linear';

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

export default class Sprite {
  element: HTMLElement;
  identifier: SpriteIdentifier;
  type: SpriteType | null = null;
  initialBounds: ContextAwareBounds | undefined;
  finalBounds: ContextAwareBounds | undefined;
  initialComputedStyle: CopiedCSS | undefined;
  finalComputedStyle: CopiedCSS | undefined;
  counterpart: Sprite | null = null; // the sent sprite if this is the received sprite, or vice versa
  motions: Motion[] = [];
  time: number;
  hidden = false;

  constructor(
    element: HTMLElement,
    id: string | null,
    role: string | null,
    type: SpriteType | null
  ) {
    this.element = element;
    this.identifier = new SpriteIdentifier(id, role);
    this.type = type;
    this.time = new Date().getTime();
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
    let initialBounds = this.initialBounds.relativeToContext;
    let finalBounds = this.finalBounds.relativeToContext;
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

  /**
   * @param contextElement
   * @param playAnimations - Whether or not to modify animation play state while measuring.
   */
  captureAnimatingBounds(
    contextElement: HTMLElement,
    playAnimations?: boolean
  ): ContextAwareBounds {
    let result = new ContextAwareBounds({
      element: getDocumentPosition(this.element, {
        withAnimations: true,
        playAnimations,
      }),
      contextElement: getDocumentPosition(contextElement, {
        withAnimations: true,
        playAnimations,
      }),
    });
    let priorElementBounds = getDocumentPosition(this.element, {
      withAnimationOffset: -100,
      playAnimations,
    });

    // TODO: extract actual precalculated velocity instead of guesstimating
    result.velocity = calculateBoundsVelocity(
      priorElementBounds,
      result.element,
      100
    );
    return result;
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

  setupAnimation(
    property: string,
    opts: Partial<
      OpacityOptions | MoveOptions | ResizeOptions | CssMotionOptions
    >
  ): void {
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

    return new SpriteAnimation(this, keyframes, keyframeAnimationOptions);
  }

  startAnimation({
    time,
  }: {
    time?: number;
  } = {}): SpriteAnimation {
    console.warn(
      'Calling Sprite.startAnimation is deprecated, please use the runAnimations util.'
    );
    let spriteAnimation = this.compileAnimation({ time }) as SpriteAnimation;
    spriteAnimation.play();
    return spriteAnimation;
  }
}

export enum SpriteType {
  Inserted = 'inserted',
  Removed = 'removed',
  Kept = 'kept',
  Intermediate = 'intermediate',
}
