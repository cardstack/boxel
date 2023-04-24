import Component from '@glimmer/component';
import { Card, Format } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import Preview from './preview';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { service } from '@ember/service';
import type CardService from '../services/card-service';
import type RouterService from '@ember/routing/router-service';
import getValueFromWeakMap from '../helpers/get-value-from-weakmap';
import { eq, not } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { restartableTask } from 'ember-concurrency';
import { TrackedWeakMap } from 'tracked-built-ins';

interface Signature {
  Args: {
    firstCardInStack: Card;
  };
}

export default class OperatorMode extends Component<Signature> {
  @tracked stack: Card[] = [];
  formats: WeakMap<Card, Format> = new TrackedWeakMap<Card, Format>();
  oldCards: WeakMap<Card, Card> = new WeakMap<Card, Card>();
  @service declare cardService: CardService;
  @service declare router: RouterService;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.stack = [this.args.firstCardInStack];
  }

  @action edit(card: Card) {
    this.oldCards.set(card, {...card});
    this.formats.set(card, 'edit');
  }

  @action getCardFormat(card: Card): Format | undefined {
    return this.formats.get(card);
  }

  @action closeCard(card: Card) {
    let index = this.stack.indexOf(card);
    this.stack.splice(index);
    this.stack = this.stack;

    if (this.stack.length <= 0) {
      this.router.transitionTo('card', this.args.firstCardInStack);
    }
  }

  @action cancel(card: Card) {
    let oldCard = this.oldCards.get(card);
    if (oldCard) {
      Object.assign(card, oldCard);
    }
    this.formats.set(card, 'isolated');
  }

  @action save(card: Card) {
    this.write.perform(card);
  }

  private write = restartableTask(async (card: Card) => {
    let updatedCard = await this.cardService.saveModel(card);
    this.formats.set(updatedCard, 'isolated');
  });

  <template>
    <div class='operator-mode-desktop-overlay'>
      <div class='operator-mode-card-stack'>
        {{#each this.stack as |card|}}
          <div class='operator-mode-card-stack__header'>
            {{#if (not (eq (getValueFromWeakMap this.formats card) 'edit'))}}
              <button
                class='operator-mode-card-stack__header-item icon-button'
                {{on 'click' (fn this.edit card)}}
                aria-label='Edit'
              >
                {{svgJar 'icon-horizontal-three-dots' width='20px' height='20px'}}
              </button>
            {{/if}}
            <button
              class='operator-mode-card-stack__header-item icon-button'
              {{on 'click' (fn this.closeCard card)}}
              aria-label='Close'
            >
              {{svgJar 'icon-x' width='20px' height='20px'}}
            </button>
          </div>
          <div class={{cn 'operator-mode-card-stack__item' operator-mode-card-stack__item_edit=(eq (getValueFromWeakMap this.formats card) 'edit')}}>
            <Preview @card={{card}} @format={{this.getCardFormat card}} />
          </div>
          {{#if (eq (getValueFromWeakMap this.formats card) 'edit')}}
          <div class='operator-mode-card-stack__footer'>
            <button
              class='operator-mode-card-stack__footer-button light-button'
              {{on 'click' (fn this.cancel card)}}
              aria-label='Cancel'
            >
              Cancel
            </button>
            <button
              class='operator-mode-card-stack__footer-button'
              {{on 'click' (fn this.save card)}}
              aria-label='Save'
            >
              Save
            </button>
          </div>
          {{/if}}
        {{/each}}
      </div>
      <div>
        <br />

        {{! TODO open card chooser }}
        ➕ Add a new card to this collection
      </div>
    </div>
  </template>
}
