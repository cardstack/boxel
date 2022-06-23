import Modifier from 'ember-modifier';
import {
  getDocumentPosition,
  copyComputedStyle,
  CopiedCSS,
  DocumentPositionArgs,
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

  @service declare animations: AnimationsService;

  didReceiveArguments(): void {
    this.id = this.args.named.id;
    this.role = this.args.named.role;
    this.animations.registerSpriteModifier(this);
    this.captureSnapshot();
  }

  captureSnapshot(opts: Partial<DocumentPositionArgs> = {}): void {
    if (!this.alreadyTracked) {
      let { element } = this;
      assert(
        'sprite modifier can only be installed on HTML elements',
        element instanceof HTMLElement
      );
      this.lastBounds = this.currentBounds;
      this.lastComputedStyle = this.currentComputedStyle;
      this.currentBounds = getDocumentPosition(element, opts);
      this.currentComputedStyle = copyComputedStyle(element);
      this.alreadyTracked = true;
    }
    once(this, this.clearTrackedPosition);
  }

  clearTrackedPosition(): void {
    this.alreadyTracked = false;
  }

  willRemove(): void {
    this.animations.unregisterSpriteModifier(this);
  }
}
