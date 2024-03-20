import { FPS } from './behaviors/base.ts';
import SpringBehavior from './behaviors/spring.ts';
import StaticBehavior from './behaviors/static.ts';
import TweenBehavior from './behaviors/tween.ts';
import WaitBehavior from './behaviors/wait.ts';
import AnimationContext from './components/animation-context.gts';
import { type Changeset, type IContext } from './models/animator.ts';
import {
  type AnimationDefinition,
  type AnimationTimeline,
  OrchestrationMatrix,
} from './models/orchestration.ts';
import Sprite, { type ISpriteModifier, SpriteType } from './models/sprite.ts';
import sprite from './modifiers/sprite.ts';
import AnimationsService from './services/animations.ts';

export {
  AnimationContext,
  AnimationDefinition,
  AnimationsService,
  AnimationTimeline,
  Changeset,
  FPS,
  IContext,
  ISpriteModifier,
  OrchestrationMatrix,
  SpringBehavior,
  Sprite, // model
  sprite, // modifier
  SpriteType,
  StaticBehavior,
  TweenBehavior,
  WaitBehavior,
};
