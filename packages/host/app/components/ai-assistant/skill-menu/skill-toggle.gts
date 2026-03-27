import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import {
  BoxelDropdown,
  ContextButton,
  Menu,
  Pill,
  RealmIcon,
  Switch,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';

import { type getCard, GetCardContextName } from '@cardstack/runtime-common';

import ShowCardCommand from '@cardstack/host/commands/show-card';
import consumeContext from '@cardstack/host/helpers/consume-context';
import type CommandService from '@cardstack/host/services/command-service';
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
  @consume(GetCardContextName) declare private getCard: getCard;
  @service declare private realm: RealmService;
  @service declare private commandService: CommandService;
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

  private get menuItems(): MenuItem[] {
    return [
      new MenuItem({
        label: 'Open Skill Card',
        action: this.openSkillCard,
      }),
    ];
  }

  @action
  private async openSkillCard() {
    let showCardCommand = new ShowCardCommand(
      this.commandService.commandContext,
    );
    await showCardCommand.execute({
      cardId: this.args.cardId,
    });
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
              <div class='pill-content'>
                <div class='card-content' title={{this.card.cardTitle}}>
                  {{this.card.cardTitle}}
                </div>
              </div>
            </:default>
            <:iconRight>
              <BoxelDropdown class='skill-dropdown'>
                <:trigger as |bindings|>
                  <ContextButton
                    class='skill-dropdown__trigger'
                    @size='extra-small'
                    @label='Skill options'
                    @icon='context-menu-vertical'
                    data-test-skill-options-button={{@cardId}}
                    {{bindings}}
                  />
                </:trigger>
                <:content as |dd|>
                  <Menu
                    class='skill-dropdown__menu'
                    @items={{this.menuItems}}
                    @closeMenu={{dd.close}}
                  />
                </:content>
              </BoxelDropdown>
            </:iconRight>
          </Pill>
          <Switch
            class='toggle'
            @isEnabled={{@isEnabled}}
            @onChange={{@onToggle}}
            @label={{this.card.cardTitle}}
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
        --pill-padding: 0 var(--boxel-sp-xxxs) 0 var(--boxel-sp-xs);
        --pill-gap: var(--boxel-sp-xxxs);
        --pill-icon-size: 18px;
        --boxel-realm-icon-size: var(--pill-icon-size);
        display: inline-grid;
        grid-template-columns: 1fr auto;
        border: 1px solid var(--boxel-400);
        height: var(--pill-height, 1.875rem);
        overflow: hidden;
      }
      .skill-dropdown__trigger {
        --boxel-icon-button-height: 26px;
        --boxel-icon-button-width: 26px;
      }
      .is-autoattached {
        border-style: dashed;
      }
      .card-content {
        max-width: 100%;
        min-width: 0;
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
