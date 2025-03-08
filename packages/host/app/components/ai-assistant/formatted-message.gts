import type { SafeString } from '@ember/template';
import Component from '@glimmer/component';

import CodeBlock from '@cardstack/host/modifiers/code-block';
import { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';

import { type MonacoSDK } from '@cardstack/host/services/monaco-service';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import ApplyButton from '../ai-assistant/apply-button';
import { fn } from '@ember/helper';

import type CardService from '@cardstack/host/services/card-service';
import { service } from '@ember/service';
import LoaderService from '@cardstack/host/services/loader-service';
interface FormattedMessageSignature {
  sanitizedHtml: SafeString;
  monacoSDK: MonacoSDK;
  renderCodeBlocks: boolean;
}

interface CodeAction {
  fileUrl: string;
  code: string;
  element: HTMLButtonElement;
}

export default class FormattedMessage extends Component<FormattedMessageSignature> {
  @tracked actionElements: TrackedArray<CodeAction> = new TrackedArray([]);
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;

  registerMonacoEditor = (
    monacoContainer: HTMLElement,
    actionElement: HTMLButtonElement,
    editor: MonacoSDK.editor.IStandaloneCodeEditor,
    model: MonacoSDK.editor.ITextModel,
  ) => {
    this.actionElements.push({
      fileUrl: monacoContainer.getAttribute('data-file-url') ?? '',
      code: model.getValue(),
      element: actionElement,
    });
  };

  // todo ec task
  @action async patchCode(codeAction: CodeAction) {
    debugger;

    let source = await this.cardService.getSource(new URL(codeAction.fileUrl));
    let patched = applyPatch(source, codeAction.code);
    await this.cardService.saveSource(new URL(codeAction.fileUrl), patched);
    this.loaderService.reset();
  }

  <template>
    {{#if @renderCodeBlocks}}
      <div
        class='message'
        {{CodeBlock
          codeBlockSelector='pre[data-codeblock]'
          languageAttr='data-codeblock'
          monacoSDK=@monacoSDK
          editorDisplayOptions=this.editorDisplayOptions
          registerMonacoEditor=this.registerMonacoEditor
        }}
      >

        {{@sanitizedHtml}}

        {{#each this.actionElements as |actionElement index|}}
          {{#in-element actionElement.element}}
            <ApplyButton
              @state='ready'
              {{on 'click' (fn this.patchCode actionElement)}}
            />
          {{/in-element}}
        {{/each}}
      </div>
    {{else}}
      <div class='message'>
        {{@sanitizedHtml}}
      </div>
    {{/if}}

    <style scoped>
      /* code blocks can be rendered inline and as blocks,
         this is the styling for when it is rendered as a block */
      .message > :deep(.preview-code.code-block) {
        width: calc(100% + 2 * var(--boxel-sp));
      }

      .message > :deep(*) {
        margin-top: 0;
        margin-bottom: 0;
      }

      .message > :deep(* + *) {
        margin-top: var(--boxel-sp);
      }

      :deep(.preview-code) {
        --spacing: var(--boxel-sp-sm);
        --fill-container-spacing: calc(
          -1 * var(--ai-assistant-message-padding)
        );
        margin: var(--boxel-sp) var(--fill-container-spacing) 0
          var(--fill-container-spacing);
        padding: var(--spacing) 0;
        background-color: var(--boxel-dark);
      }

      :deep(.preview-code.code-block) {
        display: inline-block; /* sometimes the ai bot may place the codeblock within an <li> */
        width: 100%;
        position: relative;
        padding-top: var(--boxel-sp-xxxl);
      }

      :deep(.monaco-container) {
        height: var(--monaco-container-height);
        min-height: 7rem;
        max-height: 30vh;
      }

      /*
        This filter is a best-effort approximation of a good looking dark theme that is a function of the white theme that
        we use for code previews in the AI panel. While Monaco editor does support multiple themes, it does not support
        monaco instances with different themes *on the same page*. This is why we are using a filter to approximate the
        dark theme. More details here: https://github.com/Microsoft/monaco-editor/issues/338 (monaco uses global style tags
        with hardcoded colors; any instance will override the global style tag, making all code editors look the same,
        effectively disabling multiple themes to be used on the same page)
      */
      :global(.preview-code .monaco-editor) {
        filter: invert(1) hue-rotate(151deg) brightness(0.8) grayscale(0.1);
      }

      /* we are cribbing the boxel-ui style here as we have a rather
      awkward way that we insert the copy button */
      :deep(.code-copy-button) {
        --spacing: calc(1rem / 1.333);

        position: absolute;
        top: var(--boxel-sp);
        left: var(--boxel-sp-lg);
        color: var(--boxel-highlight);
        background: none;
        border: none;
        font: 600 var(--boxel-font-xs);
        padding: 0;
        margin-bottom: var(--spacing);
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--spacing);
        letter-spacing: var(--boxel-lsp-xs);
        justify-content: center;
        height: min-content;
        align-items: center;
        white-space: nowrap;
        min-height: var(--boxel-button-min-height);
        min-width: var(--boxel-button-min-width, 5rem);
      }
      :deep(.code-copy-button .copy-text) {
        color: transparent;
      }
      :deep(.code-copy-button:hover .copy-text) {
        color: var(--boxel-highlight);
      }

      :deep(.code-actions) {
        position: absolute;
        top: 10px;
        right: 10px;
      }
    </style>
  </template>

  private editorDisplayOptions: MonacoEditorOptions = {
    wordWrap: 'on',
    wrappingIndent: 'indent',
    fontWeight: 'bold',
    scrollbar: {
      alwaysConsumeMouseWheel: false,
    },
    lineNumbers: 'off',
  };
}

/**
 * Applies a search/replace patch to a file's content
 * @param {string} fileContent - The content of the file to be patched
 * @param {string} patchText - The patch text in the specified format
 * @returns {string} Updated file content with patch applied
 */
export function applyPatch(fileContent, patchText) {
  // Parse the patch text to extract search and replace content
  const { searchText, replaceText } = parsePatch(patchText);

  // Check if search text exists in the file content
  if (!fileContent.includes(searchText)) {
    throw new Error('Search text not found in file content');
  }

  // Apply the patch by replacing the search text with the replace text
  return fileContent.replace(searchText, replaceText);
}

/**
 * Parses a search/replace block to extract search and replace text
 * @param {string} patchText - The patch text in the specified format
 * @returns {Object} Object containing searchText and replaceText
 */
function parsePatch(patchText) {
  const lines = patchText.split('\n');

  // Find the start of the search block
  const searchStartIndex = lines.findIndex(
    (line) => line.trim() === '<<<<<<< SEARCH',
  );
  if (searchStartIndex === -1) {
    throw new Error('Search marker not found');
  }

  // Find the divider
  const dividerIndex = lines.findIndex((line) => line.trim() === '=======');
  if (dividerIndex === -1) {
    throw new Error('Divider marker not found');
  }

  // Find the end of the replace block
  const replaceEndIndex = lines.findIndex(
    (line) => line.trim() === '>>>>>>> REPLACE',
  );
  if (replaceEndIndex === -1) {
    throw new Error('Replace marker not found');
  }

  // Extract the search and replace text
  const searchText = lines.slice(searchStartIndex + 1, dividerIndex).join('\n');
  const replaceText = lines.slice(dividerIndex + 1, replaceEndIndex).join('\n');

  return { searchText, replaceText };
}
