import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import type { SafeString } from '@ember/template';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Modifier from 'ember-modifier';
import { TrackedArray, TrackedObject } from 'tracked-built-ins';

import { and, eq } from '@cardstack/boxel-ui/helpers';

import { sanitizeHtml } from '@cardstack/runtime-common/dompurify-runtime';

import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';
import LoaderService from '@cardstack/host/services/loader-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import CodeBlock from './code-block';

interface FormattedMessageSignature {
  html: string;
  monacoSDK: MonacoSDK;
  renderCodeBlocks: boolean;
  isStreaming: boolean;
}

interface CodeAction {
  fileUrl: string;
  code: string;
  containerElement: HTMLDivElement;
  state: 'ready' | 'applying' | 'applied' | 'failed';
}

interface HtmlTagGroup {
  type: 'pre_tag' | 'non_pre_tag';
  content: string;
}

function sanitize(html: string): SafeString {
  return htmlSafe(sanitizeHtml(html));
}

export default class FormattedMessage extends Component<FormattedMessageSignature> {
  @tracked codeActions: TrackedArray<CodeAction> = new TrackedArray([]);
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
  @service private declare commandService: CommandService;
  @tracked htmlGroups: TrackedArray<HtmlTagGroup> = new TrackedArray([]);
  @tracked copyCodeButtonText: 'Copy' | 'Copied' = 'Copy';

  // When html is streamed, we need to update htmlParts accordingly,
  // but only the parts that have changed so that we don't needlesly re-render
  // parts of the message that haven't changed. Parts are: <pre> html code, and
  // non-<pre> html. <pre> gets special treatment because we will render it as a
  // (readonly) Monaco editor
  updateHtmlGroups = (html: string) => {
    let htmlGroups = parseHtmlContent(html);
    if (!this.htmlGroups.length) {
      this.htmlGroups = new TrackedArray(
        htmlGroups.map((part) => {
          return new TrackedObject({
            type: part.type,
            content: part.content,
          });
        }),
      );
    } else {
      this.htmlGroups.forEach((oldPart, index) => {
        let newPart = htmlGroups[index];
        if (oldPart.content !== newPart.content) {
          oldPart.content = newPart.content;
        }
      });
      if (htmlGroups.length > this.htmlGroups.length) {
        this.htmlGroups.push(
          ...htmlGroups.slice(this.htmlGroups.length).map((part) => {
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
      this.updateHtmlGroups(html);
    });
  };

  isLastHtmlGroup = (index: number) => {
    return index === this.htmlGroups.length - 1;
  };

  <template>
    {{#if @renderCodeBlocks}}
      <div
        class='message'
        {{HtmlDidUpdate html=@html onHtmlUpdate=this.onHtmlUpdate}}
      >
        {{! We are splitting the html into parts so that we can target the
        code blocks (<pre> tags) and apply Monaco editor to them. Here is an
        example of the html argument:

        <p>Here is some code for you.</p>
        <pre data-codeblock="javascript">const x = 1;</pre>
        <p>I hope you like this code. But here is some more!</p>
        <pre data-codeblock="javascript">const y = 2;</pre>
        <p>Feel free to use it in your project.</p>
        }}
        {{#each this.htmlGroups as |htmlGroup index|}}
          {{#if (eq htmlGroup.type 'pre_tag')}}
            {{#let (extractCodeData htmlGroup.content) as |codeData|}}
              <CodeBlock
                @monacoSDK={{@monacoSDK}}
                @code={{codeData.content}}
                @language={{codeData.language}}
              />
            {{/let}}
          {{else}}
            {{#if (and @isStreaming (this.isLastHtmlGroup index))}}
              {{wrapLastTextNodeInStreamingTextSpan
                (sanitize htmlGroup.content)
              }}
            {{else}}
              {{sanitize htmlGroup.content}}
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
        margin-top: 5px;
        z-index: 1;
        height: 39px;
        padding: 18px 25px;
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

function parseHtmlContent(htmlString: string): HtmlTagGroup[] {
  const result: HtmlTagGroup[] = [];

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
      language: '',
      content: '',
    };
  }
  // Extract language using regex - finds the value of data-codeblock attribute
  const languageMatch = preElementString.match(/data-code-language="([^"]+)"/);
  const language = languageMatch ? languageMatch[1] : null;

  // Extract content using regex - finds everything between the opening and closing pre tags
  const contentMatch = preElementString.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
  const content = contentMatch ? contentMatch[1] : null;

  return {
    language: language ?? '',
    content: content ?? '',
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

function wrapLastTextNodeInStreamingTextSpan(
  html: string | SafeString,
): SafeString {
  let parser = new DOMParser();
  let doc = parser.parseFromString(html.toString(), 'text/html');
  let lastTextNode = findLastTextNodeWithContent(doc.body);
  if (lastTextNode) {
    let span = doc.createElement('span');
    span.textContent = lastTextNode.textContent;
    span.classList.add('streaming-text');
    lastTextNode.replaceWith(span);
  }
  return htmlSafe(doc.body.innerHTML);
}
