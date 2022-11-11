import Service from '@ember/service';

import { ISpriteModifier } from '../models/sprite';
import { IContext } from '../models/animator';
import TransitionRunner from '../models/transition-runner';
import { scheduleOnce } from '@ember/runloop';
import { taskFor } from 'ember-concurrency-ts';
import {
  all,
  didCancel,
  restartableTask,
  TaskInstance,
} from 'ember-concurrency';
import { AnimationParticipantManager } from '../models/animation-participant';
import { assert } from '@ember/debug';

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
    this.clearChanges();

    this.animationParticipantManager.snapshotAfterRender();

    let { sprites, animators } =
      this.animationParticipantManager.createAnimatorsAndSprites();

    animators.sort((a, b) => {
      let bitmask = a.context.element.compareDocumentPosition(
        b.context.element
      );

      assert(
        'Sorting animators - Document position of two compared nodes is implementation-specific or disconnected',
        !(
          bitmask & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC ||
          bitmask & Node.DOCUMENT_POSITION_DISCONNECTED
        )
      );

      return bitmask & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    let promises = [];
    for (let animator of animators) {
      animator.handleSprites(sprites);
      let changeset = animator.toChangeset();
      if (changeset && changeset.hasSprites) {
        let transitionRunner = new TransitionRunner(changeset.context);
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
