import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';

import { restartableTask, timeout } from 'ember-concurrency';
import Modifier from 'ember-modifier';

import * as MonacoSDK from 'monaco-editor';

import config from '@cardstack/host/config/environment';
import type MonacoService from '@cardstack/host/services/monaco-service';
import { createMonacoWaiterManager } from '@cardstack/host/utils/monaco-test-waiter';
import '@cardstack/requirejs-monaco-ember-polyfill';

interface Signature {
  Args: {
    Named: {
      content: string;
      contentChanged: (text: string) => void;
      initialCursorPosition?: MonacoSDK.Position;
      onCursorPositionChange?: (position: MonacoSDK.Position) => void;
      onSetup?: (editor: MonacoSDK.editor.IStandaloneCodeEditor) => void;
      onDispose?: () => void;
      language?: string;
      readOnly?: boolean;
      monacoSDK: typeof MonacoSDK;
      editorDisplayOptions?: MonacoEditorOptions;
    };
  };
}

const { monacoDebounceMs, monacoCursorDebounceMs } = config;

export type MonacoEditorOptions =
  MonacoSDK.editor.IStandaloneEditorConstructionOptions;

export default class Monaco extends Modifier<Signature> {
  private model: MonacoSDK.editor.ITextModel | undefined;
  private editor: MonacoSDK.editor.IStandaloneCodeEditor | undefined;
  private lastLanguage: string | undefined;
  private lastContent: string | undefined;
  private lastModified = Date.now();
  private lastCursorPosition: MonacoSDK.Position | undefined;
  private waiterManager = createMonacoWaiterManager();
  private onDispose: (() => void) | undefined;
  @service declare private monacoService: MonacoService;

  modify(
    element: HTMLElement,
    _positional: [],
    {
      content,
      language,
      contentChanged,
      initialCursorPosition,
      onCursorPositionChange,
      onSetup,
      onDispose,
      readOnly,
      monacoSDK,
      editorDisplayOptions,
    }: Signature['Args']['Named'],
  ) {
    if (this.editor && this.model) {
      if (language && language !== this.lastLanguage) {
        monacoSDK.editor.setModelLanguage(this.model, language);
      }
      if (
        content !== this.model.getValue() &&
        // ignore realm event echoes of our own saves by not processing content changes
        // within serverEchoDebounceMs of the last monaco change in memory
        Date.now() >=
          this.lastModified + this.monacoService.serverEchoDebounceMs
      ) {
        this.lastContent = content;
        this.model.setValue(content);
      }
    } else {
      this.setupEditor({
        element,
        content,
        language,
        readOnly,
        editorDisplayOptions,
        monacoSDK,
        contentChanged,
        onCursorPositionChange,
        onSetup,
      });
    }
    this.lastLanguage = language;

    if (initialCursorPosition != null) {
      this.initializeCursorPosition.perform(initialCursorPosition);
    }
    this.onDispose = onDispose;
  }

  private setupEditor({
    element,
    content,
    language,
    readOnly,
    editorDisplayOptions,
    monacoSDK,
    contentChanged,
    onCursorPositionChange,
    onSetup,
  }: Omit<Signature['Args']['Named'], 'initialCursorPosition'> & {
    element: HTMLElement;
  }) {
    monacoSDK.editor.defineTheme('boxel-monaco-dark-theme', {
      base: 'vs-dark', // base themes: vs, vs-dark
      inherit: true,
      rules: [],
      colors: {
        'editor.background': readOnly ? '#606060' : '#413e4e',
      },
    });

    let editorOptions: MonacoEditorOptions = {
      readOnly,
      value: content,
      language,
      scrollBeyondLastLine: true,
      automaticLayout: true,
      minimap: {
        enabled: false,
      },
      theme: 'boxel-monaco-dark-theme',
      ...editorDisplayOptions,
    };

    // Code rendering is inconsistently wrapped without this, producing spurious visual diffs
    if (isTesting()) {
      editorOptions.wordWrap = 'on';
    }

    this.editor = monacoSDK.editor.create(element, editorOptions);

    // Track editor initialization for test waiters
    if (this.waiterManager) {
      const operationId = `monaco-modifier-init-${this.editor.getId()}`;
      this.waiterManager.trackEditorInit(this.editor, operationId);
    }

    onSetup?.(this.editor);

    registerDestructor(this, () => {
      this.onDispose?.();
      this.editor!.dispose();
    });

    this.model = this.editor.getModel()!;

    this.model.onDidChangeContent(() =>
      this.onContentChanged.perform(contentChanged),
    );
    this.editor.onDidChangeCursorSelection((event) => {
      if (
        this.editor &&
        event.source !== 'model' &&
        event.selection.startLineNumber === event.selection.endLineNumber &&
        event.selection.startColumn === event.selection.endColumn
      ) {
        let position = this.editor.getPosition();
        if (position) {
          onCursorPositionChange?.(position);
          this.lastCursorPosition = position;
        }
      }
    });
  }

  private onContentChanged = restartableTask(
    async (contentChanged: (text: string) => void) => {
      let content = this.model?.getValue();
      if (this.lastContent === content) {
        return;
      }
      this.lastModified = Date.now();
      await timeout(monacoDebounceMs);
      if (this.model) {
        this.lastContent = this.model.getValue();
        contentChanged(this.lastContent);
      }
    },
  );

  // Initialize cursor position asynchronously
  // to avoid potential effects on other elements.
  // If this affects other elements, there is a potential double update to a value in the same computation,
  // leading to an infinite Glimmer invalidation error.
  private initializeCursorPosition = restartableTask(
    async (position?: MonacoSDK.Position) => {
      await timeout(monacoCursorDebounceMs);
      if (!position) {
        position = new MonacoSDK.Position(1, 1);
      }
      if (!this.lastCursorPosition) {
        this.monacoService.updateCursorPosition(position);
      }
    },
  );
}
