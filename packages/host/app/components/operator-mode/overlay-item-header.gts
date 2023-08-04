import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import { service } from '@ember/service';
import CardService from '@cardstack/host/services/card-service';
import type {
  Card,
  Format,
  FieldType,
} from 'https://cardstack.com/base/card-api';
import { cardTypeDisplayName, type RealmInfo } from '@cardstack/runtime-common';
import { BoxelDropdown, IconButton, Menu } from '@cardstack/boxel-ui';
import menuItem from '@cardstack/boxel-ui/helpers/menu-item';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { type RenderedCardForOverlayActions } from './stack-item';

interface Signature {
  item: RenderedCardForOverlayActions;
  openOrSelectCard: (
    card: Card,
    format?: Format,
    fieldType?: FieldType,
    fieldName?: string
  ) => void;
}

export default class OperatorModeOverlayItemHeader extends Component<Signature> {
  @service declare cardService: CardService;
  @tracked realmInfo: RealmInfo | undefined;

  constructor(owner: unknown, args: Signature) {
    super(owner, args);
    this.fetchRealmInfo.perform();
  }

  fetchRealmInfo = restartableTask(
    async () =>
      (this.realmInfo = await this.cardService.getRealmInfo(
        this.args.item.card
      ))
  );

  <template>
    <header class='overlay-item-header' data-test-overlay-header>
      <div class='header-title'>
        {{#if (eq @item.fieldType 'contains')}}
          {{svgJar 'icon-turn-down-right' width='22px' height='18px'}}
        {{else}}
          <img
            src={{this.realmInfo.iconURL}}
            width='20'
            height='20'
            alt=''
            role='presentation'
          />
        {{/if}}
        <span class='header-title__text'>
          {{cardTypeDisplayName @item.card}}
        </span>
      </div>

      <div class='header-actions'>
        {{! Offer to edit embedded card only when the stack item is in edit mode  }}
        {{#if (eq @item.stackItem.format 'edit')}}
          <IconButton
            @icon='icon-pencil'
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
            <IconButton
              @icon='more-actions'
              @width='20px'
              @height='20px'
              class='header-actions__button'
              aria-label='Options'
              data-test-embedded-card-options-button
              {{bindings}}
            />
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
        background-color: var(--boxel-light-100);
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
        border-radius: 4px;
        height: calc(
          var(--overlay-embedded-card-header-height) - 2 * var(--boxel-sp-xxs)
        );
        width: calc(
          var(--overlay-embedded-card-header-height) - 2 * var(--boxel-sp-xxs)
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
