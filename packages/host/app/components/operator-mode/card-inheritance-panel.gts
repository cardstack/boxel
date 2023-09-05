import Component from '@glimmer/component';
import { service } from '@ember/service';
import CardService from '@cardstack/host/services/card-service';
import { type CardDef } from 'https://cardstack.com/base/card-api';
import { type RealmInfo, cardTypeDisplayName } from '@cardstack/runtime-common';
import DefinitionContainer, { DefinitionVariant } from './definition-container';
import { isReady, FileResource } from '@cardstack/host/resources/file';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';
import LoaderService from '@cardstack/host/services/loader-service';
import moment from 'moment';
import { BaseDef } from 'https://cardstack.com/base/card-api';
import { type ImportResource } from '@cardstack/host/resources/import';

interface Args {
  Element: HTMLElement;
  Args: {
    realmInfo: RealmInfo | null;
    realmIconURL: string | null | undefined;
    openFile: { current: FileResource | undefined };
    cardInstance: CardDef | null;
    importedModule?: ImportResource;
    onCreate?: () => void;
    onInherit?: () => void;
    onDuplicate?: () => void;
  };
}

export default class CardInheritancePanel extends Component<Args> {
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;
  @tracked cardInstance: CardDef | undefined;
  @tracked module: ModuleSyntax | undefined;

  @action
  duplicateAction() {
    console.log('running duplicate');
  }

  @action
  createAction() {
    console.log('running create');
  }

  @action
  inheritAction() {
    console.log('running inherit');
  }

  <template>
    <div class='container' ...attributes>
      {{#if @importedModule.module}}
        {{#each (cardsFromModule @importedModule.module) as |card|}}
          <DefinitionContainer
            @name={{cardTypeDisplayName card}}
            @fileExtension='.GTS'
            @realmInfo={{@realmInfo}}
            @realmIconURL={{@realmIconURL}}
            @variant={{DefinitionVariant.Module}}
            @onDuplicate={{this.duplicateAction}}
            @onCreate={{this.createAction}}
            @onInherit={{this.inheritAction}}
            @isActive={{false}}
            data-test-card-module-definition
          />
        {{/each}}
      {{/if}}
      {{#if @cardInstance}}
        <DefinitionContainer
          @name={{@cardInstance.title}}
          @fileExtension='.JSON'
          @realmInfo={{@realmInfo}}
          @realmIconURL={{@realmIconURL}}
          @infoText={{this.lastModified}}
          @variant={{DefinitionVariant.Instance}}
          @isActive={{true}}
          @onDuplicate={{this.duplicateAction}}
          data-test-card-instance-definition
        />
      {{/if}}
    </div>
    <style>
      .container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .realm-info {
        display: inline-block;
      }

      .realm-info img,
      .realm-info div {
        display: inline-block;
        vertical-align: middle;
      }

      .realm-info img {
        width: 22px;
      }
    </style>
  </template>

  get lastModified() {
    if (
      isReady(this.args.openFile.current) &&
      this.args.openFile.current?.lastModified != undefined
    ) {
      return `Last edit was ${moment(
        this.args.openFile.current?.lastModified,
      ).fromNow()}`;
    }
    return;
  }
}

function cardsFromModule(
  module: Record<string, any>,
  _never?: never, // glint insists that w/o this last param that there are actually no params
): BaseDef[] {
  return Object.values(module)
    .filter(
      (maybeCard) => typeof maybeCard === 'function' && 'baseDef' in maybeCard,
    )
    .map((o) => new o()) as BaseDef[]; //instantiating as instance needed to get display name
}
