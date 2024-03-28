import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask, restartableTask, timeout, all } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import FromElseWhere from 'ember-elsewhere/components/from-elsewhere';

import { Accordion } from '@cardstack/boxel-ui/components';

import { ResizablePanelGroup } from '@cardstack/boxel-ui/components';
import type { PanelContext } from '@cardstack/boxel-ui/components';
import { and, not, bool, eq } from '@cardstack/boxel-ui/helpers';
import { File } from '@cardstack/boxel-ui/icons';

import {
  isCardDocumentString,
  hasExecutableExtension,
  RealmPaths,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { SerializedError } from '@cardstack/runtime-common/error';
import { isEquivalentBodyPosition } from '@cardstack/runtime-common/schema-analysis-plugin';

import RecentFiles from '@cardstack/host/components/editor/recent-files';
import CodeSubmodeEditorIndicator from '@cardstack/host/components/operator-mode/code-submode/editor-indicator';
import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';
import SyntaxErrorDisplay from '@cardstack/host/components/operator-mode/syntax-error-display';

import { getCard } from '@cardstack/host/resources/card-resource';
import { isReady, type FileResource } from '@cardstack/host/resources/file';
import {
  moduleContentsResource,
  isCardOrFieldDeclaration,
  type ModuleDeclaration,
  type State as ModuleState,
  findDeclarationByName,
} from '@cardstack/host/resources/module-contents';
import type CardService from '@cardstack/host/services/card-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import type { FileView } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RecentFilesService from '@cardstack/host/services/recent-files-service';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

import FileTree from '../editor/file-tree';

import CardPreviewPanel from './card-preview-panel';
import CardURLBar from './card-url-bar';
import CodeEditor from './code-editor';
import InnerContainer from './code-submode/inner-container';
import CodeSubmodeLeftPanelToggle from './code-submode/left-panel-toggle';
import SchemaEditor, { SchemaEditorTitle } from './code-submode/schema-editor';
import CreateFileModal, { type FileType } from './create-file-modal';
import DeleteModal from './delete-modal';
import DetailPanel from './detail-panel';
import NewFileButton from './new-file-button';
import SubmodeLayout from './submode-layout';

interface Signature {
  Args: {
    saveSourceOnClose: (url: URL, content: string) => void;
    saveCardOnClose: (card: CardDef) => void;
  };
}

type PanelWidths = {
  rightPanel: number;
  codeEditorPanel: number;
  leftPanel: number;
  emptyCodeModePanel: number;
};

type PanelHeights = {
  filePanel: number;
  recentPanel: number;
};

type SelectedAccordionItem = 'schema-editor' | null;

const CodeModePanelWidths = 'code-mode-panel-widths';
const defaultPanelWidths: PanelWidths = {
  // 14rem as a fraction of the layout width
  leftPanel:
    (14.0 * parseFloat(getComputedStyle(document.documentElement).fontSize)) /
    (document.documentElement.clientWidth - 40 - 36),
  codeEditorPanel: 0.4,
  rightPanel: 0.4,
  emptyCodeModePanel: 0.8,
};

const CodeModePanelHeights = 'code-mode-panel-heights';
const ApproximateRecentPanelDefaultFraction =
  (50 + 43 * 3.5) / (document.documentElement.clientHeight - 430); // room for about 3.5 recent files
const defaultPanelHeights: PanelHeights = {
  filePanel: 1 - ApproximateRecentPanelDefaultFraction,
  recentPanel: ApproximateRecentPanelDefaultFraction,
};

const waiter = buildWaiter('code-submode:waiter');

export default class CodeSubmode extends Component<Signature> {
  @service private declare cardService: CardService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare recentFilesService: RecentFilesService;
  @service private declare environmentService: EnvironmentService;

  @tracked private loadFileError: string | null = null;
  @tracked private userHasDismissedURLError = false;
  @tracked private sourceFileIsSaving = false;
  @tracked private previewFormat: Format = 'isolated';
  @tracked private isCreateModalOpen = false;
  @tracked private itemToDelete: CardDef | URL | null | undefined;

  private hasUnsavedCardChanges = false;
  private panelWidths: PanelWidths;
  private panelHeights: PanelHeights;
  private updateCursorByName: ((name: string) => void) | undefined;
  #currentCard: CardDef | undefined;

  private createFileModal: CreateFileModal | undefined;
  private cardResource = getCard(
    this,
    () => {
      if (!this.codePath || this.codePath.href.split('.').pop() !== 'json') {
        return undefined;
      }
      // this includes all JSON files, but the card resource is smart enough
      // to skip JSON that are not card instances
      let url = this.codePath.href.replace(/\.json$/, '');
      return url;
    },
    {
      onCardInstanceChange: () => this.onCardLoaded,
    },
  );
  private moduleContentsResource = moduleContentsResource(
    this,
    () => {
      return this.isModule ? this.readyFile : undefined;
    },
    this.onModuleEdit,
  );

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.operatorModeStateService.subscribeToOpenFileStateChanges(this);
    this.panelWidths = localStorage.getItem(CodeModePanelWidths)
      ? // @ts-ignore Type 'null' is not assignable to type 'string'
        JSON.parse(localStorage.getItem(CodeModePanelWidths))
      : {};

    this.panelHeights = localStorage.getItem(CodeModePanelHeights)
      ? // @ts-ignore Type 'null' is not assignable to type 'string'
        JSON.parse(localStorage.getItem(CodeModePanelHeights))
      : {};

    registerDestructor(this, () => {
      // destructor functons are called synchronously. in order to save,
      // which is async, we leverage an EC task that is running in a
      // parent component (EC task lifetimes are bound to their context)
      // that is not being destroyed.
      if (this.hasUnsavedCardChanges && this.#currentCard) {
        // we use this.#currentCard here instead of this.card because in
        // the destructor we no longer have access to resources bound to
        // this component since they are destroyed first, so this.#currentCard
        // is something we copy from the card resource when it changes so that
        // we have access to it in the destructor
        this.args.saveCardOnClose(this.#currentCard);
      }
      this.operatorModeStateService.unsubscribeFromOpenFileStateChanges(this);
    });
  }

  private get card() {
    if (
      this.cardResource.card &&
      this.codePath?.href.replace(/\.json$/, '') === this.cardResource.url
    ) {
      return this.cardResource.card;
    }
    return undefined;
  }

  private backgroundURLStyle(backgroundURL: string | null) {
    let possibleStyle = backgroundURL
      ? `background-image: url(${backgroundURL});`
      : '';
    return htmlSafe(possibleStyle);
  }

  @action setFileView(view: FileView) {
    this.operatorModeStateService.updateFileView(view);
  }

  private get realmURL() {
    return this.operatorModeStateService.realmURL;
  }

  private get isIncompatibleFile() {
    return this.readyFile.isBinary || this.isNonCardJson;
  }

  private get isModule() {
    return (
      this.isReady &&
      hasExecutableExtension(this.readyFile.url) &&
      !this.isIncompatibleFile
    );
  }

  private get isCard() {
    return (
      this.isReady &&
      this.readyFile.name.endsWith('.json') &&
      isCardDocumentString(this.readyFile.content)
    );
  }

  private get hasCardDefOrFieldDef() {
    return this.declarations.some(isCardOrFieldDeclaration);
  }

  private get isSelectedItemIncompatibleWithSchemaEditor() {
    if (!this.selectedDeclaration) {
      return undefined;
    }
    return !isCardOrFieldDeclaration(this.selectedDeclaration);
  }

  private get isNonCardJson() {
    return (
      this.readyFile.name.endsWith('.json') &&
      !isCardDocumentString(this.readyFile.content)
    );
  }

  get fileView() {
    return this.operatorModeStateService.state.fileView;
  }

  private get isFileOpen() {
    return !!(this.codePath && this.currentOpenFile?.state !== 'not-found');
  }

  private get isCardPreviewError() {
    return this.isCard && this.cardResource.cardError;
  }

  private get fileIncompatibilityMessage() {
    if (this.isCard) {
      if (this.cardResource.cardError) {
        return `Card preview failed. Make sure both the card instance data and card definition files have no errors and that their data schema matches. `;
      }
    }

    if (this.moduleContentsResource.moduleError) {
      return null; // Handled in code-submode schema editor
    }

    if (this.isIncompatibleFile) {
      return `No tools are available to be used with this file type. Choose a file representing a card instance or module.`;
    }

    // If the module is incompatible
    if (this.isModule) {
      //this will prevent displaying message during a page refresh
      if (this.moduleContentsResource.isLoading) {
        return null;
      }
      if (!this.hasCardDefOrFieldDef) {
        return `No tools are available to be used with these file contents. Choose a module that has a card or field definition inside of it.`;
      } else if (this.isSelectedItemIncompatibleWithSchemaEditor) {
        return `No tools are available for the selected item: ${this.selectedDeclaration?.type} "${this.selectedDeclaration?.localName}". Select a card or field definition in the inspector.`;
      }
    }

    // If rhs doesn't handle any case but we can't capture the error
    if (!this.card && !this.selectedCardOrField) {
      // this will prevent displaying message during a page refresh
      if (isCardDocumentString(this.readyFile.content)) {
        return null;
      }
      return 'No tools are available to inspect this file or its contents. Select a file with a .json, .gts or .ts extension.';
    }

    if (
      !this.isModule &&
      !this.readyFile.name.endsWith('.json') &&
      !this.card //for case of creating new card instance
    ) {
      return 'No tools are available to inspect this file or its contents. Select a file with a .json, .gts or .ts extension.';
    }

    return null;
  }

  private get fileIncompatibilityErrors() {
    if (this.isCard) {
      if (this.cardResource.cardError) {
        try {
          let error = this.cardResource.cardError.error;

          if (error.responseText) {
            let parsedError = JSON.parse(error.responseText);

            let allDetails = parsedError.errors
              .concat(
                ...parsedError.errors.map(
                  (e: SerializedError) => e.additionalErrors,
                ),
              )
              .map((e: SerializedError) => e.detail);

            // There’s often a pair of errors where one has an unhelpful prefix like this:
            // cannot return card from index: Not Found - http://test-realm/test/non-card not found
            // http://test-realm/test/non-card not found

            let detailsWithoutDuplicateSuffixes = allDetails.reduce(
              (details: string[], currentDetail: string) => {
                return [
                  ...details.filter(
                    (existingDetail) => !existingDetail.endsWith(currentDetail),
                  ),
                  currentDetail,
                ];
              },
              [],
            );

            return detailsWithoutDuplicateSuffixes;
          }
        } catch (e) {
          console.log('Error extracting card preview errors', e);
          return [];
        }
      }
    }

    return [];
  }

  private get currentOpenFile() {
    return this.operatorModeStateService.openFile.current;
  }

  private get isReady() {
    return isReady(this.currentOpenFile);
  }

  private get readyFile() {
    if (isReady(this.currentOpenFile)) {
      return this.currentOpenFile;
    }
    throw new Error(
      `cannot access file contents ${this.codePath} before file is open`,
    );
  }

  private get codePath() {
    return this.operatorModeStateService.state.codePath;
  }

  @action private resetLoadFileError() {
    this.loadFileError = null;
  }

  @action private dismissURLError() {
    this.userHasDismissedURLError = true;
  }

  @action private onModuleEdit(state: ModuleState) {
    let editedDeclaration = state.declarations.find(
      (newDeclaration: ModuleDeclaration) => {
        return this.selectedDeclaration
          ? this.selectedDeclaration.localName !== newDeclaration.localName &&
              isEquivalentBodyPosition(
                this.selectedDeclaration.path,
                newDeclaration.path,
              )
          : false;
      },
    );
    if (editedDeclaration) {
      this.goToDefinition(undefined, editedDeclaration.localName);
    }
  }

  private onCardLoaded = (
    oldCard: CardDef | undefined,
    newCard: CardDef | undefined,
  ) => {
    if (oldCard) {
      this.cardResource.api.unsubscribeFromChanges(oldCard, this.onCardChange);
    }
    if (newCard) {
      this.cardResource.api.subscribeToChanges(newCard, this.onCardChange);
    }
    this.#currentCard = newCard;
  };

  private get loadedCard() {
    if (!this.card) {
      throw new Error(`bug: card ${this.codePath} is not loaded`);
    }
    return this.card;
  }

  private get declarations() {
    return this.moduleContentsResource?.declarations;
  }

  private get _selectedDeclaration() {
    let codeSelection = this.operatorModeStateService.state.codeSelection;
    if (codeSelection === undefined) return undefined;
    return findDeclarationByName(codeSelection, this.declarations);
  }

  private get selectedDeclaration() {
    if (!this.isModule || this.moduleContentsResource.moduleError) {
      return undefined;
    }
    if (this._selectedDeclaration) {
      return this._selectedDeclaration;
    } else {
      // default to 1st selection
      return this.declarations.length > 0 ? this.declarations[0] : undefined;
    }
  }

  private get selectedCardOrField() {
    if (
      this.selectedDeclaration !== undefined &&
      isCardOrFieldDeclaration(this.selectedDeclaration)
    ) {
      return this.selectedDeclaration;
    }
    return undefined;
  }

  @action
  private selectDeclaration(dec: ModuleDeclaration) {
    this.goToDefinition(undefined, dec.localName);
  }

  @action
  goToDefinition(
    codeRef: ResolvedCodeRef | undefined,
    localName: string | undefined,
  ) {
    this.operatorModeStateService.updateCodePathWithCodeSelection(
      codeRef,
      localName,
      this.updateCursorByName,
    );
  }

  private onCardChange = () => {
    this.initiateAutoSaveTask.perform();
  };

  private initiateAutoSaveTask = restartableTask(async () => {
    if (this.card) {
      this.hasUnsavedCardChanges = true;
      await timeout(this.environmentService.autoSaveDelayMs);
      await this.saveCard.perform(this.card);
      this.hasUnsavedCardChanges = false;
    }
  });

  private saveCard = restartableTask(async (card: CardDef) => {
    // these saves can happen so fast that we'll make sure to wait at
    // least 500ms for human consumption
    await all([this.cardService.saveModel(this, card), timeout(500)]);
  });

  private get isSaving() {
    return this.sourceFileIsSaving || this.saveCard.isRunning;
  }

  @action
  private onSourceFileSave(status: 'started' | 'finished') {
    this.sourceFileIsSaving = status === 'started';
  }

  @action
  private onListPanelContextChange(listPanelContext: PanelContext[]) {
    this.panelWidths.leftPanel = listPanelContext[0]?.lengthPx;
    this.panelWidths.codeEditorPanel = listPanelContext[1]?.lengthPx;
    this.panelWidths.rightPanel = listPanelContext[2]?.lengthPx;

    localStorage.setItem(CodeModePanelWidths, JSON.stringify(this.panelWidths));
  }

  @action
  private onFilePanelContextChange(filePanelContext: PanelContext[]) {
    this.panelHeights.filePanel = filePanelContext[0]?.lengthPx;
    this.panelHeights.recentPanel = filePanelContext[1]?.lengthPx;

    localStorage.setItem(
      CodeModePanelHeights,
      JSON.stringify(this.panelHeights),
    );
  }

  @action
  private onSelectNewFileType(fileType: FileType) {
    this.createFile.perform(fileType);
  }

  onStateChange(state: FileResource['state']) {
    this.userHasDismissedURLError = false;
    if (state === 'ready') {
      this.loadFileError = null;
    } else {
      this.loadFileError = 'This resource does not exist';
      this.setFileView('browser');
    }
  }

  @action private setItemToDelete(item: CardDef | URL | null | undefined) {
    this.itemToDelete = item;
  }

  @action private onCancelDelete() {
    this.itemToDelete = undefined;
  }

  // dropTask will ignore any subsequent delete requests until the one in progress is done
  private delete = dropTask(async (item: CardDef | URL) => {
    if (!item) {
      return;
    }
    if (!(item instanceof URL)) {
      if (!item.id) {
        this.itemToDelete = undefined;
        // the card isn't actually saved yet, so do nothing
        return;
      }
    }

    if (!(item instanceof URL)) {
      let card = item;
      await this.withTestWaiters(async () => {
        await this.operatorModeStateService.deleteCard(card);
      });
    } else {
      let file = item;
      await this.withTestWaiters(async () => {
        // TODO: This is a side effect of the recent-file service making assumptions about
        // what realm we are in. we should refactor that so that callers have to tell
        // it the realm of the file in question
        let realmURL = this.operatorModeStateService.realmURL;

        if (realmURL) {
          let realmPaths = new RealmPaths(realmURL);
          let filePath = realmPaths.local(file);
          this.recentFilesService.removeRecentFile(filePath);
        }
        await this.cardService.deleteSource(file);
      });
    }

    let recentFile = this.recentFilesService.recentFiles[0];
    if (recentFile) {
      let recentFileUrl = `${recentFile.realmURL}${recentFile.filePath}`;

      this.operatorModeStateService.updateCodePath(new URL(recentFileUrl));
    } else {
      this.operatorModeStateService.updateCodePath(null);
    }

    await timeout(500); // task running message can be displayed long enough for the user to read it
    this.itemToDelete = undefined;
  });

  // dropTask will ignore any subsequent create file requests until the one in progress is done
  private createFile = dropTask(
    async (
      fileType: FileType,
      definitionClass?: {
        displayName: string;
        ref: ResolvedCodeRef;
      },
      sourceInstance?: CardDef,
    ) => {
      if (!this.createFileModal) {
        throw new Error(`bug: CreateFileModal not instantiated`);
      }
      this.isCreateModalOpen = true;
      let url = await this.createFileModal.createNewFile(
        fileType,
        this.realmURL,
        definitionClass,
        sourceInstance,
      );
      this.isCreateModalOpen = false;
      if (url) {
        this.operatorModeStateService.updateCodePath(url);
        this.setPreviewFormat('edit');
      }
    },
  );

  private async withTestWaiters<T>(cb: () => Promise<T>) {
    let token = waiter.beginAsync();
    try {
      let result = await cb();
      // only do this in test env--this makes sure that we also wait for any
      // interior card instance async as part of our ember-test-waiters
      if (isTesting()) {
        await this.cardService.cardsSettled();
      }
      return result;
    } finally {
      waiter.endAsync(token);
    }
  }

  private setupCreateFileModal = (createFileModal: CreateFileModal) => {
    this.createFileModal = createFileModal;
  };

  private setupCodeEditor = (updateCursorByName: (name: string) => void) => {
    this.updateCursorByName = updateCursorByName;
  };

  @action private openSearchResultInEditor(card: CardDef) {
    let codePath = new URL(card.id + '.json');
    this.operatorModeStateService.updateCodePath(codePath);
  }

  @action private setPreviewFormat(format: Format) {
    this.previewFormat = format;
  }

  @tracked private selectedAccordionItem: SelectedAccordionItem =
    'schema-editor';

  @action private selectAccordionItem(item: SelectedAccordionItem) {
    if (this.selectedAccordionItem === item) {
      this.selectedAccordionItem = null;
      return;
    }

    this.selectedAccordionItem = item;
  }

  get isReadOnly() {
    return !this.readyFile.realmSession.canWrite;
  }

  <template>
    <RealmInfoProvider @realmURL={{this.realmURL}}>
      <:ready as |realmInfo|>
        <div
          class='code-mode-background'
          style={{this.backgroundURLStyle realmInfo.backgroundURL}}
        ></div>
      </:ready>
    </RealmInfoProvider>
    <SubmodeLayout
      @onCardSelectFromSearch={{this.openSearchResultInEditor}}
      @hideAiAssistant={{true}}
    >
      <div
        class='code-mode'
        data-test-code-mode
        data-test-save-idle={{and
          (not this.sourceFileIsSaving)
          this.initiateAutoSaveTask.isIdle
        }}
      >
        <div class='code-mode-top-bar'>
          <CardURLBar
            @loadFileError={{this.loadFileError}}
            @resetLoadFileError={{this.resetLoadFileError}}
            @userHasDismissedError={{this.userHasDismissedURLError}}
            @dismissURLError={{this.dismissURLError}}
            @realmURL={{this.realmURL}}
          />
          <NewFileButton
            @onSelectNewFileType={{this.onSelectNewFileType}}
            @isCreateModalShown={{bool this.isCreateModalOpen}}
          />
        </div>
        <ResizablePanelGroup
          @orientation='horizontal'
          @onListPanelContextChange={{this.onListPanelContextChange}}
          class='columns'
          as |ResizablePanel ResizeHandle|
        >
          <ResizablePanel
            @defaultLengthFraction={{defaultPanelWidths.leftPanel}}
            @lengthPx={{this.panelWidths.leftPanel}}
          >
            <div class='column'>
              <ResizablePanelGroup
                @orientation='vertical'
                @onListPanelContextChange={{this.onFilePanelContextChange}}
                @reverseCollapse={{true}}
                as |VerticallyResizablePanel VerticallyResizeHandle|
              >
                <VerticallyResizablePanel
                  @defaultLengthFraction={{defaultPanelHeights.filePanel}}
                  @lengthPx={{this.panelHeights.filePanel}}
                >
                  <CodeSubmodeLeftPanelToggle
                    @fileView={{this.fileView}}
                    @setFileView={{this.setFileView}}
                    @isFileOpen={{this.isFileOpen}}
                    @selectedDeclaration={{this.selectedDeclaration}}
                  >
                    <:inspector>
                      {{#if this.isReady}}
                        <DetailPanel
                          @moduleContentsResource={{this.moduleContentsResource}}
                          @cardInstance={{this.card}}
                          @readyFile={{this.readyFile}}
                          @selectedDeclaration={{this.selectedDeclaration}}
                          @selectDeclaration={{this.selectDeclaration}}
                          @delete={{this.setItemToDelete}}
                          @goToDefinition={{this.goToDefinition}}
                          @createFile={{perform this.createFile}}
                          data-test-card-inspector-panel
                        />
                      {{/if}}
                    </:inspector>
                    <:browser>
                      <FileTree @realmURL={{this.realmURL}} />
                    </:browser>
                  </CodeSubmodeLeftPanelToggle>
                </VerticallyResizablePanel>
                <VerticallyResizeHandle />
                <VerticallyResizablePanel
                  @defaultLengthFraction={{defaultPanelHeights.recentPanel}}
                  @lengthPx={{this.panelHeights.recentPanel}}
                  @minLengthPx={{100}}
                >
                  <InnerContainer
                    class='recent-files'
                    as |InnerContainerContent InnerContainerHeader|
                  >
                    <InnerContainerHeader aria-label='Recent Files Header'>
                      Recent Files
                    </InnerContainerHeader>
                    <InnerContainerContent>
                      <RecentFiles />
                    </InnerContainerContent>
                  </InnerContainer>
                </VerticallyResizablePanel>
              </ResizablePanelGroup>
            </div>
          </ResizablePanel>
          <ResizeHandle />
          {{#if this.codePath}}
            <ResizablePanel
              @defaultLengthFraction={{defaultPanelWidths.codeEditorPanel}}
              @lengthPx={{this.panelWidths.codeEditorPanel}}
              @minLengthPx={{300}}
            >
              <InnerContainer>
                {{#if this.isReady}}
                  <CodeEditor
                    @file={{this.currentOpenFile}}
                    @moduleContentsResource={{this.moduleContentsResource}}
                    @selectedDeclaration={{this.selectedDeclaration}}
                    @saveSourceOnClose={{@saveSourceOnClose}}
                    @selectDeclaration={{this.selectDeclaration}}
                    @onFileSave={{this.onSourceFileSave}}
                    @onSetup={{this.setupCodeEditor}}
                    @isReadOnly={{this.isReadOnly}}
                  />

                  <CodeSubmodeEditorIndicator
                    @isSaving={{this.isSaving}}
                    @isReadOnly={{this.isReadOnly}}
                  />
                {{/if}}
              </InnerContainer>
            </ResizablePanel>
            <ResizeHandle />
            <ResizablePanel
              @defaultLengthFraction={{defaultPanelWidths.rightPanel}}
              @lengthPx={{this.panelWidths.rightPanel}}
            >
              <InnerContainer>
                {{#if this.isReady}}
                  {{#if this.isCardPreviewError}}
                    <div
                      class='preview-error-container'
                      data-test-file-incompatibility-message
                    >
                      <div class='preview-error-box'>
                        <div class='preview-error-text'>
                          Card Preview Error
                        </div>
                        <p>
                          {{this.fileIncompatibilityMessage}}
                        </p>

                        <hr class='preview-error' />

                        {{#each this.fileIncompatibilityErrors as |error|}}
                          <pre
                            class='preview-error'
                            data-test-card-preview-error
                          >{{error}}</pre>
                        {{/each}}
                      </div>
                    </div>
                  {{else if this.fileIncompatibilityMessage}}
                    <div
                      class='file-incompatible-message'
                      data-test-file-incompatibility-message
                    >
                      {{this.fileIncompatibilityMessage}}
                    </div>
                  {{else if this.selectedCardOrField.cardOrField}}
                    <Accordion as |A|>
                      <SchemaEditor
                        @file={{this.readyFile}}
                        @moduleContentsResource={{this.moduleContentsResource}}
                        @card={{this.selectedCardOrField.cardOrField}}
                        @cardTypeResource={{this.selectedCardOrField.cardType}}
                        @goToDefinition={{this.goToDefinition}}
                        as |SchemaEditorTitle SchemaEditorPanel|
                      >
                        <A.Item
                          class='accordion-item'
                          @contentClass='accordion-item-content'
                          @onClick={{fn
                            this.selectAccordionItem
                            'schema-editor'
                          }}
                          @isOpen={{eq
                            this.selectedAccordionItem
                            'schema-editor'
                          }}
                        >
                          <:title>
                            <SchemaEditorTitle />
                          </:title>
                          <:content>
                            <SchemaEditorPanel class='accordion-content' />
                          </:content>
                        </A.Item>
                      </SchemaEditor>
                    </Accordion>
                  {{else if this.moduleContentsResource.moduleError}}
                    <Accordion as |A|>
                      <A.Item
                        class='accordion-item'
                        @contentClass='accordion-item-content'
                        @onClick={{fn this.selectAccordionItem 'schema-editor'}}
                        @isOpen={{eq
                          this.selectedAccordionItem
                          'schema-editor'
                        }}
                      >
                        <:title>
                          <SchemaEditorTitle @hasModuleError={{true}} />
                        </:title>
                        <:content>
                          <SyntaxErrorDisplay
                            @syntaxErrors={{this.moduleContentsResource.moduleError.message}}
                          />
                        </:content>
                      </A.Item>
                    </Accordion>
                  {{else if this.card}}
                    <CardPreviewPanel
                      @card={{this.loadedCard}}
                      @realmURL={{this.realmURL}}
                      @format={{this.previewFormat}}
                      @setFormat={{this.setPreviewFormat}}
                      data-test-card-resource-loaded
                    />
                  {{/if}}
                {{/if}}
              </InnerContainer>
            </ResizablePanel>
          {{else}}
            <ResizablePanel
              @defaultLengthFraction={{defaultPanelWidths.emptyCodeModePanel}}
              @lengthPx={{this.panelWidths.emptyCodeModePanel}}
            >
              <InnerContainer class='empty-container' data-test-empty-code-mode>
                <File width='40' height='40' role='presentation' />
                <h3 class='choose-file-prompt'>
                  Choose a file on the left to open it
                </h3>
              </InnerContainer>
            </ResizablePanel>
          {{/if}}
        </ResizablePanelGroup>
      </div>
      {{#if this.itemToDelete}}
        <DeleteModal
          @itemToDelete={{this.itemToDelete}}
          @onConfirm={{perform this.delete}}
          @onCancel={{this.onCancelDelete}}
          @isDeleteRunning={{this.delete.isRunning}}
        />
      {{/if}}
      <CreateFileModal @onCreate={{this.setupCreateFileModal}} />
      <FromElseWhere @name='schema-editor-modal' />
    </SubmodeLayout>

    <style>
      :global(:root) {
        --code-mode-padding-top: calc(
          var(--submode-switcher-trigger-height) + (2 * (var(--boxel-sp)))
        );
        --code-mode-padding-bottom: calc(
          var(--search-sheet-closed-height) + (var(--boxel-sp))
        );
      }

      .code-mode {
        height: 100%;
        max-height: 100vh;
        left: 0;
        right: 0;
        padding: var(--code-mode-padding-top) var(--boxel-sp)
          var(--code-mode-padding-bottom);
        overflow: auto;
        flex: 1;
      }

      .code-mode-background {
        position: fixed;
        left: 0;
        right: 0;
        display: block;
        width: 100%;
        height: 100%;
        filter: blur(15px);
        background-size: cover;
      }

      .columns {
        display: flex;
        flex-direction: row;
        flex-shrink: 0;
        height: 100%;
      }

      .column {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        height: 100%;
      }

      .recent-files {
        background-color: var(--boxel-200);
      }

      .choose-file-prompt {
        margin: 0;
        padding: var(--boxel-sp);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .code-mode-top-bar {
        --code-mode-top-bar-left-offset: calc(
          var(--submode-switcher-width) + var(--boxel-sp)
        );

        position: absolute;
        top: 0;
        right: 0;
        left: var(--code-mode-top-bar-left-offset);
        padding: var(--boxel-sp);
        display: flex;
        z-index: 1;
      }

      .loading {
        margin: 40vh auto;
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
      }
      .empty-container {
        background-color: var(--boxel-light-100);
        align-items: center;
        justify-content: center;
      }
      .empty-container > :deep(svg) {
        --icon-color: var(--boxel-highlight);
      }
      .accordion-item :deep(.accordion-item-content) {
        overflow-y: auto;
      }
      .accordion-item:last-child {
        border-bottom: var(--boxel-border);
      }
      .accordion-content {
        padding: var(--boxel-sp-sm);
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
