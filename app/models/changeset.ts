import SpriteFactory from './sprite-factory';
import Sprite, { SpriteType } from './sprite';
import AnimationContext from '../components/animation-context';
import SpriteModifier from '../modifiers/sprite';

export default class Changeset {
  context: AnimationContext;
  intent: string | undefined;
  insertedSprites: Set<Sprite> = new Set();
  removedSprites: Set<Sprite> = new Set();
  keptSprites: Set<Sprite> = new Set();

  constructor(animationContext: AnimationContext, intent: string | undefined) {
    this.context = animationContext;
    this.intent = intent;
  }

  spritesFor(spriteType: SpriteType): Set<Sprite> {
    switch (spriteType) {
      case SpriteType.Inserted:
        return this.insertedSprites;
      case SpriteType.Removed:
        return this.removedSprites;
      case SpriteType.Kept:
        return this.keptSprites;
    }
  }

  addInsertedSprites(freshlyAdded: Set<SpriteModifier>): void {
    for (let spriteModifier of freshlyAdded) {
      this.insertedSprites.add(
        SpriteFactory.createInsertedSprite(spriteModifier, this.context)
      );
    }
  }

  addRemovedSprites(freshlyRemoved: Set<SpriteModifier>): void {
    for (let spriteModifier of freshlyRemoved) {
      this.removedSprites.add(
        SpriteFactory.createRemovedSprite(spriteModifier, this.context)
      );
    }
  }

  addKeptSprites(freshlyChanged: Set<SpriteModifier>): void {
    for (let spriteModifier of freshlyChanged) {
      this.keptSprites.add(
        SpriteFactory.createKeptSprite(spriteModifier, this.context)
      );
    }
  }

  finalizeSpriteCategories(): void {
    let insertedSpritesArr = [...this.insertedSprites];
    let removedSpritesArr = [...this.removedSprites];
    let insertedIds = insertedSpritesArr.map((s) => s.id);
    let removedIds = removedSpritesArr.map((s) => s.id);
    let intersectingIds = insertedIds.filter((x) => removedIds.includes(x));
    for (let intersectingId of intersectingIds) {
      let removedSprite = removedSpritesArr.find(
        (s) => s.id === intersectingId
      );
      let insertedSprite = insertedSpritesArr.find(
        (s) => s.id === intersectingId
      );
      if (!insertedSprite || !removedSprite) {
        throw new Error(
          'intersection check should always result in removedSprite and insertedSprite being found'
        );
      }
      this.insertedSprites.delete(insertedSprite);
      if (removedSprite) {
        this.removedSprites.delete(removedSprite);
      }
      insertedSprite.type = SpriteType.Kept;
      insertedSprite.initialBounds = removedSprite.initialBounds;
      insertedSprite.counterpart = removedSprite;
      this.keptSprites.add(insertedSprite);
    }
  }
}
