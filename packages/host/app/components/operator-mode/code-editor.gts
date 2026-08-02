import { registerDestructor } from '@ember/destroyable';
import { hash } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import {
  task,
  restartableTask,
  timeout,
  all,
  didCancel,
} from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';
import { modifier } from 'ember-modifier';

import { isEqual } from 'lodash-es';

import { Position } from 'monaco-editor';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import {
  hasExecutableExtension,
  logger,
  isSingleCardDocument,
  isCardInstance,
  meta as metaSymbol,
  codeRefWithAbsoluteIdentifier,
  type SingleCardDocument,
  type PatchData,
} from '@cardstack/runtime-common';
import { getName } from '@cardstack/runtime-common/schema-analysis-plugin';

import type { PreparedCodePreviewCommit } from '@cardstack/host/lib/code-preview-sandbox';
import monacoModifier from '@cardstack/host/modifiers/monaco';
import type { MonacoContentChangeOrigin } from '@cardstack/host/modifiers/monaco';
import {
  isReady,
  type FileResource,
  type Ready,
} from '@cardstack/host/resources/file';
import type {
  ModuleAnalysis,
  ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';
import type { SaveType } from '@cardstack/host/services/card-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import { findDeclarationByName } from '@cardstack/host/services/module-contents-service';
import type MonacoService from '@cardstack/host/services/monaco-service';
import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';
import type StoreService from '@cardstack/host/services/store';
import type ToolService from '@cardstack/host/services/tool-service';
import LintAndFixTool from '@cardstack/host/tools/lint-and-fix';
import { applyBoxelFormatting } from '@cardstack/host/utils/editor/boxel-formatter';

import BinaryFileInfo from './binary-file-info';

interface Signature {
  Args: {
    file: FileResource | undefined;
    moduleAnalysis: ModuleAnalysis | undefined;
    selectedDeclaration: ModuleDeclaration | undefined;
    isReadOnly: boolean;
    saveSourceOnClose: (url: URL, content: string) => void;
    selectDeclaration: (declaration: ModuleDeclaration) => void;
    onFileSave: (status: 'started' | 'finished') => void;
    onContentChange?: (
      url: string,
      content: string,
      origin: MonacoContentChangeOrigin,
    ) => void;
    prepareSourceCommit?: (
      url: string,
      content: string,
      saveType: SaveType,
    ) => PreparedCodePreviewCommit | undefined;
    onSetup: (
      updateCursorByName: (name: string, fieldName?: string) => void,
    ) => void;
    onWriteError?: (message: string | undefined) => void;
  };
}

const log = logger('component:code-editor');

export default class CodeEditor extends Component<Signature> {
  @service declare private monacoService: MonacoService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private environmentService: EnvironmentService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private store: StoreService;
  @service declare private toolService: ToolService;
  @service declare private network: NetworkService;

  @tracked private maybeMonacoSDK: MonacoSDK | undefined;
  @tracked private isFormatting = false;
  @tracked private formattingError: string | undefined;

  private hasUnsavedSourceChanges = false;
  private hasSavedUnsavedSourceOnClose = false;
  private codePath;
  private formatContextKey:
    | ReturnType<
        import('monaco-editor').editor.IStandaloneCodeEditor['createContextKey']
      >
    | undefined;
  private formatActionDisposable:
    | import('monaco-editor').IDisposable
    | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    // note that we actually set our own `codePath` property because within
    // onEditorDispose we actually can no longer see the codePath that pertains
    // to the component that is being destroyed--rather we see the new codePath
    // that we are transitioning to.
    this.codePath = this.operatorModeStateService.state.codePath;

    registerDestructor(this, () => {
      this.saveUnsavedSourceOnClose();
      this.recentFilesService.flushPendingPersistence();
      this.formatActionDisposable?.dispose();
      this.formatActionDisposable = undefined;
      this.formatContextKey = undefined;
    });

    this.loadMonaco.perform();

    this.args.onSetup(this.updateMonacoCursorPositionByName);
  }

  private onEditorDispose = () => {
    this.saveUnsavedSourceOnClose();
    this.recentFilesService.flushPendingPersistence();
  };

  private get editorIsReady() {
    return Boolean(this.maybeMonacoSDK);
  }

  private get editorContent() {
    return isReady(this.args.file) ? this.args.file.content : '';
  }

  private get editorContentIdentity() {
    return isReady(this.args.file) ? this.args.file.url : undefined;
  }

  private get sourceIsLoading() {
    let selectedURL = this.operatorModeStateService.state.codePath?.href;
    if (!this.args.file || this.args.file.state === 'loading') {
      return true;
    }
    return Boolean(
      selectedURL &&
      isReady(this.args.file) &&
      this.args.file.url !== selectedURL,
    );
  }

  private get editorIsReadOnly() {
    return (
      this.args.isReadOnly || !isReady(this.args.file) || this.sourceIsLoading
    );
  }

  private get isBinaryFile() {
    return isReady(this.args.file) && this.args.file.isBinary;
  }

  private get declarations() {
    return this.args.moduleAnalysis?.declarations || [];
  }

  private loadMonaco = task(async () => {
    this.maybeMonacoSDK = await this.monacoService.getMonacoContext();
  });

  private get monacoSDK() {
    if (this.maybeMonacoSDK) {
      return this.maybeMonacoSDK;
    }
    throw new Error(`cannot use monaco SDK before it has loaded`);
  }

  private get readyFile() {
    if (isReady(this.args.file)) {
      return this.args.file;
    }
    throw new Error(
      `cannot access file contents ${this.codePath} before file is open`,
    );
  }

  // CodeEditor intentionally stays mounted while file resources change so
  // Monaco is not coupled to source, analysis, SES, or iframe latency. Save a
  // pending buffer against the old URL before the modifier receives the new
  // route, then let the existing Monaco model accept the next file's content.
  private syncCodePath = modifier(
    (_element: HTMLElement, [codePath]: [URL | null]) => {
      if (this.codePath?.href === codePath?.href) {
        return;
      }
      this.saveUnsavedSourceOnClose();
      this.codePath = codePath;
      this.hasUnsavedSourceChanges = false;
      this.hasSavedUnsavedSourceOnClose = false;
      this.formattingError = undefined;
      this.updateFormatActionAvailability();
    },
  );

  @cached
  private get initialMonacoCursorPosition() {
    if (this.codePath) {
      let recentFile = this.recentFilesService.findRecentFileByURL(
        this.codePath.toString(),
      );
      if (recentFile?.cursorPosition) {
        return new Position(
          recentFile.cursorPosition.line,
          recentFile.cursorPosition.column,
        );
      }
    }

    let selectedFieldName = this.operatorModeStateService.state.fieldSelection;
    let { selectedDeclaration } = this.args;
    if (
      selectedFieldName &&
      selectedDeclaration &&
      'possibleFields' in selectedDeclaration &&
      selectedDeclaration.possibleFields
    ) {
      let possibleFields = selectedDeclaration.possibleFields;
      let field = possibleFields.get(selectedFieldName);
      let loc =
        field?.path?.node && 'loc' in field.path.node && field.path.node.loc
          ? field.path.node.loc
          : undefined;
      if (loc) {
        let { start } = loc;
        let { line, column } = start;
        // Adjusts column to make cursor position right after the field name
        let fieldDecoratorTextLength = 8;
        column = column + fieldDecoratorTextLength + selectedFieldName.length;
        return new Position(line, column);
      }
    }

    let loc =
      selectedDeclaration?.path?.node &&
      'body' in selectedDeclaration.path.node &&
      'loc' in selectedDeclaration.path.node.body! &&
      selectedDeclaration.path.node.body.loc
        ? selectedDeclaration?.path?.node.body.loc
        : undefined;
    if (loc) {
      let { start } = loc;
      return new Position(start.line, start.column);
    }
    return undefined;
  }

  @action
  private updateMonacoCursorPositionByName(name: string, fieldName?: string) {
    let declaration = findDeclarationByName(name, this.declarations);
    if (declaration === undefined) return;
    return this.updateMonacoCursorPositionByDeclaration(declaration, fieldName);
  }

  @action
  private updateMonacoCursorPositionByDeclaration(
    declaration: ModuleDeclaration,
    fieldName?: string,
  ) {
    if (
      fieldName &&
      'possibleFields' in declaration &&
      declaration.possibleFields
    ) {
      let possibleFields = declaration.possibleFields;
      let field = possibleFields.get(fieldName);
      let loc =
        field?.path?.node && 'loc' in field.path.node && field.path.node.loc
          ? field.path.node.loc
          : undefined;
      if (loc) {
        // Adjusts column to make cursor position right after the field name
        let fieldDecoratorTextLength = 8;
        let columnAdjustment = fieldDecoratorTextLength + fieldName.length;
        this.monacoService.updateCursorPosition(
          new Position(loc.start.line, loc.start.column + columnAdjustment),
        );
      }
    } else if (
      declaration.path?.node &&
      'body' in declaration.path.node &&
      'loc' in declaration.path.node.body! &&
      declaration.path.node.body.loc
    ) {
      let { start, end } = declaration.path.node.body.loc;
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
    } else if (
      declaration.path?.node &&
      'loc' in (declaration.path?.node || {}) &&
      declaration.path.node.loc
    ) {
      //This is a fallback path if we cannot find declaration / code for element
      if (declaration.path?.isExportNamedDeclaration()) {
        //capturing position of named export declarations
        //this will always divert to the end of the specifier
        let specifier = declaration.path?.node.specifiers.find(
          (specifier) => getName(specifier.exported) === declaration.exportName,
        );
        if (
          specifier &&
          specifier.exported.loc !== null &&
          specifier.exported.loc !== undefined
        ) {
          let { start, end } = specifier.exported.loc;
          this.monacoService.updateCursorPosition(
            new Position(start.line, end.column + 1), //need to +1 for specifier positions
          );
        }
      } else if (declaration.path.isExportDefaultDeclaration()) {
        let { start, end } = declaration.path.node.loc;
        this.monacoService.updateCursorPosition(
          new Position(start.line, end.column),
        );
      }
    }
  }

  @action
  private onCursorPositionChange(position: Position) {
    this.selectDeclarationByMonacoCursorPosition(position);

    if (!this.codePath) {
      return;
    }
    this.recentFilesService.updateCursorPositionByURL(
      this.codePath.toString(),
      {
        line: position.lineNumber,
        column: position.column,
      },
    );
  }

  @action
  private selectDeclarationByMonacoCursorPosition(position: Position) {
    let declarationCursorOn = this.declarations.find(
      (declaration: ModuleDeclaration) => {
        if (
          declaration.path?.node &&
          'body' in declaration.path.node &&
          'loc' in declaration.path.node.body! &&
          declaration.path.node.body.loc
        ) {
          let { start, end } = declaration.path.node.body.loc;
          return (
            position.lineNumber >= start.line && position.lineNumber <= end.line
          );
        }
        return false;
      },
    );

    if (
      declarationCursorOn &&
      declarationCursorOn !== this.args.selectedDeclaration
    ) {
      this.args.selectDeclaration(declarationCursorOn);
    }
  }

  private contentChangedTask = restartableTask(async (content: string) => {
    this.hasUnsavedSourceChanges = true;
    this.hasSavedUnsavedSourceOnClose = false;
    if (!isReady(this.args.file) || content === this.args.file?.content) {
      return;
    }

    // intentionally not awaiting this
    this.syncWithStore.perform(content);

    await timeout(this.environmentService.autoSaveDelayMs);
    this.args.onWriteError?.(undefined);
    this.writeSourceCodeToFile(
      this.args.file,
      content,
      this.canSyncWithStore(content) ? 'editor-with-instance' : 'editor',
    );
    this.waitForSourceCodeWrite.perform();
    this.hasUnsavedSourceChanges = false;
    this.hasSavedUnsavedSourceOnClose = false;
  });

  private contentChanging = (
    content: string,
    origin: MonacoContentChangeOrigin,
  ) => {
    if (isReady(this.args.file)) {
      this.args.onContentChange?.(this.args.file.url, content, origin);
    }
  };

  private canSyncWithStore(content: string): boolean {
    if (!isReady(this.args.file) || !this.args.file.url.endsWith('.json')) {
      return false;
    }

    let json: Record<string, any> | undefined;
    try {
      json = JSON.parse(content);
    } catch (e) {
      return false;
    }

    if (!json || !isSingleCardDocument(json)) {
      return false;
    }

    let instance = this.store.peek(this.args.file.url.replace(/\.json$/, ''));
    if (!instance || !isCardInstance(instance)) {
      return false;
    }

    let { adoptsFrom } = instance[metaSymbol] ?? {};
    if (!adoptsFrom) {
      return false;
    }
    adoptsFrom = codeRefWithAbsoluteIdentifier(
      adoptsFrom,
      new URL(this.args.file.url),
      undefined,
      this.network.virtualNetwork,
    );
    if (
      !isEqual(
        adoptsFrom,
        codeRefWithAbsoluteIdentifier(
          json.data.meta.adoptsFrom,
          new URL(this.args.file.url),
          undefined,
          this.network.virtualNetwork,
        ),
      )
    ) {
      return false;
    }

    return true;
  }

  private syncWithStore = restartableTask(async (content: string) => {
    if (!isReady(this.args.file)) {
      return;
    }

    if (!this.canSyncWithStore(content)) {
      return;
    }

    // we checked above to make sure that we are dealing with a SingleCardDocument
    let doc: SingleCardDocument = JSON.parse(content);
    let patch: PatchData = {
      ...(doc.data.attributes ? { attributes: doc.data.attributes } : {}),
      ...(doc.data.relationships
        ? { relationships: doc.data.relationships }
        : {}),
      ...(doc.data.meta.fields
        ? { meta: { fields: doc.data.meta.fields } }
        : {}),
    };
    await this.store.patch(this.args.file.url.replace(/\.json$/, ''), patch, {
      doNotPersist: true,
    });
  });

  // these saves can happen so fast that we'll make sure to wait at
  // least 500ms for human consumption
  private waitForSourceCodeWrite = restartableTask(async () => {
    if (isReady(this.args.file)) {
      this.args.onFileSave('started');
      try {
        await all([this.args.file.writing, timeout(500)]);
      } catch {
        // Errors are surfaced via writeError banners, so don't rethrow.
      }
      this.args.onFileSave('finished');
    }
  });

  private writeSourceCodeToFile(
    file: FileResource,
    content: string,
    saveType: SaveType,
  ) {
    if (file.state !== 'ready') {
      throw new Error('File is not ready to be written to');
    }

    let isJSON = file.name.endsWith('.json');
    let validJSON = isJSON && this.safeJSONParse(content);

    if (isJSON && !validJSON) {
      log.warn(
        `content for ${this.codePath} is not valid JSON, skipping write`,
      );
      return;
    }

    let commit = this.args.prepareSourceCommit?.(file.url, content, saveType);
    // The canonical loader still needs the persisted module invalidated, but
    // an active Code preview has already rendered this source revision. Its
    // Store refresh is deferred so the mounted preview is not replaced by the
    // POST response and then replaced again by the realm event.
    return file
      .write(content, {
        flushLoader: hasExecutableExtension(file.name),
        deferStoreRefresh: commit?.shouldDeferStoreRefresh,
        saveType,
        clientRequestId: commit?.clientRequestId,
      })
      .then(() => commit?.persisted())
      .catch((error) => {
        commit?.failed(error);
        // Task cancellations are expected when the restartable contentChangedTask is
        // performed again while still running - this is normal behaviour, not an error
        if (didCancel(error)) {
          return;
        }

        if (error?.status === 413 && error?.title) {
          this.args.onWriteError?.(error.title);
          return;
        }
        let message =
          error?.message ??
          (error?.title ? `${error.title}: ${error.message ?? ''}` : undefined);
        this.args.onWriteError?.(message ? message.trim() : String(error));
      });
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

  private saveUnsavedSourceOnClose() {
    // The component destructor and the Monaco modifier's onDispose callback can
    // both run during the same file switch. We only want to persist the pending
    // buffer once for that transition.
    if (
      this.hasSavedUnsavedSourceOnClose ||
      !this.codePath ||
      !this.hasUnsavedSourceChanges
    ) {
      return;
    }

    let monacoContent = this.monacoService.getMonacoContent();
    if (!monacoContent) {
      return;
    }

    this.hasSavedUnsavedSourceOnClose = true;
    this.hasUnsavedSourceChanges = false;
    this.args.saveSourceOnClose(this.codePath, monacoContent);
  }

  private get language(): string | undefined {
    let codePath = this.operatorModeStateService.state.codePath;
    if (codePath) {
      const editorLanguages = this.monacoSDK.languages.getLanguages();
      let extension = '.' + codePath.href.split('.').pop();
      let language = editorLanguages.find((lang) =>
        lang.extensions?.find((ext) => ext === extension),
      );
      return language?.id ?? 'plaintext';
    }
    return undefined;
  }

  private setupFormatAction = (
    editor: import('monaco-editor').editor.IStandaloneCodeEditor,
  ) => {
    this.formatContextKey = editor.createContextKey(
      'boxelFormatSupported',
      this.computeFormatSupport(),
    );
    this.formatActionDisposable = editor.addAction({
      id: 'boxel-format-with-boxel',
      label: 'Format with Boxel',
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 0.5,
      precondition: 'boxelFormatSupported',
      run: () => this.formatWithBoxel.perform(),
    });
    this.updateFormatActionAvailability();
  };

  private isFormatSupported(file: Ready) {
    if (this.args.isReadOnly || file.isBinary) {
      return false;
    }
    let normalizedName = file.name.toLowerCase();
    return normalizedName.endsWith('.gts') || normalizedName.endsWith('.ts');
  }

  private updateFormatActionAvailability() {
    if (!this.formatContextKey) {
      return;
    }
    let supports = this.computeFormatSupport();
    if (!supports) {
      this.formattingError = undefined;
    }
    this.formatContextKey.set(supports && !this.isFormatting);
  }

  private formatWithBoxel = restartableTask(async () => {
    if (this.isFormatting || !this.computeFormatSupport()) {
      return;
    }
    if (!this.monacoService.editor) {
      return;
    }

    let model = this.monacoService.editor.getModel();
    if (!model) {
      return;
    }

    let content = model.getValue();
    let readyFile = this.readyFile;
    this.isFormatting = true;
    this.formattingError = undefined;
    this.updateFormatActionAvailability();

    try {
      let lintCommand = new LintAndFixTool(this.toolService.toolContext);
      await applyBoxelFormatting({
        lintAndFix: (input) => lintCommand.execute(input),
        realm: readyFile.realmURL,
        filename: readyFile.name,
        fileContent: content,
        editor: this.monacoService.editor,
        model,
      });
    } catch (error) {
      console.error(error);
      this.formattingError =
        error instanceof Error ? error.message : String(error);
    } finally {
      this.isFormatting = false;
      this.updateFormatActionAvailability();
    }
  });

  private computeFormatSupport(): boolean {
    if (!isReady(this.args.file)) {
      return false;
    }
    return this.isFormatSupported(this.args.file);
  }

  <template>
    <div
      class='code-editor-shell'
      {{this.syncCodePath this.operatorModeStateService.state.codePath}}
    >
      {{#if this.isBinaryFile}}
        <BinaryFileInfo @readyFile={{this.readyFile}} />
      {{else if this.editorIsReady}}
        <div class='monaco-wrapper'>
          {{#if this.isFormatting}}
            <div
              class='formatting-status'
              data-test-formatting-status
              aria-live='assertive'
            >
              Formatting with Boxel…
            </div>
          {{/if}}
          {{#if this.formattingError}}
            <div
              class='formatting-error'
              data-test-formatting-error
              role='alert'
            >
              {{this.formattingError}}
            </div>
          {{/if}}
          <div
            class='monaco-container {{if this.editorIsReadOnly "readonly"}}'
            data-test-editor
            data-test-percy-hide
            data-monaco-container-operator-mode
            {{monacoModifier
              content=this.editorContent
              contentIdentity=this.editorContentIdentity
              contentChanged=(perform this.contentChangedTask)
              contentChanging=this.contentChanging
              monacoSDK=this.monacoSDK
              language=this.language
              initialCursorPosition=this.initialMonacoCursorPosition
              onCursorPositionChange=this.onCursorPositionChange
              onSetup=this.setupFormatAction
              onDispose=this.onEditorDispose
              readOnly=this.editorIsReadOnly
              editorDisplayOptions=(hash lineNumbersMinChars=3 fontSize=12)
            }}
          ></div>
          {{#if this.sourceIsLoading}}
            <div
              class='source-loading'
              data-test-source-loading
              role='status'
              aria-label='Loading source'
            >
              <LoadingIndicator @color='var(--boxel-light)' />
            </div>
          {{/if}}
        </div>
      {{else}}
        <div class='loading'>
          <LoadingIndicator />
        </div>
      {{/if}}
    </div>

    <style scoped>
      .code-editor-shell {
        height: 100%;
        min-height: 0;
      }
      .monaco-wrapper {
        position: relative;
        height: 100%;
      }

      .formatting-status,
      .formatting-error {
        position: absolute;
        top: var(--boxel-sp-xs);
        left: var(--boxel-sp-xs);
        z-index: 1;
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-sm);
        font: 600 var(--boxel-font-sm);
      }

      .formatting-status {
        background: rgba(49, 132, 255, 0.9);
        color: white;
      }

      .formatting-error {
        top: calc(var(--boxel-sp-xs) + var(--boxel-sp-sm));
        background: rgba(220, 53, 69, 0.9);
        color: white;
        max-width: 60ch;
      }

      .source-loading {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgb(37 35 45 / 55%);
      }

      .monaco-container {
        height: 100%;
        min-height: 100%;
        width: 100%;
        min-width: 100%;
        padding-top: var(--boxel-sp-xxs);
        background-color: var(--monaco-background);
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-caption-font-size);
        font-weight: 500;
      }
      .monaco-container:not(.readonly) {
        filter: contrast(1.05) brightness(1.05);
      }
      .monaco-container.readonly {
        --monaco-background: var(--monaco-readonly-background);
        filter: contrast(1.1) saturate(1.1);
      }
      .monaco-container :deep(.monaco-editor) {
        --vscode-editor-background: var(--monaco-background);
        --vscode-editor-selectionBackground: var(--monaco-selection-background);
        --vscode-editor-inactiveSelectionBackground: var(
          --monaco-inactive-selection-background
        );

        --vscode-editorStickyScroll-background: var(--monaco-background);
        --vscode-editorGutter-background: var(--monaco-background);
        --vscode-editorStickyScroll-shadow: rgba(0 0 0 / 40%);
        --vscode-scrollbar-shadow: rgba(0 0 0 / 20%);
      }
      .monaco-container :deep(.monaco-editor .sticky-widget) {
        box-shadow: 0 1px 15px -2px var(--vscode-editorStickyScroll-shadow);
      }
      .monaco-container.readonly
        :deep(.monaco-editor .view-overlays .current-line-exact) {
        border-color: #454545;
      }
      .loading {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
      }
    </style>
  </template>
}
