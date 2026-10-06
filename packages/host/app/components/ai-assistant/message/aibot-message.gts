import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';

import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { and, eq } from '@cardstack/boxel-ui/helpers';

import { markdownToHtml } from '@cardstack/runtime-common/marked-sync';

import CodeBlock from '@cardstack/host/components/ai-assistant/code-block';

import { sanitizedHtml } from '@cardstack/host/helpers/sanitized-html';

import type {
  HtmlPreTagGroup,
  CodeData,
} from '@cardstack/host/lib/formatted-message/utils';
import {
  type HtmlTagGroup,
  wrapLastTextNodeInStreamingTextSpan,
} from '@cardstack/host/lib/formatted-message/utils';

import type { MonacoSDK } from '@cardstack/host/services/monaco-service';

import Message from './text-content';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    htmlParts?: HtmlTagGroup[];
    roomId: string;
    eventId: string;
    monacoSDK: MonacoSDK;
    isStreaming: boolean;
    reasoning?: {
      content: string | null;
      isExpanded: boolean;
      updateExpanded: (ev: Event) => void;
    };
  };
  Blocks: {
    default: [];
  };
}

export default class FormattedAiBotMessage extends Component<Signature> {
  @cached
  private get reasoningHtml() {
    // `markdownToHtml()` already sanitizes by default, so this only needs to
    // mark that sanitized result as renderable HTML.
    return htmlSafe(markdownToHtml(this.args.reasoning?.content));
  }

  private isLastHtmlGroup = (index: number) => {
    return index === (this.args.htmlParts?.length ?? 0) - 1;
  };

  private preTagGroupIndex = (htmlPartIndex: number) => {
    return this.args
      .htmlParts!.slice(0, htmlPartIndex)
      .filter(isHtmlPreTagGroup).length;
  };

  <template>
    <Message class='ai-bot-message'>
      {{#if @reasoning}}
        <div class='reasoning-content'>
          {{#if (eq 'Thinking...' @reasoning.content)}}
            Thinking...
          {{else}}
            <details
              open={{@reasoning.isExpanded}}
              {{on 'click' @reasoning.updateExpanded}}
              data-test-reasoning
            >
              <summary>
                Thinking...
              </summary>
              {{this.reasoningHtml}}
            </details>
          {{/if}}
        </div>
      {{/if}}
      {{! We are splitting the html into parts so that we can target the
      code blocks (<pre> tags) and apply Monaco editor to them. Here is an
      example of the html argument:

      <p>Here is some code for you.</p>
      <pre data-codeblock="javascript">const x = 1;</pre>
      <p>I hope you like this code. But here is some more!</p>
      <pre data-codeblock="javascript">const y = 2;</pre>
      <p>Feel free to use it in your project.</p>

      A drawback of this approach is that we can't render monaco editors for
      code blocks that are nested inside other elements. We should make sure
      our skills teach the model to respond with code blocks that are not nested
      inside other elements.
      }}
      {{#each @htmlParts key='@index' as |htmlPart index|}}
        {{#if (isHtmlPreTagGroup htmlPart)}}
          <HtmlGroupCodeBlock
            @codeData={{htmlPart.codeData}}
            @monacoSDK={{@monacoSDK}}
            @index={{this.preTagGroupIndex index}}
          />
        {{else}}
          {{#if (and @isStreaming (this.isLastHtmlGroup index))}}
            {{wrapLastTextNodeInStreamingTextSpan
              (sanitizedHtml htmlPart.content)
            }}
          {{else}}
            {{sanitizedHtml htmlPart.content}}
          {{/if}}
        {{/if}}
      {{/each}}
    </Message>

    <style scoped>
      .ai-bot-message {
        /* the below font-smoothing options are only recommended for light-colored
          text on dark background (otherwise not good for accessibility) */
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      .reasoning-content {
        color: var(--boxel-300);
        font-style: italic;
      }
      .reasoning-content summary {
        cursor: pointer;
      }
      :deep(span.streaming-text:after) {
        content: '';
        width: 8px;
        height: 8px;
        background: currentColor;
        border-radius: 50%;
        display: inline-block;
        font-family: system-ui, sans-serif;
        line-height: normal;
        vertical-align: baseline;
        margin-left: 5px;
      }
    </style>
  </template>
}

function isHtmlPreTagGroup(
  htmlPart: HtmlTagGroup,
): htmlPart is HtmlPreTagGroup {
  return htmlPart.type === 'pre_tag';
}

interface HtmlGroupCodeBlockSignature {
  Element: HTMLDivElement;
  Args: {
    codeData: CodeData;
    monacoSDK: MonacoSDK;
    index: number;
  };
}

const HtmlGroupCodeBlock: TemplateOnlyComponent<HtmlGroupCodeBlockSignature> =
  <template>
    <CodeBlock
      @monacoSDK={{@monacoSDK}}
      @codeData={{@codeData}}
      data-test-code-block-index={{@index}}
      as |codeBlock|
    >
      <codeBlock.editor @code={{@codeData.code}} />
      <codeBlock.actions as |actions|>
        <actions.copyCode @textToCopy={{@codeData.code}} />
      </codeBlock.actions>
    </CodeBlock>
  </template>;
