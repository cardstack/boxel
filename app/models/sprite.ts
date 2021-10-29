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
import { Opacity, OpacityOptions } from 'animations/motions/opacity';
import { Move, MoveOptions } from '../motions/move';
import { Resize, ResizeOptions } from '../motions/resize';
import { CssMotion, CssMotionOptions } from '../motions/css-motion';

class SpriteIdentifier {
  id: string | null;
  role: string | null;
  constructor(id: string | null, role: string | null) {
    this.id = id;
    this.role = role;
  }
  equals(other: SpriteIdentifier): boolean {
    return this.id === other.id && this.role === other.role;
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

  captureAnimatingBounds(contextElement: HTMLElement): ContextAwareBounds {
    let result = new ContextAwareBounds({
      element: getDocumentPosition(this.element, {
        withAnimations: true,
      }),
      contextElement: getDocumentPosition(contextElement, {
        withAnimations: true,
      }),
    });
    let priorElementBounds = getDocumentPosition(this.element, {
      withAnimationOffset: -100,
    });
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

  hide(): void {
    this.element.style.opacity = '0';
  }

  setupAnimation(
    property: string,
    opts: Partial<
      OpacityOptions | MoveOptions | ResizeOptions | CssMotionOptions
    >
  ): void {
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

  startAnimation({
    time,
  }: {
    time?: number;
  } = {}): SpriteAnimation {
    let motion = this.motions.find((motion) => motion instanceof Move);

    // TODO only implemented for Move for now
    if (!motion || !(motion instanceof Move)) {
      throw new Error('fail');
    }

    motion.applyBehaviour(time);

    return new SpriteAnimation(
      this,
      motion.keyframes,
      motion.keyframeAnimationOptions
    );
  }
}

export enum SpriteType {
  Inserted = 'inserted',
  Removed = 'removed',
  Kept = 'kept',
}
