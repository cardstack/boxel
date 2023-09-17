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
  ClickableModuleDefinitionContainer,
} from './definition-container';
import { Ready } from '@cardstack/host/resources/file';
import { tracked } from '@glimmer/tracking';
import moment from 'moment';
import { type ImportResource } from '@cardstack/host/resources/import';
import { hash, array } from '@ember/helper';
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
  @service declare operatorModeStateService: OperatorModeStateService;

  @action
  updateCodePath(url: URL | undefined) {
    if (url) {
      this.operatorModeStateService.updateCodePath(url);
    }
  }

  <template>
    <div class='container' ...attributes>

      {{#if @cardInstance}}
        {{! JSON case when visting, eg Author/1.json }}
        <InstanceDefinitionContainer
          @name={{@cardInstance.title}}
          @fileExtension='.JSON'
          @realmInfo={{@realmInfo}}
          @realmIconURL={{@realmIconURL}}
          @infoText={{this.lastModified}}
          @actions={{array
            (hash label='Delete' handler=@delete icon='icon-trash')
          }}
        />
        <div>Adopts from</div>
        <ClickableModuleDefinitionContainer
          @name={{getCardTypeDisplayNameFromInstance @cardInstance}}
          @fileExtension={{this.fileExtension}}
          @realmInfo={{@realmInfo}}
          @realmIconURL={{@realmIconURL}}
          @onSelectDefinition={{this.updateCodePath}}
          @url={{getModuleUrlOfInstance @cardInstance}}
        />
      {{else}}
        {{! Module case when visting, eg author.gts }}
        <ModuleDefinitionContainer
          @name='some module'
          @fileExtension={{this.fileExtension}}
          @realmInfo={{@realmInfo}}
          @realmIconURL={{@realmIconURL}}
          @isActive={{true}}
          @actions={{array
            (hash label='Delete' handler=@delete icon='icon-trash')
          }}
        />
        <div>Inherits from</div>
        {{#if @importedModule.module}}
          {{#each (cardsOrFieldsFromModule @importedModule.module) as |card|}}
            <ClickableModuleDefinitionContainer
              @name={{getCardTypeDisplayName card}}
              @fileExtension={{this.fileExtension}}
              @realmInfo={{@realmInfo}}
              @realmIconURL={{@realmIconURL}}
              @onSelectDefinition={{this.updateCodePath}}
              @url={{moduleUrl card}}
            />
          {{/each}}
        {{/if}}
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

  get inheritsFrom() {
    return this.args.cardInstance ? 'Adopts From' : 'Inherits From';
  }

  get lastModified() {
    if (this.args.readyFile.lastModified != undefined) {
      return `Last saved was ${moment(
        this.args.readyFile.lastModified,
      ).fromNow()}`;
    }
    return;
  }

  get fileExtension() {
    if (!this.args.cardInstance) {
      return '.' + this.args.readyFile.url.split('.').pop() || '';
    } else {
      return '';
    }
  }
}

//card-type munging

function getCardTypeDisplayName(t: typeof BaseDef) {
  let card = new t();
  return cardTypeDisplayName(card);
}

function getCardTypeDisplayNameFromInstance(instance: CardDef) {
  let cardType = Reflect.getPrototypeOf(instance)
    ?.constructor as typeof BaseDef;
  return getCardTypeDisplayName(cardType);
}

function getModuleUrlOfInstance(instance: CardDef) {
  let cardType = Reflect.getPrototypeOf(instance)
    ?.constructor as typeof BaseDef;
  return moduleUrl(cardType);
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

function cardsOrFieldsFromModule(
  module: Record<string, any>,
  _never?: never, // glint insists that w/o this last param that there are actually no params
): (typeof BaseDef)[] {
  return Object.values(module).filter(
    (maybeCard) => typeof maybeCard === 'function' && 'baseDef' in maybeCard,
  );
}

function isModuleActive(card: typeof BaseDef, f: Ready) {
  let moduleIdentity = moduleUrl(card);
  if (moduleIdentity) {
    return moduleIdentity.href === trimExecutableExtension(new URL(f.url)).href;
  } else {
    return false;
  }
}

export function isCardOrField(cardOrField: any): cardOrField is typeof BaseDef {
  return typeof cardOrField === 'function' && 'baseDef' in cardOrField;
}

export function isCard(card: any): card is typeof BaseDef {
  return typeof card === 'function' && 'baseDef' in card;
}
