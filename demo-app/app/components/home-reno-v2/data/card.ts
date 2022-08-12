import { tracked } from '@glimmer/tracking';
import form from './form';
import gallery from './gallery';
import outline from './outline';
import toc from './toc';

export const CARD_TYPES = {
  form: 'form',
  gallery: 'gallery',
  outline: 'outline',
  toc: 'toc',
} as const;
const TYPE_TO_MODEL = {
  form,
  gallery,
  outline,
  toc,
} as const;
export const CARD_STATES = {
  MIN: 'MIN',
  EXPANDED: 'EXPANDED',
  MAX: 'MAX',
} as const;

type CardType = keyof typeof TYPE_TO_MODEL;
export type CardState = keyof typeof CARD_STATES;

interface CardOptions {
  type: CardType;
  id: string;
  state: CardState;
  canUpdateState?: boolean;
  parent?: Card;
}

export class Card {
  readonly type: CardType;
  readonly id: string;
  readonly suggestionCardIds: CardType[];
  readonly canUpdateState: boolean;
  readonly model: any;
  readonly parent?: Card;
  _state: CardUiState;
  @tracked suggestions: Card[] | null = null;

  constructor(opts: CardOptions) {
    this.type = opts.type;
    this.id = opts.id;
    this.suggestionCardIds = TYPE_TO_MODEL[opts.type].suggestions as CardType[];
    this.model = TYPE_TO_MODEL[opts.type].model;
    this.parent = opts.parent;
    this.canUpdateState = opts.canUpdateState ?? true;
    // Almost every card will start at min
    this._state = new CardUiState(opts.state);
    if (this.state === CARD_STATES.MAX) {
      this.suggestions = this.suggestionCardIds.map(
        (type) =>
          new Card({
            type,
            // TODO: this should be reorganized later for more meaningful ids
            id: crypto.randomUUID(),
            state: CARD_STATES.MIN,
            parent: this,
          })
      );
    }
  }

  get state() {
    return this._state.state;
  }

  set state(arg: CardState) {
    this._state.update(arg);
  }

  get transition() {
    return this._state.transition;
  }

  changeState(newState: CardState) {
    if (newState === this.state) return;
    else if (newState === CARD_STATES.MAX) {
      this.state = newState;
      this.suggestions = this.suggestionCardIds.map(
        (type) =>
          new Card({
            type,
            // TODO: this should be reorganized later for more meaningful ids
            id: crypto.randomUUID(),
            state: CARD_STATES.MIN,
            parent: this,
          })
      );
    } else if (this.state === CARD_STATES.MAX) {
      this.state = newState;
      this.suggestions = null;
    } else {
      this.state = newState;
    }
  }
}

export class TransitionLookupBuilder {
  transitionLookup: Record<string, [CardState, CardState] | []>;
  cardLookup: Record<string, Card>;

  constructor(public card: Card) {
    let _lookup = this._cardLookupEntries(card, []);
    this.cardLookup = Object.fromEntries(_lookup);
    this.transitionLookup = Object.fromEntries(
      _lookup.map(([k, c]) => [k, c.transition])
    );
  }

  _cardLookupEntries(card: Card, entries: [string, Card][]) {
    entries.push([card.id, card]);

    if (card.suggestions) {
      for (let suggestion of card.suggestions) {
        this._cardLookupEntries(suggestion, entries);
      }
    }

    return entries;
  }
}

export function maximizedCardList(root: Card) {
  let list = [];

  let card: Card | undefined = root;
  if (card.state === CARD_STATES.MAX) list.push(card);

  while (card.suggestions) {
    card = card.suggestions.find((c) => c.state === CARD_STATES.MAX);

    if (!card) break;
    list.push(card);
  }

  return list;
}

class CardUiState {
  @tracked state: CardState;
  // This cannot be tracked otherwise it will result in an infinite rendering loop
  transition: [] | [CardState, CardState] = [];

  constructor(
    initialState:
      | typeof CARD_STATES.EXPANDED
      | typeof CARD_STATES.MAX
      | typeof CARD_STATES.MIN
  ) {
    this.state = initialState;
  }

  update(newState: CardState) {
    if (this.state !== newState) this.transition = [this.state, newState];
    this.state = newState;
  }

  transitionCompleted() {
    this.transition = [];
  }
}
