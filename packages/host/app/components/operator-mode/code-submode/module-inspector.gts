import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { capitalize } from '@ember/string';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';
import window from 'ember-window-mock';

import { TrackedObject } from 'tracked-built-ins';

import AppsIcon from '@cardstack/boxel-icons/apps';
import Brain from '@cardstack/boxel-icons/brain';
import DotIcon from '@cardstack/boxel-icons/dot';
import LayoutList from '@cardstack/boxel-icons/layout-list';
import StackIcon from '@cardstack/boxel-icons/stack';

import { Accordion, BoxelButton, Pill } from '@cardstack/boxel-ui/components';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  type getCards,
  type Query,
  isCardDef,
  isCardDocumentString,
  isFieldDef,
  internalKeyFor,
  loadCardDef,
  CodeRef,
  CardErrorJSONAPI,
  GetCardsContextName,
  ResolvedCodeRef,
  skillCardRef,
  specRef,
} from '@cardstack/runtime-common';
import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
} from '@cardstack/runtime-common/code-ref';

import CardError from '@cardstack/host/components/operator-mode/card-error';
import CardRendererPanel from '@cardstack/host/components/operator-mode/card-renderer-panel/index';
import Playground from '@cardstack/host/components/operator-mode/code-submode/playground/playground';

import SchemaEditor, {
  SchemaEditorTitle,
} from '@cardstack/host/components/operator-mode/code-submode/schema-editor';
import SpecPreview from '@cardstack/host/components/operator-mode/code-submode/spec-preview';
import ToggleButton from '@cardstack/host/components/operator-mode/code-submode/toggle-button';
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

import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type SpecPanelService from '@cardstack/host/services/spec-panel-service';
import type StoreService from '@cardstack/host/services/store';

import { CodeModePanelSelections } from '@cardstack/host/utils/local-storage-keys';
import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';
import { Spec, type SpecType } from 'https://cardstack.com/base/spec';

export type ActiveModuleInspectorView = 'schema' | 'spec' | 'preview';

