import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import {
  Pill,
  RealmIcon,
  Switch,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';

import { type getCard, GetCardContextName } from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';

import RealmService from '@cardstack/host/services/realm';

interface SkillToggleSignature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    cardId: string;
    urlForRealmLookup: string;
    isAutoAttachedCard?: boolean;
    onToggle: () => void;
    isEnabled?: boolean;
  };
}

export default class SkillToggle extends Component<SkillToggleSignature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @service private declare realm: RealmService;
  @tracked private cardResource: ReturnType<getCard> | undefined;

  private makeCardResource = () => {
    this.cardResource = this.getCard(this, () => this.args.cardId);
  };

  private get card() {
    return this.cardResource?.card;
  }

  private get isCreating() {
    return this.card && !this.card.id;
  }

  <template>
    {{consumeContext this.makeCardResource}}
    {{#if this.card}}
      {{#if this.isCreating}}
        <LoadingIndicator />
      {{else}}
        <Pill
          class='skill-toggle'
          data-test-attached-card={{@cardId}}
          data-test-autoattached-card={{@isAutoAttachedCard}}
          ...attributes
        >
          <:iconLeft>
            <RealmIcon @realmInfo={{this.realm.info @urlForRealmLookup}} />
          </:iconLeft>
          <:default>
            <div class='card-content' title={{this.card.title}}>
              {{this.card.title}}
            </div>
          </:default>
          <:iconRight>
            <Switch
              @isEnabled={{@isEnabled}}
              @onChange={{@onToggle}}
              @label={{this.card.title}}
              data-test-card-pill-toggle='{{@cardId}}-{{if
                @isEnabled
                "on"
                "off"
              }}'
            />
          </:iconRight>
        </Pill>
      {{/if}}
    {{/if}}
    <style scoped>
      .skill-toggle {
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
      .card-content {
        max-width: 100px;
        max-height: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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
