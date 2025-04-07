import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import type { SafeString } from '@ember/template';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { Resource } from 'ember-resources';
import { TrackedArray, TrackedObject } from 'tracked-built-ins';

import { and, bool, eq } from '@cardstack/boxel-ui/helpers';

import { sanitizeHtml } from '@cardstack/runtime-common/dompurify-runtime';

import ApplySearchReplaceBlockCommand from '@cardstack/host/commands/apply-search-replace-block';

import {
  extractCodeData,
  wrapLastTextNodeInStreamingTextSpan,
} from '@cardstack/host/lib/formatted-message/utils';

import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';
import LoaderService from '@cardstack/host/services/loader-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import CodeBlock from './code-block';

export interface CodeData {
  fileUrl: string | null;
  code: string | null;
  language: string | null;
  searchReplaceBlock?: string | null;
}

interface FormattedMessageSignature {
  html: string;
  monacoSDK: MonacoSDK;
  renderCodeBlocks: boolean;
  isStreaming: boolean;
}

interface HtmlTagGroup {
  type: 'pre_tag' | 'non_pre_tag';
  content: string;
}

function sanitize(html: string): SafeString {
  return htmlSafe(sanitizeHtml(html));
}

export default class FormattedMessage extends Component<FormattedMessageSignature> {
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
  @service private declare commandService: CommandService;
  @tracked htmlGroups: TrackedArray<HtmlTagGroup> = new TrackedArray([]);

