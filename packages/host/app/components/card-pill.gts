import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import {
  IconButton,
  Pill,
  RealmIcon,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import { type getCard, GetCardContextName } from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';

import RealmService from '../services/realm';

interface CardPillSignature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    cardId: string;
    urlForRealmLookup: string;
    isAutoAttachedCard?: boolean;
    removeCard?: (cardId: string) => void;
    isEnabled?: boolean;
  };
}

export default class CardPill extends Component<CardPillSignature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @service private declare realm: RealmService;
  @tracked private cardResource: ReturnType<getCard> | undefined;

  private makeCardResource = () => {
    this.cardResource = this.getCard(this, () => this.args.cardId);
  };

  private get hideIconRight() {
    return !this.args.removeCard;
  }

  private get cardTitle() {
    return this.card?.title || this.cardError?.meta.cardTitle;
  }

  private get card() {
    return this.cardResource?.card;
  }

  private get cardError() {
    return this.cardResource?.cardError;
  }

  private get isCreating() {
    return this.card && !this.card.id && !this.cardError;
  }

  <template>
    {{consumeContext this.makeCardResource}}
    {{#if this.isCreating}}
      <LoadingIndicator />
    {{else}}
      <Pill
        class={{cn
          'card-pill'
          is-autoattached=@isAutoAttachedCard
          hide-icon-right=this.hideIconRight
        }}
        data-test-attached-card={{@cardId}}
        data-test-autoattached-card={{@isAutoAttachedCard}}
        ...attributes
      >
        <:iconLeft>
          <RealmIcon @realmInfo={{this.realm.info @urlForRealmLookup}} />
        </:iconLeft>
        <:default>
          <div class='card-content' title={{this.cardTitle}}>
            {{this.cardTitle}}
          </div>
        </:default>
        <:iconRight>
          {{#if @removeCard}}
            <IconButton
              class='remove-button'
              @icon={{IconX}}
              @height='10'
              @width='10'
              {{on 'click' (fn @removeCard @cardId)}}
              data-test-remove-card-btn
            />
          {{/if}}
        </:iconRight>
      </Pill>
    {{/if}}
    <style scoped>
      .card-pill {
        --pill-gap: var(--boxel-sp-xxxs);
        --pill-icon-size: 18px;
        --boxel-realm-icon-size: var(--pill-icon-size);
        border: 1px solid var(--boxel-400);
        height: var(--pill-height, 1.875rem);
        overflow: hidden;
      }
      .is-autoattached {
        border-style: dashed;
      }
      .hide-icon-right :deep(figure.icon):last-child {
        display: none;
      }
      .card-content {
        max-width: 100px;
        max-height: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .remove-button {
        --boxel-icon-button-width: var(--boxel-icon-sm);
        --boxel-icon-button-height: var(--boxel-icon-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--boxel-border-radius-xs);
      }
    </style>
  </template>
}
