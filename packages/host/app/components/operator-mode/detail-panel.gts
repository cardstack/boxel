import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';

import { capitalize } from '@ember/string';
import Component from '@glimmer/component';

import { use, resource } from 'ember-resources';

import startCase from 'lodash/startCase';

import {
  LoadingIndicator,
  ContextButton,
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
  type CardErrorJSONAPI,
} from '@cardstack/runtime-common';

import { getCardType } from '@cardstack/host/resources/card-type';
import type { Ready } from '@cardstack/host/resources/file';

import {
  type ModuleDeclaration,
  isCardOrFieldDeclaration,
  isCommandDeclaration,
  isReexportCardOrField,
} from '@cardstack/host/resources/module-contents';

import { getResolvedCodeRefFromType } from '@cardstack/host/services/card-type-service';
import type RealmService from '@cardstack/host/services/realm';

import type { CardDef, BaseDef } from 'https://cardstack.com/base/card-api';

import { lastModifiedDate } from '../../resources/last-modified-date';

import { PanelSection } from './code-submode/inner-container';

import {
  Divider,
  BaseContainer,
  FileDefinitionContainer,
  InstanceDefinitionContainer,
  ModuleDefinitionContainer,
  ClickableModuleDefinitionContainer,
} from './definition-container';

import Selector from './detail-panel-selector';

import { selectorItemFunc } from './detail-panel-selector';

import type { FileType, NewFileType } from './create-file-modal';
import type { SelectorItem } from './detail-panel-selector';

import type { ModuleAnalysis } from '../../resources/module-contents';

import type OperatorModeStateService from '../../services/operator-mode-state-service';

interface Signature {
  Element: HTMLElement;
  Args: {
    moduleAnalysis: ModuleAnalysis;
    readyFile: Ready;
    cardInstance: CardDef | undefined;
    selectedDeclaration?: ModuleDeclaration;
    selectDeclaration: (dec: ModuleDeclaration) => void;
    openSearch: (term: string) => void;
    goToDefinition: (
      codeRef: ResolvedCodeRef | undefined,
      localName: string | undefined,
    ) => Promise<void>;
    createFile: (
      fileType: FileType,
      definitionClass?: {
        displayName: string;
        ref: ResolvedCodeRef;
      },
      sourceInstance?: CardDef,
    ) => Promise<void>;
    delete: (item: CardDef | URL | null | undefined) => void;
    cardError: CardErrorJSONAPI | undefined;
  };
}