  // When html is streamed, we need to update htmlParts accordingly,
  // but only the parts that have changed so that we don't needlesly re-render
  // parts of the message that haven't changed. Parts are: <pre> html code, and
  // non-<pre> html. <pre> gets special treatment because we will render it as a
  // (readonly) Monaco editor
  private updateHtmlGroups = (html: string) => {
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

  private onHtmlUpdate = (html: string) => {
    // The reason why reacting to html argument this way is because we want to
    // have full control of when the @html argument changes so that we can
    // properly fragment it into htmlParts, and in our reactive structure, only update
    // the parts that have changed.

    // eslint-disable-next-line ember/no-incorrect-calls-with-inline-anonymous-functions
    scheduleOnce('afterRender', () => {
      this.updateHtmlGroups(html);
    });
  };

  private isLastHtmlGroup = (index: number) => {
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

        A drawback of this approach is that we can't render monaco editors for
        code blocks that are nested inside other elements. We should make sure
        our skills teach the model to respond with code blocks that are not nested
        inside other elements.
        }}
        {{#each this.htmlGroups as |htmlGroup index|}}
          {{#if (eq htmlGroup.type 'pre_tag')}}
            {{#let (extractCodeData htmlGroup.content) as |codeData|}}
              <CodeBlock
                @monacoSDK={{@monacoSDK}}
                @codeData={{codeData}}
                as |codeBlock|
              >
                {{#if (bool codeData.searchReplaceBlock)}}
                  {{#let
                    (getCodeDiffResultResource
                      this codeData.fileUrl codeData.searchReplaceBlock
                    )
                    as |codeDiffResource|
                  }}
                    {{#if codeDiffResource.isDataLoaded}}
                      <codeBlock.actions as |actions|>
                        <actions.copyCode
                          @code={{codeDiffResource.modifiedCode}}
                        />
                        <actions.applyCodePatch />
                      </codeBlock.actions>
                      <codeBlock.diffEditor
                        @originalCode={{codeDiffResource.originalCode}}
                        @modifiedCode={{codeDiffResource.modifiedCode}}
                        @language={{codeData.language}}
                      />
                    {{/if}}
                  {{/let}}
                {{else}}
                  <codeBlock.actions as |actions|>
                    <actions.copyCode @code={{codeData.code}} />
                  </codeBlock.actions>
                  <codeBlock.editor />
                {{/if}}
              </CodeBlock>
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
  let result: HtmlTagGroup[] = [];
  let tagStack: { tag: string; startPos: number }[] = [];
  let currentPosition = 0;

  let findNextTag = (
    pos: number,
  ): { type: 'open' | 'close'; tag: string; position: number } | null => {
    let currentPos = pos;
    while (currentPos < htmlString.length) {
      let openTag = htmlString.indexOf('<', currentPos);
      if (openTag === -1) return null;

      if (htmlString.startsWith('<<<<<<<', openTag)) {
        let endMarker = htmlString.indexOf('>>>>>>>', openTag);
        if (endMarker === -1) {
          currentPos = openTag + 7; // length of '<<<<<<<'
          continue;
        }
        // Skip past the entire search/replace block
        currentPos = endMarker + 7; // length of '>>>>>>>'
        continue;
      }

      if (htmlString.startsWith('<!--', openTag)) {
        let commentEnd = htmlString.indexOf('-->', openTag);
        if (commentEnd === -1) return null;
        currentPos = commentEnd + 3;
        continue;
      }

      if (htmlString[openTag + 1] === '/') {
        let closeEnd = htmlString.indexOf('>', openTag);
        if (closeEnd === -1) return null;
        let tag = htmlString.slice(openTag + 2, closeEnd).toLowerCase();
        return { type: 'close', tag, position: openTag };
      } else {
        let spaceOrClose = /[\s>]/;
        let tagEnd = htmlString.indexOf('>', openTag);
        let spacePos = htmlString.slice(openTag, tagEnd).search(spaceOrClose);
        let tagNameEnd = spacePos !== -1 ? openTag + spacePos : tagEnd;
        let tag = htmlString.slice(openTag + 1, tagNameEnd).toLowerCase();
        return { type: 'open', tag, position: openTag };
      }
    }
    return null;
  };

  while (currentPosition < htmlString.length) {
    let nextTag = findNextTag(currentPosition);

    if (!nextTag) {
      if (tagStack.length === 0) {
        let remaining = htmlString.slice(currentPosition).trim();
        if (remaining) {
          result.push({
            type: 'non_pre_tag',
            content: remaining,
          });
        }
      }
      break;
    }

    if (nextTag.type === 'open') {
      tagStack.push({ tag: nextTag.tag, startPos: nextTag.position });
      currentPosition = nextTag.position + 1;
    } else {
      if (
        tagStack.length > 0 &&
        tagStack[tagStack.length - 1].tag === nextTag.tag
      ) {
        let openTag = tagStack.pop()!;

        if (tagStack.length === 0) {
          let content = htmlString.slice(
            openTag.startPos,
            nextTag.position + nextTag.tag.length + 3,
          );
          result.push({
            type: nextTag.tag === 'pre' ? 'pre_tag' : 'non_pre_tag',
            content: content,
          });
        }
        currentPosition = nextTag.position + nextTag.tag.length + 3;
      } else {
        currentPosition = nextTag.position + 1;
      }
    }
  }

  return result;
}

interface CodeDiffResourceArgs {
  named: {
    fileUrl?: string | null;
    searchReplaceBlock?: string | null;
  };
}

export class CodeDiffResource extends Resource<CodeDiffResourceArgs> {
  @tracked fileUrl: string | undefined | null;
  @tracked originalCode: string | undefined | null;
  @tracked modifiedCode: string | undefined | null;
  @tracked searchReplaceBlock: string | undefined | null;

  @service private declare cardService: CardService;
  @service private declare commandService: CommandService;

  modify(_positional: never[], named: CodeDiffResourceArgs['named']) {
    let { fileUrl, searchReplaceBlock } = named;
    this.fileUrl = fileUrl;
    this.searchReplaceBlock = searchReplaceBlock;

    this.load.perform();
  }

  get isDataLoaded() {
    return !!this.originalCode || !!this.modifiedCode;
  }

  private load = restartableTask(async () => {
    let { fileUrl, searchReplaceBlock } = this;
    if (!fileUrl || !searchReplaceBlock) {
      return;
    }
    let result = await this.cardService.getSource(new URL(fileUrl));
    this.originalCode = result;
    let applySearchReplaceBlockCommand = new ApplySearchReplaceBlockCommand(
      this.commandService.commandContext,
    );

    let { resultContent: patchedCode } =
      await applySearchReplaceBlockCommand.execute({
        fileContent: this.originalCode,
        codeBlock: searchReplaceBlock,
      });
    this.modifiedCode = patchedCode;
  });
}

function getCodeDiffResultResource(
  parent: object,
  fileUrl?: string | null,
  searchReplaceBlock?: string | null,
) {
  if (!fileUrl || !searchReplaceBlock) {
    throw new Error('fileUrl and searchReplaceBlock are required');
  }
  return CodeDiffResource.from(parent, () => ({
    named: {
      fileUrl,
      searchReplaceBlock,
    },
  }));
}
