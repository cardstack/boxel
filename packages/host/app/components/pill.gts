import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import {
  IconButton,
  Pill as BoxelPill,
  RealmIcon,
  Switch,
} from '@cardstack/boxel-ui/components';
import { cn, cssVar } from '@cardstack/boxel-ui/helpers';
import { IconX, CodeFile } from '@cardstack/boxel-ui/icons';

import { isCardInstance } from '@cardstack/runtime-common';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import { type FileDef } from 'https://cardstack.com/base/file-api';

import RealmService from '../services/realm';

interface PillSignature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    item: CardDef | FileDef;
    isAutoAttached?: boolean;
    remove?: (item: CardDef | FileDef) => void;
    onToggle?: () => void;
    isEnabled?: boolean;
  };
}

export default class Pill extends Component<PillSignature> {
  @service declare realm: RealmService;

  get component() {
    return this.args.item.constructor.getComponent(this.args.item);
  }

  get hideIconRight() {
    return !this.args.onToggle && !this.args.remove;
  }

  get id() {
    return isCardInstance(this.args.item)
      ? this.args.item.id
      : this.args.item.sourceUrl;
  }

  get title() {
    return isCardInstance(this.args.item)
      ? this.args.item.title
      : this.args.item.name;
  }

  <template>
    <BoxelPill
      class={{cn
        'pill'
        is-autoattached=@isAutoAttached
        hide-icon-right=this.hideIconRight
      }}
      data-test-attached-item={{this.id}}
      data-test-autoattached-item={{@isAutoAttached}}
      ...attributes
    >
      <:iconLeft>
        {{#if (isCardInstance @item)}}
          <RealmIcon @realmInfo={{this.realm.info this.id}} />
        {{else}}
          <CodeFile
            width='16px'
            height='16px'
            style={{cssVar icon-color='#0031ff'}}
          />
        {{/if}}
      </:iconLeft>
      <:default>
        <div class='pill-content' title={{this.title}}>
          {{this.title}}
        </div>
      </:default>
      <:iconRight>
        {{#if @onToggle}}
          <Switch
            @isEnabled={{@isEnabled}}
            @onChange={{@onToggle}}
            @label={{this.title}}
            data-test-pill-toggle='{{this.id}}-{{if @isEnabled "on" "off"}}'
          />
        {{/if}}
        {{#if @remove}}
          <IconButton
            class='remove-button'
            @icon={{IconX}}
            @height='10'
            @width='10'
            {{on 'click' (fn @remove @item)}}
            data-test-remove-item-btn
          />
        {{/if}}
      </:iconRight>
    </BoxelPill>
    <style scoped>
      .pill {
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
      .pill-content {
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
