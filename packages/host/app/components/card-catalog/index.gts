import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { TrackedArray } from 'tracked-built-ins';

import { Button, IconButton } from '@cardstack/boxel-ui';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { eq, gt } from '@cardstack/boxel-ui/helpers/truth-helpers';

import type { CardDef, CardContext } from 'https://cardstack.com/base/card-api';

import CardCatalogItem from './item';
import CardCatalogResultsHeader from './results-header';

import type CardService from '../../services/card-service';

import type { RealmCards } from '../card-catalog/modal';

interface Signature {
  Args: {
    results: RealmCards[];
    toggleSelect: (card?: CardDef) => void;
    selectedCard: CardDef | undefined;
    context?: CardContext;
  };
}

interface RealmsWithDisplayedCards extends RealmCards {
  displayedCards: CardDef[];
}

export default class CardCatalog extends Component<Signature> {
  <template>
    <div class='card-catalog' data-test-card-catalog>
      {{#each this.paginatedCardsByRealm as |realm|}}
        <section
          class='card-catalog__realm'
          data-test-realm={{realm.realmInfo.name}}
        >
          <CardCatalogResultsHeader
            @realm={{realm.realmInfo}}
            @resultsCount={{realm.cards.length}}
          />

          <ul class='card-catalog__group'>
            {{#each realm.displayedCards as |card|}}
              {{#let (eq @selectedCard.id card.id) as |isSelected|}}
                <li
                  class={{cn 'item' selected=isSelected}}
                  data-test-card-catalog-item={{card.id}}
                  data-test-card-catalog-item-selected={{isSelected}}
                >
                  <CardCatalogItem
                    @isSelected={{isSelected}}
                    @title={{card.title}}
                    @description={{card.description}}
                    @thumbnailURL={{card.thumbnailURL}}
                    @context={{@context}}
                  />
                  <button
                    class='select'
                    {{on 'click' (fn @toggleSelect card)}}
                    data-test-select={{card.id}}
                    aria-label='Select'
                  />
                  <IconButton
                    class='hover-button preview'
                    @icon='eye'
                    aria-label='preview'
                  />
                </li>
              {{/let}}
            {{/each}}
          </ul>
          {{#if (gt realm.cards.length realm.displayedCards.length)}}
            <Button
              {{on 'click' (fn this.displayMoreCards realm)}}
              @kind='secondary-light'
              @size='small'
              data-test-show-more-cards
            >
              Show more cards
            </Button>
          {{/if}}
        </section>
      {{else}}
        <p>No cards available</p>
      {{/each}}
    </div>

    <style>
      .card-catalog {
        display: grid;
        gap: var(--boxel-sp-xl);
      }
      .card-catalog__realm > * + * {
        margin-top: var(--boxel-sp);
      }
      .card-catalog__realm > *:not(:first-child) {
        margin-left: var(--boxel-sp-lg);
      }
      .card-catalog__group {
        list-style-type: none;
        padding: 0;
        margin-bottom: 0;
        display: grid;
        gap: var(--boxel-sp);
      }
      .item {
        position: relative;
      }
      .select {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: none;
        border: none;
        border-radius: var(--boxel-border-radius);
      }
      .item:hover > .select:not(:disabled) {
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16);
        cursor: pointer;
      }
      .item > .hover-button {
        display: none;
        width: 30px;
        height: 100%;
      }
      .hover-button:not(:disabled):hover {
        --icon-color: var(--boxel-highlight);
      }
      .item:hover > .hover-button:not(:disabled) {
        position: absolute;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .preview {
        right: 0;
        top: 0;
        visibility: collapse; /* remove this line to no longer hide the preview icon */
      }
      .preview > svg {
        height: 100%;
      }
    </style>
  </template>

  displayCardCount = 5;
  @service declare cardService: CardService;

  get paginatedCardsByRealm(): RealmsWithDisplayedCards[] {
    return this.args.results.map((r) => {
      return {
        ...r,
        displayedCards: new TrackedArray<CardDef>(
          r.cards.slice(0, this.displayCardCount),
        ),
      };
    });
  }

  @action
  displayMoreCards(realm: RealmsWithDisplayedCards) {
    let num = realm.displayedCards.length;
    realm.displayedCards.push(
      ...realm.cards.slice(num, num + this.displayCardCount),
    );
  }
}
