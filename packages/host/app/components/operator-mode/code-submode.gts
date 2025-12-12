import { registerDestructor } from '@ember/destroyable';
import { hash } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { capitalize } from '@ember/string';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask, timeout } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import FromElseWhere from 'ember-elsewhere/components/from-elsewhere';

import { consume, provide } from 'ember-provide-consume-context';
import window from 'ember-window-mock';

import startCase from 'lodash/startCase';

import {
  LoadingIndicator,
  ResizablePanelGroup,
} from '@cardstack/boxel-ui/components';
import { not, MenuItem } from '@cardstack/boxel-ui/helpers';
import { File } from '@cardstack/boxel-ui/icons';

import type { CodeRef } from '@cardstack/runtime-common';
import {
  isCardDocumentString,
  RealmPaths,
  PermissionsContextName,
  GetCardContextName,
  type ResolvedCodeRef,
  type getCard,
  CardContextName,
} from '@cardstack/runtime-common';
import { isEquivalentBodyPosition } from '@cardstack/runtime-common/schema-analysis-plugin';

import RecentFiles from '@cardstack/host/components/editor/recent-files';
import CodeSubmodeEditorIndicator from '@cardstack/host/components/operator-mode/code-submode/editor-indicator';
import ModuleInspector from '@cardstack/host/components/operator-mode/code-submode/module-inspector';

import consumeContext from '@cardstack/host/helpers/consume-context';
import type { FileResource } from '@cardstack/host/resources/file';
import type {
  ModuleDeclaration,
  State as ModuleState,
} from '@cardstack/host/resources/module-contents';
import type CardService from '@cardstack/host/services/card-service';
import type CodeSemanticsService from '@cardstack/host/services/code-semantics-service';
import type { FileView } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';
import type SpecPanelService from '@cardstack/host/services/spec-panel-service';

import type {
  CardDef,
  Format,
  CardContext,
} from 'https://cardstack.com/base/card-api';
import type { SpecType } from 'https://cardstack.com/base/spec';

import {
  CodeModePanelWidths,
  CodeModePanelHeights,
} from '../../utils/local-storage-keys';
import FileTree from '../editor/file-tree';

import CardURLBar from './card-url-bar';
import CodeEditor from './code-editor';
import InnerContainer from './code-submode/inner-container';
import CodeSubmodeLeftPanelToggle from './code-submode/left-panel-toggle';
import CreateFileModal, {
  type FileType,
  newFileTypes,
} from './create-file-modal';
import DeleteModal from './delete-modal';
import DetailPanel from './detail-panel';

import SubmodeLayout from './submode-layout';

