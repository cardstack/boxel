import Component from '@glimmer/component';
import { scheduleOnce } from '@ember/runloop';
import Ember from 'ember';
import { reads } from 'macro-decorators';
import Changeset from '../../models/changeset';
import { inject as service } from '@ember/service';
import { task } from 'ember-concurrency-decorators';
import { microwait } from '../../utils/scheduling';
import { action } from '@ember/object';
import AnimationsService from '../../services/animations';
import SpriteModifier from '../../modifiers/sprite';
import Sprite, { SpriteType } from '../../models/sprite';
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
  registered: Set<SpriteModifier> = new Set();

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

  constructor(owner: unknown, args: AnimationContextArgs) {
    super(owner, args);
    this.animations.registerContext(this);
  }

  willDestroy(): void {
    super.willDestroy();
    this.animations.unregisterContext(this);
  }

  get renderDetector(): undefined {
    consumeTag(VOLATILE_TAG);
    let task = taskFor(this.maybeTransitionTask);
    scheduleOnce('afterRender', task, task.perform);
    return undefined;
  }

  @action didInsertEl(element: HTMLElement): void {
    this.element = element;
  }

  @action didInsertOrphansEl(element: HTMLElement): void {
    this.orphansElement = element;
  }

  register(spriteModifier: SpriteModifier): void {
    this.registered.add(spriteModifier);
    this.freshlyAdded.add(spriteModifier);
  }

  unregister(spriteModifier: SpriteModifier): void {
    console.log(
      `AnimationContext(${this.id})#unregister(spriteModifier)`,
      spriteModifier
    );
    this.registered.delete(spriteModifier);
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

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  @task *maybeTransitionTask() {
    yield microwait(); // allow animations service to run far-matching to run first
    console.log(`AnimationContext(${this.id})#maybeTransition()`);
    for (let spriteModifier of this.registered) {
      if (spriteModifier.checkForChanges()) {
        this.freshlyChanged.add(spriteModifier);
      }
    }
    if (this.hasNoChanges) {
      return;
    }
    let changeset = new Changeset(this);
    changeset.addInsertedAndReceivedSprites(
      this.freshlyAdded,
      this.farMatchCandidates
    );
    this.freshlyAdded.clear();

    yield microwait(); // allow other contexts to do their far-matching for added sprites

    changeset.addRemovedAndSentSprites(this.freshlyRemoved);
    this.freshlyRemoved.clear();
    this.farMatchCandidates.clear();

    changeset.addKeptSprites(this.freshlyChanged);
    this.freshlyChanged.clear();

    changeset.finalizeSpriteCategories();

    if (this.shouldAnimate(changeset)) {
      this.logChangeset(changeset); // For debugging
      let animation = this.args.use?.(changeset);
      yield Promise.resolve(animation);
      for (let spriteModifier of this.registered) {
        spriteModifier.checkForChanges();
      }
    }
    this.isInitialRenderCompleted = true;
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

  logChangeset(changeset: Changeset): void {
    let contextId = this.args.id;
    function row(type: SpriteType, sprite: Sprite) {
      return {
        context: contextId,
        type,
        spriteId: sprite.id,
        initialBounds: sprite.initialBounds
          ? JSON.stringify(sprite.initialBounds)
          : null,
        finalBounds: sprite.finalBounds
          ? JSON.stringify(sprite.finalBounds)
          : null,
      };
    }
    let tableRows = [];
    for (let type of [
      SpriteType.Inserted,
      SpriteType.Removed,
      SpriteType.Kept,
      SpriteType.Sent,
      SpriteType.Received,
    ]) {
      for (let sprite of changeset.spritesFor(type)) {
        tableRows.push(row(type, sprite));
      }
    }
    console.table(tableRows);
  }

  clearOrphans(): void {
    let { orphansElement } = this;
    while (orphansElement && orphansElement.firstChild) {
      orphansElement.removeChild(orphansElement.firstChild);
    }
  }
}
