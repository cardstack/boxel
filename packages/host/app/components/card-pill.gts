import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { IconButton } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import RealmIcon from '@cardstack/host/components/operator-mode/realm-icon';
import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';
import Pill from '@cardstack/host/components/pill';

import { type CardDef } from 'https://cardstack.com/base/card-api';

interface CardPillSignature {
  Element: HTMLDivElement;
  Args: {
    card: CardDef;
    isAutoAttachedCard?: boolean;
    removeCard?: (card: CardDef) => void;
  };
}

export default class CardPill extends Component<CardPillSignature> {
  get component() {
    return this.args.card.constructor.getComponent(this.args.card, 'atom');
  }

  <template>
    <Pill
      @inert={{true}}
      class={{cn 'card-pill' is-autoattached=@isAutoAttachedCard}}
      data-test-attached-card={{@card.id}}
      data-test-autoattached-card={{@isAutoAttachedCard}}
    >
      <:icon>
        <RealmInfoProvider @fileURL={{@card.id}}>
          <:ready as |realmInfo|>
            <RealmIcon
              @realmIconURL={{realmInfo.iconURL}}
              @realmName={{realmInfo.name}}
              width='18'
              height='18'
            />
          </:ready>
        </RealmInfoProvider>
      </:icon>
      <:default>
        <div class='card-content'>
          <this.component @displayContainer={{false}} />
        </div>
        {{#if @removeCard}}
          <IconButton
            class='remove-button'
            @icon={{IconX}}
            {{on 'click' (fn @removeCard @card)}}
            data-test-remove-card-btn
          />
        {{/if}}
      </:default>
    </Pill>
    <style>
      .remove-button {
        --boxel-icon-button-width: 25px;
        --boxel-icon-button-height: 25px;
        display: flex;
        align-items: center;
        justify-content: center;
        outline: 0;
      }
      .remove-button:focus:not(:disabled),
      .remove-button:hover:not(:disabled) {
        --icon-color: var(--boxel-highlight);
      }
      .card-pill {
        --pill-icon-size: 18px;
        padding: var(--boxel-sp-5xs);
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-400);
        height: var(--pill-height);
      }
      .card-title {
        max-width: 10rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .is-autoattached {
        border-style: dashed;
      }
      .card-content {
        display: flex;
        max-width: 100px;
      }
      :deep(.atom-format) {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>
}
