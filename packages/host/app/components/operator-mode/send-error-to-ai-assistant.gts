import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';

import { Button } from '@cardstack/boxel-ui/components';

import OpenAiAssistantRoomCommand from '@cardstack/host/commands/open-ai-assistant-room';
import SendAiAssistantMessageCommand from '@cardstack/host/commands/send-ai-assistant-message';

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
    };
    errorType: 'syntax' | 'runtime';
    fileToAttach: FileDef;
  };
}

export default class SendErrorToAIAssistant extends Component<Signature> {
  @service declare private matrixService: MatrixService;
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private commandService: CommandService;

  private get errorMessage() {
    let { error, errorType } = this.args;
    let prefix = errorType === 'syntax' ? 'Syntax Error' : 'Card Error';
    let message = error.message;
    let stack = error.stack ? `\n\nStack trace:\n${error.stack}` : '';

    return `${prefix}\n\n${message}${stack}`;
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
      attachedFileURLs: this.args.fileToAttach
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
