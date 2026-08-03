import { registerDestructor } from '@ember/destroyable';
import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';

import { restartableTask, timeout } from 'ember-concurrency';
import Modifier from 'ember-modifier';

import * as MonacoSDK from 'monaco-editor';

import config from '@cardstack/host/config/environment';
import type MonacoService from '@cardstack/host/services/monaco-service';
import { createMonacoWaiterManager } from '@cardstack/host/utils/editor/monaco-test-waiter';

interface Signature {
  Args: {
    Named: {
      content: string;
      contentIdentity?: string;
      contentChanged: (text: string) => void;
      contentChanging?: (
        text: string,
        origin: MonacoContentChangeOrigin,
      ) => void;
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

export type MonacoContentChangeOrigin = 'initial' | 'external' | 'user';

const { monacoDebounceMs, monacoCursorDebounceMs } = config;

export type MonacoEditorOptions =
  MonacoSDK.editor.IStandaloneEditorConstructionOptions;

export default class Monaco extends Modifier<Signature> {
  private model: MonacoSDK.editor.ITextModel | undefined;
  private editor: MonacoSDK.editor.IStandaloneCodeEditor | undefined;
  private lastLanguage: string | undefined;
  private lastContent: string | undefined;
  private lastContentIdentity: string | undefined;
  private lastReadOnly: boolean | undefined;
  private lastModified = Date.now();
  private lastCursorPosition: MonacoSDK.Position | undefined;
  private waiterManager = createMonacoWaiterManager();
  private onDispose: (() => void) | undefined;
  private disposables: MonacoSDK.IDisposable[] = [];
  private modelContentDisposable: MonacoSDK.IDisposable | undefined;
  private contentChanging:
    | ((text: string, origin: MonacoContentChangeOrigin) => void)
    | undefined;
  private pendingBufferOrigin: MonacoContentChangeOrigin = 'initial';
  private isApplyingExternalContent = false;
  @service declare private monacoService: MonacoService;

  modify(
    element: HTMLElement,
    _positional: [],
    {
      content,
      contentIdentity,
      language,
      contentChanged,
      contentChanging,
      initialCursorPosition,
      onCursorPositionChange,
      onSetup,
      onDispose,
      readOnly,
      monacoSDK,
      editorDisplayOptions,
    }: Signature['Args']['Named'],
  ) {
    this.contentChanging = contentChanging;
    if (this.editor && this.model) {
      let contentIdentityChanged = contentIdentity !== this.lastContentIdentity;
      if (
        !contentIdentityChanged &&
        language &&
        language !== this.lastLanguage
      ) {
        monacoSDK.editor.setModelLanguage(this.model, language);
      }
      if (
        content !== this.model.getValue() &&
        (contentIdentityChanged ||
          // Ignore realm event echoes of our own saves by not processing
          // content changes within serverEchoDebounceMs. A different file (or
          // a file becoming ready) must bypass that guard so the persistent
          // HMR editor never remains blank or shows the prior file.
          Date.now() >=
            this.lastModified + this.monacoService.serverEchoDebounceMs)
      ) {
        if (contentIdentityChanged) {
          // Keep the editor DOM mounted, but give each selected file a fresh
          // Monaco text model. Contributions such as sticky scroll retain
          // line geometry asynchronously; mutating one model from a long file
          // into a shorter file can make those queued reads out of range.
          let previousModel = this.model;
          let nextModel = monacoSDK.editor.createModel(content, language);
          this.modelContentDisposable?.dispose();
          this.model = nextModel;
          this.editor.setModel(nextModel);
          this.bindModelContentListener(contentChanged);
          if (
            !previousModel.isDisposed() &&
            !previousModel.isAttachedToEditor()
          ) {
            previousModel.dispose();
          }
          this.lastCursorPosition = undefined;
          this.lastContent = content;
          this.publishCurrentBufferAfterRender('external');
        } else {
          this.lastContent = content;
          this.isApplyingExternalContent = true;
          try {
            this.model.setValue(content);
          } finally {
            this.isApplyingExternalContent = false;
          }
          this.publishCurrentBufferAfterRender('external');
        }
      }
      if (readOnly !== this.lastReadOnly) {
        this.editor.updateOptions({ readOnly });
        this.lastReadOnly = readOnly;
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
        contentChanging,
        onCursorPositionChange,
        onSetup,
      });
    }
    this.lastContentIdentity = contentIdentity;
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
    this.lastReadOnly = readOnly;

    // Track editor initialization for test waiters
    if (this.waiterManager) {
      const operationId = `monaco-modifier-init-${this.editor.getId()}`;
      this.waiterManager.trackEditorInit(this.editor, operationId);
    }

    onSetup?.(this.editor);

    registerDestructor(this, () => {
      this.onDispose?.();
      let model = this.model;
      this.model = undefined;
      let editor = this.editor;
      this.editor = undefined;
      for (let d of this.disposables) {
        try {
          d.dispose();
        } catch {
          // listener disposal during teardown races with Monaco's own dispose;
          // ignore so one bad listener doesn't block the rest
        }
      }
      this.disposables.length = 0;
      this.modelContentDisposable?.dispose();
      this.modelContentDisposable = undefined;
      if (editor) {
        this.disposeEditorAfterInitialLayout(editor, model);
      }
    });

    this.model = this.editor.getModel()!;
    // Give the preview its initial in-memory buffer too. Without this, a
    // private Code-mode Loader can retain the previous file's draft until the
    // first keypress after navigation. This must land after the current render
    // transaction so it does not mutate tracked preview state while
    // CardRenderer is consuming that state.
    this.publishCurrentBufferAfterRender('initial');

    this.bindModelContentListener(contentChanged);
    this.disposables.push(
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
      }),
    );
  }

