import SpriteFactory from '../models/sprite-factory';

export default class Changeset {
  insertedSprites = new Set();
  removedSprites = new Set();
  keptSprites = new Set();
  sentSprites = new Set();
  receivedSprites = new Set();

  constructor(animationContext) {
    this.context = animationContext;
  }

  addInsertedAndReceivedSprites(freshlyAdded, farMatchCandidates) {
    let farSpritesArray = Array.from(farMatchCandidates);
    for (let spriteModifier of freshlyAdded) {
      let matchingFarSpriteModifier = farSpritesArray.find(
        (s) => s.id === spriteModifier.id
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

  addRemovedAndSentSprites(freshlyRemoved) {
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

  addKeptSprites(freshlyChanged) {
    for (let spriteModifier of freshlyChanged) {
      this.keptSprites.add(SpriteFactory.createKeptSprite(spriteModifier));
    }
  }
}
