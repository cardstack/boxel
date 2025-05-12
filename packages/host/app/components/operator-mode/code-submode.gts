import { registerDestructor } from '@ember/destroyable';
import { hash } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask, timeout } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import FromElseWhere from 'ember-elsewhere/components/from-elsewhere';

import { consume, provide } from 'ember-provide-consume-context';
import window from 'ember-window-mock';

import { ResizablePanelGroup } from '@cardstack/boxel-ui/components';
import { not, bool } from '@cardstack/boxel-ui/helpers';
import { File } from '@cardstack/boxel-ui/icons';

import {
  identifyCard,
  isCardDocumentString,
  isResolvedCodeRef,
  hasExecutableExtension,
  RealmPaths,
  PermissionsContextName,
  GetCardContextName,
  CodeRef,
  type ResolvedCodeRef,
  type getCard,
} from '@cardstack/runtime-common';
import { isEquivalentBodyPosition } from '@cardstack/runtime-common/schema-analysis-plugin';

import RecentFiles from '@cardstack/host/components/editor/recent-files';
import CodeSubmodeEditorIndicator from '@cardstack/host/components/operator-mode/code-submode/editor-indicator';
import RhsPanel from '@cardstack/host/components/operator-mode/code-submode/rhs-panel';

import consumeContext from '@cardstack/host/helpers/consume-context';
import { isReady, type FileResource } from '@cardstack/host/resources/file';
import {
  isCardOrFieldDeclaration,
  moduleContentsResource,
  type ModuleDeclaration,
  type State as ModuleState,
  findDeclarationByName,
} from '@cardstack/host/resources/module-contents';
import type CardService from '@cardstack/host/services/card-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type { FileView } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';
import type SpecPanelService from '@cardstack/host/services/spec-panel-service';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';
import { type SpecType } from 'https://cardstack.com/base/spec';

import {
  CodeModePanelWidths,
  CodeModePanelHeights,
} from '../../utils/local-storage-keys';
import FileTree from '../editor/file-tree';

import AttachFileModal from './attach-file-modal';
import CardURLBar from './card-url-bar';
import CodeEditor from './code-editor';
import InnerContainer from './code-submode/inner-container';
import CodeSubmodeLeftPanelToggle from './code-submode/left-panel-toggle';
import CreateFileModal, { type FileType } from './create-file-modal';
import DeleteModal from './delete-modal';
import DetailPanel from './detail-panel';
import NewFileButton from './new-file-button';
import SubmodeLayout from './submode-layout';

