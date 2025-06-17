import { array } from '@ember/helper';
import { fn } from '@ember/helper';
import { service } from '@ember/service';
import type { SafeString } from '@ember/template';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { and, bool, eq } from '@cardstack/boxel-ui/helpers';

import { FailureBordered } from '@cardstack/boxel-ui/icons';

import { sanitizeHtml } from '@cardstack/runtime-common/dompurify-runtime';

import {
  type HtmlTagGroup,
  wrapLastTextNodeInStreamingTextSpan,
  HtmlPreTagGroup,
  CodeData,
} from '@cardstack/host/lib/formatted-message/utils';

import { parseSearchReplace } from '@cardstack/host/lib/search-replace-block-parsing';

import {
  type CodeDiffResource,
  getCodeDiffResultResource,
} from '@cardstack/host/resources/code-diff';
import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';
import LoaderService from '@cardstack/host/services/loader-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import { CodePatchStatus } from 'https://cardstack.com/base/matrix-event';

import CodeBlock from './code-block';

interface FormattedAiBotMessageSignature {
  Element: HTMLDivElement;
  Args: {
    htmlParts?: HtmlTagGroup[];
    roomId: string;
    eventId: string;
    monacoSDK: MonacoSDK;
    isStreaming: boolean;
    isLastAssistantMessage: boolean;
  };
}

function sanitize(html: string): SafeString {
  return htmlSafe(sanitizeHtml(html));
}

export default class FormattedAiBotMessage extends Component<FormattedAiBotMessageSignature> {
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
  @service private declare commandService: CommandService;

  private isLastHtmlGroup = (index: number) => {
    return index === (this.args.htmlParts?.length ?? 0) - 1;
  };

  private preTagGroupIndex = (htmlPartIndex: number) => {
    return this.args
      .htmlParts!.slice(0, htmlPartIndex)
      .filter(isHtmlPreTagGroup).length;
  };

  <template>
    <div class='message'>
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
            @codePatchStatus={{this.commandService.getCodePatchStatus
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
            @index={{this.preTagGroupIndex index}}
          />
        {{else}}
          {{#if (and @isStreaming (this.isLastHtmlGroup index))}}
            {{wrapLastTextNodeInStreamingTextSpan (sanitize htmlPart.content)}}
          {{else}}
            {{sanitize htmlPart.content}}
          {{/if}}
        {{/if}}
      {{/each}}
    </div>

    <style scoped>
      .message > :deep(*:first-child) {
        margin-top: 0;
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

      /* our dark-mode background-color is too similar to AI-Assistant message background,
        so we are using a darker background for code-blocks */
      :global(.code-block .monaco-editor) {
        --vscode-editor-background: var(--boxel-dark);
        --vscode-editorGutter-background: var(--boxel-dark);
      }

      /* this improves inserted-line legibility by reducing green background overlay opacity */
      :global(.code-block .monaco-editor .line-insert) {
        opacity: 0.4;
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
    codePatchStatus: CodePatchStatus | 'ready' | 'applying';
    onPatchCode: (codeData: CodeData) => void;
    monacoSDK: MonacoSDK;
    isLastAssistantMessage: boolean;
    index: number;
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
        )
      : undefined;
    return this._codeDiffResource;
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

  <template>
    <CodeBlock
      @monacoSDK={{@monacoSDK}}
      @codeData={{@codeData}}
      class='code-block'
      data-test-code-block-index={{@index}}
      as |codeBlock|
    >
      {{#if (bool @codeData.searchReplaceBlock)}}
        {{#if this.isAppliedOrIgnoredCodePatch}}
          <div>
            <codeBlock.editorHeader
              @codeData={{@codeData}}
              @diffEditorStats={{null}}
            />
            <codeBlock.editor @code={{this.codeForEditor}} @dimmed={{true}} />
            <codeBlock.actions as |actions|>
              <actions.copyCode
                @code={{this.extractReplaceCode @codeData.searchReplaceBlock}}
              />
              {{#if (eq @codePatchStatus 'applied')}}
                {{! This is just to show the ✅ icon to signalize that the code patch has been applied }}
                <actions.applyCodePatch
                  @codeData={{@codeData}}
                  @patchCodeStatus={{@codePatchStatus}}
                />
              {{/if}}
            </codeBlock.actions>
          </div>
        {{else}}
          {{#if this.codeDiffResource.errorMessage}}
            <div
              class='error-message'
              data-test-error-message={{this.codeDiffResource.errorMessage}}
            >
              <FailureBordered class='error-icon' />
              <div class='error-message-content'>
                <b>Code could not be displayed: </b>
                {{this.codeDiffResource.errorMessage}}
              </div>
            </div>
          {{/if}}
          {{#if this.codeDiffResource.isDataLoaded}}
            <codeBlock.editorHeader
              @codeData={{@codeData}}
              @diffEditorStats={{this.diffEditorStats}}
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
                @patchCodeStatus={{@codePatchStatus}}
                @originalCode={{this.codeDiffResource.originalCode}}
                @modifiedCode={{this.codeDiffResource.modifiedCode}}
              />
            </codeBlock.actions>
          {{/if}}
        {{/if}}
      {{else}}
        {{#if @codeData.fileUrl}}
          <codeBlock.editorHeader
            @codeData={{@codeData}}
            @diffEditorStats={{null}}
          />
        {{/if}}
        <codeBlock.editor @code={{this.codeForEditor}} />
        <codeBlock.actions as |actions|>
          <actions.copyCode @code={{@codeData.code}} />
        </codeBlock.actions>
      {{/if}}
    </CodeBlock>

    <style scoped>
      .error-message {
        background-color: var(--boxel-danger);
        color: var(--boxel-light);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        display: flex;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-xs);
      }

      .error-message > svg {
        margin-top: 0px;
      }

      .error-icon {
        --icon-background-color: var(--boxel-light);
        --icon-color: var(--boxel-danger);
        margin-top: var(--boxel-sp-5xs);
      }

      .code-block {
        margin-top: 0;
      }

      .code-block + .code-block {
        margin-top: 1rem;
      }
    </style>
  </template>
}