  private bindModelContentListener(contentChanged: (text: string) => void) {
    this.modelContentDisposable?.dispose();
    this.modelContentDisposable = this.model?.onDidChangeContent(() => {
      if (this.model) {
        if (this.isApplyingExternalContent) {
          this.publishCurrentBufferAfterRender('external');
        } else {
          this.contentChanging?.(this.model.getValue(), 'user');
        }
      }
      this.onContentChanged.perform(contentChanged);
    });
  }

  private publishCurrentBufferAfterRender(origin: MonacoContentChangeOrigin) {
    this.pendingBufferOrigin = origin;
    scheduleOnce('afterRender', this, this.publishCurrentBuffer);
  }

  private publishCurrentBuffer = () => {
    if (this.model) {
      this.contentChanging?.(this.model.getValue(), this.pendingBufferOrigin);
    }
  };

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
        this.monacoService.updateCursorPosition(
          this.model?.validatePosition(position) ?? position,
        );
      }
    },
  );

  private disposeEditorAfterInitialLayout(
    editor: MonacoSDK.editor.IStandaloneCodeEditor,
    model: MonacoSDK.editor.ITextModel | undefined,
  ) {
    // Monaco can still be instantiating editor contributions in the same turn
    // that Glimmer tears the modifier down. Disposing on the next paint avoids
    // tearing down the instantiation service mid-bootstrap without introducing
    // an arbitrary timer. In tests, rAF may never fire between teardown and
    // the next test — dispose synchronously there so Monaco's
    // _codeEditors/_diffEditors registry releases its reference and internal
    // DOMTimers stop retaining the owner.
    let dispose = () => {
      try {
        editor.dispose();
      } catch {
        // partially-instantiated editor — best-effort cleanup
      }
      if (model && !model.isDisposed() && !model.isAttachedToEditor()) {
        model.dispose();
      }
    };
    if (isTesting()) {
      dispose();
    } else {
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Monaco dispose must wait for paint to avoid bootstrap race
      requestAnimationFrame(dispose);
    }
  }
}
