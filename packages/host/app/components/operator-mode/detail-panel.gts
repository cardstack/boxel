import { hash, array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { BaseDef, type CardDef } from 'https://cardstack.com/base/card-api';
import { cardTypeDisplayName, type RealmInfo } from '@cardstack/runtime-common';
import Component from '@glimmer/component';

import { hasExecutableExtension } from '@cardstack/runtime-common';

import { type Ready } from '@cardstack/host/resources/file';

import { lastModifiedDate } from '../../resources/last-modified-date';

import {
  FileDefinitionContainer,
  InstanceDefinitionContainer,
  ModuleDefinitionContainer,
  ClickableModuleDefinitionContainer,
} from './definition-container';
// @ts-expect-error cached doesn't have type yet
import { tracked, cached } from '@glimmer/tracking';
import { type ElementInFile } from '@cardstack/host/resources/adoption-chain-manager';

import type OperatorModeStateService from '../../services/operator-mode-state-service';

interface Signature {
  Element: HTMLElement;
  Args: {
    realmInfo: RealmInfo | null;
    readyFile: Ready;
    cardInstance: CardDef | undefined;
    selectedElement?: ElementInFile;
    elements: ElementInFile[];
    selectElement: (el: ElementInFile) => void;
    delete: () => void;
  };
}

export default class DetailPanel extends Component<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  private lastModified = lastModifiedDate(this, () => this.args.readyFile);

  get cardType() {
    return this.args.selectedElement?.cardType;
  }

  get isLoading() {
    return this.cardType?.isLoading;
  }

  @action
  updateCodePath(url: URL | undefined) {
    if (url) {
      this.operatorModeStateService.updateCodePath(url);
    }
  }

  get isCardInstance() {
    return this.args.readyFile.url.endsWith('.json');
  }

  @action
  isSelected(el: ElementInFile) {
    return this.args.selectedElement === el;
  }
  get isModule() {
    return hasExecutableExtension(this.args.readyFile.url);
  }

  private get fileExtension() {
    if (!this.args.cardInstance) {
      return '.' + this.args.readyFile.url.split('.').pop() || '';
    } else {
      return '';
    }
  }

  <template>
    <div class='container' ...attributes>
      {{#if this.isLoading}}
        <div>Loading...</div>
      {{else}}
        {{#if this.isCardInstance}}
          {{! JSON case when visting, eg Author/1.json }}
          <h3>Inheritance Panel</h3>
          <div class='inheritance-chain'>
            <InstanceDefinitionContainer
              @name={{@cardInstance.title}}
              @fileExtension='.JSON'
              @realmInfo={{@realmInfo}}
              @infoText={{this.lastModified.value}}
              @actions={{array
                (hash label='Delete' handler=@delete icon='icon-trash')
              }}
            />
            <div>Adopts from</div>

            <ClickableModuleDefinitionContainer
              @name={{this.cardType.type.displayName}}
              @fileExtension={{this.cardType.type.moduleMeta.extension}}
              @realmInfo={{this.cardType.type.moduleMeta.realmInfo}}
              @onSelectDefinition={{this.updateCodePath}}
              @url={{this.cardType.type.module}}
            />
          </div>
        {{else if this.isModule}}
          {{! Module case when visting, eg author.gts }}
          <h3>In This File</h3>
          {{#each @elements as |el|}}
            <div
              class='inheritance-chain {{if (this.isSelected el) "selected"}}'
            >
              <div>{{this.getCardTypeDisplayName el.card}}</div>
              <button
                {{on 'click' (fn this.args.selectElement el)}}
              >Select</button>
            </div>
          {{/each}}
          <h3>Inheritance Panel</h3>
          <ModuleDefinitionContainer
            @name={{this.cardType.type.displayName}}
            @fileExtension={{this.cardType.type.moduleMeta.extension}}
            @realmInfo={{this.cardType.type.moduleMeta.realmInfo}}
            @infoText={{this.lastModified.value}}
            @isActive={{true}}
            @actions={{array
              (hash label='Delete' handler=@delete icon='icon-trash')
            }}
          />
          {{#if this.cardType.type.super}}
            <div>Inherits from</div>
            <ClickableModuleDefinitionContainer
              @name={{this.cardType.type.super.displayName}}
              @fileExtension={{this.cardType.type.super.moduleMeta.extension}}
              @realmInfo={{this.cardType.type.super.moduleMeta.realmInfo}}
              @onSelectDefinition={{this.updateCodePath}}
              @url={{this.cardType.type.super.module}}
            />
          {{/if}}
        {{else}}
          <FileDefinitionContainer
            @fileExtension={{this.fileExtension}}
            @realmInfo={{@realmInfo}}
            @infoText={{this.lastModified.value}}
            @actions={{array
              (hash label='Delete' handler=@delete icon='icon-trash')
            }}
          />
        {{/if}}
      {{/if}}
    </div>
    <style>
      .container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .selected {
        outline: 2px solid var(--boxel-highlight);
      }
      .inheritance-chain {
        padding: var(--boxel-sp-sm);
      }
    </style>
  </template>

  getCardTypeDisplayName(t: typeof BaseDef) {
    let card = new t();
    return cardTypeDisplayName(card);
  }
}
