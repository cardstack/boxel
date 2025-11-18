import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Alert } from '@cardstack/boxel-ui/components';
import { and, bool, eq } from '@cardstack/boxel-ui/helpers';

import { markdownToHtml } from '@cardstack/runtime-common';

import CodeBlock from '@cardstack/host/components/ai-assistant/code-block';

import { sanitizedHtml } from '@cardstack/host/helpers/sanitized-html';

import {
  type HtmlTagGroup,
  wrapLastTextNodeInStreamingTextSpan,
  HtmlPreTagGroup,
  CodeData,
} from '@cardstack/host/lib/formatted-message/utils';

import { type Message as MatrixMessage } from '@cardstack/host/lib/matrix-classes/message';
import type MessageCodePatchResult from '@cardstack/host/lib/matrix-classes/message-code-patch-result';

import { parseSearchReplace } from '@cardstack/host/lib/search-replace-block-parsing';

import {
  type CodeDiffResource,
  getCodeDiffResultResource,
} from '@cardstack/host/resources/code-diff';

import CommandService from '@cardstack/host/services/command-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import { CodePatchStatus } from 'https://cardstack.com/base/matrix-event';

import Message from './text-content';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    htmlParts?: HtmlTagGroup[];
    roomId: string;
    eventId: string;
    monacoSDK: MonacoSDK;
    isStreaming: boolean;
    isLastAssistantMessage: boolean;
    userMessageThisMessageIsRespondingTo?: MatrixMessage;
    reasoning?: {
      content: string | null;
      isExpanded: boolean;
      updateExpanded: (ev: MouseEvent | KeyboardEvent) => void;
    };
  };
  Blocks: {
    default: [];
  };
}

export default class FormattedAiBotMessage extends Component<Signature> {
  @service private declare commandService: CommandService;

  private isLastHtmlGroup = (index: number) => {
    return index === (this.args.htmlParts?.length ?? 0) - 1;
  };

  private preTagGroupIndex = (htmlPartIndex: number) => {
    return this.args
      .htmlParts!.slice(0, htmlPartIndex)
      .filter(isHtmlPreTagGroup).length;
  };

  private codePatchStatus = (codeData: CodeData) => {
    return this.commandService.getCodePatchStatus(codeData);
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
              {{sanitizedHtml (markdownToHtml @reasoning.content)}}
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
            @codePatchResult={{this.commandService.getCodePatchResult
              htmlPart.codeData
            }}
            @onPatchCode={{fn
              this.commandService.patchCode
              htmlPart.codeData.roomId
              htmlPart.codeData.fileUrl
              (array htmlPart.codeData)
            }}
            @monacoSDK={{@monacoSDK}}
            @isLastAssistantMessage={{@isLastAssistantMessage}}
            @userMessageThisMessageIsRespondingTo={{@userMessageThisMessageIsRespondingTo}}
            @index={{this.preTagGroupIndex index}}
            @codePatchStatus={{this.codePatchStatus htmlPart.codeData}}
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
    onPatchCode: (codeData: CodeData) => void;
    monacoSDK: MonacoSDK;
    isLastAssistantMessage: boolean;
    userMessageThisMessageIsRespondingTo?: MatrixMessage;
    index: number;
    codePatchStatus: CodePatchStatus | 'applying' | 'ready';
    codePatchResult: MessageCodePatchResult | undefined;
    originalUploadedFileUrl?: string | null;
  };
}

class HtmlGroupCodeBlock extends Component<HtmlGroupCodeBlockSignature> {
  _codeDiffResource: CodeDiffResource | undefined;
  _searchReplaceBlock: string | null | undefined = null;
  _fileUrl: string | null | undefined = null;
  @tracked diffEditorStats: {
    linesRemoved: number;
    linesAdded: number;
  } | null = null;

  get codeDiffResource() {
    if (this._codeDiffResource) {
      if (
        this._fileUrl === this.args.codeData.fileUrl &&
        this._searchReplaceBlock === this.args.codeData.searchReplaceBlock
      ) {
        return this._codeDiffResource;
      }
    }

    /* eslint-disable-next-line ember/no-side-effects */
    this._fileUrl = this.args.codeData.fileUrl;
    /* eslint-disable-next-line ember/no-side-effects */
    this._searchReplaceBlock = this.args.codeData.searchReplaceBlock;
    /* eslint-disable-next-line ember/no-side-effects */
    this._codeDiffResource = this.args.codeData.searchReplaceBlock
      ? getCodeDiffResultResource(
          this,
          this.args.codeData.fileUrl,
          this.args.codeData.searchReplaceBlock,
          this.args.codePatchStatus as CodePatchStatus,
        )
      : undefined;
    return this._codeDiffResource;
  }

  errorMessage(errorMessage: string) {
    return 'Code could not be displayed: ' + errorMessage;
  }

  private extractReplaceCode(searchReplaceBlock: string | null | undefined) {
    if (!searchReplaceBlock) {
      return null;
    }
    return parseSearchReplace(searchReplaceBlock).replaceContent;
  }

