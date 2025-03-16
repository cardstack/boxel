import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import type { SafeString } from '@ember/template';
import Component from '@glimmer/component';
import { restartableTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import { TrackedArray, TrackedObject } from 'tracked-built-ins';

import ApplySearchReplaceBlockCommand from '@cardstack/host/commands/apply-search-replace-block';
// import CodeBlock from '@cardstack/host/modifiers/code-block';
import { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';

import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';
import LoaderService from '@cardstack/host/services/loader-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import ApplyButton from '../ai-assistant/apply-button';
import Modifier from 'ember-modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import { scheduleOnce } from '@ember/runloop';
import { action } from '@ember/object';
import { registerDestructor } from '@ember/destroyable';
import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';
import CodeBlock from './code-block';
interface FormattedMessageSignature {
  html: string;
  monacoSDK: MonacoSDK;
  renderCodeBlocks: boolean;
}

interface CodeAction {
  fileUrl: string;
  code: string;
  containerElement: HTMLDivElement;
  state: 'ready' | 'applying' | 'applied' | 'failed';
}

interface HtmlPart {
  type: 'pre_tag' | 'non_pre_tag';
  content: string;
}

import { sanitizeHtml } from '@cardstack/runtime-common/dompurify-runtime';

function sanitize(html: string): SafeString {
  return htmlSafe(sanitizeHtml(html));
}

export default class FormattedMessage extends Component<FormattedMessageSignature> {
  @tracked codeActions: TrackedArray<CodeAction> = new TrackedArray([]);
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
  @service private declare commandService: CommandService;
  @tracked htmlParts: TrackedArray<Html> = new TrackedArray([]);
  @tracked copyCodeButtonText: 'Copy' | 'Copied' = 'Copy';

  registerCodeBlockContainer = (
    fileUrl: string,
    code: string,
    codeActionContainerElement: HTMLDivElement,
  ) => {
    let searchReplaceRegex =
      /<<<<<<< SEARCH\n(.*)\n=======\n(.*)\n>>>>>>> REPLACE/s;
    let codeIsSearchReplaceBlock = searchReplaceRegex.test(code);

    if (!codeIsSearchReplaceBlock) {
      return; // only show apply button for search/replace code blocks
    }

    this.codeActions.push(
      new TrackedObject({
        fileUrl,
        code,
        containerElement: codeActionContainerElement,
        state: 'ready' as CodeAction['state'],
      }),
    );
  };

  private patchCodeTask = task(async (codeAction: CodeAction) => {
    codeAction.state = 'applying';
    try {
      let source = await this.cardService.getSource(
        new URL(codeAction.fileUrl),
      );

      let applySearchReplaceBlockCommand = new ApplySearchReplaceBlockCommand(
        this.commandService.commandContext,
      );

      let { resultContent: patchedCode } =
        await applySearchReplaceBlockCommand.execute({
          fileContent: source,
          codeBlock: codeAction.code,
        });

      await this.cardService.saveSource(
        new URL(codeAction.fileUrl),
        patchedCode,
      );
      this.loaderService.reset();

      codeAction.state = 'applied';
    } catch (error) {
      console.error(error);
      codeAction.state = 'failed';
    }
  });

  // When html is streamed, we need to update htmlParts accordingly,
  // but only the parts that have changed so that we don't needlesly re-render
  // parts of the message that haven't changed. Parts are: <pre> html code, and
  // non-<pre> html. <pre> gets special treatment because we will render it as a
  // (readonly) Monaco editor
  updateHtmlParts = (html: string) => {
    let htmlParts = parseHtmlContent(html);
    if (!this.htmlParts.length) {
      this.htmlParts = new TrackedArray(
        htmlParts.map((part) => {
          return new TrackedObject({
            type: part.type,
            content: part.content,
          });
        }),
      );
    } else {
      this.htmlParts.forEach((oldPart, index) => {
        let newPart = htmlParts[index];
        if (oldPart.content !== newPart.content) {
          oldPart.content = newPart.content;
        }
      });
      if (htmlParts.length > this.htmlParts.length) {
        this.htmlParts.push(
          ...htmlParts.slice(this.htmlParts.length).map((part) => {
            return new TrackedObject({
              type: part.type,
              content: part.content,
            });
          }),
        );
      }
    }
  };

  onHtmlUpdate = (html: string) => {
    // The reason why reacting to html argument this way is because we want to
    // have full control of when the @html argument changes so that we can
    // properly fragment it into htmlParts, and in our reactive structure, only update
    // the parts that have changed.
    // eslint-disable-next-line ember/no-incorrect-calls-with-inline-anonymous-functions
    scheduleOnce('afterRender', () => {
      this.updateHtmlParts(html);
    });
  };

  <template>
    {{#if @renderCodeBlocks}}
      <div
        class='message'
        {{HtmlDidUpdate html=@html onHtmlUpdate=this.onHtmlUpdate}}
      >
        {{#each this.htmlParts as |part|}}
          {{#if (eq part.type 'pre_tag')}}
            {{#let (extractCodeData part.content) as |codeData|}}
              <CodeBlock
                @monacoSDK={{@monacoSDK}}
                @editorDisplayOptions={{this.editorDisplayOptions}}
                @code={{codeData.content}}
                @language={{codeData.language}}
                class='code-block'
              />
            {{/let}}
          {{else}}
            {{#if @isStreaming}}
              {{wrapLastTextNodeInStreamingTextSpan (sanitize part.content)}}
            {{else}}
              {{sanitize part.content}}
            {{/if}}
          {{/if}}
        {{/each}}
      </div>
    {{else}}
      <div class='message'>
        {{sanitize @html}}
      </div>
    {{/if}}

    <style scoped>
      .copy-icon {
        --icon-color: var(--boxel-highlight);
      }
      .message {
        position: relative;
      }

      .message > :deep(*) {
        margin-top: 0;
      }

      .message > :deep(.code-block + :not(.code-block)) {
        margin-top: 25px;
      }

      .ai-assistant-code-block-actions {
        position: absolute;
        width: calc(100% + 2 * var(--ai-assistant-message-padding));
        margin-left: -16px;
        background: black;
        margin-top: 5px !important;
        z-index: 1;
        height: 39px;
        padding: 18px 25px;
      }

      /* code blocks can be rendered inline and as blocks,
         this is the styling for when it is rendered as a block */

      .code-block {
        --spacing: var(--boxel-sp-sm);
        --fill-container-spacing: calc(
          -1 * var(--ai-assistant-message-padding)
        );
        margin: var(--boxel-sp) var(--fill-container-spacing) 0
          var(--fill-container-spacing);
        padding: var(--spacing) 0;
        background-color: var(--boxel-dark);
        width: 100%;
        position: relative;
        margin-top: 60px;
      }

      .code-copy-button {
        color: var(--boxel-highlight);
        background: none;
        border: none;
        font: 600 var(--boxel-font-xs);
        padding: 0;
        display: flex;
      }

      .code-copy-button svg {
        margin-right: var(--boxel-sp-xs);
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
      :global(.code-block .monaco-editor) {
        filter: invert(1) hue-rotate(151deg) brightness(0.8) grayscale(0.1);
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
    minimap: {
      enabled: false,
    },
  };
}

interface HtmlDidUpdateSignature {
  Args: {
    Named: {
      html: string;
      onHtmlUpdate: (html: string) => void;
    };
  };
}

class HtmlDidUpdate extends Modifier<HtmlDidUpdateSignature> {
  modify(
    _element: HTMLElement,
    _positional: [],
    { html, onHtmlUpdate }: HtmlDidUpdateSignature['Args']['Named'],
  ) {
    onHtmlUpdate(html);
  }
}

function parseHtmlContent(htmlString: string): HtmlPart[] {
  const result: HtmlPart[] = [];

  // Regular expression to match <pre> tags and their content
  const regex = /(<pre[\s\S]*?<\/pre>)|([\s\S]+?)(?=<pre|$)/g;

  let match;
  while ((match = regex.exec(htmlString)) !== null) {
    if (match[1]) {
      // This is a code block (pre tag)
      result.push({
        type: 'pre_tag',
        content: match[1],
      });
    } else if (match[2] && match[2].trim() !== '') {
      // This is non <pre> tag HTML
      result.push({
        type: 'non_pre_tag',
        content: match[2],
      });
    }
  }

  return result;
}

function extractCodeData(preElementString: string) {
  if (!preElementString) {
    return {
      language: null,
      content: null,
    };
  }
  // Extract language using regex - finds the value of data-codeblock attribute
  const languageMatch = preElementString.match(/data-codeblock="([^"]+)"/);
  const language = languageMatch ? languageMatch[1] : null;

  // Extract content using regex - finds everything between the opening and closing pre tags
  const contentMatch = preElementString.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
  const content = contentMatch ? contentMatch[1] : null;

  return {
    language,
    content,
  };
}

function findLastTextNodeWithContent(parentNode: Node): Text | null {
  // iterate childNodes in reverse to find the last text node with non-whitespace text
  for (let i = parentNode.childNodes.length - 1; i >= 0; i--) {
    let child = parentNode.childNodes[i];
    if (child.textContent && child.textContent.trim() !== '') {
      if (child instanceof Text) {
        return child;
      }
      return findLastTextNodeWithContent(child);
    }
  }
  return null;
}

function wrapLastTextNodeInStreamingTextSpan(html: string): SafeString {
  let parser = new DOMParser();
  let doc = parser.parseFromString(html, 'text/html');
  let lastTextNode = findLastTextNodeWithContent(doc.body);
  if (lastTextNode) {
    let span = doc.createElement('span');
    span.textContent = lastTextNode.textContent;
    span.classList.add('streaming-text');
    lastTextNode.replaceWith(span);
  }
  return htmlSafe(doc.body.innerHTML);
}
