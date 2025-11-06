import { inject as service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { Skill } from 'https://cardstack.com/base/skill';

import HostBaseCommand from '../lib/host-base-command';

import CreateAiAssistantRoomCommand from './create-ai-assistant-room';
import OpenAiAssistantRoomCommand from './open-ai-assistant-room';

import SendAiAssistantMessageCommand from './send-ai-assistant-message';
import SetActiveLLMCommand from './set-active-llm';
import UpdateRoomSkillsCommand from './update-room-skills';

import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type StoreService from '../services/store';

export default class UseAiAssistantCommand extends HostBaseCommand<
  typeof BaseCommandModule.UseAiAssistantInput,
  typeof BaseCommandModule.SendAiAssistantMessageResult
> {
  @service declare private store: StoreService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private matrixService: MatrixService;

  #cardAPI?: typeof CardAPI;

  static actionVerb = 'Send';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { UseAiAssistantInput } = commandModule;
    return UseAiAssistantInput;
  }

  async loadCardAPI() {
    if (!this.#cardAPI) {
      this.#cardAPI = await this.loaderService.loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
    }
    return this.#cardAPI;
  }

  protected async run(
    input: BaseCommandModule.UseAiAssistantInput,
  ): Promise<BaseCommandModule.SendAiAssistantMessageResult> {
    let roomId = await this.createRoomIfNeeded(input);

    let openRoomPromise = this.maybeOpenRoom(input, roomId);
    let loadSkillsPromise = this.maybeLoadSkillCards(input, roomId);
    let attachedCardsPromise = this.ensureAttachedCardsLoaded(input);
    let setActiveLLMPromise = this.maybeSetActiveLLM(input, roomId);
    let setLLMModePromise = this.maybeSetLLMMode(input, roomId);
    await Promise.all([
      openRoomPromise,
      loadSkillsPromise,
      attachedCardsPromise,
      setActiveLLMPromise,
      setLLMModePromise,
    ]);

    // Only send message if prompt is provided
    if (input.prompt && input.prompt.trim() !== '') {
      let sendMessageCommand = new SendAiAssistantMessageCommand(
        this.commandContext,
      );
      let sendMessageResult = await sendMessageCommand.execute({
        roomId,
        prompt: input.prompt,
        clientGeneratedId: input.clientGeneratedId,
        attachedCards: [...(await attachedCardsPromise)],
        attachedFileURLs: input.attachedFileURLs,
        openCardIds: input.openCardIds,
        realmUrl: this.operatorModeStateService.realmURL.href,
        requireCommandCall: input.requireCommandCall,
      });
      return sendMessageResult;
    }

    // Return a result indicating no message was sent
    let commandModule = await this.loadCommandModule();
    const { SendAiAssistantMessageResult } = commandModule;
    return new SendAiAssistantMessageResult({ roomId });
  }

  async createRoomIfNeeded(
    input: BaseCommandModule.UseAiAssistantInput,
  ): Promise<string> {
    // If a specific roomId is provided and it's not 'new', use that room
    if (input.roomId && input.roomId !== 'new') {
      return input.roomId;
    }

    // Check if there's a current room open (only when roomId is not 'new')
    let currentRoomId = this.matrixService.currentRoomId;
    if (input.roomId !== 'new' && currentRoomId) {
      return currentRoomId;
    }

    // Create a new room if no roomId is provided and no current room exists
    let createAIAssistantRoomCommand = new CreateAiAssistantRoomCommand(
      this.commandContext,
    );
    let createRoomResult = await createAIAssistantRoomCommand.execute({
      name: input.roomName,
    });
    return createRoomResult.roomId;
  }

  async maybeOpenRoom(
    input: BaseCommandModule.UseAiAssistantInput,
    roomId: string,
  ): Promise<void> {
    if (input.openRoom) {
      let openAiAssistantRoomCommand = new OpenAiAssistantRoomCommand(
        this.commandContext,
      );
      await openAiAssistantRoomCommand.execute({
        roomId,
      });
    }
  }

  async maybeLoadSkillCards(
    input: BaseCommandModule.UseAiAssistantInput,
    roomId: string,
  ): Promise<void> {
    let skillCards = new Set<Skill>(input.skillCards ?? []);
    let skillCardIds = new Set<string>(input.skillCardIds ?? []);
    for (let skillCard of skillCards) {
      if (skillCard.id) {
        skillCardIds.add(skillCard.id);
      }
    }

    if (skillCardIds.size === 0) {
      return;
    }

    let updateRoomSkillsCommand = new UpdateRoomSkillsCommand(
      this.commandContext,
    );
    await updateRoomSkillsCommand.execute({
      roomId,
      skillCardIdsToActivate: [...skillCardIds],
    });
  }

  async ensureAttachedCardsLoaded(
    input: BaseCommandModule.UseAiAssistantInput,
  ): Promise<Set<CardAPI.CardDef>> {
    let attachedCards = new Set<CardAPI.CardDef>(input.attachedCards ?? []);
    let attachedCardIds = input.attachedCardIds ?? [];
    let loadAttachedCardPromises = attachedCardIds.map(
      async (attachedCardId) => {
        return this.store.get<CardAPI.CardDef>(attachedCardId);
      },
    );
    let loadedAttachedCardOrErrors = await Promise.all(
      loadAttachedCardPromises,
    );
    for (const loadedAttachedCardOrError of loadedAttachedCardOrErrors) {
      if (isCardInstance(loadedAttachedCardOrError)) {
        attachedCards.add(loadedAttachedCardOrError);
      } else {
        console.warn(
          'Failed to load attached card',
          loadedAttachedCardOrError.id,
          loadedAttachedCardOrError.message,
        );
      }
    }
    return attachedCards;
  }

  async maybeSetActiveLLM(
    input: BaseCommandModule.UseAiAssistantInput,
    roomId: string,
  ): Promise<void> {
    if (input.llmModel) {
      let setActiveLLMCommand = new SetActiveLLMCommand(this.commandContext);
      await setActiveLLMCommand.execute({
        roomId,
        model: input.llmModel,
      });
    }
  }

  async maybeSetLLMMode(
    input: BaseCommandModule.UseAiAssistantInput,
    roomId: string,
  ): Promise<void> {
    if (input.llmMode) {
      await this.matrixService.sendLLMModeEvent(roomId, input.llmMode as any);
    }
  }
}
