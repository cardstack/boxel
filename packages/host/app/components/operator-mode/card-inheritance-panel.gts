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
} from '@cardstack/runtime-common';
import {
  InstanceDefinitionContainer,
  ModuleDefinitionContainer,
} from './definition-container';
import { isReady, FileResource } from '@cardstack/host/resources/file';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';
import moment from 'moment';
import { type ImportResource } from '@cardstack/host/resources/import';
import { hash, array, fn } from '@ember/helper';
import type OperatorModeStateService from '../../services/operator-mode-state-service';

interface Args {
  Element: HTMLElement;
  Args: {
    realmInfo: RealmInfo | null;
    realmIconURL: string | null | undefined;
    openFile: { current: FileResource | undefined };
    cardInstance: CardDef | null;
    importedModule?: ImportResource;
  };
}

export default class CardInheritancePanel extends Component<Args> {
  @tracked cardInstance: CardDef | undefined;
  @tracked module: ModuleSyntax | undefined;
  @service declare operatorModeStateService: OperatorModeStateService;

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
            @name={{this.getCardTypeDisplayName card}}
            @fileExtension='.GTS'
            @realmInfo={{@realmInfo}}
            @realmIconURL={{@realmIconURL}}
            @isActive={{false}}
            @onSelectDefinition={{fn this.updateCodePath (this.moduleUrl card)}}
            @url={{this.moduleUrl card}}
            @actions={{array
              (hash label='Duplicate' handler=this.duplicateAction icon='copy')
              (hash
                label='Create Instance'
                handler=this.createAction
                icon='icon-plus'
              )
              (hash
                label='Inherit' handler=this.inheritAction icon='icon-inherit'
              )
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
          @isActive={{true}}
          @actions={{array
            (hash label='Duplicate' handler=this.duplicateAction icon='copy')
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

  moduleUrl(t: typeof BaseDef | undefined) {
    if (t) {
      let ref = identifyCard(t);
      if (ref) {
        return new URL(moduleFrom(ref) + '.gts'); //TODO CS-5830: Consolidate hardcoded .gts extensions
      }
      throw new Error('Could not identify card');
    }
    return;
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
