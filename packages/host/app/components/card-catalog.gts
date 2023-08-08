import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { TrackedArray } from 'tracked-built-ins';
import type { Card, CardContext } from 'https://cardstack.com/base/card-api';
import { type RealmInfo } from '@cardstack/runtime-common';
import CardCatalogItem from './card-catalog-item';
import { Button, IconButton } from '@cardstack/boxel-ui';
// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { eq, gt, not } from '@cardstack/boxel-ui/helpers/truth-helpers';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { service } from '@ember/service';
import type CardService from '../services/card-service';

interface Signature {
  Args: {
    results: { card: Card; realmInfo: RealmInfo }[];
    toggleSelect: (card?: Card) => void;
    selectedCard: Card | undefined;
    context?: CardContext;
  };
}

type RealmCards = {
  name: RealmInfo['name'];
  iconURL: RealmInfo['iconURL'];
  cards: Card[];
  displayedCards: Card[];
};

export default class CardCatalog extends Component<Signature> {
  <template>
    <div class='card-catalog' data-test-card-catalog>
      {{#each this.cardsByRealm as |realm|}}
        <section class='card-catalog__realm' data-test-realm={{realm.name}}>
          <header class='realm-info'>
            <div
              style={{if
                realm.iconURL
                (cssUrl 'background-image' realm.iconURL)
              }}
              class={{cn 'realm-icon' realm-icon--empty=(not realm.iconURL)}}
            />
            <span class='realm-name' data-test-realm-name>
              {{realm.name}}
            </span>
            <span class='results-count' data-test-results-count>
              {{#if (gt realm.cards.length 1)}}
                {{realm.cards.length}}
                results
              {{else if (eq realm.cards.length 1)}}
                1 result
              {{/if}}
            </span>
          </header>
          {{#if realm.cards.length}}
            <ul class='card-catalog__group'>
              {{#each realm.displayedCards as |card|}}
                <li
                  class={{cn 'item' selected=(eq @selectedCard.id card.id)}}
                  data-test-card-catalog-item={{card.id}}
                >
                  <CardCatalogItem
                    @isSelected={{eq @selectedCard.id card.id}}
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
          {{else}}
            <p>No cards available</p>
          {{/if}}
        </section>
      {{else}}
        <p>No cards available</p>
      {{/each}}
    </div>

    <style>
      .realm-info {
        --realm-icon-size: 1.25rem;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .realm-icon {
        width: var(--realm-icon-size);
        height: var(--realm-icon-size);
        background-size: contain;
        background-position: center;
      }
      .realm-icon--empty {
        border: 1px solid var(--boxel-dark);
        border-radius: 100px;
      }
      .realm-name {
        display: inline-block;
        font: 700 var(--boxel-font);
      }
      .results-count {
        display: inline-block;
        font: var(--boxel-font);
      }

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

  get cardsByRealm(): RealmCards[] {
    let realmCards: RealmCards[] = [];

    if (this.args.results.length) {
      for (let instance of this.args.results) {
        let realm = realmCards.find((r) => r.name === instance.realmInfo?.name);
        if (realm) {
          realm.cards.push(instance.card);
        } else {
          realm = {
            name: instance.realmInfo.name,
            iconURL: instance.realmInfo.iconURL
              ? new URL(instance.realmInfo.iconURL, this.cardService.defaultURL)
                  .href
              : null,
            cards: [instance.card],
            displayedCards: [],
          };
          realmCards.push(realm);
        }
      }
    }

    realmCards.map((r) => {
      if (!r.displayedCards.length) {
        r.displayedCards = new TrackedArray<Card>(
          r.cards.slice(0, this.displayCardCount),
        );
      }
    });

    return realmCards.filter((r) => r.cards.length);
  }

  @action
  displayMoreCards(realm: RealmCards) {
    let num = realm.displayedCards.length;
    realm.displayedCards.push(
      ...realm.cards.slice(num, num + this.displayCardCount),
    );
  }
}
