import Controller from '@ember/controller';
import { assert } from '@ember/debug';
import { SpriteType } from '../models/sprite';
import Changeset from '../models/changeset';

export default class RoutesController extends Controller {
  async transition(changeset: Changeset): Promise<void> {
    let { context } = changeset;

    let insertedSprite = changeset.spriteFor({ type: SpriteType.Inserted });
    let removedSprite = changeset.spriteFor({ type: SpriteType.Removed });
    assert('orphansElement is present', context.orphansElement);
    assert(
      'removedSprite.initialBounds and insertedSprite.finalBounds are present',
      removedSprite &&
        insertedSprite &&
        removedSprite.initialBounds &&
        insertedSprite.finalBounds
    );
    context.orphansElement.appendChild(removedSprite.element);
    removedSprite.lockStyles();
    let moveLeft = insertedSprite.id === 'route-content-other';
    let exitTransform = `translate(${moveLeft ? '-' : ''}${
      removedSprite.initialWidth
    }px,0)`;
    let entranceTransform = `translate(${moveLeft ? '' : '-'}${
      insertedSprite.finalWidth
    }px,0)`;
    let removeAnimation = removedSprite.element.animate(
      [
        { transform: 'translate(0,0)' },
        {
          transform: exitTransform,
        },
      ],
      {
        duration: 500,
      }
    );
    let insertAnimation = insertedSprite.element.animate(
      [
        {
          transform: entranceTransform,
        },
        { transform: 'translate(0,0)' },
      ],
      {
        duration: 500,
      }
    );
    await Promise.all(
      [removeAnimation, insertAnimation].map((a) => a.finished)
    );
    context.clearOrphans();
  }
}
