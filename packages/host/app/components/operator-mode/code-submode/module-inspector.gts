import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { capitalize } from '@ember/string';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import Eye from '@cardstack/boxel-icons/eye';
import FileCog from '@cardstack/boxel-icons/file-cog';
import Schema from '@cardstack/boxel-icons/schema';

import { task } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';
import window from 'ember-window-mock';

import { eq } from '@cardstack/boxel-ui/helpers';

import type {
  CodeRef,
  CardErrorJSONAPI,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  type getCards,
  type getCard,
  type Query,
  type CardResourceMeta,
  isFieldDef,
  internalKeyFor,
  GetCardsContextName,
  GetCardContextName,
  specRef,
  localId,
  meta,
} from '@cardstack/runtime-common';

import CreateSpecCommand from '@cardstack/host/commands/create-specs';
import CardError from '@cardstack/host/components/operator-mode/card-error';
import CardRendererPanel from '@cardstack/host/components/operator-mode/card-renderer-panel/index';
import Playground from '@cardstack/host/components/operator-mode/code-submode/playground/playground';

import SchemaEditor from '@cardstack/host/components/operator-mode/code-submode/schema-editor';

import SpecPreview from '@cardstack/host/components/operator-mode/code-submode/spec-preview';
import SpecPreviewBadge from '@cardstack/host/components/operator-mode/code-submode/spec-preview-badge';

import ToggleButton from '@cardstack/host/components/operator-mode/code-submode/toggle-button';
import SyntaxErrorDisplay from '@cardstack/host/components/operator-mode/syntax-error-display';
import consumeContext from '@cardstack/host/helpers/consume-context';

import type { FileResource } from '@cardstack/host/resources/file';
import type { Ready } from '@cardstack/host/resources/file';
import { isReady } from '@cardstack/host/resources/file';
import {
  type CardOrFieldDeclaration,
  type ModuleAnalysis,
  isCardOrFieldDeclaration,
  type ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';

import type CommandService from '@cardstack/host/services/command-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import { DEFAULT_MODULE_INSPECTOR_VIEW } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type { ModuleInspectorView } from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type SpecPanelService from '@cardstack/host/services/spec-panel-service';
import type StoreService from '@cardstack/host/services/store';

import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import type {
  CardDef,
  Format,
  ViewCardFn,
} from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';
import type { Spec } from 'https://cardstack.com/base/spec';

import type { ComponentLike } from '@glint/template';

const moduleInspectorPanels: Record<ModuleInspectorView, ComponentLike> = {
  schema: Schema,
  preview: Eye,
  spec: FileCog,
};

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
    moduleAnalysis: ModuleAnalysis;
    previewFormat: Format;
    readyFile: Ready;
    selectedCardOrField: CardOrFieldDeclaration | undefined;
    selectedCodeRef: ResolvedCodeRef | undefined;
    selectedDeclaration: ModuleDeclaration | undefined;
    setPreviewFormat: (format: Format) => void;
  };
}

export default class ModuleInspector extends Component<ModuleInspectorSignature> {
  @service private declare commandService: CommandService;
  @service private declare loaderService: LoaderService;
  @service private declare matrixService: MatrixService;
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

  private get isEmptyFile() {
    return this.args.readyFile?.content.match(/^\s*$/);
  }

  private get isGeneratingEmptyFileContent() {
    if (!this.isEmptyFile) {
      return false;
    }

    let roomId = this.matrixService.currentRoomId;
    if (!roomId) {
      return false;
    }

    let roomResource = this.matrixService.roomResources.get(roomId);
    if (!roomResource) {
      return false;
    }

    let lastMessageIndex = roomResource.indexOfLastNonDebugMessage;
    if (lastMessageIndex < 0) {
      return false;
    }

    let lastMessage = roomResource.messages[lastMessageIndex];
    if (!lastMessage) {
      return false;
    }

    let canceledActionMessageId =
      this.matrixService.getLastCanceledActionEventId(roomId);
    if (
      lastMessage.isCanceled ||
      canceledActionMessageId === lastMessage.eventId
    ) {
      return false;
    }

    if (lastMessage.author.userId !== this.matrixService.aiBotUserId) {
      return false;
    }

    if (lastMessage.isStreamingFinished !== false) {
      return lastMessage.htmlParts?.some((htmlPart) => {
        let codeData = htmlPart.codeData;
        if (!codeData) {
          return false;
        }

        if (
          codeData.fileUrl !== this.args.readyFile.url ||
          !codeData.searchReplaceBlock
        ) {
          return false;
        }

        return this.commandService.getCodePatchStatus(codeData) === 'ready';
      });
    }

    return lastMessage.htmlParts?.some((htmlPart) => {
      let codeData = htmlPart.codeData;
      if (!codeData) {
        return false;
      }

      return (
        codeData.fileUrl === this.args.readyFile.url &&
        !codeData.searchReplaceBlock
      );
    });
  }

