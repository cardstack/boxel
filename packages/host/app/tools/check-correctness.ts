import { service } from '@ember/service';

import {
  isCardDocumentString,
  isCardErrorJSONAPI,
  rri,
  type CardErrorJSONAPI,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import {
  collectCardInstanceWarnings,
  type LinkTargetStatus,
} from '../lib/card-instance-warnings';
import HostBaseTool from '../lib/host-base-tool';

import type CardService from '../services/card-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';
import type ToolService from '../services/tool-service';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

const cardIndexingTimeout = ENV.cardRenderTimeout;

export default class CheckCorrectnessTool extends HostBaseTool<
  typeof BaseToolModule.CheckCorrectnessInput,
  typeof BaseToolModule.CorrectnessResultCard
> {
  @service declare private store: StoreService;
  @service declare private realm: RealmService;
  @service declare private toolService: ToolService;
  @service declare private cardService: CardService;
  @service declare private realmServer: RealmServerService;
  @service declare private network: NetworkService;

  description =
    'Run post-change correctness checks for a specific file or card instance.';
  static actionVerb = 'Check';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.CheckCorrectnessInput;
  }

  requireInputFields = ['targetType', 'targetRef', 'roomId'];

  protected async run(
    input: BaseToolModule.CheckCorrectnessInput,
  ): Promise<BaseToolModule.CorrectnessResultCard> {
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
    // Sometimes AI will write cards directly as files so we need to check
    // whether the file is actually a card instance

    let nonCardJsonError: string | undefined;
    let cardSource: string | undefined;
    if (targetType !== 'card' && input.targetRef.endsWith('.json')) {
      let inferred = await this.checkIfFileIsACardInstance(input.targetRef);
      if (inferred) {
        targetType = 'card';
        cardId = inferred.cardId;
        cardSource = inferred.content;
      } else {
        nonCardJsonError = await this.describeNonCardJson(input.targetRef);
      }
    }

    let commandModule = await this.loadToolModule();
    const { CorrectnessResultCard } = commandModule;
    let errors: string[] = [];
    let warnings: string[] = [];
    let lintIssues: string[] = input.lintIssues ?? [];

    let sizeLimitError = this.cardService.getSizeLimitError(input.targetRef);
    if (sizeLimitError) {
      return new CorrectnessResultCard({
        correct: false,
        errors: [sizeLimitError.message],
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

    if (nonCardJsonError) {
      errors = [nonCardJsonError];
    } else if (targetType === 'file' && input.targetRef.endsWith('.gts')) {
      errors = await this.collectModuleErrors(input.targetRef, roomId);
    } else if (targetType === 'card') {
      if (!cardId) {
        throw new Error('Card correctness checks require a targetRef.');
      }
      ({ errors, warnings } = await this.collectCardErrors(
        cardId,
        roomId,
        cardSource,
      ));
    }

    if (lintIssues.length) {
      errors = errors.concat(lintIssues);
    }

    return new CorrectnessResultCard({
      correct: errors.length === 0,
      errors,
      warnings,
    });
  }

  private async collectCardErrors(
    cardId: string,
    roomId: string,
    cardSource?: string,
  ): Promise<{ errors: string[]; warnings: string[] }> {
    await this.toolService.waitForInvalidationAfterAIAssistantRequest(
      roomId,
      cardId,
      cardIndexingTimeout,
    );

    let { error, instance } = await this.refreshCard(cardId);

    if (!error) {
      error = this.store.peekError(cardId);
    }

    if (error) {
      return { errors: [this.describeCardError(cardId, error)], warnings: [] };
    }
    // The instance loaded cleanly, so the document can still carry mistakes
    // that indexing accepts silently — undeclared fields, out-of-range enum
    // values, dangling links. Report those as warnings: they never fail the
    // check or trigger the automated fix loop.
    let warnings = instance
      ? await this.collectCardWarnings(cardId, instance, cardSource)
      : [];
    return { errors: [], warnings };
  }

  private async collectCardWarnings(
    cardId: string,
    instance: CardDef,
    cardSource?: string,
  ): Promise<string[]> {
    // A `.json` write already had its source fetched to recognize it as a
    // card; a card-targeted write (patchCardInstance) fetches it here.
    let rawSource =
      cardSource ??
      (await this.cardService
        .getSource(rri(`${cardId}.json`))
        .then(({ status, content }) => (status === 200 ? content : undefined))
        .catch(() => undefined));
    if (rawSource === undefined) {
      return [];
    }
    let warnings = await collectCardInstanceWarnings({
      cardId,
      rawSource,
      instance,
      loader: this.loaderService.loader,
      checkLinkTarget: (targetId, opts) => this.checkLinkTarget(targetId, opts),
    });
    return warnings.map((warning) => `${cardId}: ${warning}`);
  }

  // Asks the realm only whether the target's source exists — it doesn't load
  // the target, and so leaves the store untouched. Only a 404 counts as a
  // dangling link; auth, server and network failures say nothing about the
  // target and are treated as found.
  private async checkLinkTarget(
    targetId: string,
    { isFile }: { isFile: boolean },
  ): Promise<LinkTargetStatus> {
    try {
      let sourceId =
        isFile || targetId.endsWith('.json') ? targetId : `${targetId}.json`;
      let response = await this.network.authedFetch(rri(sourceId), {
        headers: { Accept: 'application/vnd.card+source' },
      });
      // the status is all we need; don't download the body
      await response.body?.cancel().catch(() => undefined);
      return response.status === 404 ? 'not-found' : 'found';
    } catch {
      return 'found';
    }
  }

  private async refreshCard(
    cardId: string,
  ): Promise<{ error?: CardErrorJSONAPI; instance?: CardDef }> {
    await this.store.waitForCardLoad(cardId);
    try {
      let result = await this.store.getWithoutCache(cardId);
      if (isCardErrorJSONAPI(result)) {
        return { error: result };
      }
      return { instance: result };
    } catch (error) {
      console.warn(
        `CheckCorrectnessTool: failed to refresh card ${cardId}`,
        error,
      );
    } finally {
      await this.store.waitForCardLoad(cardId);
    }
    return {};
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

    await this.toolService.waitForInvalidationAfterAIAssistantRequest(
      roomId,
      fileURL.href,
      cardIndexingTimeout,
    );

    if (await this.isEmptyFileContent(targetRef)) {
      return [];
    }

    let errorMessage = await this.prerenderModule(moduleURL, realmURL);

    if (!errorMessage) {
      return [];
    }

    return [errorMessage];
  }

  private moduleInfoFromFile(
    targetRef: string,
  ): { moduleURL: URL; realmURL: string; fileURL: URL } | undefined {
    try {
      let fileURL = new URL(targetRef);
      let realmURL = this.realm.realmOf(fileURL);
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
    realmURL: string,
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
              realm: realmURL,
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

  private async isEmptyFileContent(targetRef: string): Promise<boolean> {
    try {
      let { status, content } = await this.cardService.getSource(
        rri(targetRef),
      );
      return status === 200 && content.trim() === '';
    } catch {
      return false;
    }
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

  // A .json that was meant to be a card instance but is not a card document
  // used to pass this check clean: the indexer stores it as a plain file, and
  // the model only learns two turns later, when the card cannot be shown.
  // Models get this wrong in a handful of ways (no "data" wrapper, "type" set
  // to the card's name instead of "card", no meta.adoptsFrom, a made-up
  // "cardDef" link), so name what a card document needs. Only inspect files
  // with a card-specific signal: ordinary JSON configuration can legitimately
  // have its own type, meta, or attributes keys.
  private async describeNonCardJson(
    fileUrl: string,
  ): Promise<string | undefined> {
    let content: string;
    try {
      let source = await this.cardService.getSource(rri(fileUrl));
      if (source.status !== 200) {
        return undefined;
      }
      content = source.content;
    } catch {
      return undefined;
    }
    let doc: any;
    try {
      doc = JSON.parse(content);
    } catch (e: any) {
      return `${fileUrl} is not valid JSON: ${e?.message ?? e}`;
    }
    let candidate = doc?.data ?? doc;
    let candidateIsObject = candidate && typeof candidate === 'object';
    let candidateMeta =
      candidateIsObject && candidate.meta && typeof candidate.meta === 'object'
        ? candidate.meta
        : undefined;
    let cardShaped =
      doc &&
      typeof doc === 'object' &&
      ('data' in doc ||
        (candidateIsObject &&
          (candidate.type === 'card' ||
            candidateMeta?.adoptsFrom ||
            'cardDef' in candidate ||
            'cardDef' in (candidateMeta ?? {}))));
    if (!cardShaped) {
      return undefined;
    }
    let problems: string[] = [];
    if (!('data' in (doc ?? {}))) {
      problems.push(
        'the document must be wrapped in a top-level "data" object',
      );
    }
    if (candidate.type !== 'card') {
      problems.push(
        `"data.type" must be "card" (found ${JSON.stringify(candidate.type)})`,
      );
    }
    let adoptsFrom = candidate.meta?.adoptsFrom;
    if (
      !adoptsFrom ||
      typeof adoptsFrom.module !== 'string' ||
      typeof adoptsFrom.name !== 'string'
    ) {
      problems.push(
        '"data.meta.adoptsFrom" must name the definition, e.g. { "module": "../hello-world", "name": "HelloWorld" }',
      );
    }
    if (problems.length === 0) {
      return undefined;
    }
    return `${fileUrl} is not a card document, so it will not be indexed as a card and cannot be shown: ${problems.join('; ')}.`;
  }

  private async checkIfFileIsACardInstance(
    fileUrl: string,
  ): Promise<{ cardId: string; content: string } | undefined> {
    try {
      let { status, content } = await this.cardService.getSource(rri(fileUrl));
      if (status !== 200) {
        return undefined;
      }
      if (!isCardDocumentString(content)) {
        return undefined;
      }
      return { cardId: fileUrl.replace(/\.json$/, ''), content };
    } catch (error) {
      console.warn(
        `CheckCorrectnessTool: unable to inspect file ${fileUrl} for card content`,
        error,
      );
      return undefined;
    }
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { CheckCorrectnessTool as CheckCorrectnessCommand };
