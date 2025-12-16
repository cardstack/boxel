import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import { BoxelButton } from '@cardstack/boxel-ui/components';
import { eq, gt } from '@cardstack/boxel-ui/helpers';

import { ArrowLeft, ArrowRight } from '@cardstack/boxel-ui/icons';

import {
  type getCardCollection,
  GetCardCollectionContextName,
  realmURL as realmURLSymbol,
} from '@cardstack/runtime-common';

import type { StackItem } from '@cardstack/host/lib/stack-item';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import consumeContext from '../../helpers/consume-context';

import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RealmService from '../../services/realm';

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

export default class CopyButton extends Component<Signature> {
  <template>
    {{consumeContext this.makeCardResources}}
    {{#if (gt this.stacks.length 1)}}
      {{#if this.topMostCardCollection.isLoaded}}
        {{#if this.state}}
          <BoxelButton
            class='copy-button {{if @isCopying "copying"}}'
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
                <ArrowLeft class='arrow-icon' width='18px' height='18px' />
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
                <ArrowRight class='arrow-icon' width='18px' height='18px' />
              {{/if}}
            {{/if}}
          </BoxelButton>
        {{/if}}
      {{/if}}
    {{/if}}
    <style scoped>
      .copy-button {
        position: absolute;
        left: calc(50% - var(--boxel-button-min-width, 5rem));
        color: var(--boxel-dark);
        box-shadow: 0 15px 30px 0 rgba(0, 0, 0, 0.5);
        border: solid 1px rgba(255, 255, 255, 0.25);
      }
      .copy-text {
        margin: 0 var(--boxel-sp-xxs);
      }
      .arrow-icon {
        --icon-color: var(--boxel-dark);
      }
      .copying {
        color: var(--boxel-light);
      }
    </style>
  </template>

  @consume(GetCardCollectionContextName)
  private declare getCardCollection: getCardCollection;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @tracked private topMostCardCollection:
    | ReturnType<getCardCollection>
    | undefined;

  private makeCardResources = () => {
    this.topMostCardCollection = this.getCardCollection(
      this,
      () =>
        this.operatorModeStateService
          .topMostStackItems()
          .map((i) => i.id)
          .filter(Boolean) as string[],
    );
  };

  private canWriteStackItem(stackItem: StackItem): boolean {
    let id = stackItem.id;
    if (!id) {
      return false;
    }
    return this.realm.canWrite(id);
  }

  private get stacks() {
    return this.operatorModeStateService.state?.stacks ?? [];
  }

  private get buttonKind() {
    return this.args.isCopying ? 'primary-dark' : 'primary';
  }

  private get state() {
    let topMostStackItems = this.operatorModeStateService.topMostStackItems();
    // Need to have 2 stacks in order for a copy button to exist
    if (topMostStackItems.length < 2) {
      return undefined;
    }
    if (!topMostStackItems[LEFT].id || !topMostStackItems[RIGHT].id) {
      return undefined;
    }

    let indexCardIndicies = (this.topMostCardCollection?.cards ?? []).reduce(
      (indexCards, card, index) => {
        let realmURL = card[realmURLSymbol];
        if (!realmURL) {
          return indexCards;
        }
        if (card.id === `${realmURL.href}index`) {
          return [...indexCards, index];
        }
        return indexCards;
      },
      [] as number[],
    );

    // Returning `undefined` from this getter hides the copy button.
    switch (indexCardIndicies.length) {
      // Case (Number of top-most index cards across the two stacks)
      // Case 0 index cards: hide the button because neither top stack card is an index card.
      // Case 1 index card: the index stack is the destination; copy the other stack's top card only when the destination has no selections and its realm is writable.
      // Case 2 index cards:
      //        - whichever stack has selections becomes the source and the other stack becomes the destination
      //        - show the button only when selections reference a different stack item and the destination realm allows writes
      case 0:
        // at least one of the top most cards needs to be an index card
        return undefined;
      case 1: {
        // if only one of the top most cards are index cards, and the index card
        // has no selections, then the copy state reflects the copy of the top most
        // card to the index card
        if (this.args.selectedCards[indexCardIndicies[0]].length) {
          // the index card should be the destination card--if it has any
          // selections then don't show the copy button
          return undefined;
        }

        let sourceCard =
          this.topMostCardCollection?.cards[
            indexCardIndicies[0] === LEFT ? RIGHT : LEFT
          ];
        if (!sourceCard) {
          return undefined;
        }
        let sourceStackIndex = indexCardIndicies[0] === LEFT ? RIGHT : LEFT;
        let sourceItem = topMostStackItems[sourceStackIndex];
        let destinationItem = topMostStackItems[
          indexCardIndicies[0]
        ] as StackItem; // the index card is never a contained card

        if (!this.canWriteStackItem(destinationItem)) {
          return undefined;
        }

        return {
          direction: indexCardIndicies[0] === LEFT ? 'left' : 'right',
          sources: [sourceCard],
          destinationItem,
          sourceItem,
        };
      }
      case 2: {
        if (topMostStackItems[LEFT].id === topMostStackItems[RIGHT].id) {
          // the source and destination cannot be the same
          return undefined;
        }
        // if both the top most cards are index cards, then we need to analyze
        // the selected cards from both stacks in order to determine copy button state
        let sourceStack: number | undefined;
        for (let [
          index,
          stackSelections,
        ] of this.args.selectedCards.entries()) {
          // both stacks have selections--in this case don't show a copy button
          if (stackSelections.length > 0 && sourceStack != null) {
            return undefined;
          }
          if (stackSelections.length > 0) {
            sourceStack = index;
          }
        }
        // no stacks have a selection
        if (sourceStack == null) {
          return undefined;
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
        if (sourceItem.id === destinationItem.id) {
          return undefined;
        }

        if (!this.canWriteStackItem(destinationItem)) {
          return undefined;
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
}
