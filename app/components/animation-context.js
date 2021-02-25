import Component from '@glimmer/component';
import { scheduleOnce } from '@ember/runloop';
import Ember from 'ember';
import { reads } from 'macro-decorators';
import Changeset from '../models/changeset';
import { inject as service } from '@ember/service';
import { task } from 'ember-concurrency-decorators';
import { microwait } from '../utils/scheduling';
import { action } from '@ember/object';

const { VOLATILE_TAG, consumeTag } = Ember.__loader.require(
  '@glimmer/validator'
);
export default class AnimationContextComponent extends Component {
  registered = new Set();

  freshlyAdded = new Set();
  freshlyRemoved = new Set();
  freshlyChanged = new Set();
  farMatchCandidates = new Set();

  @service animations;
  @reads('args.id') id;

  element; //set by template
  orphansElement; //set by template
  @reads('args.initialInsertion', false) initialInsertion;
  isInitialRenderCompleted = false;

  constructor(owner, args) {
    super(owner, args);
    this.animations.registerContext(this);
  }

  willDestroy() {
    super.willDestroy(...arguments);
    this.animations.unregisterContext(this);
  }

  get renderDetector() {
    consumeTag(VOLATILE_TAG);
    scheduleOnce('afterRender', this.maybeTransitionTask, 'perform');
    return undefined;
  }

  @action didInsertEl(element) {
    this.element = element;
  }

  @action didInsertOrphansEl(element) {
    this.orphansElement = element;
  }

  register(spriteModifier) {
    this.registered.add(spriteModifier);
    this.freshlyAdded.add(spriteModifier);
  }

  unregister(spriteModifier) {
    console.log(
      `AnimationContext(${this.id})#unregister(spriteModifier)`,
      spriteModifier
    );
    this.registered.delete(spriteModifier);
    this.freshlyRemoved.add(spriteModifier);
    this.animations.notifyRemovedSpriteModifier(spriteModifier);
  }

  handleFarMatching(farMatchSpriteModifierCandidates) {
    Array.from(farMatchSpriteModifierCandidates)
      .filter((s) => s.context !== this)
      .forEach((s) => this.farMatchCandidates.add(s));
  }

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
    this.changeset = new Changeset(this);
    this.changeset.addInsertedAndReceivedSprites(
      this.freshlyAdded,
      this.farMatchCandidates
    );
    this.freshlyAdded.clear();

    yield microwait(); // allow other contexts to do their far-matching for added sprites

    this.changeset.addRemovedAndSentSprites(this.freshlyRemoved);
    this.freshlyRemoved.clear();
    this.farMatchCandidates.clear();

    this.changeset.addKeptSprites(this.freshlyChanged);
    this.freshlyChanged.clear();

    this.changeset.finalizeSpriteCategories();

    if (this.shouldAnimate(this.changeset)) {
      this.logChangeset(this.changeset); // For debugging
      this.args.use.transition(this.changeset);

      yield this.changeset.finished;

      delete this.changeset;

      for (let spriteModifier of this.registered) {
        spriteModifier.checkForChanges();
      }
    }
    this.isInitialRenderCompleted = true;
  }

  shouldAnimate(changeset) {
    return (
      changeset &&
      this.args.use &&
      (this.isInitialRenderCompleted ||
        this.initialInsertion ||
        changeset.receivedSprites.size)
    );
  }

  get hasNoChanges() {
    return (
      this.freshlyChanged.size === 0 &&
      this.freshlyAdded.size === 0 &&
      this.freshlyRemoved.size === 0
    );
  }

  logChangeset(changeset) {
    let contextId = this.args.id;
    function row(type, sprite) {
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
    for (let type of ['inserted', 'removed', 'kept', 'sent', 'received']) {
      for (let sprite of changeset[`${type}Sprites`]) {
        tableRows.push(row(type, sprite));
      }
    }
    console.table(tableRows);
  }

  clearOrphans() {
    let { orphansElement } = this;
    while (orphansElement.firstChild) {
      orphansElement.removeChild(orphansElement.firstChild);
    }
  }
}
