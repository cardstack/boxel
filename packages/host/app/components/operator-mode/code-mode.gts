import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { action } from '@ember/object';
import MonacoService from '@cardstack/host/services/monaco-service';
import { htmlSafe } from '@ember/template';
import ENV from '@cardstack/host/config/environment';
import FileTree from '../editor/file-tree';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import {
  type RealmInfo,
  type SingleCardDocument,
  type CodeRef,
  RealmPaths,
  isCardDocument,
  logger,
  isSingleCardDocument,
  identifyCard,
  moduleFrom,
} from '@cardstack/runtime-common';
import { LoadingIndicator } from '@cardstack/boxel-ui';
import { maybe } from '@cardstack/host/resources/maybe';
import {
  Ready,
  file,
  isReady,
  type FileResource,
} from '@cardstack/host/resources/file';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type { FileView } from '@cardstack/host/services/operator-mode-state-service';
import type MessageService from '@cardstack/host/services/message-service';
import CardService from '@cardstack/host/services/card-service';
import { task, restartableTask, timeout } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import { registerDestructor } from '@ember/destroyable';
import CardURLBar from '@cardstack/host/components/operator-mode/card-url-bar';
const { ownRealmURL } = ENV;
import CardPreviewPanel from '@cardstack/host/components/operator-mode/card-preview-panel';
import { CardDef } from 'https://cardstack.com/base/card-api';
import { use, resource } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';
import monacoModifier from '@cardstack/host/modifiers/monaco';
import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import CardInheritancePanel from '@cardstack/host/components/operator-mode/card-inheritance-panel';
import { importResource } from '@cardstack/host/resources/import';
import ResizablePanelGroup, {
  PanelContext,
} from '@cardstack/boxel-ui/components/resizable-panel/resizable-panel-group';
import ResizablePanel from '@cardstack/boxel-ui/components/resizable-panel/resizable-panel';
import RecentFiles from '@cardstack/host/components/editor/recent-files';

interface Signature {
  Args: {};
}
const log = logger('component:code-mode');

type PanelWidths = {
  rightPanel: string;
  codeEditorPanel: string;
  leftPanel: string;
};

const CodeModePanelWidths = 'code-mode-panel-widths';
const defaultPanelWidths: PanelWidths = {
  leftPanel: '20%',
  codeEditorPanel: '48%',
  rightPanel: '32%',
};

export default class CodeMode extends Component<Signature> {
  @service declare monacoService: MonacoService;
  @service declare cardService: CardService;
  @service declare messageService: MessageService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @tracked private loadFileError: string | null = null;
  @tracked private maybeMonacoSDK: MonacoSDK | undefined;
  private panelWidths: PanelWidths;
  private subscription: { url: string; unsubscribe: () => void } | undefined;
  private _cachedRealmInfo: RealmInfo | null = null; // This is to cache realm info during reload after code path change so that realm assets don't produce a flicker when code patch changes and the realm is the same

  constructor(args: any, owner: any) {
    super(args, owner);
    this.panelWidths = localStorage.getItem(CodeModePanelWidths)
      ? // @ts-ignore Type 'null' is not assignable to type 'string'
        JSON.parse(localStorage.getItem(CodeModePanelWidths))
      : defaultPanelWidths;

    let url = `${this.cardService.defaultURL}_message`;
    this.subscription = {
      url,
      unsubscribe: this.messageService.subscribe(
        url,
        ({ type, data: dataStr }) => {
          if (type !== 'index') {
            return;
          }
          let card = this.cardResource.value;
          let data = JSON.parse(dataStr);
          if (!card || data.type !== 'incremental') {
            return;
          }
          let invalidations = data.invalidations as string[];
          if (invalidations.includes(card.id)) {
            this.reloadCard.perform();
          }
        },
      ),
    };
    registerDestructor(this, () => {
      this.subscription?.unsubscribe();
    });
    this.loadMonaco.perform();
  }

  private get realmInfo() {
    return this.realmInfoResource.value;
  }

  private get backgroundURL() {
    return this.realmInfo?.backgroundURL;
  }

  private get backgroundURLStyle() {
    return htmlSafe(`background-image: url(${this.backgroundURL});`);
  }

  @action setFileView(view: FileView) {
    this.operatorModeStateService.updateFileView(view);
  }

  get fileView() {
    return this.operatorModeStateService.state.fileView;
  }

  get fileViewTitle() {
    return this.fileView === 'inheritance' ? 'Inheritance' : 'File Browser';
  }

  private get realmIconURL() {
    return this.realmInfo?.iconURL;
  }

  private get isLoading() {
    return (
      this.loadMonaco.isRunning || this.openFile.current?.state === 'loading'
    );
  }

  private get isReady() {
    return this.maybeMonacoSDK && this.openFile.current?.state === 'ready';
  }

  private loadMonaco = task(async () => {
    this.maybeMonacoSDK = await this.monacoService.getMonacoContext();
  });

