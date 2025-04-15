import { inject as service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { SkillCard } from 'https://cardstack.com/base/skill-card';

import HostBaseCommand from '../lib/host-base-command';

import AddSkillsToRoomCommand from './add-skills-to-room';
import CreateAiAssistantRoomCommand from './create-ai-assistant-room';
import OpenAiAssistantRoomCommand from './open-ai-assistant-room';

import SendAiAssistantMessageCommand from './send-ai-assistant-message';
import SetActiveLLMCommand from './set-active-llm';

import type StoreService from '../services/store';

export default class UseAiAssistantCommand extends HostBaseCommand<
  typeof BaseCommandModule.UseAiAssistantInput,
  typeof BaseCommandModule.SendAiAssistantMessageResult
> {
  @service declare private store: StoreService;

  #cardAPI?: typeof CardAPI;

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
    await Promise.all([
      openRoomPromise,
      loadSkillsPromise,
      attachedCardsPromise,
      setActiveLLMPromise,
    ]);
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
    });
    return sendMessageResult;
  }

  async createRoomIfNeeded(
    input: BaseCommandModule.UseAiAssistantInput,
  ): Promise<string> {
    if (input.roomId && input.roomId !== 'new') {
      return input.roomId;
    }
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
    let skillCards = new Set<SkillCard>(input.skillCards ?? []);
    let skillCardIds = input.skillCardIds ?? [];
    let loadSkillCardPromises = skillCardIds.map(async (skillCardId) => {
      return this.store.get<SkillCard>(skillCardId);
    });

    let loadedSkillCardOrErrors = await Promise.all(loadSkillCardPromises);
    for (const loadedSkillCardOrError of loadedSkillCardOrErrors) {
      if (isCardInstance(loadedSkillCardOrError)) {
        skillCards.add(loadedSkillCardOrError);
      } else {
        console.warn(
          'Failed to load skill card',
          loadedSkillCardOrError.id,
          loadedSkillCardOrError.message,
        );
      }
    }

    if (skillCards.size) {
      let addSkillsToRoomCommand = new AddSkillsToRoomCommand(
        this.commandContext,
      );
      await addSkillsToRoomCommand.execute({
        roomId,
        skills: [...skillCards],
      });
    }
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
}
