import { service } from '@ember/service';

import {
  isCardDocumentString,
  isCardErrorJSONAPI,
  type CardErrorJSONAPI,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { waitForRealmState } from './utils';

import type CardService from '../services/card-service';
import type CommandService from '../services/command-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

const cardIndexingTimeout = ENV.cardRenderTimeout;

export default class CheckCorrectnessCommand extends HostBaseCommand<
  typeof BaseCommandModule.CheckCorrectnessInput,
  typeof BaseCommandModule.CorrectnessResultCard
> {
  @service declare private store: StoreService;
  @service declare private realm: RealmService;
  @service declare private commandService: CommandService;
  @service declare private cardService: CardService;

  description =
    'Run post-change correctness checks for a specific file or card instance.';
  static actionVerb = 'Check';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    return commandModule.CheckCorrectnessInput;
  }

  requireInputFields = ['targetType', 'targetRef', 'roomId'];

  protected async run(
    input: BaseCommandModule.CheckCorrectnessInput,
  ): Promise<BaseCommandModule.CorrectnessResultCard> {
    if (!input.targetType || !input.targetRef) {
      throw new Error(
        'Target type and reference are required to run correctness checks.',
      );
    }
    let roomId = input.roomId;
    if (!roomId) {
      throw new Error('Room id is required to run correctness checks.');
    }

    let targetType = input.targetType;
    let cardId = input.cardId;

    // Sometimes AI will patch cards directly as files (with search/replace blocks) so we need to check
    // whether the file is actually a card instance
    if (
      targetType !== 'card' &&
      !cardId &&
      input.fileUrl &&
      input.fileUrl.endsWith('.json')
    ) {
      let inferredCardId = await this.checkIfFileIsACardInstance(input.fileUrl);
      if (inferredCardId) {
        targetType = 'card';
        cardId = inferredCardId;
      }
    }

    let commandModule = await this.loadCommandModule();
    const { CorrectnessResultCard } = commandModule;
    let errors: string[] = [];

    if (targetType === 'card') {
      if (!cardId) {
        throw new Error('Card correctness checks require a cardId.');
      }
      errors = await this.collectCardErrors(cardId, roomId);
    }

    return new CorrectnessResultCard({
      correct: errors.length === 0,
      errors,
      warnings: [],
    });
  }

  private async collectCardErrors(
    cardId: string,
    roomId: string,
  ): Promise<string[]> {
    let hasPendingRequest =
      this.commandService.hasPendingAiAssistantCardRequest(cardId, roomId);
    let invalidationArrived =
      this.commandService.invalidationAfterCardPatchDidArrive(cardId, roomId);

    if (hasPendingRequest && !invalidationArrived) {
      await this.waitForCardIndexing(cardId);
    }

    let error = await this.refreshCard(cardId);

    if (!error) {
      error = this.store.peekError(cardId);
    }

    if (
      hasPendingRequest &&
      this.commandService.invalidationAfterCardPatchDidArrive(cardId, roomId)
    ) {
      this.commandService.clearAiAssistantRequestForCard(cardId, roomId);
    }

    if (!error) {
      return [];
    }
    return [this.describeCardError(cardId, error)];
  }

  private async refreshCard(
    cardId: string,
  ): Promise<CardErrorJSONAPI | undefined> {
    await this.store.waitForCardLoad(cardId);
    try {
      let result = await this.store.getWithoutCache(cardId);
      if (isCardErrorJSONAPI(result)) {
        return result;
      }
    } catch (error) {
      console.warn(
        `CheckCorrectnessCommand: failed to refresh card ${cardId}`,
        error,
      );
    } finally {
      await this.store.waitForCardLoad(cardId);
    }
    return undefined;
  }

  private async waitForCardIndexing(cardId: string): Promise<void> {
    let cardURL: URL | undefined;
    try {
      cardURL = new URL(cardId);
    } catch (error) {
      console.warn(
        `CheckCorrectnessCommand: invalid card id ${cardId}, skipping index wait`,
        error,
      );
      return;
    }

    let realmURL = this.realm.realmOfURL(cardURL);
    if (!realmURL) {
      console.warn(
        `CheckCorrectnessCommand: unable to determine realm for ${cardId}`,
      );
      return;
    }

    try {
      await waitForRealmState(
        this.commandContext,
        realmURL.href,
        (event) => {
          if (
            !event ||
            event.eventName !== 'index' ||
            event.indexType !== 'incremental'
          ) {
            return false;
          }

          return event.invalidations?.some((invalidation) =>
            this.matchesInvalidation(cardURL!.href, invalidation),
          );
        },
        { timeoutMs: cardIndexingTimeout },
      );
    } catch (error) {
      console.warn(
        `CheckCorrectnessCommand: timed out waiting for indexing of ${cardId}`,
        error,
      );
    }
  }

  private matchesInvalidation(cardHref: string, invalidation: string): boolean {
    if (invalidation === cardHref) {
      return true;
    }
    let normalizedTarget = cardHref.replace(/\.json$/, '');
    let normalizedInvalidation = invalidation.replace(/\.json$/, '');
    return normalizedTarget === normalizedInvalidation;
  }

  private describeCardError(cardId: string, error: CardErrorJSONAPI): string {
    let pieces = [error.title, error.message]
      .filter((part): part is string => typeof part === 'string')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (pieces.length >= 2 && pieces[0] === pieces[1]) {
      pieces = [pieces[0]];
    }
    let summary =
      pieces.length > 0 ? pieces.join(' - ').trim() : 'Unknown card error';
    return `${cardId}: ${summary}`;
  }

  private async checkIfFileIsACardInstance(
    fileUrl: string,
  ): Promise<string | undefined> {
    try {
      let { status, content } = await this.cardService.getSource(
        new URL(fileUrl),
      );
      if (status !== 200) {
        return undefined;
      }
      if (!isCardDocumentString(content)) {
        return undefined;
      }
      return fileUrl.replace(/\.json$/, '');
    } catch (error) {
      console.warn(
        `CheckCorrectnessCommand: unable to inspect file ${fileUrl} for card content`,
        error,
      );
      return undefined;
    }
  }
}
