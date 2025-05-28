import { registerDestructor } from '@ember/destroyable';
import { hash } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { task, restartableTask, timeout, all } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import isEqual from 'lodash/isEqual';

import { Position } from 'monaco-editor';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import {
  hasExecutableExtension,
  logger,
  isSingleCardDocument,
  isCardInstance,
  meta as metaSymbol,
  codeRefWithAbsoluteURL,
  type SingleCardDocument,
  type PatchData,
} from '@cardstack/runtime-common';
import { getName } from '@cardstack/runtime-common/schema-analysis-plugin';

import monacoModifier from '@cardstack/host/modifiers/monaco';
import { isReady, type FileResource } from '@cardstack/host/resources/file';
import {
  type ModuleDeclaration,
  findDeclarationByName,
} from '@cardstack/host/resources/module-contents';

import { type ModuleContentsResource } from '@cardstack/host/resources/module-contents';
import type CardService from '@cardstack/host/services/card-service';
import type { SaveType } from '@cardstack/host/services/card-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import type MonacoService from '@cardstack/host/services/monaco-service';
import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';
import type StoreService from '@cardstack/host/services/store';

import BinaryFileInfo from './binary-file-info';

interface Signature {
  Args: {
    file: FileResource | undefined;
    moduleContentsResource: ModuleContentsResource | undefined;
    selectedDeclaration: ModuleDeclaration | undefined;
    isReadOnly: boolean;
    saveSourceOnClose: (url: URL, content: string) => void;
    selectDeclaration: (declaration: ModuleDeclaration) => void;
    onFileSave: (status: 'started' | 'finished') => void;
    onSetup: (
      updateCursorByName: (name: string, fieldName?: string) => void,
    ) => void;
  };
}

const log = logger('component:code-editor');

export default class CodeEditor extends Component<Signature> {
  @service private declare monacoService: MonacoService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare cardService: CardService;
  @service private declare environmentService: EnvironmentService;
  @service private declare recentFilesService: RecentFilesService;
  @service private declare store: StoreService;

  @tracked private maybeMonacoSDK: MonacoSDK | undefined;

  private hasUnsavedSourceChanges = false;
  private codePath;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    // note that we actually set our own `codePath` property because within
    // registerDestructor we actually can no longer see the codePath that pertains
    // to the component that is being destroyed--rather we see the new codePath
    // that we are transitioning to.
    this.codePath = this.operatorModeStateService.state.codePath;

    registerDestructor(this, () => {
      // destructor functons are called synchronously. in order to save,
      // which is async, we leverage an EC task that is running in a
      // parent component (EC task lifetimes are bound to their context)
      // that is not being destroyed.
      if (this.codePath && this.hasUnsavedSourceChanges) {
        let monacoContent = this.monacoService.getMonacoContent();
        if (monacoContent) {
          this.args.saveSourceOnClose(this.codePath, monacoContent);
        }
      }
    });

    this.loadMonaco.perform();

    this.args.onSetup(this.updateMonacoCursorPositionByName);
  }

  private get isReady() {
    return this.maybeMonacoSDK && isReady(this.args.file);
  }

  private get isLoading() {
    return (
      this.loadMonaco.isRunning || this.args.moduleContentsResource?.isLoading
    );
  }

  private get declarations() {
    return this.args.moduleContentsResource?.declarations || [];
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
    if (!isReady(this.args.file) || content === this.args.file?.content) {
      return;
    }

    // intentionally not awaiting this
    this.syncWithStore.perform(content);

    await timeout(this.environmentService.autoSaveDelayMs);
    this.writeSourceCodeToFile(
      this.args.file,
      content,
      this.canSyncWithStore(content) ? 'editor-with-instance' : 'editor',
    );
    this.waitForSourceCodeWrite.perform();
    this.hasUnsavedSourceChanges = false;
  });

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
    adoptsFrom = codeRefWithAbsoluteURL(
      adoptsFrom,
      new URL(this.args.file.url),
    );
    if (
      !isEqual(
        adoptsFrom,
        codeRefWithAbsoluteURL(
          json.data.meta.adoptsFrom,
          new URL(this.args.file.url),
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
      await all([this.args.file.writing, timeout(500)]);
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

    // flush the loader so that the preview (when card instance data is shown),
    // or schema editor (when module code is shown) gets refreshed on save
    return file.write(content, {
      flushLoader: hasExecutableExtension(file.name),
      saveType,
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

  <template>
    {{#if this.isReady}}
      {{#if this.readyFile.isBinary}}
        <BinaryFileInfo @readyFile={{this.readyFile}} />
      {{else}}
        <div
          class='monaco-container {{if @isReadOnly "readonly"}}'
          data-test-editor
          data-test-percy-hide
          data-monaco-container-operator-mode
          {{monacoModifier
            content=this.readyFile.content
            contentChanged=(perform this.contentChangedTask)
            monacoSDK=this.monacoSDK
            language=this.language
            initialCursorPosition=this.initialMonacoCursorPosition
            onCursorPositionChange=this.onCursorPositionChange
            readOnly=@isReadOnly
            editorDisplayOptions=(hash lineNumbersMinChars=3 fontSize=13)
          }}
        ></div>
      {{/if}}
    {{else if this.isLoading}}
      <div class='loading'>
        <LoadingIndicator />
      </div>
    {{/if}}

    <style scoped>
      .monaco-container {
        height: 100%;
        min-height: 100%;
        width: 100%;
        min-width: 100%;
        padding-top: var(--boxel-sp-xxs);
        background-color: var(--monaco-background);
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
        margin: 40vh auto;
      }
    </style>
  </template>
}
