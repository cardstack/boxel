import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { COMPACT_CARD_STATES } from './card/compact';

type ExistingCards = 'outline' | 'gallery' | 'form';

export default class HomeReno extends Component {
  @tracked currentExpandedItem: ExistingCards | null = null;
  @tracked currentMaximizedItems: Record<ExistingCards, boolean> = {
    outline: false,
    gallery: false,
    form: false,
  };
  @tracked expandedSecondaryItems: Record<ExistingCards, boolean> = {
    outline: false,
    gallery: false,
    form: false,
  };

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

      if (this.currentMaximizedItems[key]) {
        res[key] = COMPACT_CARD_STATES.MAXIMIZED_PLACEHOLDER;
      }
    }
    return res;
  }

  get secondaryItemState() {
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
      if (this.expandedSecondaryItems[key]) {
        res[key] = COMPACT_CARD_STATES.EXPANDED;
      }
    }
    console.log(res);
    return res;
  }

  @action toggleExpansion(item: ExistingCards) {
    if (this.currentExpandedItem === item) {
      this.currentExpandedItem = null;
    } else {
      this.currentExpandedItem = item;
    }
  }

  @action toggleSecondaryItemExpansion(item: ExistingCards) {
    this.expandedSecondaryItems[item] = !this.expandedSecondaryItems[item];
    // eslint-disable-next-line no-self-assign
    this.expandedSecondaryItems = this.expandedSecondaryItems;
  }

  @action maximize(item: ExistingCards) {
    this.expandedSecondaryItems[item] = false;
    // eslint-disable-next-line no-self-assign
    this.expandedSecondaryItems = this.expandedSecondaryItems;

    this.currentMaximizedItems[item] = true;
    // eslint-disable-next-line no-self-assign
    this.currentMaximizedItems = this.currentMaximizedItems;
  }

  @action minimize(item: ExistingCards) {
    this.currentMaximizedItems[item] = false;
    // eslint-disable-next-line no-self-assign
    this.currentMaximizedItems = this.currentMaximizedItems;
  }
}
