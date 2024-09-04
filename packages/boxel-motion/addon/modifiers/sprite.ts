import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { inject as service } from '@ember/service';
import Modifier, { ArgsFor, NamedArgs, PositionalArgs } from 'ember-modifier';

import AnimationsService from '../services/animations';

interface SpriteModifierArgs {
  Positional: unknown[];
  Named: {
    id: string;
    role?: string;
  };
}

export interface SpriteModifierSignature {
  Element: Element;
  Args: SpriteModifierArgs;
}

function cleanup(instance: SpriteModifier): void {
  instance.animations.unregisterSpriteModifier(instance);
}

export default class SpriteModifier extends Modifier<SpriteModifierSignature> {
  element!: Element;
  id!: string;
  role: string | null = null;

  #didSetup = false;

  @service declare animations: AnimationsService;

  constructor(owner: Owner, args: ArgsFor<SpriteModifierSignature>) {
    super(owner, args);
    registerDestructor(this, cleanup);
  }

  modify(
    element: Element,
    _: PositionalArgs<SpriteModifierSignature>,
    { id, role }: NamedArgs<SpriteModifierSignature>,
  ): void {
    this.element = element;
    this.id = id;
    this.role = role ?? null;

    if (!this.#didSetup) {
      this.#didSetup = true;
      this.animations.registerSpriteModifier(this);
    }
  }
}
