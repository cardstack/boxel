import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { COMPACT_CARD_STATES } from './card/compact';

type ExistingCards = 'outline' | 'gallery' | 'form';

export default class HomeReno extends Component {
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
