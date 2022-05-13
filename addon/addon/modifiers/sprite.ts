import Modifier from 'ember-modifier';
import {
  getDocumentPosition,
  copyComputedStyle,
  CopiedCSS,
} from '../utils/measurement';
import { assert } from '@ember/debug';
import { inject as service } from '@ember/service';
import { once } from '@ember/runloop';
import AnimationsService from '../services/animations';

interface SpriteModifierArgs {
  positional: [];
  named: {
    id: string | null;
    role: string | null;
  };
}

export default class SpriteModifier extends Modifier<SpriteModifierArgs> {
  id: string | null = null;
  role: string | null = null;
  lastBounds: DOMRect | undefined;
  currentBounds: DOMRect | undefined;
  lastComputedStyle: CopiedCSS | undefined;
  currentComputedStyle: CopiedCSS | undefined;

  farMatch: SpriteModifier | undefined; // Gets set to the "received" sprite modifier when this is becoming a "sent" sprite
  alreadyTracked = false;
  #animations: Animation[] = [];

  @service declare animations: AnimationsService;

  didReceiveArguments(): void {
    this.id = this.args.named.id;
    this.role = this.args.named.role;
    this.animations.registerSpriteModifier(this);

    this.prepareSnapshot();
    this.captureSnapshot();
    this.finishSnapshot();
  }

  prepareSnapshot(): Animation[] {
    if (!this.alreadyTracked) {
      let { element } = this;
      this.#animations = element.getAnimations();
    }
    // TODO: this may not be necessary as we already play all unrelated animations
    return this.#animations;
  }

  captureSnapshot(): void {
    if (!this.alreadyTracked) {
      let { element } = this;
      assert(
        'sprite modifier can only be installed on HTML elements',
        element instanceof HTMLElement
      );
      this.lastBounds = this.currentBounds;
      this.lastComputedStyle = this.currentComputedStyle;
      this.currentBounds = getDocumentPosition(
        element,
        {
          withAnimations: false,
          playAnimations: false,
        },
        this.#animations
      );
      this.currentComputedStyle = copyComputedStyle(element);
      this.alreadyTracked = true;
    }
  }

  finishSnapshot(): void {
    this.#animations = [];
    once(this, this.clearTrackedPosition);
  }

  clearTrackedPosition(): void {
    this.alreadyTracked = false;
  }

  willRemove(): void {
    this.animations.unregisterSpriteModifier(this);
  }
}
