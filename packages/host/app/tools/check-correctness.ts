import { service } from '@ember/service';

import {
  hasExecutableExtension,
  isCardDocumentString,
  isCardErrorJSONAPI,
  rri,
  SupportedMimeType,
  X_BOXEL_LINK_SHAPE_HEADER,
  type CardErrorJSONAPI,
  type RenderErrorSummary,
  type RenderResponse,
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
import type { IndexedWrite } from '../services/tool-service';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

const cardIndexingTimeout = ENV.cardRenderTimeout;

// How many instances of an edited module a check reads render errors for.
const maxInstanceChecks = 10;

// How many of those a check renders itself when the realm's render job has
// not rendered them yet. Each one is a full prerender visit, so this bounds
// what a check adds.
const maxInstanceRenders = 3;

// Follows an instance's error in a module check: the error may have come
// with the edit or been there before it.
const instanceErrorNote =
  "an instance of the edited module; the cause may be the edit or this card's own data";

// An index event strips `.json` from every file it names, so a card instance
// appears as its URL without `.json`, keeping any dot in its own name. A
// module is not an instance; any other name may be one.
function mayNameInstance(href: string): boolean {
  let name = href.split('/').pop() ?? '';
  return name.length > 0 && !hasExecutableExtension(name);
}

// What reading a file as a card instance found: no card instance at that URL,
// an error the instance carries, or a clean document and the index generation
// it was written at. A read that fails without a card error says nothing
// about the file.
type InstanceRead =
  | { kind: 'not-an-instance' }
  | { kind: 'error'; error: string }
  | { kind: 'clean'; generation?: number }
  | { kind: 'unknown' };

// How many targets are checked at once. A module check is a prerender on the
// realm server, so fewer of those run together than card reloads.
const CARD_CHECK_CONCURRENCY = 8;
const MODULE_CHECK_CONCURRENCY = 2;

interface CheckTarget {
  type: string;
  ref: string;
  lintIssues: string[];
}

interface TargetOutcome {
  target: CheckTarget;
  errors: string[];
  warnings: string[];
}

interface ModuleCheckPlan {
  kind: 'module';
  targetRef: string;
  moduleURL: URL;
  realmURL: string;
  fileURL: URL;
}

// What checking a target takes: prerendering its module, reloading its card,
// or nothing more (the outcome was settled without waiting for indexing).
type CheckPlan =
  | ModuleCheckPlan
  | { kind: 'card'; cardId: string; cardSource?: string }
  | { kind: 'done'; errors: string[] };

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  let results: R[] = new Array(items.length);
  let next = 0;
  let worker = async () => {
    while (next < items.length) {
      let index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

function checkFailure(target: CheckTarget, error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  return `${target.ref}: the correctness check could not run: ${message}`;
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
    'Run post-change correctness checks for changed files and card instances.';
  static actionVerb = 'Check';
  // The room is the one the check was requested in, so a check of several
  // targets doesn't need to name it.
  static bindsToInvokingRoom = true;

  // The tool service's execute timeout covers one round of checks. A check of
  // more targets than one round runs at once gets a render timeout for each
  // further round.
  static extraExecuteTimeMsFor(
    attributes: Record<string, unknown> | undefined,
  ): number {
    let targets = Array.isArray(attributes?.targets) ? attributes.targets : [];
    let modules = targets.filter(
      (target) =>
        typeof target?.ref === 'string' &&
        target.type !== 'card' &&
        target.ref.endsWith('.gts'),
    ).length;
    let rounds =
      Math.ceil(modules / MODULE_CHECK_CONCURRENCY) +
      Math.ceil((targets.length - modules) / CARD_CHECK_CONCURRENCY);
    return Math.max(0, rounds - 1) * cardIndexingTimeout;
  }

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.CheckCorrectnessInput;
  }

  protected async run(
    input: BaseToolModule.CheckCorrectnessInput,
  ): Promise<BaseToolModule.CorrectnessResultCard> {
    let roomId = input.roomId;
    if (!roomId) {
      throw new Error('Room id is required to run correctness checks.');
    }
    let isBatch = (input.targets?.length ?? 0) > 0;
    let targets: CheckTarget[] = isBatch
      ? input.targets.map((target) => {
          if (!target.type || !target.ref) {
            throw new Error(
              'Each target needs a type and a reference to run correctness checks.',
            );
          }
          return {
            type: target.type,
            ref: target.ref,
            lintIssues: target.lintIssues ?? [],
          };
        })
      : [];
    if (!isBatch) {
      if (!input.targetType || !input.targetRef) {
        throw new Error(
          'Target type and reference are required to run correctness checks.',
        );
      }
      targets = [
        {
          type: input.targetType,
          ref: input.targetRef,
          lintIssues: input.lintIssues ?? [],
        },
      ];
    }

    let outcomes = await this.checkTargets(targets, roomId);

    let commandModule = await this.loadToolModule();
    const { CorrectnessResultCard, CorrectnessTargetResultField } =
      commandModule;
    let errors = outcomes.flatMap((outcome) => outcome.errors);
    let warnings = outcomes.flatMap((outcome) => outcome.warnings);
    if (!isBatch) {
      return new CorrectnessResultCard({
        correct: errors.length === 0,
        errors,
        warnings,
      });
    }
    return new CorrectnessResultCard({
      correct: errors.length === 0,
      errors,
      warnings,
      targetResults: outcomes
        .filter((outcome) => outcome.errors.length || outcome.warnings.length)
        .map(
          (outcome) =>
            new CorrectnessTargetResultField({
              targetType: outcome.target.type,
              targetRef: outcome.target.ref,
              errors: outcome.errors,
              warnings: outcome.warnings,
            }),
        ),
      checkedCount: outcomes.length,
      passedCount: outcomes.filter((outcome) => outcome.errors.length === 0)
        .length,
    });
  }

  // Each target is first resolved to what checking it takes, then every
  // target's index invalidation is waited for at once, so the reply's
  // indexing is waited out once rather than once per card. Only then are the
  // modules prerendered and the cards reloaded, a few at a time. A target
  // whose check throws gets the error as its own, and the others are still
  // checked.
  private async checkTargets(
    targets: CheckTarget[],
    roomId: string,
  ): Promise<TargetOutcome[]> {
    let plans = await mapWithConcurrency(
      targets,
      CARD_CHECK_CONCURRENCY,
      async (target): Promise<CheckPlan> => {
        try {
          return await this.planCheck(target);
        } catch (error) {
          return { kind: 'done', errors: [checkFailure(target, error)] };
        }
      },
    );
    let indexedWrites = await Promise.all(
      plans.map((plan) =>
        plan.kind === 'done'
          ? undefined
          : this.toolService.waitForInvalidationAfterAIAssistantRequest(
              roomId,
              plan.kind === 'module' ? plan.fileURL.href : plan.cardId,
              cardIndexingTimeout,
            ),
      ),
    );
    let outcomes: TargetOutcome[] = new Array(plans.length);
    let finish = async (index: number) => {
      let plan = plans[index]!;
      let target = targets[index]!;
      let errors: string[] = [];
      let warnings: string[] = [];
      if (plan.kind === 'done') {
        outcomes[index] = { target, errors: plan.errors, warnings: [] };
        return;
      }
      try {
        if (plan.kind === 'module') {
          ({ errors, warnings } = await this.collectModuleErrors(
            plan,
            indexedWrites[index],
            roomId,
          ));
        } else {
          ({ errors, warnings } = await this.collectCardErrors(
            plan.cardId,
            plan.cardSource,
          ));
        }
      } catch (error) {
        errors = [checkFailure(target, error)];
      }
      outcomes[index] = {
        target,
        errors: errors.concat(target.lintIssues),
        warnings,
      };
    };
    let indexes = plans.map((_, index) => index);
    await Promise.all([
      mapWithConcurrency(
        indexes.filter((index) => plans[index]!.kind === 'module'),
        MODULE_CHECK_CONCURRENCY,
        finish,
      ),
      mapWithConcurrency(
        indexes.filter((index) => plans[index]!.kind !== 'module'),
        CARD_CHECK_CONCURRENCY,
        finish,
      ),
    ]);
    return outcomes;
  }

  private async planCheck(target: CheckTarget): Promise<CheckPlan> {
    let targetType = target.type;
    let cardId = targetType === 'card' ? target.ref : undefined;
    // Sometimes AI will write cards directly as files so we need to check
    // whether the file is actually a card instance

    let nonCardJsonError: string | undefined;
    let cardSource: string | undefined;
    if (targetType !== 'card' && target.ref.endsWith('.json')) {
      let inferred = await this.checkIfFileIsACardInstance(target.ref);
      if (inferred) {
        targetType = 'card';
        cardId = inferred.cardId;
        cardSource = inferred.content;
      } else {
        nonCardJsonError = await this.describeNonCardJson(target.ref);
      }
    }

    let sizeLimitError = this.cardService.getSizeLimitError(target.ref);
    if (sizeLimitError) {
      return { kind: 'done', errors: [sizeLimitError.message] };
    }

    if (targetType === 'file' && (await this.isEmptyFileContent(target.ref))) {
      return { kind: 'done', errors: [] };
    }

    if (nonCardJsonError) {
      return {
        kind: 'done',
        errors: [nonCardJsonError, ...target.lintIssues],
      };
    }
    if (targetType === 'file' && target.ref.endsWith('.gts')) {
      let moduleInfo = this.moduleInfoFromFile(target.ref);
      if (!moduleInfo) {
        return {
          kind: 'done',
          errors: [
            `${target.ref}: Unable to determine module URL or realm for correctness check`,
            ...target.lintIssues,
          ],
        };
      }
      return { kind: 'module', targetRef: target.ref, ...moduleInfo };
    }
    if (targetType === 'card' && cardId) {
      return { kind: 'card', cardId, cardSource };
    }
    return { kind: 'done', errors: [...target.lintIssues] };
  }

  private async collectCardErrors(
    cardId: string,
    cardSource?: string,
  ): Promise<{ errors: string[]; warnings: string[] }> {
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
    { targetRef, moduleURL, realmURL }: ModuleCheckPlan,
    indexed: IndexedWrite | undefined,
    roomId: string,
  ): Promise<{ errors: string[]; warnings: string[] }> {
    if (await this.isEmptyFileContent(targetRef)) {
      return { errors: [], warnings: [] };
    }

    let errorMessage = await this.prerenderModule(moduleURL, realmURL);

    if (errorMessage) {
      return { errors: [errorMessage], warnings: [] };
    }

    // A module that loads can still break the cards that use it: a template
    // or a computed field throws only when an instance renders. The write's
    // index pass reindexed those instances, so its invalidations name them.
    // An instance whose index visit failed reads as an error at once. A
    // render error lands on the instance's document only once a render job
    // has rendered the instance at its current index generation, which is
    // the module write's or, when the instance was indexed again since, a
    // later one; so a clean read waits a few seconds for that render and
    // reads again, and the check renders a few instances the render job has
    // not reached yet itself. Without a tracked write, or an index event
    // naming its generation, there is nothing to wait for. A read can't tell
    // an error the edit caused from one the instance already had, so an
    // instance that already failed to render fails the check as well: either
    // way it is a card of this module that doesn't render. Its error says the
    // cause may be either.
    if (indexed?.generation === undefined) {
      return { errors: [], warnings: [] };
    }
    let moduleGeneration = indexed.generation;
    // A pass too large to list what it reindexed leaves the module's
    // dependents unnamed, so the candidates are the cards the user is looking
    // at in the module's realm, any of which may use it.
    let candidates = indexed.realmWide
      ? this.contextCardHrefs(roomId).filter((href) => {
          try {
            return this.realm.realmOf(new URL(href)) === realmURL;
          } catch {
            return false;
          }
        })
      : indexed.invalidations;
    let instances = await this.readInstances(candidates, roomId);
    let awaitingRender = new Map<string, number>();
    for (let { href, read } of instances) {
      if (read.kind === 'clean') {
        awaitingRender.set(
          href,
          Math.max(moduleGeneration, read.generation ?? moduleGeneration),
        );
      }
    }
    let rendered = new Set<string>();
    let rereads = new Map<string, InstanceRead>();
    let renders = new Map<string, InstanceRead>();
    if (awaitingRender.size > 0) {
      rendered = await this.toolService.waitForRenderedHTML(
        realmURL,
        new Map(
          [...awaitingRender].map(([href, generation]) => [
            `${href}.json`,
            generation,
          ]),
        ),
      );
      // A render job's event can be dropped when a realm's events back up, so
      // an instance whose render was not announced is read again too: an
      // error that has landed is still reported.
      let hrefs = [...awaitingRender.keys()];
      let reads = await Promise.all(
        hrefs.map((href) => this.readInstance(href)),
      );
      hrefs.forEach((href, index) => rereads.set(href, reads[index]));
      // For a module with many dependents the render job takes minutes, so
      // the first few instances it has not rendered yet, in ranked order, are
      // rendered here instead.
      let unrendered = hrefs
        .filter((href) => {
          let read = rereads.get(href)!;
          return (
            read.kind !== 'error' &&
            read.kind !== 'not-an-instance' &&
            !rendered.has(`${href}.json`)
          );
        })
        .slice(0, maxInstanceRenders);
      let results = await Promise.all(
        unrendered.map((href) => this.renderInstance(href, realmURL)),
      );
      unrendered.forEach((href, index) => renders.set(href, results[index]));
    }
    // reported in the order the instances were ranked in
    let errors: string[] = [];
    let warnings: string[] = [];
    for (let { href, read: firstRead } of instances) {
      let read = rereads.get(href) ?? firstRead;
      let render = renders.get(href);
      let cardId = this.network.virtualNetwork.unresolveURL(href);
      if (read.kind === 'error') {
        errors.push(`${read.error} (${instanceErrorNote})`);
      } else if (render?.kind === 'error') {
        errors.push(`${render.error} (${instanceErrorNote})`);
      } else if (render?.kind === 'unknown') {
        warnings.push(`${cardId}: not checked, because rendering it failed`);
      } else if (
        !render &&
        awaitingRender.has(href) &&
        read.kind !== 'not-an-instance' &&
        !rendered.has(`${href}.json`)
      ) {
        warnings.push(
          `${cardId}: not checked, because the indexer had not rendered it with the edited module yet, and a check renders at most ${maxInstanceRenders} instances itself`,
        );
      }
    }
    return { errors, warnings };
  }

  // Reads the card instances among a write's invalidations, the ones the
  // user is looking at first, capped at `maxInstanceChecks`. A name that is
  // not a module's can still be a JSON file that is not a card, some other
  // file, or an instance deleted after the write was indexed; the read finds
  // no card instance for those, and the next candidate takes the place.
  private async readInstances(
    invalidations: string[],
    roomId: string,
  ): Promise<{ href: string; read: InstanceRead }[]> {
    let contextHrefs = this.contextCardHrefs(roomId);
    let rank = (href: string) => {
      let index = contextHrefs.indexOf(href);
      return index === -1 ? contextHrefs.length : index;
    };
    let candidates = invalidations
      .filter(mayNameInstance)
      .sort((a, b) => rank(a) - rank(b));
    let instances: { href: string; read: InstanceRead }[] = [];
    while (candidates.length > 0 && instances.length < maxInstanceChecks) {
      let batch = candidates.splice(0, maxInstanceChecks - instances.length);
      let reads = await Promise.all(
        batch.map((href) => this.readInstance(href)),
      );
      batch.forEach((href, index) => {
        if (reads[index].kind !== 'not-an-instance') {
          instances.push({ href, read: reads[index] });
        }
      });
    }
    return instances;
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

  // Reads the file as a card instance. The realm answers 404 for a URL with
  // no card instance, and a file-meta document for a file that is not a card.
  // An error is what the instance's index visit recorded, which the realm
  // answers with in place of the document, or what its current render
  // recorded, which the document carries as `meta.renderError`; otherwise
  // the read gives the index generation the document was written at. A read
  // that fails without a card error is logged.
  private async readInstance(cardHref: string): Promise<InstanceRead> {
    let cardId = this.network.virtualNetwork.unresolveURL(cardHref);
    try {
      let response = await this.network.authedFetch(rri(cardHref), {
        headers: {
          Accept: SupportedMimeType.CardJson,
          [X_BOXEL_LINK_SHAPE_HEADER]: 'links-only',
        },
      });
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        return { kind: 'not-an-instance' };
      }
      let body = await response.json().catch(() => undefined);
      if (!response.ok) {
        let error = body?.errors?.[0];
        if (isCardErrorJSONAPI(error)) {
          return {
            kind: 'error',
            error: this.describeCardError(cardId, error),
          };
        }
        console.warn(
          `CheckCorrectnessTool: reading ${cardId} for its errors failed (${response.status})`,
        );
        return { kind: 'unknown' };
      }
      if (body?.data?.type !== 'card') {
        return { kind: 'not-an-instance' };
      }
      let renderError: RenderErrorSummary | undefined = body.meta?.renderError;
      if (renderError) {
        return {
          kind: 'error',
          error: this.describeCardError(cardId, renderError),
        };
      }
      let generation = body.data.meta?.generation;
      return {
        kind: 'clean',
        ...(typeof generation === 'number' ? { generation } : {}),
      };
    } catch (error) {
      console.warn(
        `CheckCorrectnessTool: reading ${cardId} for its errors threw`,
        error,
      );
      return { kind: 'unknown' };
    }
  }

  // Renders the instance in every format, the way the realm's render job
  // does. A render request that fails says nothing about the instance, so it
  // is logged.
  private async renderInstance(
    cardHref: string,
    realmURL: string,
  ): Promise<InstanceRead> {
    let cardId = this.network.virtualNetwork.unresolveURL(cardHref);
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
            attributes: { realm: realmURL, url: `${cardHref}.json` },
          },
        }),
      });
      let render: RenderResponse | undefined = response.ok
        ? (await response.json().catch(() => undefined))?.data?.attributes
        : undefined;
      if (!render) {
        console.warn(
          `CheckCorrectnessTool: rendering ${cardId} failed (${response.status})`,
        );
        return { kind: 'unknown' };
      }
      let error = render.error?.error;
      return error
        ? { kind: 'error', error: this.describeCardError(cardId, error) }
        : { kind: 'clean' };
    } catch (error) {
      console.warn(`CheckCorrectnessTool: rendering ${cardId} threw`, error);
      return { kind: 'unknown' };
    }
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

  private describeCardError(
    cardId: string,
    error: { title?: string; message?: string },
  ): string {
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
