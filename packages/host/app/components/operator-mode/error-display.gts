import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import { CopyButton, Button } from '@cardstack/boxel-ui/components';
import {
  DropdownArrowDown,
  DropdownArrowUp,
  Warning,
} from '@cardstack/boxel-ui/icons';

import type ErrorDisplayService from '@cardstack/host/services/error-display';
import type { DisplayedErrorProvider } from '@cardstack/host/services/error-display';
import type ToolService from '@cardstack/host/services/tool-service';
import SwitchSubmodeTool from '@cardstack/host/tools/switch-submode';

import SendErrorToAIAssistant from './send-error-to-ai-assistant';

import type { FileDef } from '@cardstack/base/file-api';
import type { BoxelErrorForContext } from '@cardstack/base/matrix-event';

interface Signature {
  Element: HTMLElement;
  Args: {
    type: 'syntax' | 'runtime';
    headerText?: string;
    message?: string;
    stack?: string;
    // CS-10872: structured prerender-timeout diagnostics carried from
    // the error doc's meta.diagnostics. Rendered in the details section
    // beneath the stack trace so operators can classify a timeout
    // without opening the DB or correlating CloudWatch logs.
    diagnostics?: Record<string, unknown>;
    // CS-10977: additional errors carried on the error doc — typically
    // browser console errors captured by the prerender runner.
    // Shown as a collapsed list under the stack trace so the operator
    // can see the underlying template throw that the runloop swallowed.
    additionalErrors?: Array<{
      message?: string;
      stack?: string;
      status?: number;
      title?: string;
    }> | null;
    openDetails?: boolean;
    fileToAttach?: FileDef;
    viewInCodeMode?: boolean;
    cardId?: string;
  };
}

// Truncation budgets for the human-facing pane. The serialized error doc
// is already clamped server-side (see clampSerializedError), but the
// operator shouldn't see a 64KiB stack trace inline. These count UTF-16
// code units (string.length), not bytes.
const ADDITIONAL_ERRORS_DISPLAY_LIMIT = 20;
const ADDITIONAL_ERROR_MESSAGE_MAX_CHARS = 2 * 1024;
const ADDITIONAL_ERROR_STACK_MAX_CHARS = 4 * 1024;

// Tighter budget for the context payload that flows to AI assistant
// chat sends via getError() / errorsDisplayed. Every chat message
// includes this on every error currently visible, so it has to fit
// well below the Matrix event size limit even with multiple errors
// on screen. Tuned for ~7-8KB max per error.
const ADDITIONAL_ERRORS_CONTEXT_LIMIT = 5;
const ADDITIONAL_ERROR_CONTEXT_MESSAGE_MAX_CHARS = 512;
const ADDITIONAL_ERROR_CONTEXT_STACK_MAX_CHARS = 1024;
const CONTEXT_STACK_MAX_CHARS = 4 * 1024;
const CONTEXT_MESSAGE_MAX_CHARS = 2 * 1024;

const TRUNCATION_SUFFIX = ' …[truncated]';

function truncate(s: string | undefined, max: number): string | undefined {
  if (s == null) return s;
  if (s.length <= max) return s;
  let body = Math.max(0, max - TRUNCATION_SUFFIX.length);
  return s.slice(0, body) + TRUNCATION_SUFFIX;
}

