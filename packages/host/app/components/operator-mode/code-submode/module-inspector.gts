import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import { capitalize } from '@ember/string';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';
import window from 'ember-window-mock';

import { TrackedObject } from 'tracked-built-ins';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  type getCards,
  type getCard,
  type Query,
  isCardDef,
  isCardDocumentString,
  isFieldDef,
  internalKeyFor,
  loadCardDef,
  CodeRef,
  CardErrorJSONAPI,
  GetCardsContextName,
  GetCardContextName,
  ResolvedCodeRef,
  specRef,
  localId,
} from '@cardstack/runtime-common';
import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
} from '@cardstack/runtime-common/code-ref';

import CardError from '@cardstack/host/components/operator-mode/card-error';
import CardRendererPanel from '@cardstack/host/components/operator-mode/card-renderer-panel/index';
import Playground from '@cardstack/host/components/operator-mode/code-submode/playground/playground';

import SchemaEditor from '@cardstack/host/components/operator-mode/code-submode/schema-editor';

import SpecPreview from '@cardstack/host/components/operator-mode/code-submode/spec-preview';
import SpecPreviewBadge from '@cardstack/host/components/operator-mode/code-submode/spec-preview-badge';

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
import type { ModuleInspectorView } from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type SpecPanelService from '@cardstack/host/services/spec-panel-service';
import type StoreService from '@cardstack/host/services/store';

import { CodeModePanelSelections } from '@cardstack/host/utils/local-storage-keys';
import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';
import { Spec, type SpecType } from 'https://cardstack.com/base/spec';

