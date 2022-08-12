import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Changeset } from 'animations-experiment/models/changeset';
import {
  CARD_STATES,
  maximizedCardList,
  Card,
  TransitionLookupBuilder,
} from './data/card';
import {
  expandedToMax,
  expandedToMaxImages,
  groupSprites,
  maxToExpanded,
  maxToExpandedImages,
  simple,
} from './transitions';

// NEXT: identify
// NEXT: layers

export default class HomeRenoV2 extends Component {
  entrypoint = new Card({
    type: 'toc',
    id: crypto.randomUUID(),
    state: CARD_STATES.MAX,
    canUpdateState: false,
  });
  @tracked cardList: Card[] = maximizedCardList(this.entrypoint);
  CARD_STATES = CARD_STATES;

  updateState() {
    this.cardList = maximizedCardList(this.entrypoint);
  }

  @action minimize(card: Card) {
    card.changeState(CARD_STATES.MIN);
    this.updateState();
  }

  @action expand(card: Card) {
    let parent = card.parent;
    if (parent && parent.suggestions!.length > 1) {
      let currentExpanded = parent.suggestions?.find(
        (v) => v.state === CARD_STATES.EXPANDED
      );
      if (currentExpanded) {
        currentExpanded.changeState(CARD_STATES.MIN);
      }
    }
    card.changeState(CARD_STATES.EXPANDED);
    this.updateState();
  }

  @action maximize(card: Card) {
    let parent = card.parent;
    if (parent && parent.suggestions!.length > 1) {
      let currentMaximized = parent.suggestions?.find(
        (v) => v.state === CARD_STATES.MAX
      );
      if (currentMaximized) {
        currentMaximized.changeState(CARD_STATES.EXPANDED);
      }
    }
    card.changeState(CARD_STATES.MAX);
    this.updateState();
  }

  @action async transition(changeset: Changeset) {
    let { transitionLookup, cardLookup } = new TransitionLookupBuilder(
      this.entrypoint
    );

    try {
      let groupedSprites = groupSprites(
        changeset,
        transitionLookup,
        cardLookup
      );
      let staticCards = Object.fromEntries(
        Object.entries(groupedSprites).filter(([k, v]) => v.state === 'STATIC')
      );
      let shrinkingFromMaxCards = Object.fromEntries(
        Object.entries(groupedSprites).filter(
          ([k, v]) => v.state.startsWith('MAX')
          // || (v.state === 'REMOVED' && v.card?.element.className.includes('MAX'))
        )
      );
      let enteringCards = Object.fromEntries(
        Object.entries(groupedSprites).filter(([k, v]) =>
          v.state.endsWith('MAX')
        )
      );

      for (let cardId in staticCards) {
        let group = groupedSprites[cardId]!;
        if (group.placeholder) {
          Promise.all([simple(group.placeholder!), simple(group.card!)]).then(
            () => {
              group.model._state.transitionCompleted();
            }
          );
        } else {
          simple(group.card!).then(() => {
            group.model._state.transitionCompleted();
          });
        }
      }

      // hide entering cards that shouldn't be visible yet
      // keep their counterparts around because we need to fade their contents out before doing the swap
      if (Object.keys(shrinkingFromMaxCards).length) {
        for (let cardId in enteringCards) {
          let group = groupedSprites[cardId]!;
          group.card!.element.style.opacity = '0';
          group.card?.counterpart?.lockStyles();
          changeset.context.appendOrphan(group.card!.counterpart!);
        }
      }

      for (let cardId in shrinkingFromMaxCards) {
        let group = groupedSprites[cardId]!;
        let isImages = false;
        group.keptContent.forEach(
          (v) => (isImages = isImages || v.role === 'image')
        );
        if (isImages) {
          await maxToExpandedImages(
            changeset.context,
            group,
            Object.values(groupedSprites)
          );
        } else {
          await maxToExpanded(changeset.context, group);
        }
      }

      // unhide entering cards
      if (Object.keys(shrinkingFromMaxCards).length) {
        for (let cardId in enteringCards) {
          let group = groupedSprites[cardId]!;
          group.card!.element.style.opacity = '1';
        }
      }

      for (let cardId in enteringCards) {
        let group = groupedSprites[cardId]!;

        // TODO: Actually we can formalize this as "gallery"
        let isImages = false;
        group.keptContent.forEach(
          (v) => (isImages = isImages || v.role === 'image')
        );
        if (isImages) {
          await expandedToMaxImages(
            changeset.context,
            group,
            Object.values(groupedSprites)
          );
        } else {
          await expandedToMax(changeset.context, group);
        }
      }
    } catch (e) {
      Object.values(cardLookup).forEach((card) =>
        card._state.transitionCompleted()
      );
      throw e;
    }
  }
}
