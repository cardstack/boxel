import { on } from '@ember/modifier';
import { getOwner } from '@ember/owner';
import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import type { SafeString } from '@ember/template';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import Modifier from 'ember-modifier';

import { TrackedArray, TrackedMap, TrackedObject } from 'tracked-built-ins';

import { and, bool } from '@cardstack/boxel-ui/helpers';

import { sanitizeHtml } from '@cardstack/runtime-common/dompurify-runtime';

import { CodePatchAction } from '@cardstack/host/lib/formatted-message/code-patch-action';
import {
  type HtmlTagGroup,
  wrapLastTextNodeInStreamingTextSpan,
  CodeData,
  HtmlPreTagGroup,
} from '@cardstack/host/lib/formatted-message/utils';

import { getCodeDiffResultResource } from '@cardstack/host/resources/code-diff';
import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';
import LoaderService from '@cardstack/host/services/loader-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import ApplyButton from './apply-button';
import CodeBlock from './code-block';

interface FormattedAiBotMessageSignature {
  Element: HTMLDivElement;
  Args: {
    htmlParts?: HtmlTagGroup[];
    eventId: string;
    roomId: string;
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
  @tracked stableHtmlParts: TrackedArray<HtmlTagGroup> = new TrackedArray([]);

  @tracked codePatchActions: TrackedMap<number, CodePatchAction> =
    new TrackedMap();

  @tracked isRunningApplyAll = false;
  @tracked applyAllCodePatchTasksState:
    | 'ready'
    | 'applying'
    | 'applied'
    | 'failed' = 'ready';

  private setStableHtmlParts = (htmlParts: HtmlTagGroup[]) => {
    this.stableHtmlParts = new TrackedArray(
      htmlParts.map((part) => {
        return new TrackedObject({
          type: part.type,
          content: part.content,
          codeData: part.codeData,
        }) as HtmlTagGroup;
      }),
    );
  };
  // When htmlParts is updated, we need to consume it carefully, so that we don't
  // needlesly re-render parts of the message that haven't changed. Parts are:
  // <pre> html code, and non-<pre> html. <pre> gets special treatment because
  // we will render it as a (readonly) Monaco editor
  private updateStableHtmlParts = (htmlParts: HtmlTagGroup[]) => {
    let isIncrementalUpdate = htmlParts.length >= this.stableHtmlParts.length; // Not incremental update happens when the new html is shorter than the old html (the content was replaced in a way that removed some parts, e.g. replacing the content with an error message if something goes wrong during chunk processing in the AI bot)
    if (!this.stableHtmlParts.length || !isIncrementalUpdate) {
      this.setStableHtmlParts(htmlParts);
    } else {
      this.stableHtmlParts.forEach((oldPart, index) => {
        if (oldPart.content !== htmlParts[index].content) {
          oldPart.content = htmlParts[index].content;
        }
        if (oldPart.codeData !== htmlParts[index].codeData) {
          oldPart.codeData = htmlParts[index].codeData;
        }
      });
      if (htmlParts.length > this.stableHtmlParts.length) {
        this.stableHtmlParts.push(
          ...htmlParts.slice(this.stableHtmlParts.length).map((part) => {
            return new TrackedObject({
              type: part.type,
              content: part.content,
              codeData: part.codeData,
            }) as HtmlTagGroup;
          }),
        );
      }
    }
  };

  private onHtmlPartsUpdate = (htmlParts: HtmlTagGroup[] | undefined) => {
    // The reason why reacting to html argument this way is because we want to
    // have full control of when the @html argument changes so that we can
    // properly fragment it into htmlParts, and in our reactive structure, only update
    // the parts that have changed.

    // eslint-disable-next-line ember/no-incorrect-calls-with-inline-anonymous-functions
    scheduleOnce('afterRender', () => {
      this.updateStableHtmlParts(htmlParts ?? []);
    });
  };

  private isLastHtmlGroup = (index: number) => {
    return index === this.stableHtmlParts.length - 1;
  };

  private createCodePatchAction = (codeData: CodeData) => {
    let codePatchAction = new CodePatchAction(getOwner(this)!, codeData);
    this.codePatchActions.set(codeData.codeBlockIndex, codePatchAction);
    console.log(
      'createCodePatchAction',
      codeData,
      'length now',
      this.codePatchActions.size,
    );
    return codePatchAction;
  };

  private get isApplyAllButtonDisplayed() {
    return this.codePatchActions.size > 1 && !this.args.isStreaming;
  }

  get applyAllButtonState() {
    if (
      [...this.codePatchActions.values()].every(
        (action) => action.patchCodeState === 'applied',
      )
    ) {
      return 'applied';
    } else if (this.isRunningApplyAll) {
      return 'applying';
    }
    return 'ready';
  }

  private applyAllCodePatchTasks = dropTask(async () => {
    this.isRunningApplyAll = true;
    try {
      let unappliedCodePatchActions = [
        ...this.codePatchActions.values(),
      ].filter(
        (codePatchAction) => codePatchAction.patchCodeState !== 'applied',
      );

      if (unappliedCodePatchActions.length === 0) {
        return;
      }

      let codePatchActionsGroupedByFileUrl = unappliedCodePatchActions.reduce(
        (acc, codePatchAction) => {
          acc[codePatchAction.fileUrl] = [
            ...(acc[codePatchAction.fileUrl] || []),
            codePatchAction,
          ];
          return acc;
        },
        {} as Record<string, CodePatchAction[]>,
      );

      // TODO: Handle possible errors (fetching source, patching, saving source)
      // Handle in CS-8369
      for (let fileUrl in codePatchActionsGroupedByFileUrl) {
        await this.commandService.patchCode(
          this.args.roomId,
          fileUrl,
          codePatchActionsGroupedByFileUrl[fileUrl].map((codePatchAction) => {
            return {
              codeBlock: codePatchAction.searchReplaceBlock,
              eventId: codePatchAction.eventId,
              index: codePatchAction.index,
            };
          }),
        );
      }
    } finally {
      this.isRunningApplyAll = false;
    }
  });

  <template>
    {{log 'rendering FormattedAiBotMessage'}}
    <div
      class='message'
      {{HtmlPartsDidUpdate
        htmlParts=@htmlParts
        onHtmlPartsUpdate=this.onHtmlPartsUpdate
      }}
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
      {{#each this.stableHtmlParts as |htmlGroup index|}}
        {{#if (isHtmlPreTagGroup htmlGroup)}}
          {{#let
            (this.createCodePatchAction htmlGroup.codeData)
            as |codePatchAction|
          }}
            <HtmlGroupCodeBlock
              @codeData={{htmlGroup.codeData}}
              @codePatchAction={{codePatchAction}}
              @monacoSDK={{@monacoSDK}}
            />
          {{/let}}
        {{else}}
          {{#if (and @isStreaming (this.isLastHtmlGroup index))}}
            {{wrapLastTextNodeInStreamingTextSpan (sanitize htmlGroup.content)}}
          {{else}}
            {{sanitize htmlGroup.content}}
          {{/if}}
        {{/if}}
      {{/each}}

      {{#if this.isApplyAllButtonDisplayed}}
        <div class='code-patch-actions'>
          <ApplyButton
            {{on 'click' (perform this.applyAllCodePatchTasks)}}
            @state={{this.applyAllCodePatchTasksState}}
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

interface HtmlPartsDidUpdateSignature {
  Args: {
    Named: {
      htmlParts: HtmlTagGroup[] | undefined;
      onHtmlPartsUpdate: (htmlParts: HtmlTagGroup[] | undefined) => void;
    };
  };
}

class HtmlPartsDidUpdate extends Modifier<HtmlPartsDidUpdateSignature> {
  modify(
    _element: HTMLElement,
    _positional: [],
    {
      htmlParts,
      onHtmlPartsUpdate,
    }: HtmlPartsDidUpdateSignature['Args']['Named'],
  ) {
    onHtmlPartsUpdate(htmlParts);
  }
}

interface HtmlGroupCodeBlockSignature {
  Element: HTMLDivElement;
  Args: {
    codeData: CodeData;
    codePatchAction: CodePatchAction;
    monacoSDK: MonacoSDK;
  };
}

class HtmlGroupCodeBlock extends Component<HtmlGroupCodeBlockSignature> {
  @cached
  get codeDiffResource() {
    console.log('codeDiffResource getter');
    return this.args.codeData.searchReplaceBlock
      ? getCodeDiffResultResource(
          this,
          this.args.codeData.fileUrl,
          this.args.codeData.searchReplaceBlock,
        )
      : undefined;
  }

  <template>
    {{log 'rendering HtmlGroupCodeBlock'}}
    <CodeBlock @monacoSDK={{@monacoSDK}} @codeData={{@codeData}} as |codeBlock|>
      {{#if (bool @codeData.searchReplaceBlock)}}
        {{#if this.codeDiffResource.isDataLoaded}}
          <codeBlock.actions as |actions|>
            <actions.copyCode @code={{this.codeDiffResource.modifiedCode}} />
            <actions.applyCodePatch
              @codePatchAction={{@codePatchAction}}
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
