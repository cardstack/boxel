import Component from '@glimmer/component';
import { scheduleOnce } from '@ember/runloop';
import Ember from 'ember';
import { reads } from 'macro-decorators';
import Changeset from '../../models/changeset';
import { inject as service } from '@ember/service';
import { action } from '@ember/object';
import AnimationsService from '../../services/animations';
import SpriteModifier from '../../modifiers/sprite';
import { taskFor } from 'ember-concurrency-ts';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const { VOLATILE_TAG, consumeTag } = Ember.__loader.require(
  '@glimmer/validator'
);

interface AnimationContextArgs {
  id: string | undefined;
  use: ((changeset: Changeset) => Promise<void>) | undefined;
}

export default class AnimationContextComponent extends Component<AnimationContextArgs> {
  freshlyAdded: Set<SpriteModifier> = new Set();
  freshlyRemoved: Set<SpriteModifier> = new Set();
  freshlyChanged: Set<SpriteModifier> = new Set();
  farMatchCandidates: Set<SpriteModifier> = new Set();

  @service declare animations: AnimationsService;
  @reads('args.id') id: string | undefined;

  element!: HTMLElement; //set by template
  orphansElement: HTMLElement | null = null; //set by template
  @reads('args.initialInsertion', false) initialInsertion: boolean | undefined;
  isInitialRenderCompleted = false;

  willDestroy(): void {
    super.willDestroy();
    this.animations.unregisterContext(this);
  }

  get renderDetector(): undefined {
    consumeTag(VOLATILE_TAG);
    scheduleOnce('afterRender', this, this.performMaybeTransitionTask);
    return undefined;
  }

  performMaybeTransitionTask(): void {
    let task = taskFor(this.animations.maybeTransitionTask);
    task.perform(this);
  }

  @action didInsertEl(element: HTMLElement): void {
    this.element = element;
    this.animations.registerContext(this);
  }

  @action didInsertOrphansEl(element: HTMLElement): void {
    this.orphansElement = element;
  }

  register(spriteModifier: SpriteModifier): void {
    this.freshlyAdded.add(spriteModifier);
  }

  unregister(spriteModifier: SpriteModifier): void {
    console.log(
      `AnimationContext(${this.id})#unregister(spriteModifier)`,
      spriteModifier
    );
    this.freshlyRemoved.add(spriteModifier);
    this.animations.notifyRemovedSpriteModifier(spriteModifier);
  }

  handleFarMatching(
    farMatchSpriteModifierCandidates: Set<SpriteModifier>
  ): void {
    Array.from(farMatchSpriteModifierCandidates)
      .filter((s) => s.context !== this)
      .forEach((s) => this.farMatchCandidates.add(s));
  }

  shouldAnimate(changeset: Changeset): boolean {
    return !!(
      changeset &&
      this.args.use &&
      (this.isInitialRenderCompleted ||
        this.initialInsertion ||
        changeset.receivedSprites.size)
    );
  }

  get hasNoChanges(): boolean {
    return (
      this.freshlyChanged.size === 0 &&
      this.freshlyAdded.size === 0 &&
      this.freshlyRemoved.size === 0
    );
  }

  clearOrphans(): void {
    let { orphansElement } = this;
    while (orphansElement && orphansElement.firstChild) {
      orphansElement.removeChild(orphansElement.firstChild);
    }
  }
}