export default class DetailPanel extends Component<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;

  private lastModified = lastModifiedDate(this, () => this.args.readyFile);

  // it is ad-hoc that cardInstanceType is loaded as a resource here
  // the reason for it,
  // for modules, we do module analysis and do not want to re-compute that information so its passed down thru args
  // for card instances, we don't have that information at hand so we load it here
  @use private cardInstanceType = resource(() => {
    if (this.args.cardInstance !== undefined) {
      let cardDefinition = this.args.cardInstance.constructor as typeof BaseDef;
      return getCardType(this, () => cardDefinition);
    }
    return undefined;
  });

  private get declarations() {
    return this.args.moduleAnalysis.declarations;
  }

  private get showInThisFilePanel() {
    return this.isModule && this.declarations.length > 0;
  }

  private get showInThisEmptyFilePanel() {
    return this.isModule && this.isEmptyFile;
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
    return (
      this.args.cardError ||
      (!this.isModule && !isCardDocumentString(this.args.readyFile.content))
    );
  }

  private get showCommandPanel() {
    return (
      this.isModule &&
      this.args.selectedDeclaration &&
      isCommandDeclaration(this.args.selectedDeclaration)
    );
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
    return this.cardInstanceType?.isLoading;
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
    let ref = this.selectedDeclarationAsCodeRef;
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
    let ref = this.selectedDeclarationAsCodeRef;
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
    let ref = this.selectedDeclarationAsCodeRef;
    let refURL = internalKeyFor(
      ref,
      this.operatorModeStateService.state.codePath!,
    );
    this.args.openSearch(`carddef:${refURL}`);
  }

  private get selectedDeclarationAsCodeRef(): ResolvedCodeRef {
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

  private get isEmptyFile() {
    return this.args.readyFile?.content.match(/^\s*$/);
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

  private get selectedDeclarationName() {
    let declaration = this.args.selectedDeclaration;
    if (!declaration) {
      return '';
    }
    return declaration.exportName ?? declaration.localName ?? '[No Name Found]';
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
                <ContextButton
                  @icon='delete'
                  @size='extra-small'
                  @variant='destructive'
                  {{on 'click' (fn @delete this.codePath)}}
                  class='delete-module-button'
                  @label='Delete Module'
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

      {{#if this.showInThisEmptyFilePanel}}
        <PanelSection as |PanelHeader|>
          <PanelHeader aria-label='In This Empty File Header'>
            In This File
          </PanelHeader>
          <BaseContainer as |BaseHeader|>
            <BaseHeader
              @title={{@readyFile.name}}
              data-test-current-module-name={{@readyFile.name}}
            >
              {{#if (this.realm.canWrite @readyFile.url)}}
                <ContextButton
                  @icon='delete'
                  @size='extra-small'
                  @variant='destructive'
                  {{on 'click' (fn @delete this.codePath)}}
                  class='delete-module-button'
                  @label='Delete Module'
                  data-test-delete-module-button
                />
              {{/if}}
            </BaseHeader>
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
              @name={{@cardInstance.cardTitle}}
              @fileExtension='.JSON'
              @infoText={{this.lastModified.value}}
              @actions={{this.instanceActions}}
            />
            <Divider @label='Adopts From' />
            {{#if this.cardInstanceType.type}}
              {{#let
                (getResolvedCodeRefFromType this.cardInstanceType.type)
                as |codeRef|
              }}
                <ClickableModuleDefinitionContainer
                  @title='Card Definition'
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
                  @fileURL={{this.cardType.module}}
                  @name={{this.cardType.displayName}}
                  @fileExtension={{this.cardType.moduleInfo.extension}}
                  @infoText={{this.lastModified.value}}
                  @isActive={{true}}
                  @actions={{this.definitionActions}}
                />
                {{#if this.cardType.super}}
                  {{#let
                    (getResolvedCodeRefFromType this.cardType.super)
                    as |codeRef|
                  }}
                    <Divider @label='Inherits From' />
                    <ClickableModuleDefinitionContainer
                      @title={{definitionTitle}}
                      @fileURL={{this.cardType.super.module}}
                      @name={{this.cardType.super.displayName}}
                      @fileExtension={{this.cardType.super.moduleInfo.extension}}
                      @goToDefinition={{@goToDefinition}}
                      @codeRef={{codeRef}}
                      @localName={{this.cardType.super.localName}}
                    />
                  {{/let}}
                {{/if}}
              {{else if (isReexportCardOrField @selectedDeclaration)}}
                {{#if this.cardType}}
                  {{#let
                    (getResolvedCodeRefFromType this.cardType)
                    as |codeRef|
                  }}
                    <ClickableModuleDefinitionContainer
                      @title={{definitionTitle}}
                      @fileURL={{this.cardType.module}}
                      @name={{this.cardType.displayName}}
                      @fileExtension={{this.cardType.moduleInfo.extension}}
                      @goToDefinition={{@goToDefinition}}
                      @codeRef={{codeRef}}
                      @localName={{this.cardType.localName}}
                    />
                  {{/let}}
                {{/if}}
              {{/if}}
            {{/let}}
          {{/if}}
        </PanelSection>
      {{else if this.showCommandPanel}}
        <PanelSection as |PanelHeader|>
          <PanelHeader
            aria-label='Command Panel Header'
            data-test-command-panel-header
          >
            Command
          </PanelHeader>
          <ModuleDefinitionContainer
            @title='Command'
            @fileURL={{@readyFile.url}}
            @name={{this.selectedDeclarationName}}
            @fileExtension={{this.fileExtension}}
            @isActive={{true}}
            @actions={{this.definitionActions}}
            @infoText={{this.lastModified.value}}
          />
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
        align-items: center;
        height: 100%;
      }
      .delete-module-button:focus:focus-visible:not(:disabled) {
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
