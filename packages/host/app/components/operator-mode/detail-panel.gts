import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';

import { capitalize } from '@ember/string';
import Component from '@glimmer/component';

import { use, resource } from 'ember-resources';

import startCase from 'lodash/startCase';

import {
  CardContainer,
  Header,
  LoadingIndicator,
  IconButton,
} from '@cardstack/boxel-ui/components';
import {
  IconInherit,
  IconTrash,
  IconPlus,
  IconSearch,
  Copy,
} from '@cardstack/boxel-ui/icons';

import {
  hasExecutableExtension,
  getPlural,
  isCardDocumentString,
  isCardDef,
  isFieldDef,
  isBaseDef,
  internalKeyFor,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { getCodeRef, getCardType } from '@cardstack/host/resources/card-type';
import { type Ready } from '@cardstack/host/resources/file';

import {
  type ModuleDeclaration,
  isCardOrFieldDeclaration,
  isReexportCardOrField,
} from '@cardstack/host/resources/module-contents';

import RealmService from '@cardstack/host/services/realm';

import {
  type CardDef,
  type BaseDef,
} from 'https://cardstack.com/base/card-api';

import { lastModifiedDate } from '../../resources/last-modified-date';
import { ModuleContentsResource } from '../../resources/module-contents';

import { type FileType, type NewFileType } from './create-file-modal';
import {
  Divider,
  BaseContainer,
  FileDefinitionContainer,
  InstanceDefinitionContainer,
  ModuleDefinitionContainer,
  ClickableModuleDefinitionContainer,
} from './definition-container';

import Selector from './detail-panel-selector';

import { SelectorItem, selectorItemFunc } from './detail-panel-selector';

import { PanelSection } from './code-submode/inner-container';

import type OperatorModeStateService from '../../services/operator-mode-state-service';

interface Signature {
  Element: HTMLElement;
  Args: {
    moduleContentsResource: ModuleContentsResource;
    readyFile: Ready;
    cardInstance: CardDef | undefined;
    selectedDeclaration?: ModuleDeclaration;
    selectDeclaration: (dec: ModuleDeclaration) => void;
    openSearch: (term: string) => void;
    goToDefinition: (
      codeRef: ResolvedCodeRef | undefined,
      localName: string | undefined,
    ) => void;
    createFile: (
      fileType: FileType,
      definitionClass?: {
        displayName: string;
        ref: ResolvedCodeRef;
      },
      sourceInstance?: CardDef,
    ) => Promise<void>;
    delete: (item: CardDef | URL | null | undefined) => void;
  };
}

export default class DetailPanel extends Component<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;

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

  private get codePath() {
    return this.operatorModeStateService.state.codePath;
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
      ...(this.args.selectedDeclaration?.exportName &&
      (this.args.selectedDeclaration?.cardOrField as typeof CardDef).isCardDef
        ? [
            {
              label: 'Find instances',
              icon: IconSearch,
              handler: this.searchForInstances,
            },
          ]
        : []),
    ];
  }

  private get instanceActions() {
    if (!this.isCardInstance) {
      return [];
    }
    return [
      {
        label: 'Duplicate',
        icon: Copy,
        handler: this.duplicateInstance,
      },
      ...(this.realm.canWrite(this.args.readyFile.url)
        ? [
            {
              label: 'Delete',
              icon: IconTrash,
              handler: () => this.args.delete(this.args.cardInstance),
            },
          ]
        : []),
    ];
  }

  private get miscFileActions() {
    if (this.realm.canWrite(this.args.readyFile.url)) {
      return [
        {
          label: 'Delete',
          icon: IconTrash,
          handler: () => this.args.delete(this.codePath),
        },
      ];
    } else {
      return [];
    }
  }

  @action private duplicateInstance() {
    if (!this.args.cardInstance) {
      throw new Error('must have a selected card instance');
    }
    let id: NewFileType = 'duplicate-instance';
    let cardDef = Reflect.getPrototypeOf(this.args.cardInstance)!
      .constructor as typeof CardDef;
    this.args.createFile(
      { id, displayName: capitalize(cardDef.displayName || 'Instance') },
      undefined,
      this.args.cardInstance,
    );
  }

  @action private createInstance() {
    if (!this.args.selectedDeclaration) {
      throw new Error('must have a selected declaration');
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
      throw new Error('must have a selected declaration');
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

  @action private searchForInstances() {
    if (!this.args.selectedDeclaration) {
      throw new Error('must have a selected declaration');
    }
    if (
      this.args.selectedDeclaration &&
      (!isCardOrFieldDeclaration(this.args.selectedDeclaration) ||
        !isCardDef(this.args.selectedDeclaration.cardOrField))
    ) {
      throw new Error(`bug: the selected declaration is not a card definition`);
    }
    let ref = this.getSelectedDeclarationAsCodeRef();
    let refURL = internalKeyFor(
      ref,
      this.operatorModeStateService.state.codePath!,
    );
    this.args.openSearch(`carddef:${refURL}`);
  }

  private getSelectedDeclarationAsCodeRef(): ResolvedCodeRef {
    if (!this.args.selectedDeclaration?.exportName) {
      throw new Error(`bug: only exported cards/fields can be inherited`);
    }
    return {
      name: this.args.selectedDeclaration.exportName,
      module: `${this.operatorModeStateService.state.codePath!.href.replace(
        /\.[^.]+$/,
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
    {{#if this.isLoading}}
      <div class='loading'>
        <LoadingIndicator />
      </div>
    {{else}}
      {{#if this.showInThisFilePanel}}
        <PanelSection as |PanelHeader|>
          <PanelHeader aria-label='In This File Header'>
            In This File
            <span class='number-items'>{{this.numberOfItems}}</span>
          </PanelHeader>
          <BaseContainer as |BaseHeader|>
            <BaseHeader
              @title={{@readyFile.name}}
              data-test-current-module-name={{@readyFile.name}}
            >
              {{#if (this.realm.canWrite @readyFile.url)}}
                <IconButton
                  @icon={{IconTrash}}
                  @width='15'
                  @height='15'
                  {{on 'click' (fn @delete this.codePath)}}
                  class='delete-module-button'
                  aria-label='Delete Module'
                  data-test-delete-module-button
                />
              {{/if}}
            </BaseHeader>
            <Selector
              @class='in-this-file-menu'
              @items={{this.buildSelectorItems}}
              data-test-in-this-file-selector
            />
          </BaseContainer>
        </PanelSection>
      {{/if}}

      {{#if this.showInheritancePanel}}
        <PanelSection as |PanelHeader|>
          <PanelHeader
            aria-label='Inheritance Panel Header'
            data-test-inheritance-panel-header
          >
            Card Inheritance
          </PanelHeader>
          {{#if this.isCardInstance}}
            {{! JSON case when visting, eg Author/1.json }}
            <InstanceDefinitionContainer
              @fileURL={{@readyFile.url}}
              @name={{@cardInstance.title}}
              @fileExtension='.JSON'
              @infoText={{this.lastModified.value}}
              @actions={{this.instanceActions}}
            />
            <Divider @label='Adopts From' />
            {{#if this.cardInstanceType.type}}
              {{#let (getCodeRef this.cardInstanceType.type) as |codeRef|}}
                <ClickableModuleDefinitionContainer
                  @title={{'Card Definition'}}
                  @fileURL={{this.cardInstanceType.type.module}}
                  @name={{this.cardInstanceType.type.displayName}}
                  @fileExtension={{this.cardInstanceType.type.moduleInfo.extension}}
                  @goToDefinition={{@goToDefinition}}
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
                    <Divider @label='Inherits From' />
                    <ClickableModuleDefinitionContainer
                      @title={{definitionTitle}}
                      @fileURL={{this.cardType.type.super.module}}
                      @name={{this.cardType.type.super.displayName}}
                      @fileExtension={{this.cardType.type.super.moduleInfo.extension}}
                      @goToDefinition={{@goToDefinition}}
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
                      @goToDefinition={{@goToDefinition}}
                      @codeRef={{codeRef}}
                      @localName={{this.cardType.type.localName}}
                    />
                  {{/let}}
                {{/if}}
              {{/if}}
            {{/let}}
          {{/if}}
        </PanelSection>
      {{else if this.showDetailsPanel}}
        <PanelSection as |PanelHeader|>
          <PanelHeader aria-label='Details Panel Header'>
            Details
          </PanelHeader>
          <FileDefinitionContainer
            @fileURL={{@readyFile.url}}
            @fileExtension={{this.fileExtension}}
            @infoText={{this.lastModified.value}}
            @actions={{this.miscFileActions}}
          />
        </PanelSection>
      {{/if}}
    {{/if}}
    <style scoped>
      .number-items {
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .selected {
        outline: 2px solid var(--boxel-highlight);
      }
      .in-this-file-menu {
        padding: var(--boxel-sp-xs);
      }
      .loading {
        display: flex;
        justify-content: center;
      }
      .delete-module-button {
        --icon-stroke-width: 1.2px;
        border: none;
        border-radius: var(--boxel-border-radius-xs);
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .delete-module-button:hover:not(:disabled) {
        --icon-color: var(--boxel-danger);
      }
      .delete-module-button:focus:focus-visible:not(:disabled) {
        --icon-color: var(--boxel-danger);
        outline: 2px solid var(--boxel-danger);
        outline-offset: 0;
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