const accordionItems: ActiveModuleInspectorView[] = [
  'schema',
  'preview',
  'spec',
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
  @service private declare loaderService: LoaderService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service private declare specPanelService: SpecPanelService;
  @service private declare store: StoreService;

  @consume(GetCardsContextName) private declare getCards: getCards;

  @tracked private specSearch: ReturnType<getCards<Spec>> | undefined;

  private panelSelections: Record<string, ActiveModuleInspectorView>;

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

  private get selectedAccordionItem(): ActiveModuleInspectorView {
    let selection = this.panelSelections[this.args.readyFile.url];
    return selection ?? 'schema';
  }

  @action private toggleAccordionItem(item: ActiveModuleInspectorView) {
    this.panelSelections[this.args.readyFile.url] = item;
    // persist in local storage
    window.localStorage.setItem(
      CodeModePanelSelections,
      JSON.stringify(this.panelSelections),
    );
  }

  private updatePlaygroundSelectionsFromSpec = (spec: Spec) => {
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
    this.specSearch = this.getCards(
      this,
      () => this.queryForSpecsForSelectedDefinition,
      () => this.realmServer.availableRealmURLs,
      { isLive: true },
    ) as ReturnType<getCards<Spec>>;
  };

  get specsForSelectedDefinition() {
    return this.specSearch?.instances ?? [];
  }

  private get activeSpec() {
    let selectedSpecId = this.specPanelService.specSelection;

    if (selectedSpecId) {
      let selectedSpec = this.specsForSelectedDefinition?.find(
        (spec) => spec.id === selectedSpecId,
      );

      if (selectedSpec) {
        return selectedSpec;
      }
    }

    return this.specsForSelectedDefinition?.[0];
  }

  private get selectedView(): ActiveModuleInspectorView {
    let selection = this.panelSelections[this.args.readyFile.url];
    return selection ?? 'schema';
  }

  private createSpecInstance = task(
    async (ref: ResolvedCodeRef, specType: SpecType) => {
      let relativeTo = new URL(ref.module);
      let maybeAbsoluteRef = codeRefWithAbsoluteURL(ref, relativeTo);
      if (isResolvedCodeRef(maybeAbsoluteRef)) {
        ref = maybeAbsoluteRef;
      }
      try {
        let SpecKlass = await loadCardDef(specRef, {
          loader: this.loaderService.loader,
        });
        let card = new SpecKlass({
          specType,
          ref,
          title: ref.name,
        }) as CardDef;
        let currentRealm = this.operatorModeStateService.realmURL;
        await this.store.add(card, { realm: currentRealm.href });
        if (card.id) {
          this.specPanelService.setSelection(card.id);
          if (this.selectedView !== 'spec') {
            this.toggleAccordionItem('spec');
          }
        }
      } catch (e: any) {
        console.log('Error saving', e);
      }
    },
  );

  @action private async createSpec(event: MouseEvent) {
    event.stopPropagation();
    if (!this.args.selectedDeclaration) {
      throw new Error('bug: no selected declaration');
    }
    if (!this.selectedDeclarationAsCodeRef) {
      throw new Error('bug: no code ref');
    }
    let specType = await this.guessSpecType(this.args.selectedDeclaration);
    this.createSpecInstance.perform(
      this.selectedDeclarationAsCodeRef,
      specType,
    );
  }

  private async guessSpecType(
    selectedDeclaration: ModuleDeclaration,
  ): Promise<SpecType> {
    if (isCardOrFieldDeclaration(selectedDeclaration)) {
      if (isCardDef(selectedDeclaration.cardOrField)) {
        if (this.isApp(selectedDeclaration)) {
          return 'app';
        }
        if (await this.isSkill(selectedDeclaration)) {
          return 'skill';
        }
        return 'card';
      }
      if (isFieldDef(selectedDeclaration.cardOrField)) {
        return 'field';
      }
    }
    throw new Error('Unidentified spec');
  }

  //TODO: Improve identification of isApp and isSkill
  // isApp and isSkill are far from perfect functions
  //We have good primitives to identify card and field but not for app and skill
  //Here we are trying our best based upon schema analyses what is an app and a skill
  //We don't try to capture deep ancestry of app and skill
  private isApp(selectedDeclaration: CardOrFieldDeclaration) {
    if (selectedDeclaration.exportName === 'AppCard') {
      return true;
    }
    if (
      selectedDeclaration.super &&
      selectedDeclaration.super.type === 'external' &&
      selectedDeclaration.super.name === 'AppCard'
    ) {
      return true;
    }
    return false;
  }

  private async isSkill(selectedDeclaration: CardOrFieldDeclaration) {
    const isInClassChain = await selectedDeclaration.cardType.isClassInChain(
      selectedDeclaration.cardOrField,
      skillCardRef,
    );

    if (isInClassChain) {
      return true;
    }

    return false;
  }

  private get canWrite() {
    return this.realm.canWrite(this.operatorModeStateService.realmURL.href);
  }

  get showCreateSpec() {
    console.log('showCreateSpec', {
      selectedDeclaration: this.args.selectedDeclaration,
      isLoading: this.specSearch?.isLoading,
      specsForSelectedDefinition: this.specsForSelectedDefinition,
      canWrite: this.canWrite,
    });
    return (
      Boolean(this.args.selectedDeclaration?.exportName) &&
      !this.specSearch?.isLoading &&
      this.specsForSelectedDefinition.length === 0 &&
      this.canWrite
    );
  }

  <template>
    <section class='module-inspector'>
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

        <header
          class='module-inspector-header'
          aria-label='FIXME'
          {{SpecUpdatedModifier
            spec=this.activeSpec
            onSpecUpdated=this.updatePlaygroundSelectionsFromSpec
          }}
          data-test-preview-panel-header
        >
          {{#each accordionItems as |moduleInspectorView|}}
            <ToggleButton
              @isActive={{eq this.selectedView moduleInspectorView}}
              {{on 'click' (fn this.toggleAccordionItem moduleInspectorView)}}
              data-test-code-mode-panel-item={{moduleInspectorView}}
            >
              {{capitalize moduleInspectorView}}
              {{#if (eq moduleInspectorView 'spec')}}
                {{! FIXME ridiculous probs }}
                <SpecPreviewTitle
                  @spec={{this.activeSpec}}
                  @showCreateSpec={{this.showCreateSpec}}
                  @createSpec={{this.createSpec}}
                  @isCreateSpecInstanceRunning={{this.createSpecInstance.isRunning}}
                  @numberOfInstances={{this.specsForSelectedDefinition.length}}
                />
              {{/if}}
            </ToggleButton>
          {{/each}}
        </header>

        <section
          class='preview-panel-content'
          data-test-module-inspector='card-or-field'
          data-test-active-module-inspector-view={{this.selectedView}}
        >
          {{#if (eq this.selectedView 'schema')}}
            <SchemaEditor
              @file={{@readyFile}}
              @moduleContentsResource={{@moduleContentsResource}}
              @card={{@selectedCardOrField.cardOrField}}
              @cardTypeResource={{@selectedCardOrField.cardType}}
              @goToDefinition={{@goToDefinitionAndResetCursorPosition}}
              @isReadOnly={{@isReadOnly}}
              as |SchemaEditorTitle SchemaEditorPanel|
            >
              <SchemaEditorTitle />
              <SchemaEditorPanel class='accordion-content' />
            </SchemaEditor>
          {{else if (eq this.selectedView 'preview')}}
            <Playground
              @isOpen={{eq this.selectedAccordionItem 'preview'}}
              @codeRef={{@selectedCodeRef}}
              @isUpdating={{@moduleContentsResource.isLoading}}
              @cardOrField={{@selectedCardOrField.cardOrField}}
              as |PlaygroundTitle PlaygroundContent|
            >
              <PlaygroundTitle />
              {{#if (eq this.selectedAccordionItem 'preview')}}
                <PlaygroundContent />
              {{/if}}
            </Playground>
          {{else if (eq this.selectedView 'spec')}}

            <SpecPreview
              @selectedDeclaration={{@selectedDeclaration}}
              @isLoadingNewModule={{@moduleContentsResource.isLoadingNewModule}}
              @toggleAccordionItem={{this.toggleAccordionItem}}
              @isPanelOpen={{eq this.selectedAccordionItem 'spec'}}
              @selectedDeclarationAsCodeRef={{this.selectedDeclarationAsCodeRef}}
              @updatePlaygroundSelections={{this.updatePlaygroundSelections}}
              @activeSpec={{this.activeSpec}}
              @specsForSelectedDefinition={{this.specsForSelectedDefinition}}
              @showCreateSpec={{this.showCreateSpec}}
              as |SpecPreviewContent|
            >
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
            </SpecPreview>
          {{/if}}
        </section>
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
    </section>

    <style scoped>
      .module-inspector {
        background-color: var(--code-mode-panel-background-color);
      }

      .module-inspector-header {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        border-bottom: var(--boxel-border);
      }

      .module-inspector-content {
        overflow: scroll;
      }

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

interface SpecUpdatedModifierSignature {
  Args: {
    Named: {
      spec?: Spec;
      onSpecUpdated?: (spec: Spec) => void;
    };
  };
}

export class SpecUpdatedModifier extends Modifier<SpecUpdatedModifierSignature> {
  modify(
    _element: HTMLElement,
    _positional: [],
    { spec, onSpecUpdated }: SpecUpdatedModifierSignature['Args']['Named'],
  ) {
    if (!spec || !onSpecUpdated) {
      return;
    }

    onSpecUpdated(spec);
  }
}

// FIXME where is a good place for these?

interface SpecPreviewTitleSignature {
  Args: {
    spec?: Spec;
    numberOfInstances?: number;
    showCreateSpec: boolean;
    createSpec: (event: MouseEvent) => void;
    isCreateSpecInstanceRunning: boolean;
  };
}

class SpecPreviewTitle extends Component<SpecPreviewTitleSignature> {
  private get moreThanOneInstance() {
    return this.args.numberOfInstances && this.args.numberOfInstances > 1;
  }

  private get specType() {
    return this.args.spec?.specType as SpecType | undefined;
  }

  <template>
    Boxel Spec

    <span class='has-spec' data-test-has-spec>
      {{#if @showCreateSpec}}
        <BoxelButton
          class='create-spec-button'
          @kind='primary'
          @size='extra-small'
          @loading={{@isCreateSpecInstanceRunning}}
          {{on 'click' @createSpec}}
          data-test-create-spec-button
        >
          Create
        </BoxelButton>
      {{else if this.moreThanOneInstance}}
        <div
          data-test-number-of-instance={{@numberOfInstances}}
          class='number-of-instance'
        >
          <DotIcon class='dot-icon' />
          <div class='number-of-instance-text'>
            {{@numberOfInstances}}
            instances
          </div>
        </div>
      {{else}}
        {{#if this.specType}}
          <SpecTag @specType={{this.specType}} />
        {{/if}}
      {{/if}}
    </span>

    <style scoped>
      .has-spec {
        display: flex;
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .create-spec-button {
        --boxel-button-min-height: auto;
        --boxel-button-min-width: auto;
        font-weight: 500;
      }
      .number-of-instance {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
      }
      .number-of-instance-text {
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xl);
      }
      .dot-icon {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
      }
    </style>
  </template>
}

interface SpecTagSignature {
  Element: HTMLDivElement;
  Args: {
    specType: SpecType;
  };
}

export class SpecTag extends Component<SpecTagSignature> {
  get icon() {
    return getIcon(this.args.specType);
  }
  <template>
    {{#if this.icon}}
      <Pill
        data-test-spec-tag={{@specType}}
        class='spec-tag-pill'
        ...attributes
      >
        <:iconLeft>
          {{this.icon}}
        </:iconLeft>
        <:default>
          {{@specType}}
        </:default>
      </Pill>

    {{/if}}
    <style scoped>
      .spec-tag-pill {
        --pill-font: 500 var(--boxel-font-xs);
        --pill-background-color: var(--boxel-200);
        word-break: initial;
      }
    </style>
  </template>
}

function getIcon(specType: SpecType) {
  switch (specType) {
    case 'card':
      return StackIcon;
    case 'app':
      return AppsIcon;
    case 'field':
      return LayoutList;
    case 'skill':
      return Brain;
    default:
      return;
  }
}
