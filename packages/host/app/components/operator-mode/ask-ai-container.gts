import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import {
  isCardInstance,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import AddSkillsToRoomCommand from '@cardstack/host/commands/add-skills-to-room';
import CreateAiAssistantRoomCommand from '@cardstack/host/commands/create-ai-assistant-room';
import OpenAiAssistantRoomCommand from '@cardstack/host/commands/open-ai-assistant-room';
import SendAiAssistantMessageCommand from '@cardstack/host/commands/send-ai-assistant-message';
import AskAiTextBox from '@cardstack/host/components/ai-assistant/ask-ai-text-box';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RoomAttachmentsService from '@cardstack/host/services/room-attachments-service';
import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';

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
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @service private declare roomAttachmentsService: RoomAttachmentsService;
  @service private declare store: StoreService;
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
    let { roomId } = await createRoomCommand.execute({ name });

    let openRoomCommand = new OpenAiAssistantRoomCommand(commandContext);
    await openRoomCommand.execute({ roomId });

    let addSkillsCommand = new AddSkillsToRoomCommand(commandContext);
    await addSkillsCommand.execute({
      roomId,
      skills: await this.matrixService.loadDefaultSkills(
        this.operatorModeStateService.state.submode,
      ),
    });

    let openCardIds = this.roomAttachmentsService.getOpenCardIds(
      this.args.selectedCardRef,
    );
    let openCards: CardDef[] | undefined;
    if (openCardIds) {
      openCards = (
        await Promise.all(openCardIds.map((id) => this.store.peek(id)))
      )
        .filter(Boolean)
        .filter(isCardInstance);
    }
    let openFileURL = this.roomAttachmentsService.openFileURL;

    let sendMessageCommand = new SendAiAssistantMessageCommand(commandContext);
    await sendMessageCommand.execute({
      roomId,
      prompt: this.aiPrompt,
      attachedCards: openCards,
      attachedFileURLs: openFileURL ? [openFileURL] : undefined,
      openCardIds,
    });

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
