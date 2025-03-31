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
  type ResolvedCodeRef,
  internalKeyFor,
} from '@cardstack/runtime-common';

import AddSkillsToRoomCommand from '@cardstack/host/commands/add-skills-to-room';
import CreateAiAssistantRoomCommand from '@cardstack/host/commands/create-ai-assistant-room';
import OpenAiAssistantRoomCommand from '@cardstack/host/commands/open-ai-assistant-room';
// import SendAiAssistantMessageCommand from '@cardstack/host/commands/send-ai-assistant-message';

import AskAiTextBox from '@cardstack/host/components/ai-assistant/ask-ai-text-box';
import { Submodes } from '@cardstack/host/components/submode-switcher';

import type CommandService from '../../services/command-service';
import type MatrixService from '../../services/matrix-service';
import type { OperatorModeContext } from '../../services/matrix-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';

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
  @tracked private aiPrompt = '';

  @action private onInput(value: string) {
    this.aiPrompt = value;
  }

  @action private onSendPrompt() {
    this.sendMessageToNewRoom.perform('New AI Assistant Chat');
  }

  private sendMessage = enqueueTask(
    async (roomId: string, message: string | undefined) => {
      let submode = this.operatorModeStateService.state.submode;
      let cards: CardDef[] | undefined;
      let files: FileDef[] | undefined;
      let context: OperatorModeContext | undefined;

      if (submode === Submodes.Interact) {
        cards = this.operatorModeStateService
          .topMostStackItems()
          .filter((stackItem) => stackItem)
          .map((stackItem) => stackItem.card);
        context = {
          submode,
          openCardIds: cards.map((c) => c.id),
        };
        files = undefined;
      } else {
        let autoAttachedFileUrl =
          this.operatorModeStateService.state.codePath?.href;
        if (!autoAttachedFileUrl) {
          files = undefined;
        } else {
          files = [
            this.matrixService.fileAPI.createFileDef({
              sourceUrl: autoAttachedFileUrl,
              name: autoAttachedFileUrl.split('/').pop(),
            }),
          ];
        }

        if (!this.args.selectedCardRef) {
          cards = undefined;
        } else {
          let playgroundCardResource = this.getCard(this, () => {
            let moduleId = internalKeyFor(
              this.args.selectedCardRef!,
              undefined,
            );
            return this.playgroundPanelService.getSelection(moduleId)?.cardId;
          });
          await playgroundCardResource.loaded;
          cards = playgroundCardResource?.card
            ? [playgroundCardResource.card]
            : undefined;
        }
      }

      await this.matrixService.sendMessage(
        roomId,
        message,
        cards,
        files,
        undefined,
        context,
      );
    },
  );

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
