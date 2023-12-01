import { hash, array } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';

import Component from '@glimmer/component';

// @ts-expect-error cached doesn't have type yet
import { tracked, cached } from '@glimmer/tracking';

import {
  CardContainer,
  Header,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';

import {
  hasExecutableExtension,
  getPlural,
  isCardDocumentString,
} from '@cardstack/runtime-common';

import {
  isCardDef,
  isFieldDef,
  isBaseDef,
} from '@cardstack/runtime-common/code-ref';

import { type Ready } from '@cardstack/host/resources/file';
import { IconInherit, IconTrash } from '@cardstack/boxel-ui/icons';

import {
  type ModuleDeclaration,
  isCardOrFieldDeclaration,
  isReexportCardOrField,
} from '@cardstack/host/resources/module-contents';

import {
  type CardDef,
  type BaseDef,
} from 'https://cardstack.com/base/card-api';

import { lastModifiedDate } from '../../resources/last-modified-date';

import {
  FileDefinitionContainer,
  InstanceDefinitionContainer,
  ModuleDefinitionContainer,
  ClickableModuleDefinitionContainer,
} from './definition-container';

import Selector from './detail-panel-selector';

import { SelectorItem, selectorItemFunc } from './detail-panel-selector';

import type OperatorModeStateService from '../../services/operator-mode-state-service';
import { fn } from '@ember/helper';

import { getCodeRef, getCardType } from '@cardstack/host/resources/card-type';

import { use, resource } from 'ember-resources';

import { type ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';

interface Signature {
  Element: HTMLElement;
  Args: {
    readyFile: Ready;
    cardInstance: CardDef | undefined;
    selectedDeclaration?: ModuleDeclaration;
    declarations: ModuleDeclaration[];
    selectDeclaration: (dec: ModuleDeclaration) => void;
    openDefinition: (
      codeRef: ResolvedCodeRef | undefined,
      localName: string | undefined,
    ) => void;
    delete: (
      card: CardDef | typeof CardDef | undefined,
    ) => void | Promise<void>;
  };
}

export default class DetailPanel extends Component<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  private lastModified = lastModifiedDate(this, () => this.args.readyFile);

  @use private cardInstanceType = resource(() => {
    if (this.args.cardInstance !== undefined) {
      let cardDefinition = this.args.cardInstance.constructor as typeof BaseDef;
      return getCardType(this, () => cardDefinition);
    }
    return undefined;
  });

  get showInThisFilePanel() {
    return this.isModule && this.args.declarations.length > 0;
  }

  get showInheritancePanel() {
    return (
      (this.isModule &&
        this.args.selectedDeclaration &&
        (isCardOrFieldDeclaration(this.args.selectedDeclaration) ||
          isReexportCardOrField(this.args.selectedDeclaration))) ||
      this.isCardInstance
    );
  }

  get showDetailsPanel() {
    return this.isBinary || this.isNonCardJson;
  }

  get cardType() {
    if (
      this.args.selectedDeclaration &&
      (isCardOrFieldDeclaration(this.args.selectedDeclaration) ||
        isReexportCardOrField(this.args.selectedDeclaration))
    ) {
      return this.args.selectedDeclaration.cardType;
    }
    return;
  }

  get isLoading() {
    return (
      this.args.declarations.some((dec) => {
        if (isCardOrFieldDeclaration(dec)) {
          return dec.cardType?.isLoading;
        } else {
          return false;
        }
      }) ||
      this.cardType?.isLoading ||
      this.cardInstanceType?.isLoading
    );
  }

  @action
  isSelected(dec: ModuleDeclaration) {
    return this.args.selectedDeclaration === dec;
  }

  get isCardInstance() {
    return (
      this.args.readyFile.url.endsWith('.json') &&
      isCardDocumentString(this.args.readyFile.content) &&
      this.args.cardInstance !== undefined
    );
  }

  get isModule() {
    return hasExecutableExtension(this.args.readyFile.url);
  }

  get isBinary() {
    return this.args.readyFile.isBinary;
  }

  private get isNonCardJson() {
    return (
      this.args.readyFile.url.endsWith('.json') &&
      !isCardDocumentString(this.args.readyFile.content)
    );
  }

  private get fileExtension() {
    if (!this.args.cardInstance) {
      return '.' + this.args.readyFile.url.split('.').pop() || '';
    } else {
      return '';
    }
  }

  get buildSelectorItems(): SelectorItem[] {
    if (!this.args.declarations) {
      return [];
    }
    return this.args.declarations.map((dec) => {
      const isSelected = this.args.selectedDeclaration === dec;
      return selectorItemFunc(
        [
          dec,
          () => {
            this.args.selectDeclaration(dec);
          },
        ],
        { selected: isSelected },
      );
    });
  }

  get numberOfItems() {
    let numberOfElements = this.args.declarations.length || 0;
    return `${numberOfElements} ${getPlural('item', numberOfElements)}`;
  }

  <template>
    <div ...attributes>
      {{#if this.isLoading}}
        <div class='loading'>
          <LoadingIndicator />
        </div>
      {{else}}
        {{#if this.showInThisFilePanel}}
          <div class='in-this-file-panel'>
            <div class='in-this-file-panel-banner'>
              <header class='panel-header' aria-label='In This File Header'>
                In This File
              </header>
              <span class='number-items'>{{this.numberOfItems}}
              </span>
            </div>
            <CardContainer class='in-this-file-card-container'>
              <Header
                @title={{@readyFile.name}}
                @hasBackground={{true}}
                class='header'
                data-test-current-module-name={{@readyFile.name}}
              />
              <Selector
                @class='in-this-file-menu'
                @items={{this.buildSelectorItems}}
                data-test-in-this-file-selector
              />
            </CardContainer>
          </div>
        {{/if}}

        {{#if this.showInheritancePanel}}
          <div class='inheritance-panel'>
            <header
              class='panel-header'
              aria-label='Inheritance Panel Header'
              data-test-inheritance-panel-header
            >
              Card Inheritance
            </header>
            {{#if this.isCardInstance}}
              {{! JSON case when visting, eg Author/1.json }}
              <InstanceDefinitionContainer
                @fileURL={{@readyFile.url}}
                @name={{@cardInstance.title}}
                @fileExtension='.JSON'
                @infoText={{this.lastModified.value}}
                @actions={{array
                  (hash
                    label='Delete'
                    handler=(fn @delete @cardInstance)
                    icon=IconTrash
                  )
                }}
              />
              <div class='chain'>
                <IconInherit
                  class='chain-icon'
                  width='24px'
                  height='24px'
                  role='presentation'
                />
                Adopts from
              </div>
              {{#if this.cardInstanceType.type}}
                {{#let (getCodeRef this.cardInstanceType.type) as |codeRef|}}
                  <ClickableModuleDefinitionContainer
                    @title={{'Card Definition'}}
                    @fileURL={{this.cardInstanceType.type.module}}
                    @name={{this.cardInstanceType.type.displayName}}
                    @fileExtension={{this.cardInstanceType.type.moduleInfo.extension}}
                    @openDefinition={{@openDefinition}}
                    @codeRef={{codeRef}}
                  />
                {{/let}}
              {{/if}}
            {{else if @selectedDeclaration}}
              {{! Module case when selection exists}}
              {{#let
                (getDefinitionTitle @selectedDeclaration)
                as |definitionTitle|
              }}
                {{#if (isCardOrFieldDeclaration @selectedDeclaration)}}

                  <ModuleDefinitionContainer
                    @title={{definitionTitle}}
                    @fileURL={{this.cardType.type.module}}
                    @name={{this.cardType.type.displayName}}
                    @fileExtension={{this.cardType.type.moduleInfo.extension}}
                    @infoText={{this.lastModified.value}}
                    @isActive={{true}}
                    @actions={{array
                      (hash label='Delete' handler=@delete icon=IconTrash)
                    }}
                  />
                  {{#if this.cardType.type.super}}
                    {{#let (getCodeRef this.cardType.type.super) as |codeRef|}}
                      <div class='chain'>
                        <IconInherit
                          class='chain-icon'
                          width='24px'
                          height='24px'
                          role='presentation'
                        />
                        Inherits from
                      </div>
                      <ClickableModuleDefinitionContainer
                        @title={{definitionTitle}}
                        @fileURL={{this.cardType.type.super.module}}
                        @name={{this.cardType.type.super.displayName}}
                        @fileExtension={{this.cardType.type.super.moduleInfo.extension}}
                        @openDefinition={{@openDefinition}}
                        @codeRef={{codeRef}}
                        @localName={{this.cardType.type.super.localName}}
                      />
                    {{/let}}
                  {{/if}}
                {{else if (isReexportCardOrField @selectedDeclaration)}}
                  {{#if this.cardType.type}}
                    {{#let (getCodeRef this.cardType.type) as |codeRef|}}
                      <ClickableModuleDefinitionContainer
                        @title={{definitionTitle}}
                        @fileURL={{this.cardType.type.module}}
                        @name={{this.cardType.type.displayName}}
                        @fileExtension={{this.cardType.type.moduleInfo.extension}}
                        @openDefinition={{@openDefinition}}
                        @codeRef={{codeRef}}
                        @localName={{this.cardType.type.localName}}
                      />
                    {{/let}}
                  {{/if}}
                {{/if}}
              {{/let}}
            {{/if}}

          </div>
        {{else if this.showDetailsPanel}}
          <div class='details-panel'>
            <header class='panel-header' aria-label='Details Panel Header'>
              Details
            </header>
            <FileDefinitionContainer
              @fileURL={{@readyFile.url}}
              @fileExtension={{this.fileExtension}}
              @infoText={{this.lastModified.value}}
              @actions={{array
                (hash label='Delete' handler=@delete icon=IconTrash)
              }}
            />
          </div>
        {{/if}}
      {{/if}}
    </div>
    <style>
      .header {
        --boxel-header-padding: var(--boxel-sp-xs);
        --boxel-header-text-size: var(--boxel-font-size-xs);
        --boxel-header-text-transform: uppercase;
        --boxel-header-letter-spacing: var(--boxel-lsp-xxl);
        --boxel-header-background-color: var(--boxel-100);
        --boxel-header-text-color: var(--boxel-dark);
        --boxel-header-max-width: none;
      }
      .in-this-file-card-container {
        overflow: hidden;
        overflow-wrap: anywhere;
      }
      .in-this-file-panel-banner {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .panel-header {
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .number-items {
        color: #919191;
        font-size: var(--boxel-font-size-sm);
        font-weight: 200;
        letter-spacing: var(--boxel-lsp-xxl);
        text-transform: uppercase;
      }
      .selected {
        outline: 2px solid var(--boxel-highlight);
      }
      .in-this-file-panel,
      .details-panel,
      .inheritance-panel {
        padding-top: var(--boxel-sp-sm);
        gap: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
      }
      .in-this-file-menu {
        padding: var(--boxel-sp-xs);
      }
      .loading {
        display: flex;
        justify-content: center;
      }
      .chain {
        display: flex;
        font: var(--boxel-font-size-sm);
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        justify-content: center;
      }
      .chain-icon {
        --icon-color: var(--boxel-dark);
      }
    </style>
  </template>
}

function getDefinitionTitle(declaration: ModuleDeclaration) {
  if (isCardOrFieldDeclaration(declaration)) {
    if (isCardDef(declaration.cardOrField)) {
      return 'Card Definition';
    } else if (isFieldDef(declaration.cardOrField)) {
      return 'Field Definition';
    } else if (isBaseDef(declaration.cardOrField)) {
      return 'Base Definition';
    }
  }
  if (isReexportCardOrField(declaration)) {
    if (isCardDef(declaration.cardOrField)) {
      return 'Re-exported Card Definition';
    } else if (isFieldDef(declaration.cardOrField)) {
      return 'Re-exported Field Definition';
    } else if (isBaseDef(declaration.cardOrField)) {
      return 'Re-exported Base Definition';
    }
  }
  return '';
}