  private get readyFile() {
    if (this.openFile.current?.state === 'ready') {
      return this.openFile.current;
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

  @use private realmInfoResource = resource(() => {
    if (
      this.openFile.current?.state === 'ready' &&
      this.openFile.current.realmURL
    ) {
      let realmURL = this.openFile.current.realmURL;

      const state: {
        isLoading: boolean;
        value: RealmInfo | null;
        error: Error | undefined;
        load: () => Promise<void>;
      } = new TrackedObject({
        isLoading: true,
        value: this._cachedRealmInfo,
        error: undefined,
        load: async () => {
          state.isLoading = true;

          try {
            let realmInfo = await this.cardService.getRealmInfoByRealmURL(
              new URL(realmURL),
            );

            if (realmInfo) {
              this._cachedRealmInfo = realmInfo;
            }

            state.value = realmInfo;
          } catch (error: any) {
            state.error = error;
          } finally {
            state.isLoading = false;
          }
        },
      });

      state.load();
      return state;
    } else {
      return new TrackedObject({
        error: null,
        isLoading: false,
        value: this._cachedRealmInfo,
        load: () => Promise<void>,
      });
    }
  });

  private openFile = maybe(this, (context) => {
    if (!this.codePath) {
      return undefined;
    }

    return file(context, () => ({
      url: this.codePath!.href,
      onStateChange: (state) => {
        if (state === 'not-found') {
          this.loadFileError = 'File is not found';
        }
      },
    }));
  });

  @use private importedModule = resource(() => {
    if (isReady(this.openFile.current)) {
      let f: Ready = this.openFile.current;
      if (f.name.endsWith('.json')) {
        let ref = identifyCard(this.cardResource.value?.constructor);
        if (ref !== undefined) {
          return importResource(this, () => moduleFrom(ref as CodeRef));
        } else {
          return;
        }
      } else {
        return importResource(this, () => f.url);
      }
    } else {
      return undefined;
    }
  });

  private reloadCard = restartableTask(async () => {
    await this.cardResource.load();
  });

  @use private cardResource = resource(() => {
    let isFileReady =
      this.openFile.current?.state === 'ready' &&
      this.openFile.current.name.endsWith('.json');
    const state: {
      isLoading: boolean;
      value: CardDef | null;
      error: Error | undefined;
      load: () => Promise<void>;
    } = new TrackedObject({
      isLoading: isFileReady,
      value: null,
      error:
        this.openFile.current?.state == 'not-found'
          ? new Error('File not found')
          : undefined,
      load: async () => {
        state.isLoading = true;
        try {
          let currentlyOpenedFile = this.openFile.current as any;
          let cardDoc = JSON.parse(currentlyOpenedFile.content);
          if (isCardDocument(cardDoc)) {
            let url = currentlyOpenedFile.url.replace(/\.json$/, '');
            state.value = await this.cardService.loadModel(url);
          }
        } catch (error: any) {
          state.error = error;
        } finally {
          state.isLoading = false;
        }
      },
    });

    if (isFileReady) {
      state.load();
    }
    return state;
  });

  private contentChangedTask = restartableTask(async (content: string) => {
    await timeout(500);
    if (
      this.openFile.current?.state !== 'ready' ||
      content === this.openFile.current?.content
    ) {
      return;
    }

    let isJSON = this.openFile.current.name.endsWith('.json');
    let validJSON = isJSON && this.safeJSONParse(content);
    // Here lies the difference in how json files and other source code files
    // are treated during editing in the code editor
    if (validJSON && isSingleCardDocument(validJSON)) {
      // writes json instance but doesn't update state of the file resource
      // relies on message service subscription to update state
      await this.saveFileSerializedCard.perform(validJSON);
      return;
    } else if (!isJSON || validJSON) {
      // writes source code and non-card instance valid JSON,
      // then updates the state of the file resource
      await this.writeSourceCodeToFile(this.openFile.current, content);
    }
  });

  // We use this to write non-cards to the realm--so it doesn't make
  // sense to go thru the card-service for this
  private writeSourceCodeToFile(file: FileResource, content: string) {
    if (file.state !== 'ready') {
      throw new Error('File is not ready to be written to');
    }

    return file.write(content);
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
      await this.cardService.saveModel(card);
      await this.reloadCard.perform();
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

  @action
  private onListPanelContextChange(listPanelContext: PanelContext[]) {
    this.panelWidths.leftPanel = listPanelContext[0].width;
    this.panelWidths.codeEditorPanel = listPanelContext[1].width;
    this.panelWidths.rightPanel = listPanelContext[2].width;

    localStorage.setItem(CodeModePanelWidths, JSON.stringify(this.panelWidths));
  }

  <template>
    <div class='code-mode-background' style={{this.backgroundURLStyle}}></div>
    <CardURLBar
      @loadFileError={{this.loadFileError}}
      @resetLoadFileError={{this.resetLoadFileError}}
      @realmInfo={{this.realmInfo}}
      class='card-url-bar'
    />
    <div
      class='code-mode'
      data-test-code-mode
      data-test-save-idle={{this.contentChangedTask.isIdle}}
    >
      <ResizablePanelGroup
        @onListPanelContextChange={{this.onListPanelContextChange}}
        class='columns'
        as |pg|
      >
        <ResizablePanel
          @defaultWidth={{defaultPanelWidths.leftPanel}}
          @width={{this.panelWidths.leftPanel}}
          @panelGroupApi={{pg.api}}
        >
          <div class='column'>
            {{! Move each container and styles to separate component }}
            <div
              class='inner-container file-view
                {{if (eq this.fileView "browser") "file-browser"}}'
            >
              <header
                aria-label={{this.fileViewTitle}}
                data-test-file-view-header
              >
                <button
                  class='{{if (eq this.fileView "inheritance") "active"}}'
                  {{on 'click' (fn this.setFileView 'inheritance')}}
                  data-test-inheritance-toggle
                >
                  Inheritance</button>
                <button
                  class='{{if (eq this.fileView "browser") "active"}}'
                  {{on 'click' (fn this.setFileView 'browser')}}
                  data-test-file-browser-toggle
                >
                  File Browser</button>
              </header>
              <section class='inner-container__content'>
                {{#if (eq this.fileView 'inheritance')}}
                  <section class='inner-container__content'>
                    <CardInheritancePanel
                      @cardInstance={{this.cardResource.value}}
                      @openFile={{this.openFile}}
                      @realmInfo={{this.realmInfo}}
                      @realmIconURL={{this.realmIconURL}}
                      @importedModule={{this.importedModule}}
                      data-test-card-inheritance-panel
                    />
                  </section>
                {{else}}
                  <FileTree @url={{ownRealmURL}} />
                {{/if}}
              </section>
            </div>
            <aside class='inner-container'>
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
          </div>
        </ResizablePanel>
        <ResizablePanel
          @defaultWidth={{defaultPanelWidths.codeEditorPanel}}
          @width={{this.panelWidths.codeEditorPanel}}
          @minWidth='300px'
          @panelGroupApi={{pg.api}}
        >
          <div class='inner-container'>
            {{#if this.isReady}}
              <div
                class='monaco-container'
                data-test-editor
                {{monacoModifier
                  content=this.readyFile.content
                  contentChanged=(perform this.contentChangedTask)
                  monacoSDK=this.monacoSDK
                  language=this.language
                }}
              ></div>
            {{else if this.isLoading}}
              <div class='loading'>
                <LoadingIndicator />
              </div>
            {{/if}}
          </div>
        </ResizablePanel>
        <ResizablePanel
          @defaultWidth={{defaultPanelWidths.rightPanel}}
          @width={{this.panelWidths.rightPanel}}
          @panelGroupApi={{pg.api}}
        >
          <div class='inner-container'>
            {{#if this.cardResource.value}}
              <CardPreviewPanel
                @card={{this.cardResource.value}}
                @realmIconURL={{this.realmIconURL}}
                data-test-card-resource-loaded
              />
            {{else if this.cardResource.error}}
              {{this.cardResource.error.message}}
            {{/if}}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>

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
      .column:nth-child(2) {
        flex: 2;
      }
      .column:last-child {
        flex: 1.2;
      }
      .column:first-child > *:first-child {
        max-height: 50%;
        background-color: var(--boxel-200);
      }
      .column:first-child > *:last-child {
        max-height: calc(50% - var(--boxel-sp));
        background-color: var(--boxel-200);
      }

      .inner-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        box-shadow: var(--boxel-deep-box-shadow);
        overflow: hidden;
      }
      .inner-container__header {
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .inner-container__content {
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs) var(--boxel-sp-sm);
        overflow-y: auto;
      }

      .file-view header {
        margin: var(--boxel-sp-sm);
        display: flex;
        gap: var(--boxel-sp-sm);
      }

      .file-view header button {
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-lg);
        font-weight: 700;
        background: transparent;
        color: var(--boxel-dark);
        border-radius: var(--boxel-border-radius-sm);
        border: 1px solid var(--boxel-400);
        flex: 1;
      }

      .file-view header button.active {
        background: var(--boxel-dark);
        color: var(--boxel-highlight);
        border-color: var(--boxel-dark);
      }

      .file-view.file-browser .inner-container__content {
        background: var(--boxel-light);
      }

      .card-url-bar {
        position: absolute;
        top: var(--boxel-sp);
        left: calc(var(--submode-switcher-width) + (var(--boxel-sp) * 2));

        --card-url-bar-width: calc(
          100% - (var(--submode-switcher-width) + (var(--boxel-sp) * 3))
        );
        height: var(--submode-switcher-height);

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
    </style>
  </template>
}
