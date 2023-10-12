import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { task } from 'ember-concurrency';

import BoxelButton from '@cardstack/boxel-ui/components/button';

import { eq, gt, and } from '@cardstack/boxel-ui/helpers/truth-helpers';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type { StackItem } from './container';
import type CardService from '../../services/card-service';
import type LoaderService from '../../services/loader-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import ArrowLeft from '@cardstack/boxel-ui/icons/arrow-left';
import ArrowRight from '@cardstack/boxel-ui/icons/arrow-right';

interface Signature {
  Args: {
    selectedCards: CardDef[][]; // the selected cards for each stack
    copy: (
      sources: CardDef[],
      sourceItem: StackItem,
      destinationItem: StackItem,
    ) => void;
    isCopying: boolean;
  };
}

const LEFT = 0;
const RIGHT = 1;

export default class OperatorModeContainer extends Component<Signature> {
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @service declare operatorModeStateService: OperatorModeStateService;

  <template>
    {{#if (and this.loadCardService.isIdle (gt this.stacks.length 1))}}
      {{#if this.state}}
        <BoxelButton
          class='copy-button'
          @kind={{this.buttonKind}}
          @loading={{@isCopying}}
          @size='tall'
          {{on
            'click'
            (fn
              @copy
              this.state.sources
              this.state.sourceItem
              this.state.destinationItem
            )
          }}
          data-test-copy-button={{this.state.direction}}
        >
          {{#if @isCopying}}
            <span class='copy-text'>
              Copying
              {{this.state.sources.length}}
              {{#if (gt this.state.sources.length 1)}}
                Cards
              {{else}}
                Card
              {{/if}}
            </span>
          {{else}}
            {{#if (eq this.state.direction 'left')}}
              <ArrowLeft width='18px' height='18px' />
            {{/if}}
            <span class='copy-text'>
              Copy
              {{this.state.sources.length}}
              {{#if (gt this.state.sources.length 1)}}
                Cards
              {{else}}
                Card
              {{/if}}
            </span>
            {{#if (eq this.state.direction 'right')}}
              <ArrowRight width='18px' height='18px' />
            {{/if}}
          {{/if}}
        </BoxelButton>
      {{/if}}
    {{/if}}
    <style>
      .copy-button {
        position: absolute;
        left: calc(50% - var(--boxel-button-min-width, 5rem));
        color: white;
        box-shadow: 0 15px 30px 0 rgba(0, 0, 0, 0.5);
        border: solid 1px rgba(255, 255, 255, 0.25);
      }
      .copy-text {
        margin: 0 var(--boxel-sp-xxs);
      }
    </style>
  </template>

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.loadCardService.perform();
  }

  get stacks() {
    return this.operatorModeStateService.state?.stacks ?? [];
  }

  get buttonKind() {
    return this.args.isCopying ? 'primary-dark' : 'primary';
  }

  get state() {
    // Need to have 2 stacks in order for a copy button to exist
    if (this.stacks.length < 2) {
      return;
    }

    let topMostStackItems = this.operatorModeStateService.topMostStackItems();
    let indexCardIndicies = topMostStackItems.reduce(
      (indexCards, item, index) => {
        if (this.cardService.isIndexCard(item.card)) {
          return [...indexCards, index];
        }
        return indexCards;
      },
      [] as number[],
    );

    switch (indexCardIndicies.length) {
      case 0:
        // at least one of the top most cards needs to be an index card
        return;

      case 1:
        // if only one of the top most cards are index cards, and the index card
        // has no selections, then the copy state reflects the copy of the top most
        // card to the index card
        if (this.args.selectedCards[indexCardIndicies[0]].length) {
          // the index card should be the destination card--if it has any
          // selections then don't show the copy button
          return;
        }
        let destinationItem = topMostStackItems[
          indexCardIndicies[0]
        ] as StackItem; // the index card is never a contained card
        let sourceItem =
          topMostStackItems[indexCardIndicies[0] === LEFT ? RIGHT : LEFT];
        return {
          direction: indexCardIndicies[0] === LEFT ? 'left' : 'right',
          sources: [sourceItem.card],
          destinationItem,
          sourceItem,
        };

      case 2: {
        // if both the top most cards are index cards, then we need to analyze
        // the selected cards from both stacks in order to determine copy button state
        let sourceStack: number | undefined;
        for (let [
          index,
          stackSelections,
        ] of this.args.selectedCards.entries()) {
          // both stacks have selections--in this case don't show a copy button
          if (stackSelections.length > 0 && sourceStack != null) {
            return;
          }
          if (stackSelections.length > 0) {
            sourceStack = index;
          }
        }
        // no stacks have a selection
        if (sourceStack == null) {
          return;
        }
        let sourceItem =
          sourceStack === LEFT
            ? (topMostStackItems[LEFT] as StackItem)
            : (topMostStackItems[RIGHT] as StackItem); // the index card is never a contained card
        let destinationItem =
          sourceStack === LEFT
            ? (topMostStackItems[RIGHT] as StackItem)
            : (topMostStackItems[LEFT] as StackItem); // the index card is never a contained card

        // if the source and destination are the same, don't show a copy button
        if (sourceItem.card.id === destinationItem.card.id) {
          return;
        }

        return {
          direction: sourceStack === LEFT ? 'right' : 'left',
          sources: this.args.selectedCards[sourceStack],
          sourceItem,
          destinationItem,
        };
      }
      default:
        throw new Error(
          `Don't know how to handle copy state for ${this.stacks.length} stacks`,
        );
    }
  }

  private loadCardService = task(this, async () => {
    await this.cardService.ready;
  });
}
