import { service } from '@ember/service';

import {
  isCardDocumentString,
  isCardErrorJSONAPI,
  SupportedMimeType,
  type CardErrorJSONAPI,
  type LintResult,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type CommandService from '../services/command-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
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
  @service declare private realmServer: RealmServerService;
  @service declare private network: NetworkService;

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
    let cardId = targetType === 'card' ? input.targetRef : undefined;
    // Sometimes AI will patch cards directly as files (with search/replace blocks) so we need to check
    // whether the file is actually a card instance

    if (targetType !== 'card' && input.targetRef.endsWith('.json')) {
      let inferredCardId = await this.checkIfFileIsACardInstance(
        input.targetRef,
      );
      if (inferredCardId) {
        targetType = 'card';
        cardId = inferredCardId;
      }
    }

    let commandModule = await this.loadCommandModule();
    const { CorrectnessResultCard } = commandModule;
    let errors: string[] = [];
    let lintIssues: string[] = [];

    let writeError = this.cardService.peekWriteError(input.targetRef);
    if (writeError) {
      return new CorrectnessResultCard({
        correct: false,
        errors: [this.describeCardError(input.targetRef, writeError)],
        warnings: [],
      });
    }

    if (
      targetType === 'file' &&
      (await this.isEmptyFileContent(input.targetRef))
    ) {
      return new CorrectnessResultCard({
        correct: true,
        errors: [],
        warnings: [],
      });
    }

    if (targetType === 'file' && input.targetRef.endsWith('.gts')) {
      errors = await this.collectModuleErrors(input.targetRef, roomId);
      lintIssues = await this.collectLintIssues(input.targetRef);
    } else if (targetType === 'file' && this.isLintableFile(input.targetRef)) {
      lintIssues = await this.collectLintIssues(input.targetRef);
    } else if (targetType === 'card') {
      if (!cardId) {
        throw new Error('Card correctness checks require a targetRef.');
      }
      errors = await this.collectCardErrors(cardId, roomId);
    }

    if (lintIssues.length) {
      errors = errors.concat(lintIssues);
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
    await this.commandService.waitForInvalidationAfterAIAssistantRequest(
      roomId,
      cardId,
      cardIndexingTimeout,
    );

    let error = await this.refreshCard(cardId);

    if (!error) {
      error = this.store.peekError(cardId);
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

  private async collectModuleErrors(
    targetRef: string,
    roomId: string,
  ): Promise<string[]> {
    let moduleInfo = this.moduleInfoFromFile(targetRef);
    if (!moduleInfo) {
      return [
        `${targetRef}: Unable to determine module URL or realm for correctness check`,
      ];
    }

    let { moduleURL, realmURL, fileURL } = moduleInfo;

    await this.commandService.waitForInvalidationAfterAIAssistantRequest(
      roomId,
      fileURL.href,
      cardIndexingTimeout,
    );

    let errorMessage = await this.prerenderModule(moduleURL, realmURL);

    if (!errorMessage) {
      return [];
    }

    return [errorMessage];
  }

  private moduleInfoFromFile(
    targetRef: string,
  ): { moduleURL: URL; realmURL: URL; fileURL: URL } | undefined {
    try {
      let fileURL = new URL(targetRef);
      let realmURL = this.realm.realmOfURL(fileURL);
      if (!realmURL) {
        return undefined;
      }

      let moduleHref = fileURL.href.replace(/\.gts$/, '');
      let moduleURL = new URL(moduleHref);
      return { moduleURL, realmURL, fileURL };
    } catch {
      return undefined;
    }
  }

  private async prerenderModule(
    moduleURL: URL,
    realmURL: URL,
  ): Promise<string | undefined> {
    try {
      let prerenderURL = new URL('/_prerender-module', this.realmServer.url);

      let response = await this.realmServer.authedFetch(prerenderURL.href, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
        },
        body: JSON.stringify({
          data: {
            type: 'prerender-module-request',
            attributes: {
              realm: realmURL.href,
              url: moduleURL.href,
            },
          },
        }),
      });

      let body: any;
      try {
        body = await response.json();
      } catch (error) {
        let text = await response.text().catch(() => '');
        return `${moduleURL.href}: Unable to parse prerender response (${response.status}) ${text}`;
      }

      if (!response.ok) {
        return `${moduleURL.href}: prerender request failed (${response.status}) ${JSON.stringify(body)}`;
      }

      let prerenderError = body?.data?.attributes?.error?.error;
      if (prerenderError) {
        let messageParts = [
          prerenderError.message,
          prerenderError.stack,
        ].filter((part) => typeof part === 'string' && part.length > 0);
        let summary =
          messageParts.length > 0
            ? messageParts.join('\n')
            : 'Unknown prerender error';
        return `${moduleURL.href}: ${summary}`;
      }

      return undefined;
    } catch (error: any) {
      return `${moduleURL.href}: prerender request threw ${error?.message ?? error}`;
    }
  }

  private isLintableFile(targetRef: string): boolean {
    let path = targetRef;
    try {
      path = new URL(targetRef).pathname;
    } catch {
      // fall back to original targetRef when it's not a URL
    }
    return /\.(gts|ts)$/.test(path);
  }

  private async collectLintIssues(targetRef: string): Promise<string[]> {
    try {
      if (!this.isLintableFile(targetRef)) {
        return [];
      }

      let fileUrl = new URL(targetRef);
      let realmURL = this.realm.realmOfURL(fileUrl);
      if (!realmURL) {
        return [];
      }

      let { status, content } = await this.cardService.getSource(fileUrl);
      if (status !== 200 || !content.trim()) {
        return [];
      }

      let filename = fileUrl.pathname.split('/').pop() || 'input.gts';
      let response = await this.network.authedFetch(
        `${realmURL.href}_lint?lintMode=lint`,
        {
          method: 'POST',
          body: content,
          headers: {
            Accept: 'application/json',
            'Content-Type': SupportedMimeType.CardSource,
            'X-HTTP-Method-Override': 'QUERY',
            'X-Filename': filename,
          },
        },
      );

      if (!response.ok) {
        console.warn(
          `CheckCorrectnessCommand: lint request failed for ${targetRef} (${response.status})`,
        );
        return [];
      }

      let lintResult: LintResult;
      try {
        lintResult = (await response.json()) as LintResult;
      } catch (error) {
        console.warn(
          `CheckCorrectnessCommand: unable to parse lint response for ${targetRef}`,
          error,
        );
        return [];
      }

      let messages = Array.isArray(lintResult?.messages)
        ? lintResult.messages
        : [];
      return messages
        .map((message) => this.formatLintIssue(message))
        .filter((warning) => warning.length > 0);
    } catch (error) {
      console.warn(
        `CheckCorrectnessCommand: lint warning collection failed for ${targetRef}`,
        error,
      );
      return [];
    }
  }

  private async isEmptyFileContent(targetRef: string): Promise<boolean> {
    try {
      let fileUrl = new URL(targetRef);
      let { status, content } = await this.cardService.getSource(fileUrl);
      return status === 200 && content.trim() === '';
    } catch {
      return false;
    }
  }

  private formatLintIssue(message: LintResult['messages'][number]): string {
    if (!message || typeof message.message !== 'string') {
      return '';
    }
    let trimmedMessage = message.message.trim();
    if (!trimmedMessage) {
      return '';
    }

    let location = '';
    if (typeof message.line === 'number') {
      if (typeof message.column === 'number') {
        location = `line ${message.line}:${message.column}`;
      } else {
        location = `line ${message.line}`;
      }
    }

    let ruleId = message.ruleId ? ` (${message.ruleId})` : '';
    if (location) {
      return `${location} ${trimmedMessage}${ruleId}`.trim();
    }
    return `${trimmedMessage}${ruleId}`.trim();
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
