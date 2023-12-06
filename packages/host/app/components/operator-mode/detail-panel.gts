import { hash, array } from '@ember/helper';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';

import { capitalize } from '@ember/string';
import Component from '@glimmer/component';

// @ts-expect-error cached doesn't have type yet
import { tracked, cached } from '@glimmer/tracking';

import { use, resource } from 'ember-resources';

import startCase from 'lodash/startCase';

import {
  CardContainer,
  Header,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';

import { IconInherit, IconTrash, IconPlus } from '@cardstack/boxel-ui/icons';

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

import { type ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';

import { getCodeRef, getCardType } from '@cardstack/host/resources/card-type';
import { type Ready } from '@cardstack/host/resources/file';

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
import { ModuleContentsResource } from '../../resources/module-contents';

import { type FileType, type NewFileType } from './create-file-modal';
import {
  FileDefinitionContainer,
  InstanceDefinitionContainer,
  ModuleDefinitionContainer,
  ClickableModuleDefinitionContainer,
} from './definition-container';

import Selector from './detail-panel-selector';

import { SelectorItem, selectorItemFunc } from './detail-panel-selector';

import type OperatorModeStateService from '../../services/operator-mode-state-service';

interface Signature {
  Element: HTMLElement;
  Args: {
    moduleContentsResource: ModuleContentsResource;
    readyFile: Ready;
    cardInstance: CardDef | undefined;
    selectedDeclaration?: ModuleDeclaration;
    selectDeclaration: (dec: ModuleDeclaration) => void;
    openDefinition: (
      codeRef: ResolvedCodeRef | undefined,
      localName: string | undefined,
    ) => void;
    createFile: (
      fileType: FileType,
      definitionClass?: {
        displayName: string;
        ref: ResolvedCodeRef;
      },
    ) => Promise<void>;
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

  private get declarations() {
    return this.args.moduleContentsResource.declarations;
  }

  private get showInThisFilePanel() {
    return this.isModule && this.declarations.length > 0;
  }

  private get showInheritancePanel() {
    return (
      (this.isModule &&
        this.args.selectedDeclaration &&
        (isCardOrFieldDeclaration(this.args.selectedDeclaration) ||
          isReexportCardOrField(this.args.selectedDeclaration))) ||
      this.isCardInstance
    );
  }

  private get showDetailsPanel() {
    return !this.isModule && !isCardDocumentString(this.args.readyFile.content);
  }

  private get cardType() {
    if (
      this.args.selectedDeclaration &&
      (isCardOrFieldDeclaration(this.args.selectedDeclaration) ||
        isReexportCardOrField(this.args.selectedDeclaration))
    ) {
      return this.args.selectedDeclaration.cardType;
    }
    return undefined;
  }

  private get isLoading() {
    return (
      this.args.moduleContentsResource.isLoadingNewModule ||
      this.declarations.some((dec) => {
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

  private get definitionActions() {
    if (
      this.args.selectedDeclaration &&
      !isCardOrFieldDeclaration(this.args.selectedDeclaration)
    ) {
      return [];
    }
    return [
      // internal cards are not really meant to be addressable instances, but
      // rather interior owned instances, as well as only card definitions can
      // be instantiated (not field definitions)
      ...(this.args.selectedDeclaration?.exportName &&
      (this.args.selectedDeclaration?.cardOrField as typeof CardDef).isCardDef
        ? [
            {
              label: 'Create Instance',
              icon: IconPlus,
              handler: this.createInstance,
            },
          ]
        : []),
      // the inherit feature performs in the inheritance in a new module,
      // this means that the Card/Field that we are inheriting must be exported
      ...(this.args.selectedDeclaration?.exportName
        ? [
            {
              label: 'Inherit',
              icon: IconInherit,
              handler: this.inherit,
            },
          ]
        : []),
      { label: 'Delete', icon: IconTrash, handler: this.args.delete },
    ];
  }

  @action private createInstance() {
    if (!this.args.selectedDeclaration) {
      throw new Error('must have a selected delcaration');
    }
    if (
      this.args.selectedDeclaration &&
      (!isCardOrFieldDeclaration(this.args.selectedDeclaration) ||
        !isCardDef(this.args.selectedDeclaration.cardOrField))
    ) {
      throw new Error(`bug: the selected declaration is not a card definition`);
    }
    let ref = this.getSelectedDeclarationAsCodeRef();
    let displayName = this.args.selectedDeclaration.cardOrField.displayName;
    let id: NewFileType = 'card-instance';
    this.args.createFile(
      { id, displayName: capitalize(startCase(id)) },
      {
        ref,
        displayName,
      },
    );
  }

  @action private inherit() {
    if (!this.args.selectedDeclaration) {
      throw new Error('must have a selected delcaration');
    }
    if (
      this.args.selectedDeclaration &&
      !isCardOrFieldDeclaration(this.args.selectedDeclaration)
    ) {
      throw new Error(`bug: the selected declaration is not a card nor field`);
    }
    let id: NewFileType | undefined = isCardDef(
      this.args.selectedDeclaration.cardOrField,
    )
      ? 'card-definition'
      : isFieldDef(this.args.selectedDeclaration.cardOrField)
      ? 'field-definition'
      : undefined;
    if (!id) {
      throw new Error(`Can only call inherit() on card def or field def`);
    }
    let ref = this.getSelectedDeclarationAsCodeRef();
    let displayName = this.args.selectedDeclaration.cardOrField.displayName;
    this.args.createFile(
      { id, displayName: capitalize(startCase(id)) },
      {
        ref,
        displayName,
      },
    );
  }

  private getSelectedDeclarationAsCodeRef(): ResolvedCodeRef {
    if (!this.args.selectedDeclaration?.exportName) {
      throw new Error(`bug: only exported cards/fields can be inherited`);
    }
    return {
      name: this.args.selectedDeclaration.exportName,
      module: `${this.operatorModeStateService.state.codePath!.href.replace(
        /\.[^\.]+$/,
        '',
      )}`,
    };
  }

  private get isCardInstance() {
    return (
      this.args.readyFile.url.endsWith('.json') &&
      isCardDocumentString(this.args.readyFile.content) &&
      this.args.cardInstance !== undefined
    );
  }

  private get isModule() {
    return hasExecutableExtension(this.args.readyFile.url);
  }

  private get fileExtension() {
    if (!this.args.cardInstance) {
      return '.' + this.args.readyFile.url.split('.').pop() || '';
    } else {
      return '';
    }
  }

  private get buildSelectorItems(): SelectorItem[] {
    if (!this.declarations) {
      return [];
    }
    return this.declarations.map((dec) => {
      const isSelected = this.args.selectedDeclaration === dec;
      return selectorItemFunc(
        [
          dec,
          () => {
            this.args.selectDeclaration(dec);
          },
        ],
        { selected: isSelected, url: this.args.readyFile.url },
      );
    });
  }

  private get numberOfItems() {
    let numberOfElements = this.declarations.length || 0;
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
                    @actions={{this.definitionActions}}
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
