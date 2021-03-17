import Controller from '@ember/controller';
import { assert } from '@ember/debug';
import { SpriteType } from '../models/sprite';
import Changeset from '../models/changeset';

export default class RoutesController extends Controller {
  async transition(changeset: Changeset): Promise<void> {
    let { context } = changeset;

    let insertedSprite = changeset.spriteFor({ type: SpriteType.Inserted });
    let removedSprite = changeset.spriteFor({ type: SpriteType.Removed });
    assert(
      'removedSprite.initialWidth and insertedSprite.finalWidth are present',
      removedSprite?.initialWidth && insertedSprite?.finalWidth
    );
    context.appendOrphan(removedSprite);
    removedSprite.lockStyles();
    let moveLeft = insertedSprite.id === 'route-content-other';
    removedSprite.setupAnimation('position', {
      endX: removedSprite.initialWidth * (moveLeft ? -1 : 1),
      duration: 500,
    });
    insertedSprite.setupAnimation('position', {
      startX: insertedSprite.finalWidth * (moveLeft ? 1 : -1),
      duration: 500,
    });
    await Promise.all(
      [removedSprite.startAnimation(), insertedSprite.startAnimation()].map(
        (a) => a.finished
      )
    );
  }
}
