import type { SafeString } from '@ember/template';
import Component from '@glimmer/component';

import CodeBlock from '@cardstack/host/modifiers/code-block';
import { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';

import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

interface FormattedMessageSignature {
  sanitizedHtml: SafeString;
  monacoSDK: MonacoSDK;
  renderCodeBlocks: boolean;
}

export default class FormattedMessage extends Component<FormattedMessageSignature> {
  <template>
    {{#if @renderCodeBlocks}}
      <div
        class='message'
        {{CodeBlock
          codeBlockSelector='pre[data-codeblock]'
          languageAttr='data-codeblock'
          monacoSDK=@monacoSDK
          editorDisplayOptions=this.editorDisplayOptions
        }}
      >
        {{@sanitizedHtml}}
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
