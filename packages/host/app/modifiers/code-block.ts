import { registerDestructor } from '@ember/destroyable';

import { isTesting } from '@embroider/macros';

import Modifier from 'ember-modifier';

import * as MonacoSDK from 'monaco-editor';

import { MonacoEditorOptions } from './monaco';

import '@cardstack/requirejs-monaco-ember-polyfill';

interface Signature {
  Args: {
    Named: {
      codeBlockSelector: string;
      languageAttr: string;
      monacoSDK: typeof MonacoSDK;
      editorDisplayOptions?: MonacoEditorOptions;
    };
  };
}

export default class CodeBlock extends Modifier<Signature> {
  private monacoState: {
    editor: MonacoSDK.editor.IStandaloneCodeEditor;
    model: MonacoSDK.editor.ITextModel;
    language: string | undefined;
  }[] = [];
  modify(
    element: HTMLElement,
    _positional: [],
    {
      codeBlockSelector,
      languageAttr,
      monacoSDK,
      editorDisplayOptions,
      registerMonacoEditor,
    }: Signature['Args']['Named'],
  ) {
    let codeBlocks = element.querySelectorAll(codeBlockSelector);
    if (!codeBlocks || codeBlocks.length === 0) {
      return;
    }

    for (let [index, codeBlockNode] of [...codeBlocks].entries()) {
      let codeBlock = codeBlockNode as HTMLElement;
      let id = codeBlock.id;
      if (!id) {
        continue;
      }
      // note that since the localstorage item was set from runtime-common there
      // was no ember-window-mock available, so we can't use window mock here
      let maybeContent = window.localStorage.getItem(id);
      window.localStorage.removeItem(id);
      if (maybeContent == null) {
        continue;
      }
      let content = maybeContent;
      let lines = content.split('\n').length;
      // if first line is // File url: http://localhost:4201/jurgen/jurgens/author.gts
      // then parse the file url in a variable and remove the first line
      let fileUrl = undefined;
      debugger;
      if (content.startsWith('// File url: ')) {
        let firstLine = content.split('\n')[0];
        // use regex to extract the file url
        let fileUrlRegex = /File url: (.*)/;
        let fileUrlMatch = firstLine.match(fileUrlRegex);
        if (fileUrlMatch) {
          fileUrl = fileUrlMatch[1];
        }
        content = content.slice(firstLine.length).trimStart();
      }
      let language = codeBlock.getAttribute(languageAttr) ?? undefined;
      let state = this.monacoState[index];
      if (state) {
        let { model, language: lastLanguage } = state;
        if (language && language !== lastLanguage) {
          monacoSDK.editor.setModelLanguage(model, language);
        }
        if (content !== model.getValue()) {
          model.setValue(content);
        }
      } else {
        // The light theme editor is used for the main editor in code mode,
        // but we also have a dark themed editor for the preview editor in AI panel.
        // The latter is themed using a CSS filter as opposed to defining a new monaco theme
        // because monaco does not support multiple themes on the same page (check the comment in
        // room-message-command.gts for more details)
        monacoSDK.editor.defineTheme('boxel-monaco-light-theme', {
          base: 'vs',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': '#FFFFFF',
          },
        });

        let editorOptions: MonacoEditorOptions = {
          readOnly: true,
          value: content,
          language,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          minimap: {
            enabled: false,
          },
          theme: 'boxel-monaco-light-theme',
          ...editorDisplayOptions,
        };

        // Code rendering is inconsistently wrapped without this,
        // producing spurious visual diffs
        if (isTesting()) {
          editorOptions.wordWrap = 'on';
        }
        let monacoContainer = document.createElement('div');
        monacoContainer.setAttribute(
          'class',
          'preview-code monaco-container code-block',
        );
        monacoContainer.setAttribute('style', `height: ${lines + 4}rem`);
        monacoContainer.setAttribute('data-file-url', fileUrl ?? '');
        codeBlock.replaceWith(monacoContainer);
        let editor = monacoSDK.editor.create(monacoContainer, editorOptions);
        let model = editor.getModel()!;

        let actionsElement = makeActionsDiv();
        monacoContainer.insertBefore(
          actionsElement,
          monacoContainer.firstChild,
        );

        registerMonacoEditor(monacoContainer, actionsElement, editor, model);
        this.monacoState.push({ editor, model, language });

        let copyButton = makeCopyButton();
        monacoContainer.insertBefore(copyButton, monacoContainer.firstChild);
        copyButton.onclick = (event) => {
          let buttonElement = event.currentTarget as HTMLElement;
          let codeBlock = buttonElement.nextElementSibling;
          if (codeBlock) {
            navigator.clipboard.writeText(content).then(() => {
              let svg = buttonElement.children[0];
              let copyText = buttonElement.children[1];
              buttonElement.replaceChildren(
                svg,
                document.createTextNode('Copied'),
              );
              setTimeout(
                () => buttonElement.replaceChildren(svg, copyText),
                2000,
              );
            });
          }
        };
      }
    }

    registerDestructor(this, () => {
      for (let { editor } of this.monacoState) {
        editor.dispose();
      }
    });
  }
}

function makeActionsDiv() {
  let template = document.createElement('template');
  template.innerHTML = `
    <div id=${Math.random().toString(36).substring(2, 15)} class="code-actions">
    </div>
  `.trim();
  return template.content.firstChild as HTMLButtonElement;
}

function makeCopyButton() {
  let template = document.createElement('template');
  template.innerHTML = `
    <button class="code-copy-button">
      <svg
        xmlns='http://www.w3.org/2000/svg'
        width='16'
        height='16'
        fill='none'
        stroke='currentColor'
        stroke-linecap='round'
        stroke-linejoin='round'
        stroke-width='3'
        class='lucide lucide-copy'
        viewBox='0 0 24 24'
        role='presentation'
        aria-hidden='true'
        ...attributes
      ><rect width='14' height='14' x='8' y='8' rx='2' ry='2' /><path
          d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
        />
      </svg>
      <span class="copy-text">Copy to clipboard</span>
    </button>
  `.trim();
  return template.content.firstChild as HTMLButtonElement;
}
