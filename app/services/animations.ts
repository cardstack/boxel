import Service from '@ember/service';

import SpriteModifier from '../modifiers/sprite';
import SpriteTree from '../models/sprite-tree';
import AnimationContext from '../components/animation-context';
import { taskFor } from 'ember-concurrency-ts';
import TransitionRunner from 'animations/models/transition-runner';

export default class AnimationsService extends Service {
  spriteTree = new SpriteTree();
  freshlyAdded: Set<SpriteModifier> = new Set();
  freshlyRemoved: Set<SpriteModifier> = new Set();

  registerContext(context: AnimationContext): void {
    this.spriteTree.addAnimationContext(context);
  }

  unregisterContext(context: AnimationContext): void {
    this.spriteTree.removeAnimationContext(context);
  }

  registerSpriteModifier(spriteModifier: SpriteModifier): void {
    this.spriteTree.addSpriteModifier(spriteModifier);
    this.freshlyAdded.add(spriteModifier);
  }

  unregisterSpriteModifier(spriteModifier: SpriteModifier): void {
    this.spriteTree.removeSpriteModifier(spriteModifier);
    this.freshlyRemoved.add(spriteModifier);
  }

  runTransition(animationContext: AnimationContext): void {
    let transitionRunner = new TransitionRunner(animationContext, this);
    let task = taskFor(transitionRunner.maybeTransitionTask);
    task.perform();
  }
}

declare module '@ember/service' {
  interface Registry {
    animations: AnimationsService;
  }
}