const moduleInspectorPanels: ModuleInspectorView[] = [
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
  @consume(GetCardContextName) private declare getCard: getCard;

  @tracked private specSearch: ReturnType<getCards<Spec>> | undefined;
  @tracked private cardResource: ReturnType<getCard> | undefined;

  private panelSelections: Record<string, ModuleInspectorView>;

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

  private get activePanel(): ModuleInspectorView {
    let selection = this.panelSelections[this.args.readyFile.url];
    let activePanel = this.operatorModeStateService.moduleInspectorForCodePath;
    console.log('activePanel:');
    console.log('selection:', selection);
    console.log('activePanel:', activePanel);
    console.log('result:', selection ?? activePanel ?? 'schema');
    return selection ?? activePanel ?? 'schema';
  }

  @action private setActivePanel(item: ModuleInspectorView) {
    this.panelSelections[this.args.readyFile.url] = item;
    this.operatorModeStateService.updateModuleInspectorView(item);
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

  doWhileRefreshing = () => {
    if (
      !this.specPanelService.specSelection &&
      this.specsForSelectedDefinition.length > 0
    ) {
      this.specPanelService.setSelection(this.specsForSelectedDefinition[0].id);
    }
  };

  private findSpecsForSelectedDefinition = () => {
    this.specSearch = this.getCards(
      this,
      () => this.queryForSpecsForSelectedDefinition,
      () => this.realmServer.availableRealmURLs,
      { isLive: true, doWhileRefreshing: this.doWhileRefreshing },
    ) as ReturnType<getCards<Spec>>;
  };

  private makeCardResource = () => {
    this.cardResource = this.getCard(this, () => this.activeSpecId);
  };

  get specsForSelectedDefinition() {
    return this.specSearch?.instances ?? [];
  }

  private get activeSpecId() {
    return this.specPanelService.specSelection ?? undefined;
  }

  get activeSpec() {
    return this.cardResource?.card as Spec;
  }

  private createSpecTask = task(
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
        let spec = new SpecKlass({
          specType,
          ref,
          title: ref.name,
        }) as Spec;
        let currentRealm = this.operatorModeStateService.realmURL;
        await this.store.add(spec, {
          realm: currentRealm.href,
          doNotWaitForPersist: true,
        });
        this.specPanelService.setSelection(spec[localId]);
        if (this.activePanel !== 'spec') {
          this.setActivePanel('spec');
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
    this.createSpecTask.perform(this.selectedDeclarationAsCodeRef, specType);
  }

  private async guessSpecType(
    selectedDeclaration: ModuleDeclaration,
  ): Promise<SpecType> {
    if (isCardOrFieldDeclaration(selectedDeclaration)) {
      if (isCardDef(selectedDeclaration.cardOrField)) {
        if (this.isApp(selectedDeclaration)) {
          return 'app';
        }
        return 'card';
      }
      if (isFieldDef(selectedDeclaration.cardOrField)) {
        return 'field';
      }
    }
    throw new Error('Unidentified spec');
  }

  //TODO: Improve identification of isApp
  //We have good primitives to identify card and field but not for app
  //Here we are trying our best based upon schema analyses what is an app
  //We don't try to capture deep ancestry of app
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

  private get canWrite() {
    return this.realm.canWrite(this.operatorModeStateService.realmURL.href);
  }

  get showCreateSpec() {
    return (
      Boolean(this.args.selectedDeclaration?.exportName) &&
      !this.specSearch?.isLoading &&
      this.specsForSelectedDefinition.length === 0 &&
      !this.activeSpec &&
      this.canWrite
    );
  }

  <template>
    {{#if this.isCardPreviewError}}
      {{! this is here to make TS happy, this is always true }}
      {{#if @cardError}}
        <CardError @error={{@cardError}} @hideHeader={{true}} />
      {{/if}}
    {{else if this.isEmptyFile}}
      <SyntaxErrorDisplay @syntaxErrors='File is empty' />
    {{else if this.fileIncompatibilityMessage}}

      <div
        class='file-incompatible-message'
        data-test-file-incompatibility-message
      >
        {{this.fileIncompatibilityMessage}}
      </div>
    {{else if @selectedCardOrField.cardOrField}}
      {{consumeContext this.makeCardResource}}
      {{consumeContext this.findSpecsForSelectedDefinition}}

      <SchemaEditor
        @file={{@readyFile}}
        @moduleContentsResource={{@moduleContentsResource}}
        @card={{@selectedCardOrField.cardOrField}}
        @cardTypeResource={{@selectedCardOrField.cardType}}
        @goToDefinition={{@goToDefinitionAndResetCursorPosition}}
        @isReadOnly={{@isReadOnly}}
        as |SchemaEditorBadge SchemaEditorPanel|
      >

        <header
          class='module-inspector-header'
          {{SpecUpdatedModifier
            spec=this.activeSpec
            onSpecUpdated=this.updatePlaygroundSelectionsFromSpec
          }}
          data-test-preview-panel-header
        >
          {{#each moduleInspectorPanels as |moduleInspectorView|}}
            <ToggleButton
              class='toggle-button'
              @isActive={{eq this.activePanel moduleInspectorView}}
              {{on 'click' (fn this.setActivePanel moduleInspectorView)}}
              data-test-module-inspector-view={{moduleInspectorView}}
            >
              {{capitalize moduleInspectorView}}
              {{#if (eq moduleInspectorView 'spec')}}
                <SpecPreviewBadge
                  @spec={{this.activeSpec}}
                  @showCreateSpec={{this.showCreateSpec}}
                  @createSpec={{this.createSpec}}
                  @isCreateSpecInstanceRunning={{this.createSpecTask.isRunning}}
                  @numberOfInstances={{this.specsForSelectedDefinition.length}}
                />
              {{else if (eq moduleInspectorView 'schema')}}
                <SchemaEditorBadge />
              {{/if}}
            </ToggleButton>
          {{/each}}
        </header>

        <section
          class='module-inspector-content'
          data-test-module-inspector='card-or-field'
          data-test-active-module-inspector-view={{this.activePanel}}
        >
          {{#if (eq this.activePanel 'schema')}}
            <SchemaEditorPanel class='non-preview-panel-content' />
          {{else if (eq this.activePanel 'preview')}}
            <Playground
              @isOpen={{eq this.activePanel 'preview'}}
              @codeRef={{@selectedCodeRef}}
              @isUpdating={{@moduleContentsResource.isLoading}}
              @cardOrField={{@selectedCardOrField.cardOrField}}
            />
          {{else if (eq this.activePanel 'spec')}}
            <SpecPreview
              @selectedDeclaration={{@selectedDeclaration}}
              @isLoadingNewModule={{@moduleContentsResource.isLoadingNewModule}}
              @setActiveModuleInspectorPanel={{this.setActivePanel}}
              @isPanelOpen={{eq this.activePanel 'spec'}}
              @selectedDeclarationAsCodeRef={{this.selectedDeclarationAsCodeRef}}
              @updatePlaygroundSelections={{this.updatePlaygroundSelections}}
              @activeSpec={{this.activeSpec}}
              @specsForSelectedDefinition={{this.specsForSelectedDefinition}}
              @showCreateSpec={{this.showCreateSpec}}
              as |SpecPreviewContent|
            >
              {{#if this.showSpecPreview}}
                <SpecPreviewContent class='non-preview-panel-content' />
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
      </SchemaEditor>
    {{else if @moduleContentsResource.moduleError}}
      <SyntaxErrorDisplay
        @syntaxErrors={{@moduleContentsResource.moduleError.message}}
      />
    {{else if @card}}
      <CardRendererPanel
        class='card-renderer-panel'
        @card={{@card}}
        @realmURL={{this.operatorModeStateService.realmURL}}
        @format={{@previewFormat}}
        @setFormat={{@setPreviewFormat}}
        data-test-card-resource-loaded
      />
    {{/if}}

    <style scoped>
      .module-inspector-header {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        border-bottom: var(--boxel-border);
      }

      .module-inspector-content {
        overflow: scroll;
        height: 100%;
      }

      .toggle-button {
        justify-content: space-between;
        padding: 0 var(--boxel-sp-xxxs) 0 var(--boxel-sp);
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

      .non-preview-panel-content {
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