export default class ErrorDisplay
  extends Component<Signature>
  implements DisplayedErrorProvider
{
  @tracked private showDetails = this.args.openDetails ?? false;

  @service declare private toolService: ToolService;
  @service declare private errorDisplay: ErrorDisplayService;

  constructor(owner: any, args: any) {
    super(owner, args);
    this.errorDisplay.register(this);
    registerDestructor(this, () => this.errorDisplay.unregister(this));
  }

  private viewInCodeMode = dropTask(async () => {
    let switchSubmodeCommand = new SwitchSubmodeTool(
      this.toolService.toolContext,
    );
    await switchSubmodeCommand.execute({
      submode: 'code',
      codePath: `${this.args.cardId}.json`,
    });
  });

  private toggleDetails = () => (this.showDetails = !this.showDetails);

  // Payload for CopyButton (clipboard copy, no transit constraint) and
  // the Fix-with-AI button (which applies its own AI-prompt budget on
  // top). Uses the display-pane bounds so users get the same view they
  // see in the overlay.
  private get errorObject() {
    return {
      message: this.args.message ?? '',
      stack: this.args.stack,
      additionalErrors: this.normalizedAdditionalErrors,
      diagnostics: this.args.diagnostics,
    };
  }

  private get normalizedAdditionalErrors():
    | Array<{
        message?: string;
        stack?: string;
        status?: number;
        title?: string;
      }>
    | undefined {
    return this.boundAdditionalErrors(
      ADDITIONAL_ERRORS_DISPLAY_LIMIT,
      ADDITIONAL_ERROR_MESSAGE_MAX_CHARS,
      ADDITIONAL_ERROR_STACK_MAX_CHARS,
    );
  }

  private get contextAdditionalErrors():
    | Array<{
        message?: string;
        stack?: string;
        status?: number;
        title?: string;
      }>
    | undefined {
    return this.boundAdditionalErrors(
      ADDITIONAL_ERRORS_CONTEXT_LIMIT,
      ADDITIONAL_ERROR_CONTEXT_MESSAGE_MAX_CHARS,
      ADDITIONAL_ERROR_CONTEXT_STACK_MAX_CHARS,
    );
  }

  private boundAdditionalErrors(
    entryLimit: number,
    messageMax: number,
    stackMax: number,
  ):
    | Array<{
        message?: string;
        stack?: string;
        status?: number;
        title?: string;
      }>
    | undefined {
    let raw = this.args.additionalErrors;
    if (!raw || raw.length === 0) return undefined;
    let entries = raw.slice(0, entryLimit).map((e) => ({
      message: truncate(e?.message, messageMax),
      stack: truncate(e?.stack, stackMax),
      status: e?.status,
      title: e?.title,
    }));
    if (raw.length > entryLimit) {
      let omitted = raw.length - entryLimit;
      entries.push({
        title: 'Errors omitted',
        message: `${omitted} additional errors hidden`,
        stack: undefined,
        status: undefined,
      });
    }
    return entries;
  }

  private get additionalErrorsCount(): number {
    return this.args.additionalErrors?.length ?? 0;
  }

  // diagnostics/additionalErrors can in principle contain
  // non-JSON-serializable values (circulars, getters that throw). Fall
  // back to the minimal payload so the overlay never breaks on a copy
  // request.
  private get errorText() {
    try {
      return JSON.stringify(this.errorObject);
    } catch {
      return JSON.stringify({
        message: this.args.message ?? '',
        stack: this.args.stack,
      });
    }
  }

  // errorsDisplayed flows on every chat message context build (see
  // OperatorModeStateService.getSummaryForAIBot → errorDisplay
  // .getDisplayedErrors), so this payload has to stay small even with
  // multiple errors visible. Tighter than errorObject's display bounds:
  // 5 entries, 1KiB stack, 512B message per entry, plus top-level
  // message/stack capped. Fix-with-AI receives errorObject directly
  // (full display bounds) and runs its own AI-prompt budget on top.
  getError(): BoxelErrorForContext {
    return {
      message:
        truncate(this.args.message ?? '', CONTEXT_MESSAGE_MAX_CHARS) ?? '',
      stack: truncate(this.args.stack, CONTEXT_STACK_MAX_CHARS),
      additionalErrors: this.contextAdditionalErrors,
      diagnostics: this.args.diagnostics,
      sourceUrl: this.args.fileToAttach?.sourceUrl,
    };
  }

  private get headerText() {
    return this.args.headerText ?? `${this.args.type} Error`;
  }

  // CS-10872: pretty-print the diagnostics block so the details
  // section is human-readable at a glance. JSON.stringify with indent
  // keeps the structure (waits sub-object, per-item arrays) visible
  // without imposing a bespoke layout on every possible field.
  private get diagnosticsText(): string | undefined {
    let d = this.args.diagnostics;
    if (!d || typeof d !== 'object' || Object.keys(d).length === 0) {
      return undefined;
    }
    try {
      return JSON.stringify(d, null, 2);
    } catch {
      return undefined;
    }
  }

  // Summary line: pick the small handful of fields that nearly always
  // point at the triage category (see
  // .claude/skills/prerender-timeout-diagnostics/SKILL.md). Shown
  // above the full JSON so operators don't have to parse the block.
  private get diagnosticsSummary(): string | undefined {
    let d = this.args.diagnostics as
      | {
          launchMs?: number;
          renderElapsedMs?: number;
          totalElapsedMs?: number;
          waits?: {
            semaphoreMs?: number;
            tabQueueMs?: number;
            tabStartupMs?: number;
          };
          renderStage?: string;
          stageAgeMs?: number;
          requestId?: string;
        }
      | undefined;
    if (!d) return undefined;
    let parts: string[] = [];
    if (typeof d.totalElapsedMs === 'number') {
      parts.push(`total=${d.totalElapsedMs}ms`);
    }
    if (typeof d.launchMs === 'number') {
      let waits = d.waits;
      if (
        waits &&
        (typeof waits.semaphoreMs === 'number' ||
          typeof waits.tabQueueMs === 'number' ||
          typeof waits.tabStartupMs === 'number')
      ) {
        parts.push(
          `launch=${d.launchMs}ms (semaphore=${waits.semaphoreMs ?? 0}ms, tabQueue=${waits.tabQueueMs ?? 0}ms, tabStartup=${waits.tabStartupMs ?? 0}ms)`,
        );
      } else {
        parts.push(`launch=${d.launchMs}ms`);
      }
    }
    if (typeof d.renderElapsedMs === 'number') {
      parts.push(`render=${d.renderElapsedMs}ms`);
    }
    if (d.renderStage) {
      parts.push(
        typeof d.stageAgeMs === 'number'
          ? `stage=${d.renderStage} (age=${d.stageAgeMs}ms)`
          : `stage=${d.renderStage}`,
      );
    }
    if (d.requestId) {
      parts.push(`requestId=${d.requestId}`);
    }
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }

  <template>
    <div class='error-display' data-test-error-display>
      <div class='error-header'>
        <div class='error-type' data-test-error-type>
          <Warning class='error-icon' />
          <span>{{this.headerText}}</span>
        </div>
        {{#if @fileToAttach}}
          <SendErrorToAIAssistant
            @error={{this.errorObject}}
            @errorType={{@type}}
            @fileToAttach={{@fileToAttach}}
          />
        {{/if}}
      </div>

      {{#if @message}}
        <div class='error-message' data-test-error-message>
          {{@message}}
        </div>
      {{/if}}

      <div class='error-actions'>
        <CopyButton
          @textToCopy={{this.errorText}}
          @width='16px'
          @heigth='16px'
        />
        <Button
          class='toggle-details-button'
          @kind='text-only'
          @size='extra-small'
          {{on 'click' this.toggleDetails}}
          data-test-toggle-details
        >
          {{if this.showDetails 'Hide Details' 'Show Details'}}
          {{#if this.showDetails}}
            <DropdownArrowUp width='12px' height='12px' />
          {{else}}
            <DropdownArrowDown width='12px' height='12px' />
          {{/if}}
        </Button>
      </div>

      {{#if this.showDetails}}
        <div class='error-details' data-test-error-details>
          {{#if @viewInCodeMode}}
            <div class='actions'>
              <Button
                data-test-view-in-code-mode-button
                @kind='primary'
                {{on 'click' (perform this.viewInCodeMode)}}
              >View in Code Mode</Button>
            </div>
          {{/if}}
          <div class='detail-item'>
            <div class='detail-title'>Stack trace:</div>
            {{#if @stack}}
              <pre data-test-error-stack data-test-percy-hide>{{@stack}}</pre>
            {{else}}
              <p class='no-stack-message'>No stack trace is available. This
                could be because the error occurred in a context where stack
                traces are not captured, or the error was handled before a stack
                trace could be generated.</p>
            {{/if}}
          </div>
          {{#if this.diagnosticsText}}
            <div class='detail-item' data-test-error-diagnostics>
              <div class='detail-title'>Prerender diagnostics:</div>
              {{#if this.diagnosticsSummary}}
                <p
                  class='diagnostics-summary'
                  data-test-error-diagnostics-summary
                >{{this.diagnosticsSummary}}</p>
              {{/if}}
              <pre
                data-test-error-diagnostics-json
                data-test-percy-hide
              >{{this.diagnosticsText}}</pre>
            </div>
          {{/if}}
          {{#if this.normalizedAdditionalErrors}}
            <div
              class='detail-item'
              data-test-error-additional-errors
              data-test-error-additional-errors-count={{this.additionalErrorsCount}}
            >
              <div class='detail-title'>Additional Errors:</div>
              {{#each this.normalizedAdditionalErrors as |entry index|}}
                <div
                  class='additional-error-entry'
                  data-test-error-additional-error
                  data-test-error-additional-error-index={{index}}
                >
                  {{#if entry.title}}
                    <div
                      class='additional-error-heading'
                      data-test-error-additional-heading
                    >{{entry.title}}</div>
                  {{/if}}
                  {{#if entry.message}}
                    <p
                      class='additional-error-message'
                      data-test-error-additional-message
                    >{{entry.message}}</p>
                  {{/if}}
                  {{#if entry.stack}}
                    <pre
                      data-test-error-additional-stack
                      data-test-percy-hide
                    >{{entry.stack}}</pre>
                  {{/if}}
                </div>
              {{/each}}
            </div>
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .error-display {
        background: var(--boxel-warning-200);
        border-radius: var(--boxel-border-radius-lg);
        padding-bottom: var(--boxel-sp-xs);
        color: black;
        min-width: fit-content;
        width: 100%;
        box-shadow: var(--boxel-deep-box-shadow);
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        max-height: 100%;
      }

      .error-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--boxel-sp-xs);
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp) var(--boxel-sp) 0 var(--boxel-sp);
      }

      .error-type {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-weight: 600;
        text-transform: uppercase;
      }

      .error-icon {
        width: 20px;
        height: 20px;
        color: black;
      }

      .error-message {
        font-size: var(--boxel-font-size-sm);
        padding: 0 var(--boxel-sp) 0
          calc(var(--boxel-sp) + 20px + var(--boxel-sp-xs));
      }

      .error-actions {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        margin-top: var(--boxel-sp);
        padding: 0 var(--boxel-sp);

        --boxel-icon-button-height: 20px;
        --boxel-icon-button-width: 20px;
      }

      .toggle-details-button {
        padding: 0;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        width: 100px;
        justify-content: flex-end;
        font-weight: 400;
        border: none;
      }

      .toggle-details-button:hover {
        background-color: transparent;
      }

      .error-details {
        background: white;
        padding: var(--boxel-sp);
        width: 100%;
        margin-bottom: calc(-1 * var(--boxel-sp));
        overflow: auto;
        scrollbar-width: thin;
        flex: 1;
      }

      .error-details::-webkit-scrollbar {
        width: 8px;
      }

      .error-details::-webkit-scrollbar-track {
        background: var(--boxel-light);
      }

      .error-details::-webkit-scrollbar-thumb {
        background: var(--boxel-dark);
        border-radius: 4px;
      }

      .detail-item {
        margin-bottom: var(--boxel-sp);
      }

      .detail-item:last-child {
        margin-bottom: 0;
      }

      .detail-title {
        font-weight: 600;
        margin-bottom: var(--boxel-sp-xs);
      }

      .detail-contents {
        word-break: break-word;
      }

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-all;
      }

      .no-stack-message {
        color: var(--boxel-purple-700);
        font-style: italic;
        margin: 0;
      }

      .diagnostics-summary {
        margin: 0 0 var(--boxel-sp-xs) 0;
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: var(--boxel-font-size-xs);
        line-height: 1.5;
        word-break: break-word;
        background: #fff6d6;
        padding: var(--boxel-sp-xs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        border-left: 3px solid var(--boxel-warning-200);
      }

      .actions {
        display: flex;
        justify-content: center;
        gap: var(--boxel-sp);
        margin-top: var(--boxel-sp-lg);
      }

      .additional-error-entry {
        margin-bottom: var(--boxel-sp);
        padding-bottom: var(--boxel-sp-xs);
        border-bottom: 1px solid var(--boxel-200, #ddd);
      }

      .additional-error-entry:last-child {
        margin-bottom: 0;
        padding-bottom: 0;
        border-bottom: none;
      }

      .additional-error-heading {
        font-weight: 600;
        margin-bottom: var(--boxel-sp-xxs);
        word-break: break-word;
      }

      .additional-error-message {
        margin: 0 0 var(--boxel-sp-xs) 0;
        font-size: var(--boxel-font-size-sm);
        word-break: break-word;
      }
    </style>
  </template>
}