import type { NewFileOptions } from './new-file-button';

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
  @consume(CardContextName) private declare cardContext: CardContext;

  @service private declare cardService: CardService;
  @service private declare codeSemanticsService: CodeSemanticsService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @service private declare recentFilesService: RecentFilesService;
  @service private declare realm: RealmService;
  @service private declare specPanelService: SpecPanelService;

  @tracked private loadFileError: string | null = null;
  @tracked private userHasDismissedURLError = false;
  @tracked private sourceFileIsSaving = false;
  @tracked private isCreateModalOpen = false;
  @tracked private itemToDelete: CardDef | URL | null | undefined;
  @tracked private cardResource: ReturnType<getCard> | undefined;

  private defaultPanelWidths: PanelWidths;
  private defaultPanelHeights: PanelHeights;
  private updateCursorByName:
    | ((name: string, fieldName?: string) => void)
    | undefined;

  private createFileModal: CreateFileModal | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.operatorModeStateService.subscribeToOpenFileStateChanges(this);
    this.codeSemanticsService.setOnModuleEditCallback(this.onModuleEdit);

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

  @action setFileView(view: FileView) {
    this.operatorModeStateService.updateFileView(view);
  }

  private get realmURL() {
    return this.operatorModeStateService.realmURL;
  }

  private get isCard() {
    return (
      this.isReady &&
      this.readyFile.name.endsWith('.json') &&
      isCardDocumentString(this.readyFile.content)
    );
  }

  get fileView() {
    return this.operatorModeStateService.state.fileView;
  }

  private get isFileOpen() {
    return !!(
      this.codeSemanticsService.codePath &&
      this.currentOpenFile?.state !== 'not-found'
    );
  }

  private get currentOpenFile() {
    return this.codeSemanticsService.currentOpenFile;
  }

  private get isReady() {
    return this.codeSemanticsService.isReady;
  }

  private get isLoading() {
    return this.currentOpenFile?.state === 'loading';
  }

  private get readyFile() {
    return this.codeSemanticsService.readyFile;
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

  // Adapter getter for components that expect the resource interface
  private get moduleAnalysis() {
    let file = this.isModule ? this.readyFile : undefined;
    let isModule = this.isModule;

    return {
      declarations: this.codeSemanticsService.getDeclarations(file, isModule),
      moduleError: this.codeSemanticsService.getModuleError(file, isModule),
      isLoading: this.codeSemanticsService.getIsLoading(file, isModule),
    };
  }

  private get selectedCardOrField() {
    return this.codeSemanticsService.selectedCardOrField;
  }

  private get selectedCodeRef(): ResolvedCodeRef | undefined {
    return this.codeSemanticsService.selectedCodeRef;
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
  private async goToDefinitionAndResetCursorPosition(
    codeRef: CodeRef | undefined,
    localName: string | undefined,
    fieldName?: string,
  ) {
    await this.goToDefinition(codeRef, localName, fieldName);
    if (this.codePath) {
      let urlString = this.codePath.toString();
      this.recentFilesService.updateCursorPositionByURL(
        urlString.endsWith('gts') ? urlString : `${urlString}.gts`,
        undefined,
      );
    }
  }

  @action
  private async goToDefinition(
    codeRef: CodeRef | undefined,
    localName: string | undefined,
    fieldName?: string,
  ) {
    await this.operatorModeStateService.updateCodePathWithSelection({
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

  private get menuItems(): MenuItem[] {
    return newFileTypes.flatMap(({ id, icon, description, extension }) => {
      if (id === 'duplicate-instance' || id === 'spec-instance') {
        return [];
      }
      let displayName = capitalize(startCase(id));
      return [
        new MenuItem({
          label: displayName,
          action: () => this.createFile.perform({ id, displayName }),
          subtext: description,
          icon,
          postscript: extension,
        }),
      ];
    });
  }

  private get newFileOptions(): NewFileOptions {
    return {
      menuItems: this.menuItems,
      isDisabled: this.isCreateModalOpen,
      onClose: this.operatorModeStateService.setNewFileDropdownClosed,
    };
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

      await this.operatorModeStateService.updateCodePath(
        new URL(recentFileUrl),
      );
    } else {
      await this.operatorModeStateService.updateCodePath(null);
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

      let sourceURLs = [
        sourceInstance?.id,
        definitionClass?.ref?.module,
      ].filter(Boolean) as string[] | [];

      let destinationRealm =
        this.operatorModeStateService.getWritableRealmURL(sourceURLs);

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
        await this.operatorModeStateService.updateCodePath(url);
        this.setCardPreviewFormat('edit');
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

  @action private async openSearchResultInEditor(cardId: string) {
    let codePath = cardId.endsWith('.json')
      ? new URL(cardId)
      : new URL(cardId + '.json');
    await this.operatorModeStateService.updateCodePath(codePath);
  }

  get cardPreviewFormat() {
    return this.operatorModeStateService.state.cardPreviewFormat;
  }

  @action private setCardPreviewFormat(format: Format) {
    this.operatorModeStateService.updateCardPreviewFormat(format);
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

  get selectedDeclaration(): ModuleDeclaration | undefined {
    return this.codeSemanticsService.selectedDeclaration;
  }

  get isIncompatibleFile() {
    return this.codeSemanticsService.isIncompatibleFile;
  }

  get isModule() {
    return this.codeSemanticsService.isModule;
  }

  get codePath() {
    return this.codeSemanticsService.codePath;
  }

  <template>
    {{consumeContext this.makeCardResource}}
    <SubmodeLayout
      class='code-submode-layout'
      @onCardSelectFromSearch={{this.openSearchResultInEditor}}
      @selectedCardRef={{this.selectedCodeRef}}
      @newFileOptions={{this.newFileOptions}}
      data-test-code-submode
    >
      <:topBar>
        <CardURLBar
          @loadFileError={{this.loadFileError}}
          @resetLoadFileError={{this.resetLoadFileError}}
          @userHasDismissedError={{this.userHasDismissedURLError}}
          @dismissURLError={{this.dismissURLError}}
          @realmURL={{this.realmURL}}
        />
      </:topBar>
      <:default as |search|>
        <div
          class='code-mode'
          data-test-code-mode
          data-test-save-idle={{not this.isSaving}}
        >
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
                      @realmURL={{this.realmURL}}
                      @fileView={{this.fileView}}
                      @setFileView={{this.setFileView}}
                      @isFileOpen={{this.isFileOpen}}
                      @selectedDeclaration={{this.selectedDeclaration}}
                    >
                      <:inspector>
                        {{#if this.isReady}}
                          <DetailPanel
                            @moduleAnalysis={{this.moduleAnalysis}}
                            @cardInstance={{this.card}}
                            @readyFile={{this.readyFile}}
                            @selectedDeclaration={{this.selectedDeclaration}}
                            @selectDeclaration={{this.selectDeclaration}}
                            @delete={{this.setItemToDelete}}
                            @goToDefinition={{this.goToDefinitionAndResetCursorPosition}}
                            @createFile={{perform this.createFile}}
                            @openSearch={{search.openSearchToResults}}
                            @cardError={{this.cardError}}
                          />
                        {{else if this.isLoading}}
                          <LoadingIndicator class='loading-indicator' />
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
                  <VerticallyResizeHandle class='handle' />
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
            <ResizeHandle class='handle' />
            {{#if this.codePath}}
              <ResizablePanel
                @defaultSize={{this.defaultPanelWidths.codeEditorPanel}}
                @minSize={{20}}
              >
                <InnerContainer class='monaco-editor-panel'>
                  {{#if this.isReady}}
                    <CodeEditor
                      @file={{this.currentOpenFile}}
                      @moduleAnalysis={{this.moduleAnalysis}}
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
                  {{else if this.isLoading}}
                    <LoadingIndicator
                      @color='var(--boxel-light)'
                      class='loading-indicator'
                    />
                  {{/if}}
                </InnerContainer>
              </ResizablePanel>
              <ResizeHandle class='handle' />
              <ResizablePanel
                @defaultSize={{this.defaultPanelWidths.rightPanel}}
                {{! TODO in CS-8713: make this have a minimum width }}
                @collapsible={{false}}
              >
                <InnerContainer class='module-inspector-container'>
                  {{#if this.isReady}}
                    <ModuleInspector
                      @card={{this.card}}
                      @cardError={{this.cardError}}
                      @currentOpenFile={{this.currentOpenFile}}
                      @goToDefinitionAndResetCursorPosition={{this.goToDefinitionAndResetCursorPosition}}
                      @isCard={{this.isCard}}
                      @isIncompatibleFile={{this.isIncompatibleFile}}
                      @isModule={{this.isModule}}
                      @isReadOnly={{this.isReadOnly}}
                      @moduleAnalysis={{this.moduleAnalysis}}
                      @previewFormat={{this.cardPreviewFormat}}
                      @readyFile={{this.readyFile}}
                      @selectedCardOrField={{this.selectedCardOrField}}
                      @selectedCodeRef={{this.selectedCodeRef}}
                      @selectedDeclaration={{this.selectedDeclaration}}
                      @setPreviewFormat={{this.setCardPreviewFormat}}
                    />
                  {{else if this.isLoading}}
                    <LoadingIndicator class='loading-indicator' />
                  {{/if}}
                </InnerContainer>
              </ResizablePanel>
            {{else}}
              <ResizablePanel
                @defaultLengthFraction={{this.defaultPanelWidths.emptyCodeModePanel}}
              >
                <InnerContainer
                  class='empty-container'
                  data-test-empty-code-mode
                >
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
      </:default>
    </SubmodeLayout>

    <CreateFileModal @owner={{this}} @onCreate={{this.setupCreateFileModal}} />
    <FromElseWhere @name='schema-editor-modal' />
    <FromElseWhere @name='playground-field-picker' />

    <style scoped>
      :global(:root) {
        --code-submode-background: #74707d;
        --code-mode-panel-background-color: #ebeaed;
        --code-mode-container-border-radius: 10px;
        --code-mode-realm-icon-size: 1.125rem;
        --code-mode-active-box-shadow: 0 3px 6px 0 rgba(0, 0, 0, 0.16);
        --monaco-background: var(--boxel-600);
        --monaco-selection-background: var(--boxel-500);
        --monaco-inactive-selection-background: var(--boxel-550);
        --monaco-readonly-background: #606060;
      }

      .code-submode-layout {
        --submode-bar-item-outline: 2px solid transparent;
        --submode-bar-item-box-shadow: none;
        background-color: var(--code-submode-background);
      }

      .code-mode {
        overflow: auto;
        flex: 1;
        background-color: var(--code-submode-background);
      }

      .columns {
        display: flex;
        flex-direction: row;
        flex-shrink: 0;
        height: 100%;
        border-top: 1px solid var(--boxel-dark);
      }

      .column {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        height: 100%;
      }

      .handle {
        --boxel-panel-resize-separator-background-color: var(--boxel-dark);
      }

      .monaco-editor-panel {
        background-color: var(--monaco-background);
      }
      .monaco-editor-panel :deep(.binary-info) {
        --icon-color: var(--boxel-light);
        color: var(--boxel-light);
      }

      .choose-file-prompt {
        margin: 0;
        padding: var(--boxel-sp);
        font: 600 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .code-submode-layout
        :deep(
          .submode-layout-top-bar .ember-basic-dropdown-content-wormhole-origin
        ) {
        position: absolute;
      }

      .module-inspector-container {
        background-color: transparent;
      }

      .loading {
        margin: 40vh auto;
      }

      .empty-container {
        background-color: var(--boxel-light-100);
        align-items: center;
        justify-content: center;
      }

      .loading-indicator {
        height: 100%;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    </style>
  </template>
}
