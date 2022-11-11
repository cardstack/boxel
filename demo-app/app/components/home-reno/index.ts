import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import runAnimations from '@cardstack/boxel-motion/utils/run-animations';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import magicMove from '@cardstack/boxel-motion/transitions/magic-move';
import { COMPACT_CARD_STATES } from './card/compact';
import Sprite, { SpriteType } from '@cardstack/boxel-motion/models/sprite';

type ExistingCards = 'outline' | 'gallery' | 'form';

interface Signature {
  Element: HTMLDivElement;
}

export default class HomeReno extends Component<Signature> {
  @tracked currentExpandedItem: ExistingCards | null = null;
  @tracked currentMaximizedItem: ExistingCards | null = null;
  @tracked secondaryItemExpanded = false;

  get compactCardState(): Record<
    ExistingCards,
    typeof COMPACT_CARD_STATES[keyof typeof COMPACT_CARD_STATES]
  > {
    let res: Record<
      ExistingCards,
      typeof COMPACT_CARD_STATES[keyof typeof COMPACT_CARD_STATES]
    > = {
      outline: COMPACT_CARD_STATES.MINIMIZED,
      gallery: COMPACT_CARD_STATES.MINIMIZED,
      form: COMPACT_CARD_STATES.MINIMIZED,
    };
    let key: ExistingCards;
    for (key in res) {
      if (this.currentExpandedItem === key) {
        res[key] = COMPACT_CARD_STATES.EXPANDED;
      }

      if (this.currentMaximizedItem === key) {
        res[key] = COMPACT_CARD_STATES.MAXIMIZED_PLACEHOLDER;
      }
    }
    return res;
  }

  get secondaryItemState() {
    return this.secondaryItemExpanded
      ? COMPACT_CARD_STATES.EXPANDED
      : COMPACT_CARD_STATES.MINIMIZED;
  }

  async insideTransition(changeset: Changeset) {
    let { keptSprites } = changeset;

    let keptSprite = [...keptSprites].find(
      (sprite) => sprite.counterpart
    ) as Sprite;
    if (keptSprite) {
      magicMove({ keptSprites: new Set([keptSprite]) } as Changeset, {
        duration: 650,
      });
      await runAnimations([keptSprite]);
    }
  }

  async transition(changeset: Changeset) {
    let spritesToRunAnimationsFor = [];
    let keptCompactCards = [
      ...changeset.spritesFor({
        type: SpriteType.Kept,
      }),
    ];
    let keptSprite = keptCompactCards.find((sprite) => sprite.counterpart);
    if (keptSprite) {
      changeset.context.appendOrphan(keptSprite.counterpart!);
      keptSprite.counterpart!.lockStyles();
      keptSprite.element.style.visibility = 'hidden';
      keptSprite.counterpart!.element.style.zIndex = '1';
      magicMove(
        {
          keptSprites: new Set([keptSprite.counterpart]),
        } as Changeset,
        {
          duration: 650,
        }
      );
      spritesToRunAnimationsFor.push(keptSprite.counterpart as Sprite);
    }

    await runAnimations(spritesToRunAnimationsFor);

    if (keptSprite) {
      keptSprite.element.style.visibility = 'initial';
      keptSprite.counterpart!.element.style.zIndex = '';
    }
  }

  @action toggleExpansion(item: ExistingCards) {
    if (this.currentExpandedItem === item) {
      this.currentExpandedItem = null;
    } else {
      this.currentExpandedItem = item;
    }
  }

  @action toggleSecondaryItemExpansion() {
    this.secondaryItemExpanded = !this.secondaryItemExpanded;
  }

  @action maximize(item: ExistingCards) {
    this.secondaryItemExpanded = false;
    this.currentMaximizedItem = item;
  }

  @action minimize() {
    this.currentMaximizedItem = null;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    HomeReno: typeof HomeReno;
  }
}
