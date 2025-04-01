import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, enqueueTask } from 'ember-concurrency';
import { consume } from 'ember-provide-consume-context';

import type { FileDef } from 'https://cardstack.com/base/file-api';
import type { CardDef } from 'https://cardstack.com/base/card-api';

import {
  type getCard,
  GetCardContextName,
  isCardInstance,
  type ResolvedCodeRef,
  internalKeyFor,
} from '@cardstack/runtime-common';

import AddSkillsToRoomCommand from '@cardstack/host/commands/add-skills-to-room';
import CreateAiAssistantRoomCommand from '@cardstack/host/commands/create-ai-assistant-room';
import OpenAiAssistantRoomCommand from '@cardstack/host/commands/open-ai-assistant-room';
// import SendAiAssistantMessageCommand from '@cardstack/host/commands/send-ai-assistant-message';
import type StoreService from '@cardstack/host/services/store';

import AskAiTextBox from '@cardstack/host/components/ai-assistant/ask-ai-text-box';
import { Submodes } from '@cardstack/host/components/submode-switcher';

import type CommandService from '../../services/command-service';
import type MatrixService from '../../services/matrix-service';
import type { OperatorModeContext } from '../../services/matrix-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RoomAttachmentsService from '@cardstack/host/services/room-attachments-service';

interface Signature {
  Args: {
    selectedCardRef?: ResolvedCodeRef;
  };
}

export default class AskAiContainer extends Component<Signature> {
  @consume(GetCardContextName) private declare getCard: getCard;

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

    this.sendMessage.perform(roomId, this.aiPrompt);

    // let autoAttachedFileURL = this.roomAttachmentsService.autoAttachedFileURL;
    // let sendMessageCommand = new SendAiAssistantMessageCommand(commandContext);
    // await sendMessageCommand.execute({
    //   roomId,
    //   prompt: this.aiPrompt,
    //   attachedCards: this.roomAttachmentsService.autoAttachedCards,
    //   attachedFileURLs: autoAttachedFileURL ? [autoAttachedFileURL] : undefined,
    //   openCardIds: this.roomAttachmentsService.openCardIds,
    // });

    this.aiPrompt = '';
  });

  private sendMessage = enqueueTask(
    async (roomId: string, message: string | undefined) => {
      let submode = this.operatorModeStateService.state.submode;
      let attachedCards: CardDef[] | undefined;
      let attachedFiles: FileDef[] | undefined;
      let context: OperatorModeContext | undefined;

      if (submode === Submodes.Interact) {
        attachedCards = this.roomAttachmentsService.autoAttachedCards;
        context = attachedCards
          ? {
              submode,
              openCardIds: attachedCards.map((c) => c.id),
            }
          : undefined;
      } else if (submode === Submodes.Code) {
        let autoAttachedFile = this.roomAttachmentsService.autoAttachedFile;
        attachedFiles = autoAttachedFile ? [autoAttachedFile] : undefined;

        if (this.args.selectedCardRef) {
          let moduleId = internalKeyFor(this.args.selectedCardRef, undefined);
          let cardId =
            this.playgroundPanelService.getSelection(moduleId)?.cardId;
          if (cardId) {
            let card = await this.store.getInstanceDetachedFromStore(cardId);
            attachedCards = isCardInstance(card) ? [card] : undefined;
          }
        }
      }

      await this.matrixService.sendMessage(
        roomId,
        message,
        attachedCards,
        attachedFiles,
        undefined,
        context,
      );
    },
  );

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
