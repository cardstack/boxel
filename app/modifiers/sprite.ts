import Modifier from 'ember-modifier';
import ContextAwareBounds from 'animations/models/context-aware-bounds';
import { measure } from '../utils/measurement';
import { assert } from '@ember/debug';
import AnimationContext from '../components/animation-context';
import { inject as service } from '@ember/service';
import AnimationsService from '../services/animations';

interface SpriteModifierArgs {
  positional: [];
  named: {
    context: AnimationContext;
    id: string | null;
  };
}

export default class SpriteModifier extends Modifier<SpriteModifierArgs> {
  id: string | null = null;
  context: AnimationContext | undefined;
  lastBounds: ContextAwareBounds | undefined;
  currentBounds: ContextAwareBounds | undefined;
  farMatch: SpriteModifier | undefined; // Gets set to the "received" sprite modifier when this is becoming a "sent" sprite
  contextElement: HTMLElement | undefined;

  @service declare animations: AnimationsService;

  didReceiveArguments(): void {
    this.contextElement = this.element.closest(
      '.animation-context'
    ) as HTMLElement;
    this.context = this.args.named.context;
    this.id = this.args.named.id;

    this.context.register(this);
    this.animations.registerSpriteModifier(this);

    this.trackPosition();
  }

  trackPosition(): void {
    let { element, contextElement } = this;
    assert(
      'sprite modifier can only be installed on HTML elements',
      element instanceof HTMLElement
    );
    assert(
      'sprite modifier can only be installed on element that is a descendant of an AnimationContext',
      contextElement instanceof HTMLElement
    );
    this.lastBounds = this.currentBounds;
    this.currentBounds = measure({
      contextElement,
      element,
    });
  }

  checkForChanges(): boolean {
    this.trackPosition();
    if (this.currentBounds && this.lastBounds) {
      return !this.currentBounds.isEqualTo(this.lastBounds);
    } else {
      return true;
    }
  }

  willRemove(): void {
    this.context && this.context.unregister(this);
    this.animations.unregisterSpriteModifier(this);
  }
}