  private get codeForEditor() {
    if (this.isAppliedOrIgnoredCodePatch) {
      return this.extractReplaceCode(this.args.codeData.searchReplaceBlock);
    } else {
      return this.args.codeData.code;
    }
  }

  private get isAppliedOrIgnoredCodePatch() {
    // Ignored means the user moved on to the next message
    return (
      this.args.codePatchStatus === 'applied' ||
      !this.args.isLastAssistantMessage
    );
  }

  private updateDiffEditorStats = (stats: {
    linesAdded: number;
    linesRemoved: number;
  }) => {
    this.diffEditorStats = stats;
  };

  private get codePatchfinalFileUrlAfterCodePatching() {
    return this.args.codePatchStatus === 'applied'
      ? this.args.codePatchResult?.finalFileUrlAfterCodePatching
      : null;
  }

  private get codePatchErrorMessage() {
    if (this.args.codePatchStatus === 'applied') {
      return null;
    } else if (this.args.codePatchStatus === 'failed') {
      return this.args.codePatchResult?.failureReason;
    } else if (this.codeDiffResource?.errorMessage) {
      return this.codeDiffResource.errorMessage;
    }
    return null;
  }

  <template>
    <CodeBlock
      @monacoSDK={{@monacoSDK}}
      @codeData={{@codeData}}
      data-test-code-block-index={{@index}}
      as |codeBlock|
    >
      {{#if (bool @codeData.searchReplaceBlock)}}
        {{#if this.isAppliedOrIgnoredCodePatch}}
          <div>
            <codeBlock.diffEditorHeader
              @codeData={{@codeData}}
              @diffEditorStats={{null}}
              @finalFileUrlAfterCodePatching={{this.codePatchfinalFileUrlAfterCodePatching}}
              @originalUploadedFileUrl={{@codePatchResult.originalUploadedFileUrl}}
              @codePatchStatus={{@codePatchStatus}}
              @codePatchErrorMessage={{this.codePatchErrorMessage}}
              @userMessageThisMessageIsRespondingTo={{@userMessageThisMessageIsRespondingTo}}
            />

            <codeBlock.editor @code={{this.codeForEditor}} />

            <codeBlock.actions as |actions|>
              <actions.copyCode
                @code={{this.extractReplaceCode @codeData.searchReplaceBlock}}
              />
              {{! This is just to show the ✅ icon to signalize that the code patch has been applied }}
              <actions.applyCodePatch
                @codeData={{@codeData}}
                @patchCodeStatus={{@codePatchStatus}}
              />
            </codeBlock.actions>

            {{#if this.codePatchErrorMessage}}
              <codeBlock.patchFooter>
                <Alert @type='error' class='code-patch-error' as |Alert|>
                  <Alert.Messages
                    @messages={{array this.codePatchErrorMessage}}
                  />
                </Alert>
              </codeBlock.patchFooter>
            {{/if}}
          </div>
        {{else}}
          {{#if this.codeDiffResource.isDataLoaded}}
            <codeBlock.diffEditorHeader
              @codeData={{@codeData}}
              @diffEditorStats={{this.diffEditorStats}}
              @originalUploadedFileUrl={{@codePatchResult.originalUploadedFileUrl}}
              @codePatchStatus={{@codePatchStatus}}
              @userMessageThisMessageIsRespondingTo={{@userMessageThisMessageIsRespondingTo}}
              @codePatchErrorMessage={{this.codePatchErrorMessage}}
            />

            <codeBlock.diffEditor
              @originalCode={{this.codeDiffResource.originalCode}}
              @modifiedCode={{this.codeDiffResource.modifiedCode}}
              @language={{@codeData.language}}
              @updateDiffEditorStats={{this.updateDiffEditorStats}}
            />

            <codeBlock.actions as |actions|>
              <actions.copyCode @code={{this.codeDiffResource.modifiedCode}} />

              <actions.applyCodePatch
                @codeData={{@codeData}}
                @performPatch={{fn @onPatchCode @codeData}}
                @patchCodeStatus={{if
                  this.codePatchErrorMessage
                  'failed'
                  @codePatchStatus
                }}
                @originalCode={{this.codeDiffResource.originalCode}}
                @modifiedCode={{this.codeDiffResource.modifiedCode}}
              />
            </codeBlock.actions>
          {{/if}}

          {{#if this.codePatchErrorMessage}}
            <codeBlock.patchFooter>
              <Alert
                @type='error'
                class='code-patch-error'
                data-test-error-message={{this.codePatchErrorMessage}}
                as |Alert|
              >
                <Alert.Messages
                  @messages={{array this.codePatchErrorMessage}}
                />
              </Alert>
            </codeBlock.patchFooter>
          {{/if}}
        {{/if}}
      {{else}}
        {{#if @codeData.fileUrl}}
          <codeBlock.diffEditorHeader
            @codeData={{@codeData}}
            @diffEditorStats={{null}}
            @codePatchStatus={{@codePatchStatus}}
          />
        {{/if}}
        <codeBlock.editor @code={{this.codeForEditor}} />
        <codeBlock.actions as |actions|>
          <actions.copyCode @code={{@codeData.code}} />
        </codeBlock.actions>
      {{/if}}
    </CodeBlock>
  </template>
}
