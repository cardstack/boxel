import {
  type AnimationDefinition,
  type Changeset,
  Sprite,
  SpriteType,
  TweenBehavior,
} from '@cardstack/boxel-motion';
//import magicMove from '@cardstack/boxel-motion/transitions/magic-move';
//import runAnimations from '@cardstack/boxel-motion/utils/run-animations';
import Controller from '@ember/controller';

export default class RoutesController extends Controller {
  transition(changeset: Changeset): AnimationDefinition {
    let behavior = new TweenBehavior();
    let duration = 1000;
    let insertedSprites = changeset.spritesFor({
      type: SpriteType.Inserted,
    });
    let incomingWidth = (Array.from(insertedSprites)[0] as Sprite).finalWidth;
    let removedSprites = changeset.spritesFor({
      type: SpriteType.Removed,
    });
    let outgoingWidth = (Array.from(removedSprites)[0] as Sprite).initialWidth;
    return {
      timeline: {
        type: 'parallel',
        animations: [
          {
            sprites: insertedSprites,
            properties: {
              translateX: { from: `${incomingWidth}px` },
            },
            timing: {
              behavior,
              duration,
            },
          },
          {
            sprites: removedSprites,
            properties: {
              translateX: { to: `-${outgoingWidth}px` },
            },
            timing: {
              behavior,
              duration,
            },
          },
        ],
      },
    };

    /*let { removedSprites, keptSprites, insertedSprites, context } = changeset;

    magicMove({ keptSprites } as Changeset, {
      duration: 1000,
    });

    insertedSprites.forEach((s) => {
      s.setupAnimation('position', {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        startX: -s.finalBounds!.relativeToContext.width,
        duration: 1000,
      });
    });

    removedSprites.forEach((s) => {
      if (context.hasOrphan(s)) context.removeOrphan(s);
      context.appendOrphan(s);
      s.lockStyles();
      s.setupAnimation('position', {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        endX: -s.initialBounds!.relativeToContext.width,
        duration: 1000,
      });
    });

    await runAnimations([
      ...removedSprites,
      ...keptSprites,
      ...insertedSprites,
    ]);*/
  }
}
