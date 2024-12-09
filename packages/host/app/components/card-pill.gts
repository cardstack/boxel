import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import {
  IconButton,
  Pill,
  RealmIcon,
  Switch,
} from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

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

  get hideIconRight() {
    return !this.args.onToggle && !this.args.removeCard;
  }

  <template>
    <Pill
      class={{cn
        'card-pill'
        is-autoattached=@isAutoAttachedCard
        hide-icon-right=this.hideIconRight
      }}
      data-test-attached-card={{@card.id}}
      data-test-autoattached-card={{@isAutoAttachedCard}}
      ...attributes
    >
      <:iconLeft>
        <RealmIcon @realmInfo={{this.realm.info @card.id}} />
      </:iconLeft>
      <:default>
        <div class='card-content' title={{@card.title}}>
          <this.component @format='atom' @displayContainer={{false}} />
        </div>
      </:default>
      <:iconRight>
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
            @height='10'
            @width='10'
            {{on 'click' (fn @removeCard @card)}}
            data-test-remove-card-btn
          />
        {{/if}}
      </:iconRight>
    </Pill>
    <style scoped>
      .card-pill {
        --pill-gap: var(--boxel-sp-xxxs);
        --pill-icon-size: 18px;
        --boxel-realm-icon-size: var(--pill-icon-size);
        border: 1px solid var(--boxel-400);
        height: var(--pill-height, 1.875rem);
      }
      .is-autoattached {
        border-style: dashed;
      }
      .hide-icon-right :deep(figure.icon):last-child {
        display: none;
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
        --boxel-icon-button-width: var(--boxel-icon-sm);
        --boxel-icon-button-height: var(--boxel-icon-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--boxel-border-radius-xs);
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
