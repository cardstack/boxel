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
  boundsBeforeRender: DOMRect | undefined;
  boundsAfterRender: DOMRect | undefined;
  lastComputedStyle: CopiedCSS | undefined;
  currentComputedStyle: CopiedCSS | undefined;

  alreadyTracked = false;

  @service declare animations: AnimationsService;

  didReceiveArguments(): void {
    this.id = this.args.named.id;
    this.role = this.args.named.role;
    this.animations.registerSpriteModifier(this);
  }

  captureSnapshot(
    before: boolean,
    opts: Partial<DocumentPositionArgs> = {}
  ): void {
    let { element } = this;
    assert(
      'sprite modifier can only be installed on HTML elements',
      element instanceof HTMLElement
    );
    if (before) {
      this.boundsBeforeRender = getDocumentPosition(element, opts);
      this.lastComputedStyle = copyComputedStyle(element);
      this.boundsAfterRender = undefined;
      this.currentComputedStyle = undefined;
    } else {
      this.boundsAfterRender = getDocumentPosition(element, opts);
      this.currentComputedStyle = copyComputedStyle(element);
    }
  }

  willRemove(): void {
    this.animations.unregisterSpriteModifier(this);
  }
}
