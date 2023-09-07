import Component from '@glimmer/component';
import { service } from '@ember/service';
import CardService from '@cardstack/host/services/card-service';
import {
  type CardDef,
  type BaseDef,
} from 'https://cardstack.com/base/card-api';
import { type RealmInfo, cardTypeDisplayName } from '@cardstack/runtime-common';
import DefinitionContainer, { DefinitionVariant } from './definition-container';
import { isReady, FileResource } from '@cardstack/host/resources/file';
import { tracked } from '@glimmer/tracking';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';
import LoaderService from '@cardstack/host/services/loader-service';
import moment from 'moment';
import { type ImportResource } from '@cardstack/host/resources/import';

interface Args {
  Element: HTMLElement;
  Args: {
    realmInfo: RealmInfo | null;
    realmIconURL: string | null | undefined;
    openFile: { current: FileResource | undefined };
    cardInstance: CardDef | null;
    importedModule?: ImportResource;
    delete: () => void;
  };
}

export default class CardInheritancePanel extends Component<Args> {
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;
  @tracked cardInstance: CardDef | undefined;
  @tracked module: ModuleSyntax | undefined;

  <template>
    <div class='container' ...attributes>
      {{#if @importedModule.module}}
        {{#each (cardsFromModule @importedModule.module) as |card|}}
          <DefinitionContainer
            @name={{this.getCardTypeDisplayName card}}
            @fileExtension='.GTS'
            @realmInfo={{@realmInfo}}
            @realmIconURL={{@realmIconURL}}
            @variant={{DefinitionVariant.Module}}
            @delete={{@delete}}
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
          @delete={{@delete}}
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
    </style>
  </template>

  get lastModified() {
    if (
      isReady(this.args.openFile.current) &&
      this.args.openFile.current?.lastModified != undefined
    ) {
      return `Last saved was ${moment(
        this.args.openFile.current?.lastModified,
      ).fromNow()}`;
    }
    return;
  }

  getCardTypeDisplayName(t: typeof BaseDef) {
    let card = new t();
    return cardTypeDisplayName(card);
  }
}

function cardsFromModule(
  module: Record<string, any>,
  _never?: never, // glint insists that w/o this last param that there are actually no params
): (typeof BaseDef)[] {
  return Object.values(module).filter(
    (maybeCard) => typeof maybeCard === 'function' && 'baseDef' in maybeCard,
  );
}
