import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';

import { Button } from '@cardstack/boxel-ui/components';

import OpenAiAssistantRoomCommand from '@cardstack/host/tools/open-ai-assistant-room';
import SendAiAssistantMessageCommand from '@cardstack/host/tools/send-ai-assistant-message';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import type AiAssistantPanelService from '../../services/ai-assistant-panel-service';
import type CommandService from '../../services/command-service';
import type MatrixService from '../../services/matrix-service';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    error: {
      message: string;
      stack?: string;
      // CS-10977: optional structured payload — additional errors
      // captured by the prerender runner and prerender diagnostics
      // pulled off the error doc. Forwarded into the AI prompt body
      // so the assistant has the underlying template throw and the
      // timing context, not just the swallowed top-level message.
      additionalErrors?: Array<{
        message?: string;
        stack?: string;
        status?: number;
        title?: string;
      }>;
      diagnostics?: Record<string, unknown>;
    };
    errorType: 'syntax' | 'runtime';
    fileToAttach: FileDef;
  };
}

// Per-entry / per-call budgets (UTF-16 code units, not bytes). Truncation
// keeps the final string at or below the configured max, including the
// suffix.
const AI_ADDITIONAL_ERROR_STACK_MAX_CHARS = 8 * 1024;
const AI_ADDITIONAL_ERROR_MESSAGE_MAX_CHARS = 4 * 1024;
const AI_TOP_LEVEL_STACK_MAX_CHARS = 16 * 1024;
const AI_TOP_LEVEL_MESSAGE_MAX_CHARS = 4 * 1024;
const AI_ADDITIONAL_ERRORS_LIMIT = 50;
// Total prompt cap. Matrix events are typically capped at 65 KB. Stay
// well below so the rest of the message envelope (room + headers + the
// fixed prefix the assistant adds) has room.
const AI_PROMPT_TOTAL_MAX_CHARS = 48 * 1024;
const AI_TRUNCATION_SUFFIX = ' …[truncated]';

function truncateForAi(s: string | undefined, max: number): string | undefined {
  if (s == null) return s;
  if (s.length <= max) return s;
  let body = Math.max(0, max - AI_TRUNCATION_SUFFIX.length);
  return s.slice(0, body) + AI_TRUNCATION_SUFFIX;
}

export default class SendErrorToAIAssistant extends Component<Signature> {
  @service declare private matrixService: MatrixService;
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private commandService: CommandService;

  private get errorMessage() {
    let { error, errorType } = this.args;
    let prefix = errorType === 'syntax' ? 'Syntax Error' : 'Card Error';
    let message =
      truncateForAi(error.message, AI_TOP_LEVEL_MESSAGE_MAX_CHARS) ?? '';
    let truncatedStack = truncateForAi(
      error.stack,
      AI_TOP_LEVEL_STACK_MAX_CHARS,
    );
    let stack = truncatedStack ? `\n\nStack trace:\n${truncatedStack}` : '';

    let diagnosticsSection = '';
    if (
      error.diagnostics &&
      typeof error.diagnostics === 'object' &&
      Object.keys(error.diagnostics).length > 0
    ) {
      try {
        diagnosticsSection = `\n\nDiagnostics:\n${JSON.stringify(
          error.diagnostics,
          null,
          2,
        )}`;
      } catch {
        // best-effort: skip diagnostics if unserializable
      }
    }

    let additionalErrorsSection = '';
    let entries = error.additionalErrors;
    if (entries && entries.length > 0) {
      let shown = entries.slice(0, AI_ADDITIONAL_ERRORS_LIMIT);
      let parts = shown.map((e, i) => {
        let title = e?.title ?? `Error ${i + 1}`;
        let truncatedMessage = truncateForAi(
          e?.message,
          AI_ADDITIONAL_ERROR_MESSAGE_MAX_CHARS,
        );
        let body = truncatedMessage ? `\n${truncatedMessage}` : '';
        let entryStack = truncateForAi(
          e?.stack,
          AI_ADDITIONAL_ERROR_STACK_MAX_CHARS,
        );
        let stackPart = entryStack ? `\nStack:\n${entryStack}` : '';
        return `--- ${title} ---${body}${stackPart}`;
      });
      let footer =
        entries.length > AI_ADDITIONAL_ERRORS_LIMIT
          ? `\n\n(${entries.length - AI_ADDITIONAL_ERRORS_LIMIT} additional errors omitted)`
          : '';
      additionalErrorsSection = `\n\nAdditional Errors:\n${parts.join('\n\n')}${footer}`;
    }

    let assembled = `${prefix}\n\n${message}${stack}${diagnosticsSection}${additionalErrorsSection}`;
    // Final safety net: per-entry budgets above bound the assembled
    // string at roughly 50 × (4 + 8) KiB ≈ 600 KiB worst case (50 entries
    // each at the per-entry max), still well over Matrix's typical 65 KB
    // event ceiling. Cap the whole string here so a pathological doc
    // can't make Fix-with-AI fail to send.
    return truncateForAi(assembled, AI_PROMPT_TOTAL_MAX_CHARS) ?? assembled;
  }

  get commandContext() {
    return this.commandService.commandContext;
  }

  private sendToAiAssistant = restartableTask(async () => {
    await new OpenAiAssistantRoomCommand(this.commandContext).execute({
      roomId: this.matrixService.currentRoomId,
    });
    await new SendAiAssistantMessageCommand(this.commandContext).execute({
      roomId: this.matrixService.currentRoomId,
      prompt: `In the attachment file, I encountered an error that needs fixing:\n\n${this.errorMessage}.`,
      attachedFileIdentifiers: this.args.fileToAttach
        ? [this.args.fileToAttach.sourceUrl]
        : [],
    });
  });

  <template>
    <Button
      class='send-error-to-ai-assistant'
      @kind='secondary-dark'
      @size='extra-small'
      @disabled={{this.sendToAiAssistant.isRunning}}
      {{on 'click' this.sendToAiAssistant.perform}}
      data-test-send-error-to-ai-assistant
    >
      {{if this.sendToAiAssistant.isRunning 'Sending...' 'Fix with AI'}}
    </Button>

    <style scoped>
      .send-error-to-ai-assistant {
        --boxel-button-color: var(--boxel-ai-purple);
        --boxel-button-border: 1px solid var(--boxel-ai-purple);
        --boxel-button-text-color: var(--boxel-light);
        padding: 6px 12px;
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        text-wrap: nowrap;
        background-image: image-set(
          url('../ai-assistant/ai-assist-icon.webp') 1x,
          url('../ai-assistant/ai-assist-icon@2x.webp') 2x,
          url('../ai-assistant/ai-assist-icon@3x.webp')
        );
        background-color: var(--boxel-ai-purple);
        background-size: 14px 14px;
        background-position: 12px center;
        background-repeat: no-repeat;
        padding-left: 32px;
      }

      .send-error-to-ai-assistant:hover:not(:disabled) {
        --boxel-button-color: var(--boxel-ai-purple);
        --boxel-button-border: 1px solid var(--boxel-ai-purple);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .send-error-to-ai-assistant:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    </style>
  </template>
}
