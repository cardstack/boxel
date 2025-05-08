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

import { TrackedArray, TrackedObject } from 'tracked-built-ins';

import { and, bool, eq } from '@cardstack/boxel-ui/helpers';

import { sanitizeHtml } from '@cardstack/runtime-common/dompurify-runtime';

import { CodePatchAction } from '@cardstack/host/lib/formatted-message/code-patch-action';
import {
  type HtmlTagGroup,
  extractCodeData,
  parseHtmlContent,
  wrapLastTextNodeInStreamingTextSpan,
} from '@cardstack/host/lib/formatted-message/utils';

import { getCodeDiffResultResource } from '@cardstack/host/resources/code-diff';
import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';
import LoaderService from '@cardstack/host/services/loader-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import ApplyButton from './apply-button';
import CodeBlock from './code-block';

export interface CodeData {
  fileUrl: string | null;
  code: string | null;
  language: string | null;
  searchReplaceBlock?: string | null;
  roomId: string | null;
  eventId: string | null;
  index: number;
}

interface FormattedMessageSignature {
  Element: HTMLDivElement;
  Args: {
    html: SafeString;
    eventId: string;
    roomId: string;
    monacoSDK: MonacoSDK;
    renderCodeBlocks: boolean;
    isStreaming: boolean;
  };
}

function sanitize(html: string): SafeString {
  return htmlSafe(sanitizeHtml(html));
}

export default class FormattedMessage extends Component<FormattedMessageSignature> {
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
  @service private declare commandService: CommandService;
  @tracked htmlGroups: TrackedArray<HtmlTagGroup> = new TrackedArray([]);

  @tracked codePatchActions: TrackedArray<CodePatchAction> = new TrackedArray(
    [],
  );

  @tracked isRunningApplyAll = false;
  @tracked applyAllCodePatchTasksState:
    | 'ready'
    | 'applying'
    | 'applied'
    | 'failed' = 'ready';

  private setHtmlGroups = (htmlGroups: HtmlTagGroup[]) => {
    this.htmlGroups = new TrackedArray(
      htmlGroups.map((part) => {
        return new TrackedObject({
          type: part.type,
          content: part.content,
        });
      }),
    );
  };
  // When html is streamed, we need to update htmlParts accordingly,
  // but only the parts that have changed so that we don't needlesly re-render
  // parts of the message that haven't changed. Parts are: <pre> html code, and
  // non-<pre> html. <pre> gets special treatment because we will render it as a
  // (readonly) Monaco editor
  private updateHtmlGroups = (html: string) => {
    let htmlGroups = parseHtmlContent(html);
    let isIncrementalUpdate = htmlGroups.length >= this.htmlGroups.length; // Not incremental update happens when the new html is shorter than the old html (the content was replaced in a way that removed some parts, e.g. replacing the content with an error message if something goes wrong during chunk processing in the AI bot)
    if (!this.htmlGroups.length || !isIncrementalUpdate) {
      this.setHtmlGroups(htmlGroups);
    } else {
      this.htmlGroups.forEach((oldPart, index) => {
        if (oldPart.content !== htmlGroups[index].content) {
          oldPart.content = htmlGroups[index].content;
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

  private onHtmlUpdate = (html: SafeString) => {
    // The reason why reacting to html argument this way is because we want to
    // have full control of when the @html argument changes so that we can
    // properly fragment it into htmlParts, and in our reactive structure, only update
    // the parts that have changed.

    // eslint-disable-next-line ember/no-incorrect-calls-with-inline-anonymous-functions
    scheduleOnce('afterRender', () => {
      this.updateHtmlGroups(html.toString());
    });
  };

  private isLastHtmlGroup = (index: number) => {
    return index === this.htmlGroups.length - 1;
  };

  private createCodePatchAction = (codeData: CodeData) => {
    let codePatchAction = new CodePatchAction(getOwner(this)!, codeData);
    this.codePatchActions.push(codePatchAction);
    return codePatchAction;
  };

  private get isApplyAllButtonDisplayed() {
    return this.codePatchActions.length > 1 && !this.args.isStreaming;
  }

  get applyAllButtonState() {
    if (
      this.codePatchActions.every(
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
      let unappliedCodePatchActions = this.codePatchActions.filter(
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

  sanitizeSafeString = (html: SafeString) => {
    return sanitize(html.toString());
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

            {{#let
              (extractCodeData htmlGroup.content @roomId @eventId index)
              as |codeData|
            }}
              {{#let
                (this.createCodePatchAction codeData)
                as |codePatchAction|
              }}
                <HtmlGroupCodeBlock
                  @codeData={{codeData}}
                  @codePatchAction={{codePatchAction}}
                  @monacoSDK={{@monacoSDK}}
                />
              {{/let}}
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

        {{#if this.isApplyAllButtonDisplayed}}
          <div class='code-patch-actions'>
            <ApplyButton
              {{on 'click' (perform this.applyAllCodePatchTasks)}}
              @state={{this.applyAllButtonState}}
              data-test-apply-all-code-patches-button
            >
              Accept All
            </ApplyButton>
          </div>
        {{/if}}
      </div>
    {{else}}
      <div class='message'>
        {{this.sanitizeSafeString @html}}
      </div>
    {{/if}}

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

interface HtmlDidUpdateSignature {
  Args: {
    Named: {
      html: SafeString;
      onHtmlUpdate: (html: SafeString) => void;
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
    return this.args.codeData.searchReplaceBlock
      ? getCodeDiffResultResource(
          this,
          this.args.codeData.fileUrl,
          this.args.codeData.searchReplaceBlock,
        )
      : undefined;
  }

  <template>
    <CodeBlock @monacoSDK={{@monacoSDK}} @codeData={{@codeData}} as |codeBlock|>
      {{#if (bool @codeData.searchReplaceBlock)}}
        {{#if this.codeDiffResource.isDataLoaded}}
          <codeBlock.actions as |actions|>
            <actions.copyCode @code={{this.codeDiffResource.modifiedCode}} />
            <actions.applyCodePatch @codePatchAction={{@codePatchAction}} />
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
