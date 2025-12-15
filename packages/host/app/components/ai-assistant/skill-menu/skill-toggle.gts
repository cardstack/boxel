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

import type RealmService from '@cardstack/host/services/realm';

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
        <div class='toggle-and-realm-icon'>
          <RealmIcon @realmInfo={{this.realm.info @urlForRealmLookup}} />
          <Pill
            class='skill-toggle'
            data-test-attached-card={{@cardId}}
            data-test-autoattached-card={{@isAutoAttachedCard}}
            ...attributes
          >
            <:default>
              <div class='card-content' title={{this.card.title}}>
                {{this.card.title}}
              </div>
            </:default>
          </Pill>
          <Switch
            class='toggle'
            @isEnabled={{@isEnabled}}
            @onChange={{@onToggle}}
            @label={{this.card.title}}
            data-test-skill-toggle='{{@cardId}}-{{if @isEnabled "on" "off"}}'
          />
        </div>
      {{/if}}
    {{/if}}
    <style scoped>
      .toggle-and-realm-icon {
        width: 100%;
        display: inline-grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: var(--boxel-sp-4xs);
      }

      .skill-toggle {
        --pill-padding: 0 0 0 var(--boxel-sp-xs);
        --pill-gap: var(--boxel-sp-xxxs);
        --pill-icon-size: 18px;
        --boxel-realm-icon-size: var(--pill-icon-size);
        display: inline-grid;
        grid-template-columns: auto 1fr;
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
        margin-left: var(--boxel-sp-xxxs);
      }
    </style>
  </template>
}
