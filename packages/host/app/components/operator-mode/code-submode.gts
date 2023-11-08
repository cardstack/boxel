import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
//@ts-expect-error cached type not available yet
import { cached, tracked } from '@glimmer/tracking';

import {
  dropTask,
  task,
  restartableTask,
  timeout,
  all,
} from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import { use, resource } from 'ember-resources';
import { Position } from 'monaco-editor';

import {
  Button,
  LoadingIndicator,
  ResizablePanelGroup,
} from '@cardstack/boxel-ui/components';
import type { PanelContext } from '@cardstack/boxel-ui/components';

import { cn, and, not } from '@cardstack/boxel-ui/helpers';
import { CheckMark, File } from '@cardstack/boxel-ui/icons';

import {
  type SingleCardDocument,
  RealmPaths,
  Deferred,
  logger,
  isCardDocumentString,
  isSingleCardDocument,
  hasExecutableExtension,
} from '@cardstack/runtime-common';

import { type ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';

import RecentFiles from '@cardstack/host/components/editor/recent-files';
import SchemaEditorColumn from '@cardstack/host/components/operator-mode/schema-editor-column';
import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';
import config from '@cardstack/host/config/environment';

import monacoModifier from '@cardstack/host/modifiers/monaco';

import {
  isReady,
  type Ready,
  type FileResource,
} from '@cardstack/host/resources/file';

import {
  moduleContentsResource,
  isCardOrFieldDeclaration,
  type ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';

import type CardService from '@cardstack/host/services/card-service';

import type LoaderService from '@cardstack/host/services/loader-service';

import type MessageService from '@cardstack/host/services/message-service';
import type MonacoService from '@cardstack/host/services/monaco-service';
import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import type { FileView } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RecentFilesService from '@cardstack/host/services/recent-files-service';

import { CardDef } from 'https://cardstack.com/base/card-api';

import FileTree from '../editor/file-tree';

import BinaryFileInfo from './binary-file-info';
import CardPreviewPanel from './card-preview-panel';
import CardURLBar from './card-url-bar';
import DeleteModal from './delete-modal';
import DetailPanel from './detail-panel';
import SubmodeLayout from './submode-layout';
import NewFileButton from './new-file-button';

import { getCard } from '@cardstack/host/resources/card-resource';

interface Signature {
  Args: {
    saveSourceOnClose: (url: URL, content: string) => void;
    saveCardOnClose: (card: CardDef) => void;
  };
}
const log = logger('component:code-submode');
const { autoSaveDelayMs } = config;

type PanelWidths = {
  rightPanel: string;
  codeEditorPanel: string;
  leftPanel: string;
  emptyCodeModePanel: string;
};

type PanelHeights = {
  filePanel: string;
  recentPanel: string;
};

const CodeModePanelWidths = 'code-mode-panel-widths';
const defaultPanelWidths: PanelWidths = {
  leftPanel: 'var(--operator-mode-left-column)',
  codeEditorPanel: '48%',
  rightPanel: '32%',
  emptyCodeModePanel: '80%',
};

const CodeModePanelHeights = 'code-mode-panel-heights';
const defaultPanelHeights: PanelHeights = {
  filePanel: '60%',
  recentPanel: '40%',
};

const cardEditorSaveTimes = new Map<string, number>();

const waiter = buildWaiter('code-submode:waiter');

export default class CodeSubmode extends Component<Signature> {
  @service declare monacoService: MonacoService;
  @service declare cardService: CardService;
  @service declare messageService: MessageService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare recentFilesService: RecentFilesService;
  @service declare loaderService: LoaderService;

  @tracked private loadFileError: string | null = null;
  @tracked private maybeMonacoSDK: MonacoSDK | undefined;
  @tracked private cardError: Error | undefined;
  @tracked private userHasDismissedURLError = false;

  private hasUnsavedSourceChanges = false;
  private hasUnsavedCardChanges = false;
  private panelWidths: PanelWidths;
  private panelHeights: PanelHeights;
  #currentCard: CardDef | undefined;

  private deleteModal: DeleteModal | undefined;
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

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.operatorModeStateService.subscribeToOpenFileStateChanges(this);
    this.panelWidths = localStorage.getItem(CodeModePanelWidths)
      ? // @ts-ignore Type 'null' is not assignable to type 'string'
        JSON.parse(localStorage.getItem(CodeModePanelWidths))
      : defaultPanelWidths;

    this.panelHeights = localStorage.getItem(CodeModePanelHeights)
      ? // @ts-ignore Type 'null' is not assignable to type 'string'
        JSON.parse(localStorage.getItem(CodeModePanelHeights))
      : defaultPanelHeights;

    registerDestructor(this, () => {
      // destructor functons are called synchronously. in order to save,
      // which is async, we leverage an EC task that is running in a
      // parent component (EC task lifetimes are bound to their context)
      // that is not being destroyed.
      if (this.codePath && this.hasUnsavedSourceChanges) {
        // we let the monaco changes win if there are unsaved changes both
        // monaco and the card preview (an arbitrary choice)
        let monacoContent = this.monacoService.getMonacoContent();
        if (monacoContent) {
          this.args.saveSourceOnClose(this.codePath, monacoContent);
        }
      } else if (this.hasUnsavedCardChanges && this.#currentCard) {
        // we use this.#currentCard here instead of this.card because in
        // the destructor we no longer have access to resources bound to
        // this component since they are destroyed first, so this.#currentCard
        // is something we copy from the card resource when it changes so that
        // we have access to it in the destructor
        this.args.saveCardOnClose(this.#currentCard);
      }
      this.operatorModeStateService.unsubscribeFromOpenFileStateChanges(this);
    });
    this.loadMonaco.perform();
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

  get fileView() {
    return this.operatorModeStateService.state.fileView;
  }

  get fileViewTitle() {
    return this.isFileTreeShowing ? 'File Browser' : 'Inheritance';
  }

  private get realmURL() {
    return this.operatorModeStateService.realmURL;
  }

  private get isLoading() {
    return (
      this.loadMonaco.isRunning ||
      this.currentOpenFile?.state === 'loading' ||
      this.moduleContentsResource?.isLoading
    );
  }

  private get isReady() {
    return this.maybeMonacoSDK && isReady(this.currentOpenFile);
  }

  private get isIncompatibleFile() {
    return this.readyFile.isBinary || this.isNonCardJson;
  }

  private get isModule() {
    return (
      hasExecutableExtension(this.readyFile.name) && !this.isIncompatibleFile
    );
  }

  private get hasCardDefOrFieldDef() {
    return this.declarations.some((d) => isCardOrFieldDeclaration(d));
  }

  private get isSelectedItemIncompatibleWithSchemaEditor() {
    if (!this.selectedDeclaration) {
      return;
    }
    return !isCardOrFieldDeclaration(this.selectedDeclaration);
  }

  private get isNonCardJson() {
    return (
      this.readyFile.name.endsWith('.json') &&
      !isCardDocumentString(this.readyFile.content)
    );
  }

  private get emptyOrNotFound() {
    return !this.codePath || this.currentOpenFile?.state === 'not-found';
  }

  private get fileIncompatibilityMessage() {
    // If file is incompatible
    if (this.isIncompatibleFile) {
      return `No tools are available to be used with this file type. Choose a file representing a card instance or module.`;
    }

    // If the module is incompatible
    if (this.isModule) {
      if (!this.hasCardDefOrFieldDef) {
        return `No tools are available to be used with these file contents. Choose a module that has a card or field definition inside of it.`;
      } else if (this.isSelectedItemIncompatibleWithSchemaEditor) {
        return `No tools are available for the selected item: ${this.selectedDeclaration?.type} "${this.selectedDeclaration?.localName}". Select a card or field definition in the inspector.`;
      }
    }

    // If rhs doesn't handle any case but we can't capture the error
    if (!this.card && !this.selectedCardOrField) {
      return "No tools are available to inspect this file or it's contents.";
    }

    // TODO: handle card preview errors (when json is valid but card returns error)
    // This code is never reached but is temporarily placed here to please linting
    // - a card runtime error will crash entire app
    // - a json error will be caught by incompatibleFile
    if (this.cardError) {
      return `card preview error ${this.cardError.message}`;
    }

    return null;
  }

  private loadMonaco = task(async () => {
    this.maybeMonacoSDK = await this.monacoService.getMonacoContext();
  });

  private get readyFile() {
    if (isReady(this.currentOpenFile)) {
      return this.currentOpenFile;
    }
    throw new Error(
      `cannot access file contents ${this.codePath} before file is open`,
    );
  }

  private get monacoSDK() {
    if (this.maybeMonacoSDK) {
      return this.maybeMonacoSDK;
    }
    throw new Error(`cannot use monaco SDK before it has loaded`);
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

  private get currentOpenFile() {
    return this.operatorModeStateService.openFile.current;
  }

  @use private moduleContentsResource = resource(() => {
    if (isReady(this.currentOpenFile)) {
      let f: Ready = this.currentOpenFile;
      if (hasExecutableExtension(f.url)) {
        return moduleContentsResource(this, () => ({
          executableFile: f,
        }));
      }
    }
    return;
  });

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

  @action
  private initializeMonacoCursorPosition() {
    if (this.selectedDeclaration?.path?.node.loc) {
      let { start } = this.selectedDeclaration.path.node.loc;
      this.monacoService.updateCursorPosition(
        new Position(start.line, start.column),
      );
    }
  }

  @action
  private updateMonacoCursorPositionByDeclaration(
    declaration: ModuleDeclaration,
  ) {
    if (declaration.path?.node.loc) {
      let { start, end } = declaration.path?.node.loc;
      let currentCursorPosition = this.monacoService.getCursorPosition();
      if (
        currentCursorPosition &&
        (currentCursorPosition.lineNumber < start.line ||
          currentCursorPosition.lineNumber > end.line)
      ) {
        this.monacoService.updateCursorPosition(
          new Position(start.line, start.column),
        );
      }
    }
  }

  private get declarations() {
    return this.moduleContentsResource?.declarations || [];
  }

  private get _selectedDeclaration() {
    return this.moduleContentsResource?.declarations.find((dec) => {
      // when refreshing module,
      // checks localName from serialized url
      if (
        this.operatorModeStateService.state.codeSelection.localName ===
        dec.localName
      ) {
        return true;
      }

      // when opening new definition,
      // checks codeRef from serialized url
      let codeRef = this.operatorModeStateService.state.codeSelection?.codeRef;
      if (isCardOrFieldDeclaration(dec) && codeRef) {
        return (
          dec.exportedAs === codeRef.name || dec.localName === codeRef.name
        );
      }
      return false;
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
    return;
  }

  @action
  private selectDeclarationByMonacoCursorPosition(position: Position) {
    let declarationCursorOn = this.declarations.find(
      (declaration: ModuleDeclaration) => {
        if (declaration.path?.node.loc) {
          let { start, end } = declaration.path?.node.loc;
          return (
            position.lineNumber >= start.line && position.lineNumber <= end.line
          );
        }
        return false;
      },
    );

    if (
      declarationCursorOn &&
      declarationCursorOn !== this.selectedDeclaration
    ) {
      this.selectDeclaration(declarationCursorOn);
    }
  }

  @action
  private selectDeclaration(dec: ModuleDeclaration) {
    this.operatorModeStateService.updateLocalNameSelection(dec.localName);
    this.updateMonacoCursorPositionByDeclaration(dec);
  }

  @action
  openDefinition(moduleHref: string, codeRef: ResolvedCodeRef | undefined) {
    if (codeRef) {
      this.operatorModeStateService.updateCodeRefSelection(codeRef);
    }
    this.operatorModeStateService.updateCodePath(new URL(moduleHref));
  }

  private onCardChange = () => {
    this.doWhenCardChanges.perform();
  };

  private doWhenCardChanges = restartableTask(async () => {
    if (this.card) {
      this.hasUnsavedCardChanges = true;
      await timeout(autoSaveDelayMs);
      cardEditorSaveTimes.set(this.card.id, Date.now());
      await this.saveCard.perform(this.card);
      this.hasUnsavedCardChanges = false;
    }
  });

  private saveCard = restartableTask(async (card: CardDef) => {
    // these saves can happen so fast that we'll make sure to wait at
    // least 500ms for human consumption
    await all([this.cardService.saveModel(this, card), timeout(500)]);
  });

  private contentChangedTask = restartableTask(async (content: string) => {
    this.hasUnsavedSourceChanges = true;
    // note that there is already a debounce in the monaco modifier so there
    // is no need to delay further for auto save initiation
    if (
      !isReady(this.currentOpenFile) ||
      content === this.currentOpenFile?.content
    ) {
      return;
    }

    let isJSON = this.currentOpenFile.name.endsWith('.json');
    let validJSON = isJSON && this.safeJSONParse(content);
    // Here lies the difference in how json files and other source code files
    // are treated during editing in the code editor
    if (validJSON && isSingleCardDocument(validJSON)) {
      // writes json instance but doesn't update state of the file resource
      // relies on message service subscription to update state
      await this.saveFileSerializedCard.perform(validJSON);
    } else if (!isJSON || validJSON) {
      // writes source code and non-card instance valid JSON,
      // then updates the state of the file resource
      this.writeSourceCodeToFile(this.currentOpenFile, content);
      this.waitForSourceCodeWrite.perform();
    }
    this.hasUnsavedSourceChanges = false;
  });

  // these saves can happen so fast that we'll make sure to wait at
  // least 500ms for human consumption
  private waitForSourceCodeWrite = restartableTask(async () => {
    if (isReady(this.currentOpenFile)) {
      await all([this.currentOpenFile.writing, timeout(500)]);
    }
  });

  // We use this to write non-cards to the realm--so it doesn't make
  // sense to go thru the card-service for this
  private writeSourceCodeToFile(file: FileResource, content: string) {
    if (file.state !== 'ready') {
      throw new Error('File is not ready to be written to');
    }

    // flush the loader so that the preview (when card instance data is shown), or schema editor (when module code is shown) gets refreshed on save
    return file.write(content, true);
  }

  private safeJSONParse(content: string) {
    try {
      return JSON.parse(content);
    } catch (err) {
      log.warn(
        `content for ${this.codePath} is not valid JSON, skipping write`,
      );
      return;
    }
  }

  private saveFileSerializedCard = task(async (json: SingleCardDocument) => {
    if (!this.codePath) {
      return;
    }
    let realmPath = new RealmPaths(this.cardService.defaultURL);
    let url = realmPath.fileURL(this.codePath.href.replace(/\.json$/, ''));
    let realmURL = this.readyFile.realmURL;
    if (!realmURL) {
      throw new Error(`cannot determine realm for ${this.codePath}`);
    }

    let doc = this.monacoService.reverseFileSerialization(
      json,
      url.href,
      realmURL,
    );
    let card: CardDef | undefined;
    try {
      card = await this.cardService.createFromSerialized(doc.data, doc, url);
    } catch (e) {
      // TODO probably we should show a message in the UI that the card
      // instance JSON is not actually a valid card
      console.error(
        'JSON is not a valid card--TODO this should be an error message in the code editor',
      );
      return;
    }

    try {
      // these saves can happen so fast that we'll make sure to wait at
      // least 500ms for human consumption
      await all([this.cardService.saveModel(this, card), timeout(500)]);
    } catch (e) {
      console.error('Failed to save single card document', e);
    }
  });

  private get language(): string | undefined {
    if (this.codePath) {
      const editorLanguages = this.monacoSDK.languages.getLanguages();
      let extension = '.' + this.codePath.href.split('.').pop();
      let language = editorLanguages.find((lang) =>
        lang.extensions?.find((ext) => ext === extension),
      );
      return language?.id ?? 'plaintext';
    }
    return undefined;
  }

  private get isSaving() {
    return (
      this.waitForSourceCodeWrite.isRunning ||
      this.saveFileSerializedCard.isRunning ||
      this.saveCard.isRunning
    );
  }

  @action
  private onListPanelContextChange(listPanelContext: PanelContext[]) {
    this.panelWidths.leftPanel = listPanelContext[0]?.length;
    this.panelWidths.codeEditorPanel = listPanelContext[1]?.length;
    this.panelWidths.rightPanel = listPanelContext[2]?.length;

    localStorage.setItem(CodeModePanelWidths, JSON.stringify(this.panelWidths));
  }

  @action
  private onFilePanelContextChange(filePanelContext: PanelContext[]) {
    this.panelHeights.filePanel = filePanelContext[0]?.length;
    this.panelHeights.recentPanel = filePanelContext[1]?.length;

    localStorage.setItem(
      CodeModePanelHeights,
      JSON.stringify(this.panelHeights),
    );
  }

  private get isFileTreeShowing() {
    return this.fileView === 'browser' || this.emptyOrNotFound;
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

  @action private openSearchResultInEditor(card: CardDef) {
    let codePath = new URL(card.id + '.json');
    this.operatorModeStateService.updateCodePath(codePath);
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
      <NewFileButton />
    </div>
    <SubmodeLayout @onCardSelectFromSearch={{this.openSearchResultInEditor}}>
      <div
        class='code-mode'
        data-test-code-mode
        data-test-save-idle={{and
          this.contentChangedTask.isIdle
          this.doWhenCardChanges.isIdle
        }}
      >
        <ResizablePanelGroup
          @orientation='horizontal'
          @onListPanelContextChange={{this.onListPanelContextChange}}
          class='columns'
          as |ResizablePanel|
        >
          <ResizablePanel
            @defaultLength={{defaultPanelWidths.leftPanel}}
            @length='var(--operator-mode-left-column)'
          >
            <div class='column'>
              <ResizablePanelGroup
                @orientation='vertical'
                @onListPanelContextChange={{this.onFilePanelContextChange}}
                @reverseCollapse={{true}}
                as |VerticallyResizablePanel|
              >
                <VerticallyResizablePanel
                  @defaultLength={{defaultPanelHeights.filePanel}}
                  @length={{this.panelHeights.filePanel}}
                >

                  {{! Move each container and styles to separate component }}
                  <div
                    class='inner-container file-view
                      {{if this.isFileTreeShowing "file-browser"}}'
                  >
                    <header
                      class='file-view__header'
                      aria-label={{this.fileViewTitle}}
                      data-test-file-view-header
                    >
                      <Button
                        @disabled={{this.emptyOrNotFound}}
                        @kind={{if
                          (not this.isFileTreeShowing)
                          'primary-dark'
                          'secondary'
                        }}
                        @size='extra-small'
                        class={{cn
                          'file-view__header-btn'
                          active=(not this.isFileTreeShowing)
                        }}
                        {{on 'click' (fn this.setFileView 'inheritance')}}
                        data-test-inheritance-toggle
                      >
                        Inspector</Button>
                      <Button
                        @kind={{if
                          this.isFileTreeShowing
                          'primary-dark'
                          'secondary'
                        }}
                        @size='extra-small'
                        class={{cn
                          'file-view__header-btn'
                          active=this.isFileTreeShowing
                        }}
                        {{on 'click' (fn this.setFileView 'browser')}}
                        data-test-file-browser-toggle
                      >
                        File Tree</Button>
                    </header>
                    <section class='inner-container__content'>
                      {{#if this.isFileTreeShowing}}
                        <FileTree @realmURL={{this.realmURL}} />
                      {{else}}
                        {{#if this.isReady}}
                          <DetailPanel
                            @cardInstance={{this.card}}
                            @readyFile={{this.readyFile}}
                            @selectedDeclaration={{this.selectedDeclaration}}
                            @declarations={{this.declarations}}
                            @selectDeclaration={{this.selectDeclaration}}
                            @delete={{perform this.delete}}
                            @openDefinition={{this.openDefinition}}
                            data-test-card-inheritance-panel
                          />
                        {{/if}}
                      {{/if}}
                    </section>
                  </div>
                </VerticallyResizablePanel>
                <VerticallyResizablePanel
                  @defaultLength={{defaultPanelHeights.recentPanel}}
                  @length={{this.panelHeights.recentPanel}}
                  @minLength='100px'
                >
                  <aside class='inner-container recent-files'>
                    <header
                      class='inner-container__header'
                      aria-label='Recent Files Header'
                    >
                      Recent Files
                    </header>
                    <section class='inner-container__content'>
                      <RecentFiles />
                    </section>
                  </aside>
                </VerticallyResizablePanel>
              </ResizablePanelGroup>
            </div>
          </ResizablePanel>
          {{#if this.codePath}}
            <ResizablePanel
              @defaultLength={{defaultPanelWidths.codeEditorPanel}}
              @length={{this.panelWidths.codeEditorPanel}}
              @minLength='300px'
            >
              <div class='inner-container'>
                {{#if this.isReady}}
                  {{#if this.readyFile.isBinary}}
                    <BinaryFileInfo @readyFile={{this.readyFile}} />
                  {{else}}
                    <div
                      class='monaco-container'
                      data-test-editor
                      {{monacoModifier
                        content=this.readyFile.content
                        contentChanged=(perform this.contentChangedTask)
                        monacoSDK=this.monacoSDK
                        language=this.language
                        initializeCursorPosition=this.initializeMonacoCursorPosition
                        onCursorPositionChange=this.selectDeclarationByMonacoCursorPosition
                      }}
                    ></div>
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
                {{else if this.isLoading}}
                  <div class='loading'>
                    <LoadingIndicator />
                  </div>
                {{/if}}
              </div>
            </ResizablePanel>
            <ResizablePanel
              @defaultLength={{defaultPanelWidths.rightPanel}}
              @length={{this.panelWidths.rightPanel}}
            >
              <div class='inner-container'>
                {{#if this.isLoading}}
                  <div class='loading'>
                    <LoadingIndicator />
                  </div>
                {{else if this.isReady}}
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
                      data-test-card-resource-loaded
                    />
                  {{else if this.selectedCardOrField}}
                    <SchemaEditorColumn
                      @file={{this.readyFile}}
                      @card={{this.selectedCardOrField.cardOrField}}
                      @cardTypeResource={{this.selectedCardOrField.cardType}}
                      @openDefinition={{this.openDefinition}}
                    />
                  {{/if}}
                {{/if}}
              </div>
            </ResizablePanel>
          {{else}}
            <ResizablePanel
              @defaultLength={{defaultPanelWidths.emptyCodeModePanel}}
              @length={{this.panelWidths.emptyCodeModePanel}}
            >
              <div
                class='inner-container inner-container--empty'
                data-test-empty-code-mode
              >
                <File width='40' height='40' role='presentation' />
                <h3 class='choose-file-prompt'>
                  Choose a file on the left to open it
                </h3>
              </div>
            </ResizablePanel>
          {{/if}}
        </ResizablePanelGroup>
      </div>
      <DeleteModal @onCreate={{this.setupDeleteModal}} />
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

      .inner-container {
        height: 100%;
        position: relative;
        display: flex;
        flex-direction: column;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        box-shadow: var(--boxel-deep-box-shadow);
        overflow: hidden;
      }

      .inner-container.recent-files {
        background-color: var(--boxel-200);
      }

      .inner-container__header {
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .inner-container__content {
        position: relative;
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs) var(--boxel-sp-sm);
        overflow-y: auto;
        height: 100%;
      }
      .inner-container--empty {
        background-color: var(--boxel-light-100);
        align-items: center;
        justify-content: center;
      }
      .inner-container--empty > :deep(svg) {
        --icon-color: var(--boxel-highlight);
      }

      .file-view {
        background-color: var(--boxel-200);
      }

      .choose-file-prompt {
        margin: 0;
        padding: var(--boxel-sp);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .file-view__header {
        display: flex;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-200);
      }
      .file-view__header-btn {
        --boxel-button-border: 1px solid var(--boxel-400);
        --boxel-button-font: 700 var(--boxel-font-xs);
        --boxel-button-letter-spacing: var(--boxel-lsp-xs);
        --boxel-button-min-width: 6rem;
        --boxel-button-padding: 0;
        border-radius: var(--boxel-border-radius);
        flex: 1;
      }
      .file-view__header-btn:hover:not(:disabled) {
        border-color: var(--boxel-dark);
      }
      .file-view__header-btn.active {
        border-color: var(--boxel-dark);
        --boxel-button-text-color: var(--boxel-highlight);
      }

      .file-view.file-browser .inner-container__content {
        background: var(--boxel-light);
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

      .monaco-container {
        height: 100%;
        min-height: 100%;
        width: 100%;
        min-width: 100%;
        padding: var(--boxel-sp) 0;
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
    </style>
  </template>
}
