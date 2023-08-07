import { scheduleOnce } from '@ember/runloop';
import Service from '@ember/service';

import {
  all,
  didCancel,
  restartableTask,
  TaskInstance,
} from 'ember-concurrency';

import { AnimationParticipantManager } from '../models/animation-participant';
import { IContext } from '../models/animator';
import { ISpriteModifier } from '../models/sprite';
import TransitionRunner from '../models/transition-runner';

export default class AnimationsService extends Service {
  animationParticipantManager = new AnimationParticipantManager();

  // Data and methods to do with insertions and removals from the DOM
  // Data is relevant only for one render and should be cleared before the next
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
  clearChanges() {
    this.insertedContexts.clear();
    this.removedContexts.clear();
    this.insertedSpriteModifiers.clear();
    this.removedSpriteModifiers.clear();
  }

  didNotifyContextRendering = false;
  notifyContextRendering(): void {
    // Trigger once per render cycle
    if (!this.didNotifyContextRendering) {
      this.didNotifyContextRendering = true;

      this.animationParticipantManager.clearSnapshots();
      this.animationParticipantManager.snapshotBeforeRender();

      scheduleOnce('afterRender', this, this.maybeTransition);
    }
  }

  async maybeTransition(): Promise<TaskInstance<void | void[]>> {
    return this.maybeTransitionTask.perform().catch((error: Error) => {
      if (!didCancel(error)) {
        console.error(error);
        throw error;
      } else {
        console.warn('maybeTransition cancelled, animations interrupted');
      }
    });
  }

  maybeTransitionTask = restartableTask(async () => {
    this.didNotifyContextRendering = false;
    this.animationParticipantManager.updateParticipants({
      insertedContexts: this.insertedContexts,
      insertedSpriteModifiers: this.insertedSpriteModifiers,
      removedContexts: this.removedContexts,
      removedSpriteModifiers: this.removedSpriteModifiers,
    });
    this.clearChanges();

    this.animationParticipantManager.snapshotAfterRender();
    this.animationParticipantManager.log();

    let { sprites, animators } =
      this.animationParticipantManager.createAnimatorsAndSprites();

    let promises = [];
    for (let animator of animators) {
      animator.handleSprites(sprites);
      // Clean up all orphans since
      // we will re-append them if necessary
      // This does not optimize for long-running, uninterrupted animations
      // Which may cause clones/orphans to stick around and interfere with
      // interactive parts of an app. If we find that we have many such animations
      // Then we should be moving towards more granular cleanup
      let context = animator.context;
      context.clearOrphans();
      let changeset = animator.toChangeset();
      if (changeset.hasSprites) {
        let transitionRunner = new TransitionRunner(changeset.context);
        let task = transitionRunner.maybeTransitionTask;
        promises.push(
          task.perform(changeset).then(() => {
            context.clearOrphans();
          }),
        );
      }
    }

    return all(promises);
  });
}

declare module '@ember/service' {
  interface Registry {
    animations: AnimationsService;
  }
}
