import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';

import { Button } from '@cardstack/boxel-ui/components';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import type AiAssistantPanelService from '../../services/ai-assistant-panel-service';
import type MatrixService from '../../services/matrix-service';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    error: {
      message: string;
      stack?: string;
      title?: string;
    };
    errorType: 'syntax' | 'card';
    fileToAttach: FileDef;
  };
}

export default class FixItButton extends Component<Signature> {
  @service private declare matrixService: MatrixService;
  @service private declare aiAssistantPanelService: AiAssistantPanelService;

  private get errorMessage() {
    let { error, errorType } = this.args;
    let prefix = errorType === 'syntax' ? 'Syntax Error' : 'Card Error';
    let title = error.title ? `: ${error.title}` : '';
    let message = error.message;
    let stack = error.stack ? `\n\nStack trace:\n${error.stack}` : '';

    return `${prefix}${title}\n\n${message}${stack}`;
  }

  private sendToAiAssistant = restartableTask(async () => {
    await this.aiAssistantPanelService.openPanel();

    if (!this.matrixService.currentRoomId) {
      throw new Error('No room found');
    }

    await this.matrixService.sendMessage(
      this.matrixService.currentRoomId,
      `In the attached file, I encountered an error that needs fixing:\n\n${this.errorMessage}.`,
      [],
      this.args.fileToAttach ? [this.args.fileToAttach] : [],
    );
  });

  <template>
    <Button
      class='fix-it-button'
      @kind='primary'
      @size='small'
      @disabled={{this.sendToAiAssistant.isRunning}}
      {{on 'click' this.sendToAiAssistant.perform}}
      data-test-fix-it-button
    >
      {{if this.sendToAiAssistant.isRunning 'Sending...' 'Fix it'}}
    </Button>

    <style scoped>
      .fix-it-button {
        --boxel-button-color: var(--boxel-error-300);
        --boxel-button-border: 1px solid var(--boxel-error-300);
        --boxel-button-text-color: var(--boxel-light);
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 500;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s ease;
        text-wrap: nowrap;
      }

      .fix-it-button:hover:not(:disabled) {
        --boxel-button-color: var(--boxel-error-200);
        --boxel-button-border: 1px solid var(--boxel-error-200);
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .fix-it-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .fix-it-button :deep(svg) {
        width: 14px;
        height: 14px;
      }
    </style>
  </template>
}
