import Component from '@glimmer/component';
import { service } from '@ember/service';
import {
  type CardDef,
  type BaseDef,
} from 'https://cardstack.com/base/card-api';
import {
  type RealmInfo,
  cardTypeDisplayName,
  identifyCard,
  moduleFrom,
  trimExecutableExtension,
} from '@cardstack/runtime-common';
import {
  InstanceDefinitionContainer,
  ModuleDefinitionContainer,
} from './definition-container';
import { Ready } from '@cardstack/host/resources/file';
import { tracked } from '@glimmer/tracking';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';
import moment from 'moment';
import { type ImportResource } from '@cardstack/host/resources/import';
import { hash, array, fn } from '@ember/helper';
import CardService from '@cardstack/host/services/card-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import { action } from '@ember/object';

interface Args {
  Element: HTMLElement;
  Args: {
    realmInfo: RealmInfo | null;
    realmIconURL: string | null | undefined;
    readyFile: Ready;
    cardInstance: CardDef | null;
    importedModule?: ImportResource;
    delete: () => void;
  };
}

export default class CardInheritancePanel extends Component<Args> {
  @tracked cardInstance: CardDef | undefined;
  @tracked module: ModuleSyntax | undefined;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare cardService: CardService;

  @action
  updateCodePath(url: URL | undefined) {
    if (url) {
      this.operatorModeStateService.updateCodePath(url);
    }
  }

  <template>
    <div class='container' ...attributes>
      {{#if @importedModule.module}}
        {{#each (cardsFromModule @importedModule.module) as |card|}}
          <ModuleDefinitionContainer
            @title={{'Card Definition'}}
            @name={{getCardTypeDisplayName card}}
            @fileExtension='.GTS'
            @realmInfo={{@realmInfo}}
            @realmIconURL={{@realmIconURL}}
            @isActive={{(isModuleActive card @readyFile)}}
            @onSelectDefinition={{fn this.updateCodePath (moduleUrl card)}}
            @infoText={{this.lastModified}}
            @url={{moduleUrl card}}
            @actions={{array
              (hash label='Delete' handler=@delete icon='icon-trash')
            }}
          />
        {{/each}}
      {{/if}}
      {{#if @cardInstance}}
        <InstanceDefinitionContainer
          @title={{'Card Instance'}}
          @name={{@cardInstance.title}}
          @fileExtension='.JSON'
          @realmInfo={{@realmInfo}}
          @realmIconURL={{@realmIconURL}}
          @infoText={{this.lastModified}}
          @isActive={{(isInstanceActive @cardInstance @readyFile)}}
          @actions={{array
            (hash label='Delete' handler=@delete icon='icon-trash')
          }}
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
    if (this.args.readyFile.lastModified != undefined) {
      return `Last saved was ${moment(
        this.args.readyFile.lastModified,
      ).fromNow()}`;
    }
    return;
  }
}

function getCardTypeDisplayName(t: typeof BaseDef) {
  let card = new t();
  return cardTypeDisplayName(card);
}

function moduleUrl(t: typeof BaseDef | undefined) {
  if (t) {
    let ref = identifyCard(t);
    if (ref) {
      return new URL(moduleFrom(ref)); //TODO CS-5830: Consolidate hardcoded .gts extensions
    }
    throw new Error('Could not identify card');
  }
  return;
}

function cardsFromModule(
  module: Record<string, any>,
  _never?: never, // glint insists that w/o this last param that there are actually no params
): (typeof BaseDef)[] {
  return Object.values(module).filter(
    (maybeCard) => typeof maybeCard === 'function' && 'baseDef' in maybeCard,
  );
}

function isInstanceActive(cardInstance: CardDef, f: Ready) {
  return cardInstance.id === f.url.replace(/\.json$/, '');
}

function isModuleActive(card: typeof BaseDef, f: Ready) {
  let url = moduleUrl(card);
  if (url) {
    return url.href === trimExecutableExtension(new URL(f.url)).href;
  } else {
    return false;
  }
}
