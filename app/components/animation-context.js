import Component from '@glimmer/component';
import { scheduleOnce } from '@ember/runloop';
import Ember from 'ember';
import { reads } from 'macro-decorators';
import Sprite from '../models/sprite';
import { inject as service } from '@ember/service';

const { VOLATILE_TAG, consumeTag } = Ember.__loader.require(
  '@glimmer/validator'
);

const INSERTED = Symbol('inserted');
const REMOVED = Symbol('removed');
const KEPT = Symbol('kept');
// const SENT = new Symbol('sent');
const RECEIVED = Symbol('received');

function createSprite(spriteModifier, type) {
  let sprite = new Sprite(spriteModifier.element);
  sprite.id = spriteModifier.id;
  if (type === INSERTED) {
    sprite.finalBounds = spriteModifier.currentPosition.relativeToContext;
  }
  if (type === REMOVED) {
    sprite.initialBounds = spriteModifier.currentPosition.relativeToContext;
  }
  if (type === KEPT) {
    sprite.initialBounds = spriteModifier.lastPosition.relativeToContext;
    sprite.finalBounds = spriteModifier.currentPosition.relativeToContext;
  }
  sprite.initialBoundsString = JSON.stringify(sprite.initialBounds);
  sprite.finalBoundsString = JSON.stringify(sprite.finalBounds);

  return sprite;
}
export default class AnimationContextComponent extends Component {
  registered = new Set();

  freshlyAdded = new Set();
  freshlyRemoved = new Set();
  freshlyChanged = new Set();
  farMatchedSprites = new Set();

  @service animations;

  orphansElement; //set by template
  @reads('args.initialInsertion', false) initialInsertion;
  isInitialRenderCompleted = false;

  constructor(owner, args) {
    super(owner, args);
    this.animations.registerContext(this);
  }

  willDestroy() {
    this.animations.unregisterContext(this);
  }

  handleFarMatching(spritesThatMightMatch) {
    console.log('handleFarMatching called', this.args.id);
    spritesThatMightMatch.forEach(s => this.farMatchedSprites.add(s));
  }

  get renderDetector() {
    console.log('renderDetector', this.args.id);
    consumeTag(VOLATILE_TAG);
    scheduleOnce('afterRender', this, 'maybeTransition');
    return undefined;
  }

  register(spriteModifier) {
    this.registered.add(spriteModifier);
    this.freshlyAdded.add(spriteModifier);
  }

  unregister(spriteModifier) {
    this.registered.delete(spriteModifier);
    this.freshlyRemoved.add(spriteModifier);
  }

  maybeTransition() {
    console.log('maybeTransition called', this.args.id);

    for (let spriteModifier of this.registered) {
      if (spriteModifier.checkForChanges()) {
        this.freshlyChanged.add(spriteModifier);
      }
    }
    this.simulateTransition();
  }

  simulateTransition() {
    if (
      this.freshlyChanged.size === 0 &&
      this.freshlyAdded.size === 0 &&
      this.freshlyRemoved.size === 0
    ) {
      return;
    }
    let changeset = {
      insertedSprites: new Set(),
      removedSprites: new Set(),
      keptSprites: new Set(),
      sentSprites: new Set(),
      receivedSprites: new Set()
    };
    let farSpritesArray = Array.from(this.farMatchedSprites);
    for (let spriteModifier of this.freshlyAdded) {
      if (farSpritesArray.any(s => s.id === spriteModifier.id)) {
        changeset.receivedSprites.add(createSprite(spriteModifier, RECEIVED));
      } else {
        changeset.insertedSprites.add(createSprite(spriteModifier, INSERTED));
      }
    }

    this.freshlyAdded.clear();
    this.farMatchedSprites.clear();

    for (let spriteModifier of this.freshlyRemoved) {
      changeset.removedSprites.add(createSprite(spriteModifier, REMOVED));
    }
    this.freshlyRemoved.clear();

    for (let spriteModifier of this.freshlyChanged) {
      changeset.keptSprites.add(createSprite(spriteModifier, KEPT));
    }
    this.freshlyChanged.clear();

    let shouldAnimate =
      this.args.use &&
      (this.isInitialRenderCompleted ||
        this.initialInsertion ||
        changeset.receivedSprites.size);

    if (shouldAnimate) {
      this.logChangeset(changeset); // For debugging
      let animation = this.args.use(changeset, this.orphansElement);
      animation.then(() => {
        for (let spriteModifier of this.registered) {
          spriteModifier.checkForChanges();
        }
      });
    }
    this.isInitialRenderCompleted = true;
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
          : null
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
}
