import Controller from '@ember/controller';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import magicMove from 'animations-experiment/transitions/magic-move';
import runAnimations from 'animations-experiment/utils/run-animations';
import { Changeset } from 'animations-experiment/models/changeset';
import { ISpriteModifier } from 'animations-experiment/models/sprite-tree';

class InterruptionController extends Controller {
  columns = ['1/2', '2/3', '3/4', '4/5'];
  rows = ['1/2', '2/3', '3/4'];
  outerRules = [
    {
      select(modifiers: Set<ISpriteModifier>) {
        let matchedModifiers: ISpriteModifier[] = [];
        for (let modifier of modifiers) {
          // both are moving
          if (
            (modifier.id === 'inner' || modifier.id === 'outer') &&
            (modifier.lastBounds?.top !== modifier.currentBounds?.top ||
              modifier.lastBounds?.left !== modifier.currentBounds?.left)
          ) {
            matchedModifiers.push(modifier);
          }
        }

        if (
          matchedModifiers.find((v) => v.id === 'inner') &&
          matchedModifiers.find((v) => v.id === 'outer')
        ) {
          return matchedModifiers;
        } else {
          return [];
        }
      },
    },
  ];
  infoDiv1: HTMLElement | null = document.querySelector('#extra-1');
  infoDiv2: HTMLElement | null = document.querySelector('#extra-2');

  @tracked inner = {
    left: this.columns[0],
    top: this.rows[0],
  };
  @tracked outer = {
    left: this.columns[0],
    top: this.rows[0],
  };

  @action move(row: string, column: string, e: PointerEvent) {
    if (e.shiftKey) {
      this.outer.left = column;
      this.outer.top = row;
      this.outer = {
        left: column,
        top: row,
      };
    } else if (e.altKey) {
      this.inner = {
        left: column,
        top: row,
      };
      this.outer = {
        left: column,
        top: row,
      };
    } else {
      this.inner = {
        left: column,
        top: row,
      };
    }
  }

  @action async innerTransition(changeset: Changeset) {
    magicMove(changeset, { duration: 500 });
    let transitioningSprites = [...changeset.keptSprites].map((v) => v.id!);
    this.infoDiv1!.textContent = 'inner:' + JSON.stringify(transitioningSprites);
    this.infoDiv1?.getBoundingClientRect();
    await runAnimations([
      changeset.spriteFor({
        id: 'inner',
      })!,
    ]);
    this.infoDiv1!.textContent = 'inner:';
  }

  @action async outerTransition(changeset: Changeset) {
    magicMove(changeset, { duration: 1000 });
    let transitioningSprites = [...changeset.keptSprites].map((v) => v.id!);
    this.infoDiv2!.textContent = 'outer:' + JSON.stringify(transitioningSprites);
    this.infoDiv2?.getBoundingClientRect();
    await runAnimations([
      changeset.spriteFor({
        id: 'outer',
      })!,
      ...[
        ...changeset.spritesFor({
          id: 'inner',
        }),
      ],
    ]);
    this.infoDiv2!.textContent = 'outer:';
  }
}

export default InterruptionController;
