import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { type ResolvedCodeRef } from '@cardstack/runtime-common';

import AddSkillsToRoomCommand from '@cardstack/host/commands/add-skills-to-room';
import CreateAiAssistantRoomCommand from '@cardstack/host/commands/create-ai-assistant-room';
import OpenAiAssistantRoomCommand from '@cardstack/host/commands/open-ai-assistant-room';
import SendAiAssistantMessageCommand from '@cardstack/host/commands/send-ai-assistant-message';

import AskAiTextBox from '@cardstack/host/components/ai-assistant/ask-ai-text-box';

import type CommandService from '../../services/command-service';
import type MatrixService from '../../services/matrix-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';

interface Signature {
  Args: {
    selectedCardRef?: ResolvedCodeRef;
  };
}

export default class AskAiContainer extends Component<Signature> {
  @service private declare commandService: CommandService;
  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @tracked private aiPrompt = '';

  @action private onInput(value: string) {
    this.aiPrompt = value;
  }

  @action private onSendPrompt() {
    this.sendMessageToNewRoom.perform('New AI Assistant Chat');
  }

  private sendMessageToNewRoom = restartableTask(async (name: string) => {
    let { commandContext } = this.commandService;

    let createRoomCommand = new CreateAiAssistantRoomCommand(commandContext);
    let openRoomCommand = new OpenAiAssistantRoomCommand(commandContext);
    let addSkillsCommand = new AddSkillsToRoomCommand(commandContext);
    let sendMessageCommand = new SendAiAssistantMessageCommand(commandContext);

    let [{ roomId }, skills, openCards] = await Promise.all([
      createRoomCommand.execute({ name }),
      this.matrixService.loadDefaultSkills(
        this.operatorModeStateService.state.submode,
      ),
      this.operatorModeStateService.getOpenCards.perform(
        this.args.selectedCardRef,
      ),
    ]);

    await Promise.all([
      addSkillsCommand.execute({ roomId, skills }),
      sendMessageCommand.execute({
        roomId,
        prompt: this.aiPrompt,
        attachedCards: openCards,
        attachedFileURLs: this.operatorModeStateService.openFileURL
          ? [this.operatorModeStateService.openFileURL]
          : undefined,
        openCardIds: openCards?.map((c) => c.id),
        realmUrl: this.operatorModeStateService.realmURL.href,
      }),
    ]);

    await openRoomCommand.execute({ roomId });
    this.aiPrompt = '';
  });

  <template>
    <div class='ask-ai-container'>
      <AskAiTextBox
        @value={{this.aiPrompt}}
        @onInput={{this.onInput}}
        @onSend={{this.onSendPrompt}}
        @isLoading={{this.sendMessageToNewRoom.isRunning}}
      />
    </div>

    <style scoped>
      .ask-ai-container {
        width: 310px;
        position: absolute;
        bottom: var(--operator-mode-spacing);
        right: calc(
          2 * var(--operator-mode-spacing) + var(--container-button-size)
        );
        border-radius: var(--boxel-border-radius-xxl);
        box-shadow: var(--boxel-deep-box-shadow);
        z-index: var(--host-ai-panel-button-z-index);
      }
    </style>
  </template>
}
