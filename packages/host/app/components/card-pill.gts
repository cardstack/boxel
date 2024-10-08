import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { IconButton, Pill, Switch } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import RealmIcon from '@cardstack/host/components/operator-mode/realm-icon';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import RealmService from '../services/realm';

interface CardPillSignature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    card: CardDef;
    isAutoAttachedCard?: boolean;
    removeCard?: (card: CardDef) => void;
    onToggle?: () => void;
    isEnabled?: boolean;
  };
}

export default class CardPill extends Component<CardPillSignature> {
  @service declare realm: RealmService;

  get component() {
    return this.args.card.constructor.getComponent(this.args.card);
  }

  <template>
    <Pill
      class={{cn 'card-pill' is-autoattached=@isAutoAttachedCard}}
      data-test-attached-card={{@card.id}}
      data-test-autoattached-card={{@isAutoAttachedCard}}
      ...attributes
    >
      <:icon>
        <RealmIcon
          @realmInfo={{this.realm.info @card.id}}
          width='18'
          height='18'
        />
      </:icon>
      <:default>
        <div class='card-content' title={{@card.title}}>
          <this.component @format='atom' @displayContainer={{false}} />
        </div>
        {{#if @onToggle}}
          <Switch
            @isEnabled={{@isEnabled}}
            @onChange={{@onToggle}}
            @label={{@card.title}}
            data-test-card-pill-toggle='{{@card.id}}-{{if
              @isEnabled
              "on"
              "off"
            }}'
          />
        {{/if}}
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
    <style scoped>
      .card-pill {
        --pill-icon-size: 18px;
        border: 1px solid var(--boxel-400);
        height: var(--pill-height, 1.875rem);
      }
      .is-autoattached {
        border-style: dashed;
      }
      .card-content {
        display: flex;
        max-width: 100px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .card-content > :deep(.atom-format) {
        background: none;
        border-radius: 0;
        white-space: inherit;
        overflow: inherit;
        text-overflow: inherit;
      }
      .remove-button {
        --boxel-icon-button-width: 12px;
        --boxel-icon-button-height: 25px;
        display: flex;
        align-items: center;
        justify-content: center;
        outline: 0;
        margin-right: var(--boxel-sp-5xs);
      }
      .remove-button:focus:not(:disabled),
      .remove-button:hover:not(:disabled) {
        --icon-color: var(--boxel-highlight);
      }
      .toggle {
        margin-left: auto;
        width: 22px;
        height: 12px;
        background-color: var(--boxel-450);
        border-radius: var(--boxel-border-radius-sm);
        padding: 3px;
        display: flex;
        align-items: center;
        transition: background-color 0.1s ease-in;
      }
      input[type='checkbox'] {
        appearance: none;
      }
      .toggle-switch {
        margin: 0;
        width: 6px;
        height: 6px;
        background-color: var(--boxel-light);
        border-radius: 50%;
        transform: translateX(0);
        transition: transform 0.1s ease-in;
      }
      .toggle.checked {
        background-color: var(--boxel-dark-green);
      }
      .toggle.checked .toggle-switch {
        transform: translateX(10px);
      }
      .toggle:hover,
      .toggle-switch:hover {
        cursor: pointer;
      }
    </style>
  </template>
}
