import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import {
  Pill,
  RealmIcon,
  LoadingIndicator,
  IconButton,
} from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import { type getCard, GetCardContextName } from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import AttachedFileDropdownMenu from './ai-assistant/attached-file-dropdown-menu';

import type RealmService from '../services/realm';

interface CardPillSignature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    cardId: string;
    urlForRealmLookup: string;
    borderType?: 'dashed' | 'solid';
    onClick?: () => void;
    onRemove?: () => void;
    isEnabled?: boolean;
    fileActionsEnabled?: boolean;
    file?: FileDef;
  };
}

export default class CardPill extends Component<CardPillSignature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @service private declare realm: RealmService;
  @tracked private cardResource: ReturnType<getCard> | undefined;

  private makeCardResource = () => {
    this.cardResource = this.getCard(this, () => this.args.cardId);
  };

  private get cardTitle() {
    return this.card?.cardTitle || this.cardError?.meta.cardTitle;
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

  @action
  private handleCardClick() {
    if (this.args.onClick) {
      this.args.onClick();
    }
  }

  @action
  private handleRemoveClick(event: Event) {
    // Prevent the click from bubbling up to the pill button
    event.stopPropagation();
    if (this.args.onRemove) {
      this.args.onRemove();
    }
  }

  private get pillKind() {
    return this.args.onClick ? 'button' : 'default';
  }

  private get borderStyle() {
    return this.args.borderType === 'dashed' ? 'dashed' : 'solid';
  }

  private get borderClass() {
    return `border-${this.borderStyle}`;
  }

  <template>
    {{consumeContext this.makeCardResource}}

    {{#if this.isCreating}}
      <LoadingIndicator />
    {{else}}
      <Pill
        @kind={{this.pillKind}}
        class={{cn 'card-pill' this.borderClass}}
        data-test-attached-card={{@cardId}}
        {{on 'click' this.handleCardClick}}
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
          {{#if @onRemove}}
            <IconButton
              class='remove-button'
              @icon={{IconX}}
              @height='10'
              @width='10'
              {{on 'click' this.handleRemoveClick}}
              data-test-remove-card-btn
            />
          {{/if}}

          {{#if @file}}
            <AttachedFileDropdownMenu
              @file={{@file}}
              @isNewFile={{false}}
              @isCardInstance={{true}}
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
      .border-dashed {
        border-style: dashed;
      }
      .border-solid {
        border-style: solid;
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
