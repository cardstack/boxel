import SpriteFactory from './sprite-factory';
import Sprite, { SpriteType } from './sprite';
import AnimationContext from '../components/animation-context';
import { SpriteModel } from 'animations/models/sprite-tree';

export default class Changeset {
  context: AnimationContext;
  insertedSprites: Set<Sprite> = new Set();
  removedSprites: Set<Sprite> = new Set();
  keptSprites: Set<Sprite> = new Set();
  sentSprites: Set<Sprite> = new Set();
  receivedSprites: Set<Sprite> = new Set();

  constructor(animationContext: AnimationContext) {
    this.context = animationContext;
  }

  spritesFor(spriteType: SpriteType): Set<Sprite> {
    switch (spriteType) {
      case SpriteType.Inserted:
        return this.insertedSprites;
      case SpriteType.Removed:
        return this.removedSprites;
      case SpriteType.Kept:
        return this.keptSprites;
      case SpriteType.Sent:
        return this.sentSprites;
      case SpriteType.Received:
        return this.receivedSprites;
    }
  }

  addInsertedAndReceivedSprites(
    freshlyAdded: Set<SpriteModel>,
    farMatchCandidates: Set<SpriteModel>
  ): void {
    let farSpritesArray = Array.from(farMatchCandidates);
    for (let spriteModifier of freshlyAdded) {
      let matchingFarSpriteModifier = farSpritesArray.find(
        (s) => s.id && s.id === spriteModifier.id
      );
      if (matchingFarSpriteModifier) {
        this.receivedSprites.add(
          SpriteFactory.createReceivedSprite(
            spriteModifier,
            matchingFarSpriteModifier
          )
        );
      } else {
        this.insertedSprites.add(
          SpriteFactory.createInsertedSprite(spriteModifier)
        );
      }
    }
  }

  addRemovedAndSentSprites(freshlyRemoved: Set<SpriteModel>): void {
    for (let spriteModifier of freshlyRemoved) {
      if (spriteModifier.farMatch) {
        this.sentSprites.add(SpriteFactory.createSentSprite(spriteModifier));
      } else {
        this.removedSprites.add(
          SpriteFactory.createRemovedSprite(spriteModifier)
        );
      }
    }
  }

  addKeptSprites(freshlyChanged: Set<SpriteModel>): void {
    for (let spriteModifier of freshlyChanged) {
      this.keptSprites.add(SpriteFactory.createKeptSprite(spriteModifier));
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
