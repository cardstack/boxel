import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';

import { service } from '@ember/service';
import Component from '@glimmer/component';

import { trackedFunction } from 'ember-resources/util/function';

import {
  BoxelDropdown,
  IconButton,
  Menu,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { eq, menuItem, and } from '@cardstack/boxel-ui/helpers';

import {
  IconPencil,
  IconTurnDownRight,
  ThreeDotsHorizontal,
} from '@cardstack/boxel-ui/icons';

import { cardTypeDisplayName } from '@cardstack/runtime-common';

import CardService from '@cardstack/host/services/card-service';

import type {
  CardDef,
  Format,
  FieldType,
} from 'https://cardstack.com/base/card-api';

import { type RenderedCardForOverlayActions } from './stack-item';

interface Signature {
  item: RenderedCardForOverlayActions;
  canWrite: boolean;
  openOrSelectCard: (
    card: CardDef,
    format?: Format,
    fieldType?: FieldType,
    fieldName?: string,
  ) => void;
}

export default class OperatorModeOverlayItemHeader extends Component<Signature> {
  @service declare cardService: CardService;

  fetchRealmInfo = trackedFunction(
    this,
    async () => await this.cardService.getRealmInfo(this.args.item.card),
  );

  get iconURL() {
    return this.fetchRealmInfo.value?.iconURL ?? '/default-realm-icon.png';
  }

  <template>
    <header class='overlay-item-header' data-test-overlay-header>
      <div class='header-title'>
        {{#if (eq @item.fieldType 'contains')}}
          <IconTurnDownRight width='22px' height='18px' />
        {{else}}
          <img src={{this.iconURL}} width='20' height='20' alt='' />
        {{/if}}
        <span class='header-title__text'>
          {{cardTypeDisplayName @item.card}}
        </span>
      </div>

      <div class='header-actions'>
        {{! Offer to edit embedded card only when the stack item is in edit 
            mode and you can write to the card in question }}
        {{#if (and @canWrite (eq @item.stackItem.format 'edit'))}}
          <IconButton
            @icon={{IconPencil}}
            @width='24px'
            @height='24px'
            class='header-actions__button'
            aria-label='Edit'
            data-test-embedded-card-edit-button
            {{on
              'click'
              (fn
                @openOrSelectCard
                @item.card
                'edit'
                @item.fieldType
                @item.fieldName
              )
            }}
          />
        {{/if}}

        <BoxelDropdown>
          <:trigger as |bindings|>
            <Tooltip @placement='top'>
              <:trigger>
                <IconButton
                  @icon={{ThreeDotsHorizontal}}
                  @width='20px'
                  @height='20px'
                  class='header-actions__button'
                  aria-label='Options'
                  data-test-embedded-card-options-button
                  {{bindings}}
                />
              </:trigger>
              <:content>
                More Options
              </:content>
            </Tooltip>
          </:trigger>
          <:content as |dd|>
            <Menu
              @closeMenu={{dd.close}}
              @items={{array
                (menuItem 'View card' (fn @openOrSelectCard @item.card))
              }}
            />
          </:content>
        </BoxelDropdown>
      </div>
    </header>

    <style>
      .overlay-item-header {
        border-bottom: 1px solid var(--boxel-200);
        height: var(--overlay-embedded-card-header-height);
        display: flex;
        justify-content: space-between;
        padding: var(--boxel-sp-xxs);
        border-top-right-radius: var(--boxel-border-radius);
        border-top-left-radius: var(--boxel-border-radius);
      }
      .header-title {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .header-title__text {
        display: inline-block;
        margin: 0;
        color: var(--boxel-label-color);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .header-actions {
        display: flex;
        align-items: center;
      }
      .header-actions__button {
        --icon-bg: var(--boxel-highlight);
        --icon-color: var(--boxel-highlight);

        margin-left: var(--boxel-sp-xxxs);
        pointer-events: auto; /* pointer events are disabled in the overlay, we re-enable it here for header actions */
        display: flex;
        border-radius: 5px;
        height: calc(
          var(--overlay-embedded-card-header-height) - 2 * var(--boxel-sp-xxxs)
        );
        width: calc(
          var(--overlay-embedded-card-header-height) - 2 * var(--boxel-sp-xxxs)
        );
      }
      .header-actions__button:hover {
        --icon-bg: var(--boxel-light);
        --icon-color: var(--boxel-light);
        background-color: var(--boxel-highlight);
      }
    </style>
  </template>
}
