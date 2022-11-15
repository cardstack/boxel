import { inject as service } from '@ember/service';
import Modifier from 'ember-modifier';

import AnimationsService from '../services/animations';

interface SpriteModifierArgs {
  Positional: unknown[];
  Named: {
    id: string;
    role?: string;
  };
}

export interface SpriteModifierSignature {
  Element: HTMLElement;
  Args: SpriteModifierArgs;
}

export default class SpriteModifier extends Modifier<SpriteModifierSignature> {
  id!: string;
  role: string | null = null;

  @service declare animations: AnimationsService;

  didReceiveArguments(): void {
    this.id = this.args.named.id;
    this.role = this.args.named.role ?? null;
    this.animations.registerSpriteModifier(this);
  }

  willRemove(): void {
    this.animations.unregisterSpriteModifier(this);
  }
}
