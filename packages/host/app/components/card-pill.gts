import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { cached } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import {
  Pill,
  RealmIcon,
  LoadingIndicator,
  IconButton,
} from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { FailureBordered, IconX } from '@cardstack/boxel-ui/icons';

import { type getCard, GetCardContextName } from '@cardstack/runtime-common';

import RealmURLTooltip from '@cardstack/host/components/realm-url-tooltip';

import AttachedFileDropdownMenu from './ai-assistant/attached-file-dropdown-menu';

import type RealmService from '../services/realm';
import type { FileDef } from '@cardstack/base/file-api';

interface CardPillSignature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    cardId: string;
    urlForRealmLookup: string;
    borderType?: 'dashed' | 'solid';
    displayTitle?: string;
    showErrorIcon?: boolean;
    /** the click, so a caller can tell which pill was pressed */
    onClick?: (event: Event) => void;
    onRemove?: () => void;
    isEnabled?: boolean;
    fileActionsEnabled?: boolean;
    file?: FileDef;
  };
}

export default class CardPill extends Component<CardPillSignature> {
  @consume(GetCardContextName) declare private getCard: getCard;
  @service declare private realm: RealmService;

  @cached
  private get cardResource(): ReturnType<getCard> {
    return this.getCard(this, () => this.args.cardId);
  }

  private get cardTitle() {
    return (
      this.args.displayTitle ||
      this.card?.cardTitle ||
      this.cardError?.meta.cardTitle
    );
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
  private handleCardClick(event: Event) {
    // a control inside the pill (its file menu) keeps its own click
    let inner = (event.target as Element | null)?.closest(
      'button, a, [role="button"]',
    );
    let pill = event.currentTarget as Element | null;
    if (inner && inner !== pill && pill?.contains(inner)) {
      return;
    }
    if (this.args.onClick) {
      this.args.onClick(event);
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
          {{#if @showErrorIcon}}
            <FailureBordered
              class='fallback-card-icon'
              width='18'
              height='18'
              aria-hidden='true'
            />
          {{else}}
            <RealmURLTooltip @urlInRealm={{@urlForRealmLookup}}>
              <RealmIcon @realmInfo={{this.realm.info @urlForRealmLookup}} />
            </RealmURLTooltip>
          {{/if}}
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
      .fallback-card-icon {
        display: block;
        flex-shrink: 0;
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
