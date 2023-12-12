import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
//@ts-expect-error cached type not available yet
import { cached, tracked } from '@glimmer/tracking';

import { dropTask, restartableTask, timeout, all } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import { Accordion } from '@cardstack/boxel-ui/components';

import {
  LoadingIndicator,
  ResizablePanelGroup,
} from '@cardstack/boxel-ui/components';
import type { PanelContext } from '@cardstack/boxel-ui/components';
import { and, not, bool, eq } from '@cardstack/boxel-ui/helpers';
import { CheckMark, File } from '@cardstack/boxel-ui/icons';

import {
  Deferred,
  isCardDocumentString,
  hasExecutableExtension,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import RecentFiles from '@cardstack/host/components/editor/recent-files';
import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';
import config from '@cardstack/host/config/environment';
import { getCard } from '@cardstack/host/resources/card-resource';
import { isReady, type FileResource } from '@cardstack/host/resources/file';
import {
  moduleContentsResource,
  isCardOrFieldDeclaration,
  type ModuleDeclaration,
  type State,
} from '@cardstack/host/resources/module-contents';
import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type MessageService from '@cardstack/host/services/message-service';
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
import SchemaEditor from './code-submode/schema-editor';
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
const { autoSaveDelayMs } = config;

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
  @service declare cardService: CardService;
  @service declare messageService: MessageService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare recentFilesService: RecentFilesService;
  @service declare loaderService: LoaderService;

  @tracked private loadFileError: string | null = null;
  @tracked private cardError: Error | undefined;
  @tracked private userHasDismissedURLError = false;
  @tracked private sourceFileIsSaving = false;
  @tracked private previewFormat: Format = 'isolated';
  @tracked private isCreateModalOpen = false;

  private hasUnsavedCardChanges = false;
  private panelWidths: PanelWidths;
  private panelHeights: PanelHeights;
  private updateCursorByDeclaration:
    | ((declaration: ModuleDeclaration) => void)
    | undefined;
  #currentCard: CardDef | undefined;

  private deleteModal: DeleteModal | undefined;
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

  private get fileIncompatibilityMessage() {
    // If file is incompatible
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

    // TODO: handle card preview errors (when json is valid but card returns error)
    // This code is never reached but is temporarily placed here to please linting
    // - a card runtime error will crash entire app
    // - a json error will be caught by incompatibleFile
    if (this.cardError) {
      return `card preview error ${this.cardError.message}`;
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

  @action private onModuleEdit(state: State, staleState: State) {
    let selectedDeclaration = this.selectedDeclaration;
    let editedDeclaration = state.declarations.find((d) => {
      return (
        d.path?.node?.body.loc.start.token ===
          selectedDeclaration?.path?.node?.body.loc.start.token &&
        d.path?.node?.body.loc.end.token ===
          selectedDeclaration?.path?.node?.body.loc.end.token
      );
    });
    if (editedDeclaration) {
      this.openDefinition(undefined, editedDeclaration.localName);
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
    return this.moduleContentsResource?.declarations.find((dec) => {
      return codeSelection
        ? dec.exportName === codeSelection || dec.localName === codeSelection
        : false;
    });
  }

  private get selectedDeclaration() {
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
    this.openDefinition(undefined, dec.localName);
  }

  @action
  openDefinition(
    codeRef: ResolvedCodeRef | undefined,
    localName: string | undefined,
  ) {
    this.operatorModeStateService.updateCodePathWithCodeSelection(
      codeRef,
      localName,
      () => this.updateCursorByDeclaration?.(this.selectedDeclaration!),
    );
  }

  private onCardChange = () => {
    this.initiateAutoSaveTask.perform();
  };

  private initiateAutoSaveTask = restartableTask(async () => {
    if (this.card) {
      this.hasUnsavedCardChanges = true;
      await timeout(autoSaveDelayMs);
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

  // dropTask will ignore any subsequent delete requests until the one in progress is done
  private delete = dropTask(async (card: CardDef) => {
    if (!card.id) {
      // the card isn't actually saved yet, so do nothing
      return;
    }
    if (!this.card) {
      throw new Error(`TODO: non-card instance deletes are not yet supported`);
    }

    if (!this.deleteModal) {
      throw new Error(`bug: DeleteModal not instantiated`);
    }
    let deferred: Deferred<void>;
    let isDeleteConfirmed = await this.deleteModal.confirmDelete(
      card,
      (d) => (deferred = d),
    );
    if (!isDeleteConfirmed) {
      return;
    }

    await this.withTestWaiters(async () => {
      await this.operatorModeStateService.deleteCard(card);
      deferred!.fulfill();
    });

    let recentFile = this.recentFilesService.recentFiles[0];

    if (recentFile) {
      let recentFileUrl = `${recentFile.realmURL}${recentFile.filePath}`;

      this.operatorModeStateService.updateCodePath(new URL(recentFileUrl));
    } else {
      this.operatorModeStateService.updateCodePath(null);
    }
  });

  // dropTask will ignore any subsequent create file requests until the one in progress is done
  private createFile = dropTask(
    async (
      fileType: FileType,
      definitionClass?: {
        displayName: string;
        ref: ResolvedCodeRef;
      },
    ) => {
      if (!this.createFileModal) {
        throw new Error(`bug: CreateFileModal not instantiated`);
      }
      this.isCreateModalOpen = true;
      let url = await this.createFileModal.createNewFile(
        fileType,
        this.realmURL,
        definitionClass,
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

  private setupDeleteModal = (deleteModal: DeleteModal) => {
    this.deleteModal = deleteModal;
  };

  private setupCreateFileModal = (createFileModal: CreateFileModal) => {
    this.createFileModal = createFileModal;
  };

  private setupCodeEditor = (
    updateCursorByDeclaration: (declaration: ModuleDeclaration) => void,
  ) => {
    this.updateCursorByDeclaration = updateCursorByDeclaration;
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

  <template>
    <RealmInfoProvider @realmURL={{this.realmURL}}>
      <:ready as |realmInfo|>
        <div
          class='code-mode-background'
          style={{this.backgroundURLStyle realmInfo.backgroundURL}}
        ></div>
      </:ready>
    </RealmInfoProvider>
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
    <SubmodeLayout @onCardSelectFromSearch={{this.openSearchResultInEditor}}>
      <div
        class='code-mode'
        data-test-code-mode
        data-test-save-idle={{and
          (not this.sourceFileIsSaving)
          this.initiateAutoSaveTask.isIdle
        }}
      >
        <ResizablePanelGroup
          @orientation='horizontal'
          @onListPanelContextChange={{this.onListPanelContextChange}}
          class='columns'
          as |ResizablePanel|
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
                as |VerticallyResizablePanel|
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
                          @delete={{perform this.delete}}
                          @openDefinition={{this.openDefinition}}
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
                  />
                {{/if}}
                <div class='save-indicator {{if this.isSaving "visible"}}'>
                  {{#if this.isSaving}}
                    <span class='saving-msg'>
                      Now Saving
                    </span>
                    <span class='save-spinner'>
                      <span class='save-spinner-inner'>
                        <LoadingIndicator />
                      </span>
                    </span>
                  {{else}}
                    <span data-test-saved class='saved-msg'>
                      Saved
                    </span>
                    <CheckMark width='27' height='27' />
                  {{/if}}
                </div>
              </InnerContainer>
            </ResizablePanel>
            <ResizablePanel
              @defaultLengthFraction={{defaultPanelWidths.rightPanel}}
              @lengthPx={{this.panelWidths.rightPanel}}
            >
              <InnerContainer>
                {{#if this.isReady}}
                  {{#if this.fileIncompatibilityMessage}}
                    <div
                      class='file-incompatible-message'
                      data-test-file-incompatibility-message
                    >
                      {{this.fileIncompatibilityMessage}}
                    </div>
                  {{else if this.card}}
                    <CardPreviewPanel
                      @card={{this.loadedCard}}
                      @realmURL={{this.realmURL}}
                      @format={{this.previewFormat}}
                      @setFormat={{this.setPreviewFormat}}
                      data-test-card-resource-loaded
                    />
                  {{else if this.selectedCardOrField}}
                    <Accordion as |A|>
                      <SchemaEditor
                        @file={{this.readyFile}}
                        @moduleContentsResource={{this.moduleContentsResource}}
                        @card={{this.selectedCardOrField.cardOrField}}
                        @cardTypeResource={{this.selectedCardOrField.cardType}}
                        @openDefinition={{this.openDefinition}}
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
      <DeleteModal @onCreate={{this.setupDeleteModal}} />
      <CreateFileModal @onCreate={{this.setupCreateFileModal}} />
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
        z-index: 1;
        padding: var(--code-mode-padding-top) var(--boxel-sp)
          var(--code-mode-padding-bottom);
        overflow: auto;
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
        --code-mode-top-bar-padding-left: calc(
          var(--submode-switcher-width) + (var(--boxel-sp) * 2)
        );

        position: absolute;
        top: 0;
        right: 0;
        padding: var(--boxel-sp) var(--boxel-sp) 0
          var(--code-mode-top-bar-padding-left);
        display: flex;
        z-index: 2;
      }

      .loading {
        margin: 40vh auto;
      }

      .save-indicator {
        --icon-color: var(--boxel-highlight);
        position: absolute;
        display: flex;
        align-items: center;
        height: 2.5rem;
        width: 140px;
        bottom: 0;
        right: 0;
        background-color: var(--boxel-200);
        padding: 0 var(--boxel-sp-xxs) 0 var(--boxel-sp-sm);
        border-top-left-radius: var(--boxel-border-radius);
        font: var(--boxel-font-sm);
        font-weight: 500;
        transform: translateX(140px);
        transition: all var(--boxel-transition);
        transition-delay: 5s;
      }
      .save-indicator.visible {
        transform: translateX(0px);
        transition-delay: 0s;
      }
      .save-spinner {
        display: inline-block;
        position: relative;
      }
      .save-spinner-inner {
        display: inline-block;
        position: absolute;
        top: -7px;
      }
      .saving-msg {
        margin-right: var(--boxel-sp-sm);
      }
      .saved-msg {
        margin-right: var(--boxel-sp-xxs);
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
    </style>
  </template>
}
