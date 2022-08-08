import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { CARD_STATES, maximizedCardList, Card } from './data/card';

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
    // console.table(
    //   this.cardList.map((v) => ({
    //     type: v.type,
    //     id: v.id,
    //   }))
    // );
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
}
