import { array } from '@ember/helper';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import type { SafeString } from '@ember/template';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { and, bool } from '@cardstack/boxel-ui/helpers';

import { sanitizeHtml } from '@cardstack/runtime-common/dompurify-runtime';

import {
  type HtmlTagGroup,
  wrapLastTextNodeInStreamingTextSpan,
  CodeData,
  HtmlPreTagGroup,
} from '@cardstack/host/lib/formatted-message/utils';

import {
  type CodeDiffResource,
  getCodeDiffResultResource,
} from '@cardstack/host/resources/code-diff';
import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';
import LoaderService from '@cardstack/host/services/loader-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import { CodePatchStatus } from 'https://cardstack.com/base/matrix-event';

import ApplyButton from './apply-button';
import CodeBlock from './code-block';

interface FormattedAiBotMessageSignature {
  Element: HTMLDivElement;
  Args: {
    htmlParts?: HtmlTagGroup[];
    monacoSDK: MonacoSDK;
    isStreaming: boolean;
  };
}

function sanitize(html: string): SafeString {
  return htmlSafe(sanitizeHtml(html));
}

export default class FormattedAiBotMessage extends Component<FormattedAiBotMessageSignature> {
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
  @service private declare commandService: CommandService;

  @tracked applyAllCodePatchTasksState:
    | 'ready'
    | 'applying'
    | 'applied'
    | 'failed' = 'ready';

  private isLastHtmlGroup = (index: number) => {
    return index === (this.args.htmlParts?.length ?? 0) - 1;
  };

  private get isApplyAllButtonDisplayed() {
    if (this.args.isStreaming) {
      return false;
    }
    return (
      this.codeDataItems.filter((codeData) => !!codeData.searchReplaceBlock)
        .length > 1
    );
  }

  private get codeDataItems() {
    return (this.args.htmlParts ?? [])
      .map((htmlPart) => {
        if (isHtmlPreTagGroup(htmlPart)) {
          return htmlPart.codeData;
        }
        return null;
      })
      .filter((codeData): codeData is CodeData => !!codeData);
  }

  get applyAllCodePatchesButtonState() {
    let { codeDataItems } = this;
    let states = codeDataItems.map((codeData) =>
      this.commandService.getCodePatchStatus(codeData),
    );
    if (states.some((state) => state === 'applying')) {
      return 'applying';
    } else if (states.every((state) => state === 'applied')) {
      return 'applied';
    } else {
      return 'ready';
    }
  }

  private applyAllCodePatchTasks = dropTask(async () => {
    this.applyAllCodePatchTasksState = 'applying';
    let unappliedCodeDataItems = this.codeDataItems.filter(
      (codeData) =>
        this.commandService.getCodePatchStatus(codeData) !== 'applied',
    );

    let codeDataItemsGroupedByFileUrl = unappliedCodeDataItems.reduce(
      (acc, codeDataItem) => {
        acc[codeDataItem.fileUrl!] = [
          ...(acc[codeDataItem.fileUrl!] || []),
          codeDataItem,
        ];
        return acc;
      },
      {} as Record<string, CodeData[]>,
    );

    // TODO: Handle possible errors (fetching source, patching, saving source)
    // Handle in CS-8369
    for (let fileUrl in codeDataItemsGroupedByFileUrl) {
      await this.commandService.patchCode(
        codeDataItemsGroupedByFileUrl[fileUrl][0].roomId,
        fileUrl,
        codeDataItemsGroupedByFileUrl[fileUrl],
      );
    }
  });

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
          />
        {{else}}
          {{#if (and @isStreaming (this.isLastHtmlGroup index))}}
            {{wrapLastTextNodeInStreamingTextSpan (sanitize htmlPart.content)}}
          {{else}}
            {{sanitize htmlPart.content}}
          {{/if}}
        {{/if}}
      {{/each}}

      {{#if this.isApplyAllButtonDisplayed}}
        <div class='code-patch-actions'>
          <ApplyButton
            {{on 'click' (perform this.applyAllCodePatchTasks)}}
            @state={{this.applyAllCodePatchesButtonState}}
            data-test-apply-all-code-patches-button
          >
            Accept All
          </ApplyButton>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .code-patch-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp);
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
  };
}

class HtmlGroupCodeBlock extends Component<HtmlGroupCodeBlockSignature> {
  _codeDiffResource: CodeDiffResource | undefined;
  _searchReplaceBlock: string | null | undefined = null;
  _fileUrl: string | null | undefined = null;

  get codeDiffResource() {
    if (this._codeDiffResource) {
      if (
        this._fileUrl === this.args.codeData.fileUrl &&
        this._searchReplaceBlock === this.args.codeData.searchReplaceBlock
      ) {
        return this._codeDiffResource;
      }
    }

    this._fileUrl = this.args.codeData.fileUrl;
    this._searchReplaceBlock = this.args.codeData.searchReplaceBlock;
    this._codeDiffResource = this.args.codeData.searchReplaceBlock
      ? getCodeDiffResultResource(
          this,
          this.args.codeData.fileUrl,
          this.args.codeData.searchReplaceBlock,
        )
      : undefined;
    return this._codeDiffResource;
  }

  <template>
    <CodeBlock @monacoSDK={{@monacoSDK}} @codeData={{@codeData}} as |codeBlock|>
      {{#if (bool @codeData.searchReplaceBlock)}}
        {{#if this.codeDiffResource.isDataLoaded}}
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
          <codeBlock.diffEditor
            @originalCode={{this.codeDiffResource.originalCode}}
            @modifiedCode={{this.codeDiffResource.modifiedCode}}
            @language={{@codeData.language}}
          />
        {{/if}}
      {{else}}
        <codeBlock.actions as |actions|>
          <actions.copyCode @code={{@codeData.code}} />
        </codeBlock.actions>
        <codeBlock.editor />
      {{/if}}
    </CodeBlock>
  </template>
}