interface Signature {
  Args: {
    saveSourceOnClose: (url: URL, content: string) => void;
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

const defaultLeftPanelWidth =
  ((14.0 * parseFloat(getComputedStyle(document.documentElement).fontSize)) /
    (document.documentElement.clientWidth - 40 - 36)) *
  100;
const defaultPanelWidths: PanelWidths = {
  // 14rem as a fraction of the layout width
  leftPanel: defaultLeftPanelWidth,
  codeEditorPanel: (100 - defaultLeftPanelWidth) / 2,
  rightPanel: (100 - defaultLeftPanelWidth) / 2,
  emptyCodeModePanel: 100 - defaultLeftPanelWidth,
};

const ApproximateRecentPanelDefaultPercentage =
  ((43 + 40 * 3.5) / (document.documentElement.clientHeight - 140)) * 100; // room for about 3.5 recent files
const defaultPanelHeights: PanelHeights = {
  filePanel: 100 - ApproximateRecentPanelDefaultPercentage,
  recentPanel: ApproximateRecentPanelDefaultPercentage,
};

const waiter = buildWaiter('code-submode:waiter');

function urlToFilename(url: URL) {
  if (url) {
    return decodeURIComponent(url.href?.split('/').pop() ?? '');
  }
  return undefined;
}

export default class CodeSubmode extends Component<Signature> {
  @consume(GetCardContextName) private declare getCard: getCard;

  @service private declare cardService: CardService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @service private declare recentFilesService: RecentFilesService;
  @service private declare environmentService: EnvironmentService;
  @service private declare realm: RealmService;
  @service private declare loaderService: LoaderService;
  @service private declare specPanelService: SpecPanelService;

  @tracked private loadFileError: string | null = null;
  @tracked private userHasDismissedURLError = false;
  @tracked private sourceFileIsSaving = false;
  @tracked private previewFormat: Format = 'isolated';
  @tracked private isCreateModalOpen = false;
  @tracked private itemToDelete: CardDef | URL | null | undefined;
  @tracked private cardResource: ReturnType<getCard> | undefined;

  private defaultPanelWidths: PanelWidths;
  private defaultPanelHeights: PanelHeights;
  private updateCursorByName:
    | ((name: string, fieldName?: string) => void)
    | undefined;

  private createFileModal: CreateFileModal | undefined;
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

    let persistedDefaultPanelWidths = window.localStorage.getItem(
      CodeModePanelWidths,
    )
      ? // @ts-ignore Type 'null' is not assignable to type 'string'
        JSON.parse(window.localStorage.getItem(CodeModePanelWidths))
      : null;
    let persistedDefaultPanelHeights = window.localStorage.getItem(
      CodeModePanelHeights,
    )
      ? // @ts-ignore Type 'null' is not assignable to type 'string'
        JSON.parse(window.localStorage.getItem(CodeModePanelHeights))
      : null;
    let sum = (obj: Record<string, number>) =>
      Object.values(obj).reduce(
        (sum, value) => sum + (value ? Number(value.toFixed(0)) : 0),
        0,
      );

    this.defaultPanelWidths =
      persistedDefaultPanelWidths &&
      sum({
        ...persistedDefaultPanelWidths,
        emptyCodeModePanel: this.codePath
          ? 0
          : persistedDefaultPanelWidths.emptyCodeModePanel,
        codeEditorPanel: !this.codePath
          ? 0
          : persistedDefaultPanelWidths.codeEditorPanel,
        rightPanel: !this.codePath ? 0 : persistedDefaultPanelWidths.rightPanel,
      }) <= 100
        ? persistedDefaultPanelWidths
        : defaultPanelWidths;
    this.defaultPanelHeights =
      persistedDefaultPanelHeights && sum(persistedDefaultPanelHeights) <= 100
        ? persistedDefaultPanelHeights
        : defaultPanelHeights;

    registerDestructor(this, () => {
      this.operatorModeStateService.unsubscribeFromOpenFileStateChanges(this);
    });
  }

  // you cannot consume context in the constructor. the provider is wired up
  //  as part of the DOM rendering
  private makeCardResource = () => {
    this.cardResource = this.getCard(this, () => {
      if (!this.codePath || this.codePath.href.split('.').pop() !== 'json') {
        return undefined;
      }
      // this includes all JSON files, but the card resource is smart enough
      // to skip JSON that are not card instances
      let url = this.codePath.href.replace(/\.json$/, '');
      return url;
    });
  };

  private get card() {
    return this.cardResource?.card;
  }

  private get cardError() {
    return this.cardResource?.cardError?.meta
      ? this.cardResource?.cardError
      : undefined;
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

  private get selectedCodeRef(): ResolvedCodeRef | undefined {
    let codeRef = identifyCard(this.selectedCardOrField?.cardOrField);
    return isResolvedCodeRef(codeRef) ? codeRef : undefined;
  }

  private get itemToDeleteAsCard() {
    return this.itemToDelete as CardDef;
  }

  private get itemToDeleteAsFile() {
    return this.itemToDelete as URL;
  }

  @action
  private selectDeclaration(dec: ModuleDeclaration) {
    this.goToDefinition(undefined, dec.localName);
  }

  @action
  private goToDefinitionAndResetCursorPosition(
    codeRef: CodeRef | undefined,
    localName: string | undefined,
    fieldName?: string,
  ) {
    this.goToDefinition(codeRef, localName, fieldName);
    if (this.codePath) {
      let urlString = this.codePath.toString();
      this.recentFilesService.updateCursorPositionByURL(
        urlString.endsWith('gts') ? urlString : `${urlString}.gts`,
        undefined,
      );
    }
  }

  @action
  private goToDefinition(
    codeRef: CodeRef | undefined,
    localName: string | undefined,
    fieldName?: string,
  ) {
    this.operatorModeStateService.updateCodePathWithSelection({
      codeRef,
      localName,
      fieldName,
      onLocalSelection: this.updateCursorByName,
    });
    this.specPanelService.setSelection(null);
  }

  private get isSaving() {
    return (
      this.sourceFileIsSaving || !!this.cardResource?.autoSaveState?.isSaving
    );
  }

  @action
  private onSourceFileSave(status: 'started' | 'finished') {
    this.sourceFileIsSaving = status === 'started';
  }

  @action
  private onHorizontalLayoutChange(layout: number[]) {
    if (layout.length > 2) {
      this.defaultPanelWidths.leftPanel = layout[0];
      this.defaultPanelWidths.codeEditorPanel = layout[1];
      this.defaultPanelWidths.rightPanel = layout[2];
    } else {
      this.defaultPanelWidths.leftPanel = layout[0];
      this.defaultPanelWidths.emptyCodeModePanel = layout[1];
    }

    window.localStorage.setItem(
      CodeModePanelWidths,
      JSON.stringify(this.defaultPanelWidths),
    );
  }

  @action
  private onVerticalLayoutChange(layout: number[]) {
    this.defaultPanelHeights.filePanel = layout[0];
    this.defaultPanelHeights.recentPanel = layout[1];

    window.localStorage.setItem(
      CodeModePanelHeights,
      JSON.stringify(this.defaultPanelHeights),
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
  private delete = dropTask(async () => {
    let item = this.itemToDelete;
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
        await this.operatorModeStateService.deleteCard(card.id);
        this.playgroundPanelService.removeSelectionsByCardId(card.id);
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
        if (file.href.endsWith('.json')) {
          this.playgroundPanelService.removeSelectionsByCardId(
            file.href.replace('.json', ''),
          );
        }
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
        specType?: SpecType;
      },
      sourceInstance?: CardDef,
    ) => {
      if (!this.createFileModal) {
        throw new Error(`bug: CreateFileModal not instantiated`);
      }

      let destinationRealm: string | undefined;

      if (sourceInstance && this.realm.canWrite(sourceInstance.id)) {
        destinationRealm = this.realm.url(sourceInstance.id);
      } else if (
        definitionClass?.ref &&
        this.realm.canWrite(definitionClass.ref.module)
      ) {
        destinationRealm = this.realm.url(definitionClass.ref.module);
      } else if (
        this.realm.canWrite(this.operatorModeStateService.realmURL.href)
      ) {
        destinationRealm = this.operatorModeStateService.realmURL.href;
      } else if (this.realm.defaultWritableRealm) {
        destinationRealm = this.realm.defaultWritableRealm.path;
      }

      if (!destinationRealm) {
        throw new Error('No writable realm found');
      }

      this.isCreateModalOpen = true;
      let url = await this.createFileModal.createNewFile(
        fileType,
        new URL(destinationRealm),
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

  private setupCodeEditor = (
    updateCursorByName: (name: string, fieldName?: string) => void,
  ) => {
    this.updateCursorByName = updateCursorByName;
  };

  @action private openSearchResultInEditor(cardId: string) {
    let codePath = cardId.endsWith('.json')
      ? new URL(cardId)
      : new URL(cardId + '.json');
    this.operatorModeStateService.updateCodePath(codePath);
  }

  @action private setPreviewFormat(format: Format) {
    this.previewFormat = format;
  }

  get isReadOnly() {
    return !this.realm.canWrite(this.readyFile.url);
  }

  @provide(PermissionsContextName)
  get permissions() {
    return this.realm.permissions(this.readyFile.url);
  }

  get itemToDeleteId() {
    if (!this.itemToDelete) {
      return '';
    }
    return this.itemToDelete instanceof URL
      ? this.itemToDelete.href
      : this.itemToDelete.id;
  }

  <template>
    {{consumeContext this.makeCardResource}}
    <AttachFileModal />
    {{#let (this.realm.info this.realmURL.href) as |realmInfo|}}
      <div
        class='code-mode-background'
        style={{this.backgroundURLStyle realmInfo.backgroundURL}}
      ></div>
    {{/let}}
    <SubmodeLayout
      @onCardSelectFromSearch={{this.openSearchResultInEditor}}
      @selectedCardRef={{this.selectedCodeRef}}
      as |search|
    >
      <div
        class='code-mode'
        data-test-code-mode
        data-test-save-idle={{not this.isSaving}}
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
          @onLayoutChange={{this.onHorizontalLayoutChange}}
          class='columns'
          as |ResizablePanel ResizeHandle|
        >
          <ResizablePanel @defaultSize={{this.defaultPanelWidths.leftPanel}}>
            <div class='column'>
              <ResizablePanelGroup
                @orientation='vertical'
                @onLayoutChange={{this.onVerticalLayoutChange}}
                @reverseCollapse={{true}}
                as |VerticallyResizablePanel VerticallyResizeHandle|
              >
                <VerticallyResizablePanel
                  @defaultSize={{this.defaultPanelHeights.filePanel}}
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
                          @goToDefinition={{this.goToDefinitionAndResetCursorPosition}}
                          @createFile={{perform this.createFile}}
                          @openSearch={{search.openSearchToResults}}
                        />
                      {{/if}}
                    </:inspector>
                    <:browser>
                      <FileTree
                        @realmURL={{this.realmURL}}
                        @selectedFile={{this.operatorModeStateService.codePathRelativeToRealm}}
                        @openDirs={{this.operatorModeStateService.currentRealmOpenDirs}}
                        @onFileSelected={{this.operatorModeStateService.onFileSelected}}
                        @onDirectorySelected={{this.operatorModeStateService.toggleOpenDir}}
                        @scrollPositionKey={{this.operatorModeStateService.codePathString}}
                      />
                    </:browser>
                  </CodeSubmodeLeftPanelToggle>
                </VerticallyResizablePanel>
                <VerticallyResizeHandle />
                <VerticallyResizablePanel
                  @defaultSize={{this.defaultPanelHeights.recentPanel}}
                  @minSize={{20}}
                >
                  <InnerContainer
                    class='recent-files-panel'
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
              @defaultSize={{this.defaultPanelWidths.codeEditorPanel}}
              @minSize={{20}}
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
            <ResizablePanel @defaultSize={{this.defaultPanelWidths.rightPanel}}>
              <InnerContainer>
                {{#if this.isReady}}
                  <RhsPanel
                    @card={{this.card}}
                    @cardError={{this.cardError}}
                    @currentOpenFile={{this.currentOpenFile}}
                    @goToDefinitionAndResetCursorPosition={{this.goToDefinitionAndResetCursorPosition}}
                    @isCard={{this.isCard}}
                    @isIncompatibleFile={{this.isIncompatibleFile}}
                    @isModule={{this.isModule}}
                    @isReadOnly={{this.isReadOnly}}
                    @moduleContentsResource={{this.moduleContentsResource}}
                    @previewFormat={{this.previewFormat}}
                    @readyFile={{this.readyFile}}
                    @selectedCardOrField={{this.selectedCardOrField}}
                    @selectedCodeRef={{this.selectedCodeRef}}
                    @selectedDeclaration={{this.selectedDeclaration}}
                    @setPreviewFormat={{this.setPreviewFormat}}
                  />
                {{/if}}
              </InnerContainer>
            </ResizablePanel>
          {{else}}
            <ResizablePanel
              @defaultLengthFraction={{this.defaultPanelWidths.emptyCodeModePanel}}
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
          @itemToDelete={{hash id=this.itemToDeleteId}}
          @onConfirm={{perform this.delete}}
          @onCancel={{this.onCancelDelete}}
          @isDeleteRunning={{this.delete.isRunning}}
        >
          <:content>
            {{#if this.isCard}}
              Delete the card
              <strong>{{this.itemToDeleteAsCard.title}}</strong>?
            {{else}}
              Delete the file
              <strong>{{urlToFilename this.itemToDeleteAsFile}}</strong>?
            {{/if}}
          </:content>
        </DeleteModal>
      {{/if}}
      <CreateFileModal
        @owner={{this}}
        @onCreate={{this.setupCreateFileModal}}
      />
      <FromElseWhere @name='schema-editor-modal' />
      <FromElseWhere @name='playground-field-picker' />
    </SubmodeLayout>

    <style scoped>
      :global(:root) {
        --code-mode-panel-background-color: #ebeaed;
        --code-mode-container-border-radius: 10px;
        --code-mode-realm-icon-size: 1.125rem;
        --code-mode-active-box-shadow: 0 3px 5px 0 rgba(0, 0, 0, 0.35);
        --code-mode-padding-top: calc(
          var(--operator-mode-top-bar-item-height) +
            (2 * (var(--operator-mode-spacing)))
        );
      }

      .code-mode {
        height: 100%;
        max-height: 100vh;
        left: 0;
        right: 0;
        padding-top: var(--code-mode-padding-top);
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

      .recent-files-panel {
        background-color: var(--code-mode-panel-background-color);
      }

      .choose-file-prompt {
        margin: 0;
        padding: var(--boxel-sp);
        font: 600 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .code-mode-top-bar {
        --code-mode-top-bar-left-offset: calc(
          var(--operator-mode-left-column) - var(--operator-mode-spacing)
        ); /* subtract additional padding */

        position: absolute;
        top: 0;
        right: 0;
        left: var(--code-mode-top-bar-left-offset);
        padding: var(--operator-mode-spacing);
        display: flex;
        z-index: 1;
      }

      .loading {
        margin: 40vh auto;
      }

      .empty-container {
        background-color: var(--boxel-light-100);
        align-items: center;
        justify-content: center;
      }

      :deep(.boxel-panel, .separator-vertical, .separator-horizontal) {
        box-shadow: var(--boxel-deep-box-shadow);
        border-radius: var(--boxel-border-radius-xl);
      }
    </style>
  </template>
}