  private get sourceFileForCard(): FileDef | undefined {
    if (!this.args.cardError || !isReady(this.args.currentOpenFile)) {
      return undefined;
    }

    const fileContent = JSON.parse(this.args.currentOpenFile.content);
    const adoptsFrom = fileContent?.data?.meta?.adoptsFrom;

    if (!adoptsFrom) {
      return undefined;
    }

    let moduleURLWithExtension = new URL(
      adoptsFrom.module.endsWith('.gts')
        ? adoptsFrom.module
        : `${adoptsFrom.module}.gts`,
      this.args.currentOpenFile.url,
    );
    return this.matrixService.fileAPI.createFileDef({
      sourceUrl: moduleURLWithExtension.href,
      name: moduleURLWithExtension.href.split('/').pop()!,
    });
  }

  private get fileIncompatibilityMessage() {
    if (this.args.isIncompatibleFile) {
      return `No tools are available to be used with this file type. Choose a file representing a card instance or module.`;
    }
    return null;
  }

  private get activePanel(): ModuleInspectorView {
    return (
      this.operatorModeStateService.state.moduleInspector ??
      DEFAULT_MODULE_INSPECTOR_VIEW
    );
  }

  private viewCardInCodeSubmode: ViewCardFn = async (cardOrURL) => {
    let cardId = cardOrURL instanceof URL ? cardOrURL.href : cardOrURL.id;
    if (!cardId) {
      return;
    }

    const fileUrl = cardId.endsWith('.json') ? cardId : `${cardId}.json`;
    await this.operatorModeStateService.updateCodePath(new URL(fileUrl));
  };

