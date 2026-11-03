import { service } from '@ember/service';

import {
  isCardDocumentString,
  isCardErrorJSONAPI,
  rri,
  type CardErrorJSONAPI,
  type RenderResponse,
  type SerializedError,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import {
  collectCardInstanceWarnings,
  type LinkTargetStatus,
} from '../lib/card-instance-warnings';
import HostBaseTool from '../lib/host-base-tool';

import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type NetworkService from '../services/network';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';
import type ToolService from '../services/tool-service';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

const cardIndexingTimeout = ENV.cardRenderTimeout;

// How many instances of an edited module a check renders. Each one is a full
// prerender visit, so this bounds what a module check adds.
const maxInstanceRenders = 3;

// The formats a card render produces, in the order the prerenderer renders
// them, with the member of the render response that holds each one. The
// prerenderer reports the first error a render hits and leaves the HTML of a
// format that threw empty, so the first format with no HTML is the one the
// error came from.
const renderedFormats = [
  ['isolated', 'isolatedHTML'],
  ['head', 'headHTML'],
  ['atom', 'atomHTML'],
  ['markdown', 'markdown'],
  ['fitted', 'fittedHTML'],
  ['embedded', 'embeddedHTML'],
] as const;

// An index event spells a card instance as its URL without `.json`, and every
// other file with its extension. A card whose name holds a dot reads as a file
// here and is not rendered.
function isCardInstanceHref(href: string): boolean {
  let name = href.split('/').pop() ?? '';
  return name.length > 0 && !name.includes('.');
}

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
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;

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

    let invalidations =
      await this.toolService.waitForInvalidationAfterAIAssistantRequest(
        roomId,
        fileURL.href,
        cardIndexingTimeout,
      );

    if (await this.isEmptyFileContent(targetRef)) {
      return [];
    }

    let errorMessage = await this.prerenderModule(moduleURL, realmURL);

    if (errorMessage) {
      return [errorMessage];
    }

    // A module that loads can still break the cards that use it: a template
    // or a computed field throws only when an instance renders. The write's
    // index pass reindexed those instances, so its invalidations name them.
    // Without a tracked write there is nothing to render.
    let instanceHrefs = this.instancesToRender(invalidations ?? [], roomId);
    let renderErrors = await Promise.all(
      instanceHrefs.map((href) => this.renderInstance(href, realmURL)),
    );
    return renderErrors.filter((error): error is string => Boolean(error));
  }

  // The card instances among a write's invalidations, the ones the user is
  // looking at first, capped at `maxInstanceRenders`.
  private instancesToRender(invalidations: string[], roomId: string): string[] {
    let contextHrefs = this.contextCardHrefs(roomId);
    let rank = (href: string) => {
      let index = contextHrefs.indexOf(href);
      return index === -1 ? contextHrefs.length : index;
    };
    return invalidations
      .filter(isCardInstanceHref)
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, maxInstanceRenders);
  }

  // The cards the user is looking at, spelled as an index event spells them:
  // the ones open in the workspace, then the ones attached in the room, newest
  // first.
  private contextCardHrefs(roomId: string): string[] {
    let ids: string[] = [...this.operatorModeStateService.getOpenCardIds()];
    let messages = this.matrixService.roomResources.get(roomId)?.messages ?? [];
    for (let message of [...messages].reverse()) {
      ids.push(...(message.attachedCardIds ?? []));
    }
    let { virtualNetwork } = this.network;
    let hrefs: string[] = [];
    for (let id of ids) {
      try {
        hrefs.push(virtualNetwork.toURLHref(id).replace(/\.json$/, ''));
      } catch {
        // an id no realm resolves can't match an invalidation
      }
    }
    return hrefs;
  }

  // Renders the instance in every format the indexer renders, and describes
  // the first error the render hit.
  private async renderInstance(
    cardHref: string,
    realmURL: string,
  ): Promise<string | undefined> {
    let cardId = this.network.virtualNetwork.unresolveURL(cardHref);
    let render = await this.prerenderCard(cardId, cardHref, realmURL);
    let error = render?.error?.error;
    if (!render || !error) {
      return undefined;
    }
    let format = renderedFormats.find(([, member]) => render[member] == null);
    let where = format ? `${cardId} (${format[0]} format)` : cardId;
    return `${where}: ${this.describeRenderError(error)}`;
  }

  // A render request that fails says nothing about the instance, so it is
  // logged rather than reported.
  private async prerenderCard(
    cardId: string,
    cardHref: string,
    realmURL: string,
  ): Promise<RenderResponse | undefined> {
    try {
      let prerenderURL = new URL('/_prerender-card', this.realmServer.url);
      let response = await this.realmServer.authedFetch(prerenderURL.href, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
        },
        body: JSON.stringify({
          data: {
            type: 'prerender-card-request',
            attributes: {
              realm: realmURL,
              url: `${cardHref}.json`,
            },
          },
        }),
      });
      if (!response.ok) {
        let text = await response.text().catch(() => '');
        console.warn(
          `CheckCorrectnessTool: render of ${cardId} failed (${response.status}) ${text}`,
        );
        return undefined;
      }
      return (await response.json())?.data?.attributes;
    } catch (error) {
      console.warn(`CheckCorrectnessTool: render of ${cardId} threw`, error);
      return undefined;
    }
  }

  private describeRenderError(error: SerializedError): string {
    let pieces = [error.title, error.message]
      .filter((part): part is string => typeof part === 'string')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (pieces.length >= 2 && pieces[0] === pieces[1]) {
      pieces = [pieces[0]];
    }
    return pieces.length > 0 ? pieces.join(' - ') : 'Unknown render error';
  }

  // The prerender request and the indexing wait both speak URLs: the
  // realm-server endpoint parses the realm as a URL, and writes register their
  // invalidation waits by file URL. So the file is resolved to its URL before
  // anything else, and the realm is looked up from that URL.
  private moduleInfoFromFile(
    targetRef: string,
  ): { moduleURL: URL; realmURL: string; fileURL: URL } | undefined {
    try {
      let { virtualNetwork } = this.network;
      let fileURL = virtualNetwork.toURL(targetRef);
      let realmURL = this.realm.realmOf(fileURL);
      if (!realmURL) {
        return undefined;
      }

      let moduleURL = virtualNetwork.toURL(fileURL.href.replace(/\.gts$/, ''));
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
