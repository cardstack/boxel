import Controller from '@ember/controller';
import Sprite, { SpriteType } from '../models/sprite';
import Changeset from '../models/changeset';
import LinearBehavior from 'animations/behaviors/linear';
import magicMove from 'animations/transitions/magic-move';
import { assert } from '@ember/debug';
import ContextAwareBounds from 'animations/models/context-aware-bounds';

export default class RoutesController extends Controller {
  async transition(changeset: Changeset): Promise<void> {
    let { removedSprites, keptSprites, context } = changeset;

    assert('Context must always have currentBounds', context.currentBounds);

    if (keptSprites.size > 0) {
      let keptSprite = changeset.spriteFor({
        type: SpriteType.Kept,
      }) as Sprite;

      assert(
        'keptSprite always has a counterpart, initialBounds and finalBounds',
        keptSprite.counterpart &&
          keptSprite.initialBounds &&
          keptSprite.finalBounds
      );

      for (let sprite of removedSprites) {
        assert(
          'removedSprite must always have initialBounds',
          sprite.initialBounds
        );

        sprite.element.getAnimations().forEach((a) => a.pause());
        context.appendOrphan(sprite);
        sprite.lockStyles();

        let moveLeft = keptSprite.id === 'route-content-other';

        let { x, y, width } = keptSprite.finalBounds.element;
        let finalElementBounds;
        if (moveLeft) {
          finalElementBounds = new DOMRect(
            x - width,
            y,
            sprite.initialBounds.element.width,
            sprite.initialBounds.element.height
          );
        } else {
          finalElementBounds = new DOMRect(
            x + width,
            y,
            sprite.initialBounds.element.width,
            sprite.initialBounds.element.height
          );
        }
        sprite.finalBounds = new ContextAwareBounds({
          element: finalElementBounds,
          contextElement: context.currentBounds,
        });

        let finalBounds = sprite.finalBounds.relativeToContext;

        sprite.setupAnimation('position', {
          endX: finalBounds.x - sprite.initialBounds.element.x,
          behavior: new LinearBehavior(),
          duration: 5000,
        });
      }

      let promises: Promise<void | Animation>[] = [
        magicMove(changeset),
        ...[...removedSprites].map((s) => s.startAnimation().finished),
      ];
      await Promise.all(promises);
    } else {
      let removedSprite = changeset.spriteFor({ type: SpriteType.Removed });
      let insertedSprite = changeset.spriteFor({ type: SpriteType.Inserted });

      assert(
        'removedSprite.initialWidth and insertedSprite.finalWidth are present',
        removedSprite?.initialWidth && insertedSprite?.finalWidth
      );

      context.appendOrphan(removedSprite);
      removedSprite.lockStyles();

      let moveLeft = insertedSprite?.id === 'route-content-other';

      removedSprite.setupAnimation('position', {
        endX: removedSprite.initialWidth * (moveLeft ? -1 : 1),
        behavior: new LinearBehavior(),
        duration: 5000,
      });

      insertedSprite.setupAnimation('position', {
        startX: insertedSprite.finalWidth * (moveLeft ? 1 : -1),
        behavior: new LinearBehavior(),
        duration: 5000,
      });

      await Promise.all([
        removedSprite.startAnimation().finished,
        insertedSprite.startAnimation().finished,
      ]);
    }
  }
}
