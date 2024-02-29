import type AnimationContext from './components/animation-context.gts';
import type registerContentModifier from './modifiers/register-context.ts';
import type registerContextOrphansEl from './modifiers/register-context-orphans-el.ts';
import type Sprite from './modifiers/sprite.ts';
export default interface BoxelMotionRegistry {
  // component
  AnimationContext: typeof AnimationContext;
  // modifier
  'register-context': typeof registerContentModifier;
  // modifier
  'register-context-orphans-el': typeof registerContextOrphansEl;
  // modifier
  sprite: typeof Sprite;
}
