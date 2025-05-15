import { fn } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Modifier from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';
import window from 'ember-window-mock';

import { TrackedObject } from 'tracked-built-ins';

import { Accordion } from '@cardstack/boxel-ui/components';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  type getCards,
  type Query,
  isCardDocumentString,
  isFieldDef,
  internalKeyFor,
  CodeRef,
  CardErrorJSONAPI,
  GetCardsContextName,
  ResolvedCodeRef,
  specRef,
} from '@cardstack/runtime-common';

import CardError from '@cardstack/host/components/operator-mode/card-error';
import CardRendererPanel from '@cardstack/host/components/operator-mode/card-renderer-panel/index';
import Playground from '@cardstack/host/components/operator-mode/code-submode/playground/playground';

import SchemaEditor, {
  SchemaEditorTitle,
} from '@cardstack/host/components/operator-mode/code-submode/schema-editor';
import SpecPreview from '@cardstack/host/components/operator-mode/code-submode/spec-preview';
import SyntaxErrorDisplay from '@cardstack/host/components/operator-mode/syntax-error-display';

import consumeContext from '@cardstack/host/helpers/consume-context';

import { type Ready } from '@cardstack/host/resources/file';
import type { FileResource } from '@cardstack/host/resources/file';
import {
  type CardOrFieldDeclaration,
  type ModuleContentsResource,
  isCardOrFieldDeclaration,
  type ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type SpecPanelService from '@cardstack/host/services/spec-panel-service';

import { CodeModePanelSelections } from '@cardstack/host/utils/local-storage-keys';
import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';
import { Spec } from 'https://cardstack.com/base/spec';

export type SelectedAccordionItem =
  | 'schema-editor'
  | 'spec-preview'
  | 'playground';

const accordionItems: SelectedAccordionItem[] = [
  'schema-editor',
  'playground',
  'spec-preview',
];

interface ModuleInspectorSignature {
  Args: {
    card: CardDef | undefined;
    cardError: CardErrorJSONAPI | undefined;
    currentOpenFile: FileResource | undefined;
    goToDefinitionAndResetCursorPosition: (
      codeRef: CodeRef | undefined,
      localName: string | undefined,
      fieldName?: string,
    ) => void;
    isCard: boolean;
    isIncompatibleFile: boolean;
    isModule: boolean;
    isReadOnly: boolean;
    moduleContentsResource: ModuleContentsResource;
    previewFormat: Format;
    readyFile: Ready;
    selectedCardOrField: CardOrFieldDeclaration | undefined;
    selectedCodeRef: ResolvedCodeRef | undefined;
    selectedDeclaration: ModuleDeclaration | undefined;
    setPreviewFormat: (format: Format) => void;
  };
}

export default class ModuleInspector extends Component<ModuleInspectorSignature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @service private declare realmServer: RealmServerService;
  @service private declare specPanelService: SpecPanelService;

  @consume(GetCardsContextName) private declare getCards: getCards;

  @tracked private specsForSelectedDefinition:
    | ReturnType<getCards<Spec>>
    | undefined;

  private panelSelections: Record<string, SelectedAccordionItem>;

  constructor(owner: Owner, args: ModuleInspectorSignature['Args']) {
    super(owner, args);

    let panelSelections = window.localStorage.getItem(CodeModePanelSelections);
    this.panelSelections = new TrackedObject(
      panelSelections ? JSON.parse(panelSelections) : {},
    );
  }

  private get declarations() {
    return this.args.moduleContentsResource?.declarations;
  }

  get showSpecPreview() {
    return Boolean(this.args.selectedCardOrField?.exportName);
  }

  private get hasCardDefOrFieldDef() {
    return this.declarations.some(isCardOrFieldDeclaration);
  }

  private get isCardPreviewError() {
    return this.args.isCard && this.args.cardError;
  }

  private get isEmptyFile() {
    return this.args.readyFile?.content.match(/^\s*$/);
  }

  private get isSelectedItemIncompatibleWithSchemaEditor() {
    if (!this.args.selectedDeclaration) {
      return undefined;
    }
    return !isCardOrFieldDeclaration(this.args.selectedDeclaration);
  }

  private get fileIncompatibilityMessage() {
    if (this.args.isCard) {
      if (this.args.cardError) {
        return `Card preview failed. Make sure both the card instance data and card definition files have no errors and that their data schema matches. `;
      }
    }

    if (this.args.moduleContentsResource.moduleError) {
      return null; // Handled in code-submode schema editor
    }

    if (this.args.isIncompatibleFile) {
      return `No tools are available to be used with this file type. Choose a file representing a card instance or module.`;
    }

    // If the module is incompatible
    if (this.args.isModule) {
      //this will prevent displaying message during a page refresh
      if (this.args.moduleContentsResource.isLoading) {
        return null;
      }
      if (!this.hasCardDefOrFieldDef) {
        return `No tools are available to be used with these file contents. Choose a module that has a card or field definition inside of it.`;
      } else if (this.isSelectedItemIncompatibleWithSchemaEditor) {
        return `No tools are available for the selected item: ${this.args.selectedDeclaration?.type} "${this.args.selectedDeclaration?.localName}". Select a card or field definition in the inspector.`;
      }
    }
    // If module inspector doesn't handle any case but we can't capture the error
    if (!this.args.card && !this.args.selectedCardOrField) {
      // this will prevent displaying message during a page refresh
      if (isCardDocumentString(this.args.readyFile.content)) {
        return null;
      }
      return 'No tools are available to inspect this file or its contents. Select a file with a .json, .gts or .ts extension.';
    }

    if (
      !this.args.isModule &&
      !this.args.readyFile?.name.endsWith('.json') &&
      !this.args.card //for case of creating new card instance
    ) {
      return 'No tools are available to inspect this file or its contents. Select a file with a .json, .gts or .ts extension.';
    }

    return null;
  }

  private get selectedAccordionItem(): SelectedAccordionItem {
    let selection = this.panelSelections[this.args.readyFile.url];
    return selection ?? 'schema-editor';
  }

  @action private toggleAccordionItem(item: SelectedAccordionItem) {
    if (this.selectedAccordionItem === item) {
      let index = accordionItems.indexOf(item);
      if (index !== -1 && index === accordionItems.length - 1) {
        index--;
      } else if (index !== -1) {
        index++;
      }
      item = accordionItems[index];
    }
    this.panelSelections[this.args.readyFile.url] = item;
    // persist in local storage
    window.localStorage.setItem(
      CodeModePanelSelections,
      JSON.stringify(this.panelSelections),
    );
  }

  private onSpecView = (spec: Spec) => {
    // console.trace('onSpecView', spec);
    if (!spec.isField) {
      return; // not a field spec
    }
    if (
      this.selectedDeclarationAsCodeRef.name !== spec.ref.name ||
      this.selectedDeclarationAsCodeRef.module !== spec.moduleHref // absolute url
    ) {
      return; // not the right field spec
    }
    this.updatePlaygroundSelections(spec.id, true);
  };

  private get selectedDeclarationAsCodeRef(): ResolvedCodeRef {
    if (!this.args.selectedDeclaration?.exportName) {
      return {
        name: '',
        module: '',
      };
    }
    return {
      name: this.args.selectedDeclaration.exportName,
      module: `${this.operatorModeStateService.state.codePath!.href.replace(
        /\.[^.]+$/,
        '',
      )}`,
    };
  }

  @action private updatePlaygroundSelections(id: string, fieldDefOnly = false) {
    const declaration = this.args.selectedDeclaration;

    if (!declaration?.exportName || !isCardOrFieldDeclaration(declaration)) {
      return;
    }

    const isField = isFieldDef(declaration.cardOrField);
    if (fieldDefOnly && !isField) {
      return;
    }

    const moduleId = internalKeyFor(
      this.selectedDeclarationAsCodeRef,
      undefined,
    );
    const cardId = id.replace(/\.json$/, '');

    const selections = window.localStorage.getItem(PlaygroundSelections);
    let existingFormat: Format = isField ? 'embedded' : 'isolated';

    if (selections) {
      const selection = JSON.parse(selections)[moduleId];
      if (selection?.cardId === cardId) {
        return;
      }
      // If we already have selections for this module, preserve the format
      if (selection?.format) {
        existingFormat = selection?.format;
      }
    }

    this.playgroundPanelService.persistSelections(
      moduleId,
      cardId,
      existingFormat,
      isField ? 0 : undefined,
    );
  }

  private get queryForSpecsForSelectedDefinition(): Query {
    return {
      filter: {
        on: specRef,
        eq: {
          ref: this.selectedDeclarationAsCodeRef, //ref is primitive
        },
      },
      sort: [
        {
          by: 'createdAt',
          direction: 'desc',
        },
      ],
    };
  }

  private findSpecsForSelectedDefinition = () => {
    this.specsForSelectedDefinition = this.getCards(
      this,
      () => this.queryForSpecsForSelectedDefinition,
      () => this.realmServer.availableRealmURLs,
      { isLive: true },
    ) as ReturnType<getCards<Spec>>;
  };

  get specInstancesForSelectedDefinition() {
    return this.specsForSelectedDefinition?.instances ?? [];
  }

  private get activeSpec() {
    let selectedSpecId = this.specPanelService.specSelection;

    if (selectedSpecId) {
      let selectedSpec = this.specInstancesForSelectedDefinition?.find(
        (spec) => spec.id === selectedSpecId,
      );

      if (selectedSpec) {
        return selectedSpec;
      }
    }

    return this.specInstancesForSelectedDefinition?.[0];
  }

  <template>
    {{#if this.isCardPreviewError}}
      {{! this is here to make TS happy, this is always true }}
      {{#if @cardError}}
        <CardError @error={{@cardError}} @hideHeader={{true}} />
      {{/if}}
    {{else if this.isEmptyFile}}
      <Accordion as |A|>
        <A.Item
          class='accordion-item'
          @contentClass='accordion-item-content'
          @isOpen={{true}}
        >
          <:title>
            <SchemaEditorTitle @hasModuleError={{true}} />
          </:title>
          <:content>
            <SyntaxErrorDisplay @syntaxErrors='File is empty' />
          </:content>
        </A.Item>
      </Accordion>
    {{else if this.fileIncompatibilityMessage}}

      <div
        class='file-incompatible-message'
        data-test-file-incompatibility-message
      >
        {{this.fileIncompatibilityMessage}}
      </div>
    {{else if @selectedCardOrField.cardOrField}}
      {{consumeContext this.findSpecsForSelectedDefinition}}
      <Accordion
        {{! FIXME is this the right place? }}
        {{SpecPreviewModifier spec=this.activeSpec onSpecView=this.onSpecView}}
        data-test-module-inspector='card-or-field'
        data-test-selected-accordion-item={{this.selectedAccordionItem}}
        as |A|
      >
        <SchemaEditor
          @file={{@readyFile}}
          @moduleContentsResource={{@moduleContentsResource}}
          @card={{@selectedCardOrField.cardOrField}}
          @cardTypeResource={{@selectedCardOrField.cardType}}
          @goToDefinition={{@goToDefinitionAndResetCursorPosition}}
          @isReadOnly={{@isReadOnly}}
          as |SchemaEditorTitle SchemaEditorPanel|
        >
          <A.Item
            class='accordion-item'
            @contentClass='accordion-item-content'
            @onClick={{fn this.toggleAccordionItem 'schema-editor'}}
            @isOpen={{eq this.selectedAccordionItem 'schema-editor'}}
            data-test-accordion-item='schema-editor'
          >
            <:title>
              <SchemaEditorTitle />
            </:title>
            <:content>
              <SchemaEditorPanel class='accordion-content' />
            </:content>
          </A.Item>
        </SchemaEditor>
        <Playground
          @isOpen={{eq this.selectedAccordionItem 'playground'}}
          @codeRef={{@selectedCodeRef}}
          @isUpdating={{@moduleContentsResource.isLoading}}
          @cardOrField={{@selectedCardOrField.cardOrField}}
          as |PlaygroundTitle PlaygroundContent|
        >
          <A.Item
            class='accordion-item playground-accordion-item'
            @contentClass='accordion-item-content'
            @onClick={{fn this.toggleAccordionItem 'playground'}}
            @isOpen={{eq this.selectedAccordionItem 'playground'}}
            data-test-accordion-item='playground'
          >
            <:title><PlaygroundTitle /></:title>
            <:content>
              {{#if (eq this.selectedAccordionItem 'playground')}}
                <PlaygroundContent />
              {{/if}}
            </:content>
          </A.Item>
        </Playground>
        <SpecPreview
          @selectedDeclaration={{@selectedDeclaration}}
          @isLoadingNewModule={{@moduleContentsResource.isLoadingNewModule}}
          @toggleAccordionItem={{this.toggleAccordionItem}}
          @isPanelOpen={{eq this.selectedAccordionItem 'spec-preview'}}
          @selectedDeclarationAsCodeRef={{this.selectedDeclarationAsCodeRef}}
          @updatePlaygroundSelections={{this.updatePlaygroundSelections}}
          @activeSpec={{this.activeSpec}}
          @specsForSelectedDefinition={{this.specInstancesForSelectedDefinition}}
          @searchIsLoading={{this.specsForSelectedDefinition.isLoading}}
          as |SpecPreviewTitle SpecPreviewContent|
        >
          <A.Item
            class='accordion-item'
            @contentClass='accordion-item-content'
            @onClick={{fn this.toggleAccordionItem 'spec-preview'}}
            @isOpen={{eq this.selectedAccordionItem 'spec-preview'}}
            data-test-accordion-item='spec-preview'
          >
            <:title>
              <SpecPreviewTitle />
            </:title>
            <:content>
              {{#if this.showSpecPreview}}
                <SpecPreviewContent class='accordion-content' />
              {{else}}
                <p
                  class='file-incompatible-message'
                  data-test-incompatible-spec-nonexports
                >
                  <span>Boxel Spec is not supported for card or field
                    definitions that are not exported.</span>
                </p>
              {{/if}}
            </:content>
          </A.Item>
        </SpecPreview>
      </Accordion>
    {{else if @moduleContentsResource.moduleError}}
      <Accordion as |A|>
        <A.Item
          class='accordion-item'
          @contentClass='accordion-item-content'
          @isOpen={{true}}
          data-test-module-error-panel
        >
          <:title>
            <SchemaEditorTitle @hasModuleError={{true}} />
          </:title>
          <:content>
            <SyntaxErrorDisplay
              @syntaxErrors={{@moduleContentsResource.moduleError.message}}
            />
          </:content>
        </A.Item>
      </Accordion>
    {{else if @card}}
      <CardRendererPanel
        @card={{@card}}
        @realmURL={{this.operatorModeStateService.realmURL}}
        @format={{@previewFormat}}
        @setFormat={{@setPreviewFormat}}
        data-test-card-resource-loaded
      />
    {{/if}}

    <style scoped>
      .file-incompatible-message {
        display: flex;
        flex-wrap: wrap;
        align-content: center;
        justify-content: center;
        text-align: center;
        height: 100%;
        background-color: var(--boxel-200);
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        font-weight: 500;
        padding: var(--boxel-sp-xl);
        margin-block: 0;
      }

      .file-incompatible-message > span {
        max-width: 400px;
      }

      .accordion-item {
        --accordion-item-title-font: 600 var(--boxel-font-sm);
        box-sizing: content-box; /* prevent shift during accordion toggle because of border-width */
      }
      .playground-accordion-item > :deep(.title) {
        padding-block: var(--boxel-sp-4xs);
      }
      .accordion-item > :deep(.title) {
        height: var(--accordion-item-closed-height);
      }
      .accordion-item :deep(.accordion-item-content) {
        overflow-y: auto;
      }
      .accordion-item:last-child {
        border-bottom: var(--boxel-border);
      }

      .accordion-content {
        padding: var(--boxel-sp-xs);
        background-color: var(--code-mode-panel-background-color);
        min-height: 100%;
      }

      .preview-error-container {
        background: var(--boxel-100);
        padding: var(--boxel-sp);
        border-radius: var(--boxel-radius);
        height: 100%;
      }

      .preview-error-box {
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
        background: var(--boxel-200);
      }

      .preview-error-text {
        color: red;
        font-weight: 600;
      }

      hr.preview-error {
        width: calc(100% + var(--boxel-sp) * 2);
        margin-left: calc(var(--boxel-sp) * -1);
        margin-top: calc(var(--boxel-sp-sm) + 1px);
      }

      pre.preview-error {
        white-space: pre-wrap;
        text-align: left;
      }
    </style>
  </template>
}

interface ModifierSignature {
  Args: {
    Named: {
      spec?: Spec;
      onSpecView?: (spec: Spec) => void;
    };
  };
}

// FIXME this is copied from spec-preview, but is it just an on-render, next?
export class SpecPreviewModifier extends Modifier<ModifierSignature> {
  modify(
    _element: HTMLElement,
    _positional: [],
    { spec, onSpecView }: ModifierSignature['Args']['Named'],
  ) {
    if (!spec || !onSpecView) {
      // throw new Error('bug: no spec or onSpecView hook');
      return;
    }

    onSpecView(spec);
  }
}