  @action private setActivePanel(item: ModuleInspectorView) {
    this.operatorModeStateService.updateModuleInspectorView(item);
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

  private getSpecMeta(spec: Spec): CardResourceMeta | undefined {
    return (spec as Spec & { [meta]?: CardResourceMeta })[meta];
  }

  private getSpecCreatedAt(spec: Spec) {
    return this.getSpecMeta(spec)?.resourceCreatedAt ?? 0;
  }

  private getSpecIdForSort(spec: Spec) {
    return spec.id ?? spec[localId];
  }

  get specsForSelectedDefinition() {
    const specs = this.specSearch?.instances ?? [];
    if (specs.length <= 1) {
      return specs;
    }
    return [...specs].sort((a, b) => {
      const createdDiff = this.getSpecCreatedAt(b) - this.getSpecCreatedAt(a);
      if (createdDiff !== 0) {
        return createdDiff;
      }
      const aId = this.getSpecIdForSort(a);
      const bId = this.getSpecIdForSort(b);
      if (aId && bId && aId !== bId) {
        return bId.localeCompare(aId);
      }
      return 0;
    });
  }

  private get activeSpecId() {
    return this.specPanelService.specSelection ?? undefined;
  }

  get activeSpec() {
    return this.cardResource?.card as Spec;
  }

  private createSpecTask = task(async (ref: ResolvedCodeRef) => {
    try {
      const createSpecCommand = new CreateSpecCommand(
        this.commandService.commandContext,
      );
      let currentRealm = this.operatorModeStateService.realmURL;
      const result = await createSpecCommand.execute({
        codeRef: ref,
        targetRealm: currentRealm,
      });
      const spec = result.specs?.[0];
      if (spec) {
        this.specPanelService.setSelection(spec[localId]);
        if (this.activePanel !== 'spec') {
          this.setActivePanel('spec');
        }
      }
    } catch (e: any) {
      console.log('Error saving', e);
    }
  });

  @action private async createSpec(event: MouseEvent) {
    event.stopPropagation();
    if (!this.args.selectedDeclaration) {
      throw new Error('bug: no selected declaration');
    }
    if (!this.selectedDeclarationAsCodeRef) {
      throw new Error('bug: no code ref');
    }
    this.createSpecTask.perform(this.selectedDeclarationAsCodeRef);
  }

  private get canWrite() {
    return this.realm.canWrite(this.operatorModeStateService.realmURL);
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

  get displayInspector() {
    return this.args.selectedDeclaration;
  }

  <template>
    {{#if this.isEmptyFile}}
      <div class='empty-file-message' data-test-empty-file-message>
        {{if
          this.isGeneratingEmptyFileContent
          'File is empty - its content is currently being generated by the AI Assistant.'
          'File is empty - tools like schema inspector, and file preview, are unavailable.'
        }}
      </div>
    {{else if this.fileIncompatibilityMessage}}
      <div
        class='file-incompatible-message'
        data-test-file-incompatibility-message
      >
        {{this.fileIncompatibilityMessage}}
      </div>
    {{else if this.displayInspector}}
      {{consumeContext this.makeCardResource}}
      {{consumeContext this.findSpecsForSelectedDefinition}}

      <SchemaEditor
        @file={{@readyFile}}
        @moduleAnalysis={{@moduleAnalysis}}
        @card={{@selectedCardOrField.cardOrField}}
        @cardType={{@selectedCardOrField.cardType}}
        @selectedDeclaration={{@selectedDeclaration}}
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
          {{#each-in moduleInspectorPanels as |moduleInspectorView icon|}}
            <ToggleButton
              class='toggle-button'
              @icon={{icon}}
              @isActive={{eq this.activePanel moduleInspectorView}}
              {{on 'click' (fn this.setActivePanel moduleInspectorView)}}
              data-test-module-inspector-view={{moduleInspectorView}}
            >
              <:default>{{capitalize moduleInspectorView}}</:default>
              <:annotation>
                {{#if (eq moduleInspectorView 'spec')}}
                  <SpecPreviewBadge
                    @spec={{this.activeSpec}}
                    @showCreateSpec={{this.showCreateSpec}}
                    @createSpec={{this.createSpec}}
                    @isCreateSpecInstanceRunning={{this.createSpecTask.isRunning}}
                    @numberOfInstances={{this.specsForSelectedDefinition.length}}
                  />
                {{else if (eq moduleInspectorView 'schema')}}
                  {{#if @selectedCardOrField}}
                    <SchemaEditorBadge />
                  {{/if}}
                {{/if}}
              </:annotation>
            </ToggleButton>
          {{/each-in}}
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
              @isUpdating={{@moduleAnalysis.isLoading}}
              @cardOrField={{@selectedCardOrField.cardOrField}}
              @viewCard={{this.viewCardInCodeSubmode}}
            />
          {{else if (eq this.activePanel 'spec')}}
            <SpecPreview
              @selectedDeclaration={{@selectedDeclaration}}
              @setActiveModuleInspectorPanel={{this.setActivePanel}}
              @isPanelOpen={{eq this.activePanel 'spec'}}
              @selectedDeclarationAsCodeRef={{this.selectedDeclarationAsCodeRef}}
              @updatePlaygroundSelections={{this.updatePlaygroundSelections}}
              @activeSpec={{this.activeSpec}}
              @specsForSelectedDefinition={{this.specsForSelectedDefinition}}
              @showCreateSpec={{this.showCreateSpec}}
            >
              <:loading as |SpecPreviewLoading|>
                <div class='non-preview-panel-content'>
                  <SpecPreviewLoading />
                </div>
              </:loading>
              <:content as |SpecPreviewContent|>
                <SpecPreviewContent class='non-preview-panel-content' />
              </:content>
            </SpecPreview>
          {{/if}}
        </section>
      </SchemaEditor>
    {{else if @moduleAnalysis.moduleError}}
      <SyntaxErrorDisplay
        @syntaxErrors={{@moduleAnalysis.moduleError.message}}
      />
    {{else if @cardError}}
      <section class='module-inspector-content error'>
        <CardError
          @error={{@cardError}}
          @fileToFixWithAi={{this.sourceFileForCard}}
        />
      </section>
    {{else if @card}}
      <CardRendererPanel
        @card={{@card}}
        @format={{@previewFormat}}
        @setFormat={{@setPreviewFormat}}
        @viewCard={{this.viewCardInCodeSubmode}}
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
        background-color: transparent;
      }

      .module-inspector-content {
        overflow: auto;
        height: 100%;
        background-color: var(--boxel-light);
      }

      .module-inspector-content.error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--boxel-dark);
      }

      .module-inspector-content.error :deep(.error-header) {
        width: 100%;
      }

      .toggle-button {
        padding-right: var(--boxel-sp-xxxs);
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

      .empty-file-message {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        background-color: var(--boxel-200);
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        font-weight: 500;
        text-align: center;
        padding: var(--boxel-sp-xl);
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
