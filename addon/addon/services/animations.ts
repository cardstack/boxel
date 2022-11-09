import Service from '@ember/service';

import { IContext, ISpriteModifier } from '../models/sprite-tree';
import TransitionRunner from '../models/transition-runner';
import { scheduleOnce } from '@ember/runloop';
import { taskFor } from 'ember-concurrency-ts';
import Sprite from '../models/sprite';
import Motion from '../motions/base';
import { SpriteAnimation } from '../models/sprite-animation';
import { CopiedCSS } from '@cardstack/boxel-motion/utils/measurement';
import {
  all,
  didCancel,
  restartableTask,
  TaskInstance,
} from 'ember-concurrency';
import { ChangesetBuilder } from '@cardstack/boxel-motion/models/changeset';
import { AnimationParticipantManager } from '../models/animation-participant';

export type AnimateFunction = (
  sprite: Sprite,
  motion: Motion
) => SpriteAnimation;

export interface IntermediateSprite {
  modifier: ISpriteModifier;
  intermediateBounds: DOMRect;
  intermediateStyles: CopiedCSS;
}

export default class AnimationsService extends Service {
  animationParticipantManager = new AnimationParticipantManager();
  insertedContexts: Set<IContext> = new Set();
  removedContexts: Set<IContext> = new Set();
  insertedSpriteModifiers: Set<ISpriteModifier> = new Set();
  removedSpriteModifiers: Set<ISpriteModifier> = new Set();

  registerContext(context: IContext): void {
    this.insertedContexts.add(context);
  }

  unregisterContext(context: IContext): void {
    this.removedContexts.add(context);
  }

  registerSpriteModifier(spriteModifier: ISpriteModifier): void {
    this.insertedSpriteModifiers.add(spriteModifier);
  }

  unregisterSpriteModifier(spriteModifier: ISpriteModifier): void {
    this.removedSpriteModifiers.add(spriteModifier);
  }

  didNotifyContextRendering = false;
  notifyContextRendering(): void {
    // Trigger once per render cycle
    if (!this.didNotifyContextRendering) {
      this.didNotifyContextRendering = true;

      this.animationParticipantManager.clear();
      this.animationParticipantManager.snapshotBeforeRender();

      scheduleOnce('afterRender', this, this.maybeTransition);
    }
  }

  async maybeTransition(): Promise<TaskInstance<void>> {
    return taskFor(this.maybeTransitionTask)
      .perform()
      .catch((error: Error) => {
        if (!didCancel(error)) {
          console.error(error);
          throw error;
        } else {
          console.warn('maybeTransition cancelled, animations interrupted');
        }
      });
  }

  @restartableTask
  *maybeTransitionTask() {
    this.didNotifyContextRendering = false;

    this.animationParticipantManager.updateParticipants({
      insertedContexts: this.insertedContexts,
      insertedSpriteModifiers: this.insertedSpriteModifiers,
      removedContexts: this.removedContexts,
      removedSpriteModifiers: this.removedSpriteModifiers,
    });

    this.insertedContexts.clear();
    this.insertedSpriteModifiers.clear();
    this.removedContexts.clear();
    this.removedSpriteModifiers.clear();

    this.animationParticipantManager.snapshotAfterRender();
    console.log(this.animationParticipantManager.DOMRefs);


    let { sprites, animators } =
      this.animationParticipantManager.createAnimatorsAndSprites();

    let changesetBuilder = new ChangesetBuilder(animators, sprites);

    let promises = [];
    for (let { context } of animators) {
      let changeset = changesetBuilder.contextToChangeset.get(context);
      if (changeset && changeset.hasSprites) {
        let transitionRunner = new TransitionRunner(context);
        let task = taskFor(transitionRunner.maybeTransitionTask);
        promises.push(task.perform(changeset));
      }
    }
    yield all(promises);
  }
}

declare module '@ember/service' {
  interface Registry {
    animations: AnimationsService;
  }
}
