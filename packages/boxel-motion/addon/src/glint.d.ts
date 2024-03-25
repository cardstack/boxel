import type AnimationContext from '@cardstack/boxel-motion/components/animation-context';
import { type SpriteModifierSignature } from '@cardstack/boxel-motion/modifiers/sprite';
import { ModifierLike } from '@glint/template';

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    AnimationContext: typeof AnimationContext;
    sprite: ModifierLike<SpriteModifierSignature>;
  }
}
