/**
 * Instantiate execution — shared engine used by both the validation pipeline's
 * `InstantiateValidationStep` (which writes an `InstantiateResult` card
 * artifact) and the in-memory `run_instantiate` agent tool (which returns
 * results without side effects).
 *
 * Discovery is spec-based: the realm is searched for Spec cards (from
 * `https://cardstack.com/base/spec`), and each spec's `linkedExamples` entries
 * are instantiated by calling the `instantiate-card` host command via
 * `_run-command`. The host command runs in the prerenderer sandbox (headless
 * Chrome), so every runtime error that surfaces when a real user opens the
 * card — missing fields, mis-shaped data, broken getters — fails here too.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import { rri } from '@cardstack/runtime-common/realm-identifiers';
import {
  isResolvedCodeRef,
  isSingleCardDocument,
} from '@cardstack/runtime-common/card-document-shape';
import { specRef } from '@cardstack/runtime-common/constants';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import { logger } from './logger';
import { validateRealmRelativePath } from './realm-relative-path';
import { isTransientIndexNotFound, retryWithPoll } from './retry-with-poll';
import { readCard } from './workspace-fs';

let log = logger('instantiate-execution');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INSTANTIATE_CARD_COMMAND =
  '@cardstack/boxel-host/commands/instantiate-card/default';

// ---------------------------------------------------------------------------
// Shared engine types
// ---------------------------------------------------------------------------

export interface InstantiateModuleResult {
  passed: boolean;
  error?: string;
  stackTrace?: string;
}

export interface SpecInfo {
  specId: string;
  moduleUrl: string;
  cardName: string;
  exampleUrls: string[];
}

/** Per-instance outcome of one instantiation attempt. */
export interface InstanceInstantiationRecord {
  codeRef: { module: string; name: string };
  /** Absolute URL of the example instance, or empty string for empty-data fallback. */
  instanceId: string;
  /** Realm-relative example path, or empty string for empty-data fallback. */
  exampleUrl: string;
  cardName: string;
  passed: boolean;
  error: string;
  stackTrace?: string;
}

export type InstantiateCardFn = (
  moduleUrl: string,
  cardName: string,
  realmUrl: string,
  instanceData?: string,
) => Promise<InstantiateModuleResult>;

export interface DiscoverRealmSpecsOptions {
  targetRealm: string;
  client: BoxelCLIClient;
  /** Injected for testing — defaults to a client.search over Spec cards. */
  searchSpecsFn?: (
    realmUrl: string,
  ) => Promise<{ specs: SpecInfo[]; error?: string }>;
}

export interface InstantiateRealmSpecsOptions {
  targetRealm: string;
  realmServerUrl: string;
  client: BoxelCLIClient;
  /**
   * Local workspace directory to read example `.json` instances from. The
   * realm is used for spec discovery and card instantiation (prerenderer),
   * but example content comes from disk.
   */
  workspaceDir: string;
  /** Injected for testing — defaults to client.runCommand → instantiate-card. */
  instantiateCardFn?: InstantiateCardFn;
}

export interface InstantiateRealmSpecsOutput {
  records: InstanceInstantiationRecord[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// In-memory tool types
// ---------------------------------------------------------------------------

export interface RunInstantiateInMemoryOptions {
  targetRealm: string;
  realmServerUrl: string;
  client: BoxelCLIClient;
  /**
   * Local workspace directory to read example `.json` instances from.
   */
  workspaceDir: string;
  /**
   * When set, instantiate only this realm-relative `.json` file instead of
   * discovering every linkedExample on every Spec. Useful for mid-turn
   * self-validation right after writing or tweaking a single example. The
   * path must end in `.json` — other extensions return `status: 'error'`
   * without calling the realm.
   */
  path?: string;
  /** Injected for testing — defaults to client.runCommand → instantiate-card. */
  instantiateCardFn?: InstantiateCardFn;
}

export interface RunInstantiateFailure {
  /**
   * Realm-relative example path, or empty string for a bare-instantiation
   * fallback (a spec with no linkedExamples). When empty, use `cardName`
   * to identify which spec failed — do not pass `''` back into `path`.
   */
  path: string;
  cardName: string;
  error: string;
  stackTrace?: string;
}

export interface RunInstantiateResult {
  status: 'passed' | 'failed' | 'error';
  instancesChecked: number;
  instancesWithErrors: number;
  durationMs: number;
  /**
   * Realm-relative `.json` example paths attempted. Always real file paths
   * (empty-string bare-instantiation entries are filtered out) — any entry
   * in this list can be fed back into `path` verbatim.
   */
  instanceFiles: string[];
  failures: RunInstantiateFailure[];
  /** Set only when `status === 'error'`. */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Public engine
// ---------------------------------------------------------------------------

/**
 * Search the realm for Spec cards and return the ref + linkedExamples for
 * each card/app spec. Field specs are skipped (they don't produce
 * instantiable cards). linkedExample URLs that resolve outside the target
 * realm are dropped to prevent leaking the realm auth token to external
 * origins.
 */
export async function discoverRealmSpecs(
  options: DiscoverRealmSpecsOptions,
): Promise<{ specs: SpecInfo[]; error?: string }> {
  let searchSpecsFn =
    options.searchSpecsFn ??
    ((realmUrl: string) => defaultSearchSpecs(options.client, realmUrl));

  // Realm-side source POST indexing is async, so a newly-uploaded Spec
  // card may not be in the search index by the time we get here. Bounded-
  // poll until even one spec shows up so an agent or test that just
  // pushed Spec files isn't penalized for indexing latency.
  return retryWithPoll(
    () => searchSpecsFn(options.targetRealm),
    (r) => !r.error && r.specs.length === 0,
  );
}

/**
 * Instantiate every linkedExample on every spec. For a spec with
 * linkedExamples that all fail to read, one synthetic failure record is
 * emitted (typoed paths shouldn't silently downgrade to empty-data
 * instantiation). For a spec with no linkedExamples at all, a single
 * empty-data instantiation is attempted so the card class itself is
 * exercised.
 */
export async function instantiateRealmSpecs(
  options: InstantiateRealmSpecsOptions,
  specs: SpecInfo[],
): Promise<InstantiateRealmSpecsOutput> {
  let instantiateCardFn =
    options.instantiateCardFn ??
    ((moduleUrl, cardName, realmUrl, instanceData) =>
      defaultInstantiateCard(
        options.client,
        options.realmServerUrl,
        moduleUrl,
        cardName,
        realmUrl,
        instanceData,
      ));

  let startedAt = Date.now();
  let records: InstanceInstantiationRecord[] = [];
  let normalizedRealmUrl = ensureTrailingSlash(options.targetRealm);

  for (let spec of specs) {
    let exampleInstances = await collectExampleInstances(
      options.targetRealm,
      options.workspaceDir,
      spec,
    );

    // Declared examples that all failed to read: one synthetic failure.
    if (exampleInstances.length === 0 && spec.exampleUrls.length > 0) {
      let message = `All ${spec.exampleUrls.length} linkedExample(s) for spec ${spec.specId} failed to read — cannot validate instantiation. Check that example paths are correct.`;
      log.warn(message);
      records.push({
        codeRef: { module: spec.moduleUrl, name: spec.cardName },
        instanceId: '',
        exampleUrl: '',
        cardName: spec.cardName,
        passed: false,
        error: message,
      });
      continue;
    }

    // Spec with no linkedExamples — try instantiating with no field data so
    // the card class itself is still exercised.
    if (exampleInstances.length === 0) {
      exampleInstances.push({ url: '', data: '' });
    }

    let settled = await Promise.allSettled(
      exampleInstances.map((example) =>
        instantiateCardFn(
          spec.moduleUrl,
          spec.cardName,
          options.targetRealm,
          example.data || undefined,
        ),
      ),
    );

    for (let i = 0; i < settled.length; i++) {
      let outcome = settled[i];
      let exampleUrl = exampleInstances[i].url;
      // `instanceId` is the extensionless card resource URL — matches both
      // the canonical Boxel card id and what `prepareExampleInstance` sets
      // on `document.data.id`. Stripping `.json` keeps the id consistent
      // between the spec-discovered and single-path entrypoints.
      let instanceId = exampleUrl
        ? new URL(exampleUrl, normalizedRealmUrl).href.replace(/\.json$/, '')
        : '';
      let codeRef = { module: spec.moduleUrl, name: spec.cardName };

      if (outcome.status === 'fulfilled') {
        let result = outcome.value;
        records.push({
          codeRef,
          instanceId,
          exampleUrl,
          cardName: spec.cardName,
          passed: result.passed,
          error: result.error ?? '',
          stackTrace: result.stackTrace,
        });
      } else {
        let message = `Instantiate failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`;
        log.warn(`Error instantiating ${spec.cardName}: ${message}`);
        records.push({
          codeRef,
          instanceId,
          exampleUrl,
          cardName: spec.cardName,
          passed: false,
          error: message,
        });
      }
    }
  }

  return { records, durationMs: Date.now() - startedAt };
}

// ---------------------------------------------------------------------------
// In-memory agent tool
// ---------------------------------------------------------------------------

/**
 * Instantiate example instances in the target realm and return a flat,
 * JSON-friendly result. Unlike `InstantiateValidationStep`, this does NOT
 * create or update an `InstantiateResult` card — the result is consumed by
 * the agent directly for mid-turn self-validation.
 *
 * Without `path`, every linkedExample on every Spec card in the realm is
 * instantiated. With `path`, only that single realm-relative `.json` file
 * is instantiated (its `adoptsFrom` supplies the module + card name) — the
 * spec-discovery step is skipped entirely so the agent can self-check one
 * example in isolation.
 */
export async function runInstantiateInMemory(
  options: RunInstantiateInMemoryOptions,
): Promise<RunInstantiateResult> {
  let instantiateCardFn =
    options.instantiateCardFn ??
    ((moduleUrl, cardName, realmUrl, instanceData) =>
      defaultInstantiateCard(
        options.client,
        options.realmServerUrl,
        moduleUrl,
        cardName,
        realmUrl,
        instanceData,
      ));

  if (options.path != null) {
    return runSingleInstance(
      options.path,
      options.targetRealm,
      options.workspaceDir,
      instantiateCardFn,
    );
  }

  let specsResult: { specs: SpecInfo[]; error?: string };
  try {
    specsResult = await discoverRealmSpecs({
      targetRealm: options.targetRealm,
      client: options.client,
    });
  } catch (err) {
    return emptyErrorResult(
      `Failed to discover specs: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (specsResult.error) {
    return emptyErrorResult(`Failed to discover specs: ${specsResult.error}`);
  }

  if (specsResult.specs.length === 0) {
    return {
      status: 'passed',
      instancesChecked: 0,
      instancesWithErrors: 0,
      durationMs: 0,
      instanceFiles: [],
      failures: [],
    };
  }

  try {
    let { records, durationMs } = await instantiateRealmSpecs(
      {
        targetRealm: options.targetRealm,
        realmServerUrl: options.realmServerUrl,
        client: options.client,
        workspaceDir: options.workspaceDir,
        instantiateCardFn,
      },
      specsResult.specs,
    );

    return summarizeRecords(records, durationMs);
  } catch (err) {
    let errorMessage = err instanceof Error ? err.message : String(err);
    log.error(`runInstantiateInMemory error: ${errorMessage}`);
    return {
      status: 'error',
      instancesChecked: 0,
      instancesWithErrors: 0,
      durationMs: 0,
      instanceFiles: [],
      failures: [],
      errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runSingleInstance(
  path: string,
  targetRealm: string,
  workspaceDir: string,
  instantiateCardFn: InstantiateCardFn,
): Promise<RunInstantiateResult> {
  let pathError = validateRealmRelativePath(path);
  if (pathError) {
    return emptyErrorResult(pathError);
  }
  if (!path.endsWith('.json')) {
    return emptyErrorResult(
      `Path "${path}" is not an instance file — must end with ".json".`,
    );
  }

  let prepared = await prepareExampleInstance(targetRealm, workspaceDir, path);
  if ('error' in prepared) {
    return emptyErrorResult(prepared.error);
  }

  let startedAt = Date.now();
  let outcome: InstantiateModuleResult;
  try {
    outcome = await instantiateCardFn(
      prepared.codeRef.module,
      prepared.codeRef.name,
      targetRealm,
      prepared.data,
    );
  } catch (err) {
    let message = `Instantiate failed: ${err instanceof Error ? err.message : String(err)}`;
    log.warn(`Error instantiating ${path}: ${message}`);
    outcome = { passed: false, error: message };
  }
  let durationMs = Date.now() - startedAt;

  let record: InstanceInstantiationRecord = {
    codeRef: prepared.codeRef,
    instanceId: prepared.instanceId,
    exampleUrl: path,
    cardName: prepared.codeRef.name,
    passed: outcome.passed,
    error: outcome.error ?? '',
    stackTrace: outcome.stackTrace,
  };

  return summarizeRecords([record], durationMs);
}

/**
 * Read an example card JSON, resolve its `adoptsFrom.module` against the
 * example's own URL, and return the serialized instance plus the extracted
 * codeRef. Mirrors the per-example prep inside `instantiateRealmSpecs`.
 */
async function prepareExampleInstance(
  targetRealm: string,
  workspaceDir: string,
  exampleUrl: string,
): Promise<
  | {
      data: string;
      instanceId: string;
      codeRef: { module: string; name: string };
    }
  | { error: string }
> {
  let exampleFilePath = exampleUrl.endsWith('.json')
    ? exampleUrl
    : `${exampleUrl}.json`;

  let rawRead;
  try {
    rawRead = await readCard(workspaceDir, exampleFilePath);
  } catch (err) {
    return {
      error: `Failed to read example "${exampleUrl}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!rawRead.ok || !rawRead.document) {
    return {
      error: `Failed to read example "${exampleUrl}": ${rawRead.error ?? (rawRead.status === 404 ? 'not found in workspace' : 'unknown error')}`,
    };
  }

  let parsedDoc = rawRead.document;

  // A readable `.json` file isn't guaranteed to be a card document — a
  // malformed fixture or a raw JSON payload could be missing `data`,
  // `data.meta`, or `data.meta.adoptsFrom` entirely. `isSingleCardDocument`
  // from `runtime-common/card-document-shape` is the canonical shape
  // check: it validates the document is `{ data: CardResource }`, that
  // `data.meta.adoptsFrom` is present, and that `adoptsFrom` is a valid
  // `CodeRef`. Running it first means the nested accesses below cannot
  // throw.
  //
  // NB: we import from the lightweight `/card-document-shape` subpath
  // (not the `/document-types` barrel entry that re-exports it) so the
  // software-factory Playwright harness that exercises this module does
  // not have to pull in the heavier, Node-oriented runtime-common entry
  // points.
  if (!isSingleCardDocument(parsedDoc)) {
    return {
      error: `Example "${exampleUrl}" is not a valid card document (missing or malformed "data" / "data.meta.adoptsFrom").`,
    };
  }

  let document = parsedDoc as unknown as LooseSingleCardDocument;
  // Boxel card IDs are extensionless — the `id` is the resource URL, not
  // the .json file path. Strip any trailing `.json` so the id matches what
  // the prerender sandbox expects (and what the pre-refactor validation
  // step produced when exampleUrls were always extensionless).
  let exampleCardUrl = new URL(
    exampleUrl.replace(/\.json$/, ''),
    ensureTrailingSlash(targetRealm),
  ).href;

  // `isSingleCardDocument` has already confirmed `adoptsFrom` is a
  // `CodeRef`, but that union also includes unresolved forms like
  // `{ type: 'ancestorOf', card }` — the prerender sandbox needs a
  // resolved `{ module, name }`, so guard for that explicitly.
  let adoptsFrom = document.data.meta?.adoptsFrom;
  if (!isResolvedCodeRef(adoptsFrom)) {
    return {
      error: `Example "${exampleUrl}" has a non-resolved meta.adoptsFrom — expected { module, name }, cannot instantiate.`,
    };
  }

  let moduleUrl = rri(new URL(adoptsFrom.module, exampleCardUrl).href);

  // The prerender refuses cross-origin module loads. The most common way
  // an agent triggers this is by passing a `Spec/...json` path: Specs
  // adopt from `https://cardstack.com/base/spec`, which lives in a
  // different origin than any user realm. Catch it here with a clearer
  // error than the prerender's "moduleUrl origin … does not match
  // realmUrl origin …" so the agent knows what to do instead.
  let moduleOrigin = new URL(moduleUrl).origin;
  let targetRealmOrigin = new URL(targetRealm).origin;
  if (moduleOrigin !== targetRealmOrigin) {
    return {
      error:
        `Example "${exampleUrl}" adopts from a module at ${moduleUrl} ` +
        `(origin ${moduleOrigin}), but instantiation is scoped to the ` +
        `target realm at ${targetRealmOrigin}. This typically means you ` +
        `passed a Spec card path — Specs adopt from the base realm and ` +
        `cannot be instantiated cross-origin. To validate Specs, call ` +
        `run_instantiate WITHOUT a "path"; it discovers Specs in the ` +
        `target realm and exercises their linkedExamples against the ` +
        `card classes you wrote.`,
    };
  }

  document.data.meta!.adoptsFrom = { module: moduleUrl, name: adoptsFrom.name };
  document.data.id = exampleCardUrl;

  return {
    data: JSON.stringify(document),
    instanceId: exampleCardUrl,
    codeRef: { module: moduleUrl, name: adoptsFrom.name },
  };
}

async function collectExampleInstances(
  targetRealm: string,
  workspaceDir: string,
  spec: SpecInfo,
): Promise<{ url: string; data: string }[]> {
  let exampleInstances: { url: string; data: string }[] = [];
  for (let exampleUrl of spec.exampleUrls) {
    let prepared = await prepareExampleInstance(
      targetRealm,
      workspaceDir,
      exampleUrl,
    );
    if ('error' in prepared) {
      log.warn(
        `Failed to prepare example ${exampleUrl} for spec ${spec.specId}: ${prepared.error}`,
      );
      continue;
    }
    exampleInstances.push({ url: exampleUrl, data: prepared.data });
  }
  return exampleInstances;
}

function summarizeRecords(
  records: InstanceInstantiationRecord[],
  durationMs: number,
): RunInstantiateResult {
  let failures: RunInstantiateFailure[] = [];
  for (let r of records) {
    if (!r.passed) {
      failures.push({
        path: r.exampleUrl,
        cardName: r.cardName,
        error: r.error || 'Card instantiation failed',
        stackTrace: r.stackTrace,
      });
    }
  }

  // `instanceFiles` is a list of realm-relative paths the agent can feed
  // back into `path`. Bare-instantiation records (spec with no
  // linkedExamples) carry an empty `exampleUrl` sentinel — filter those
  // out here so the published list always contains real `.json` paths.
  // Bare instantiations still count in `instancesChecked` and, if they
  // fail, surface in `failures` with `path: ''` and a populated
  // `cardName` so the agent can identify them.
  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    instancesChecked: records.length,
    instancesWithErrors: failures.length,
    durationMs,
    instanceFiles: records.map((r) => r.exampleUrl).filter((f) => f !== ''),
    failures,
  };
}

function emptyErrorResult(errorMessage: string): RunInstantiateResult {
  return {
    status: 'error',
    instancesChecked: 0,
    instancesWithErrors: 0,
    durationMs: 0,
    instanceFiles: [],
    failures: [],
    errorMessage,
  };
}

async function defaultSearchSpecs(
  client: BoxelCLIClient,
  realmUrl: string,
): Promise<{ specs: SpecInfo[]; error?: string }> {
  let searchResult = await client.search(realmUrl, {
    filter: { type: specRef },
  });

  if (!searchResult.ok) {
    return { specs: [], error: searchResult.error };
  }

  let specs: SpecInfo[] = [];
  for (let card of searchResult.data ?? []) {
    let specId = (card as Record<string, unknown>).id as string | undefined;
    if (!specId) {
      continue;
    }

    let attributes = (card as Record<string, unknown>).attributes as
      | Record<string, unknown>
      | undefined;
    if (!attributes) {
      continue;
    }

    // Field specs don't produce instantiable instances — skip.
    let specType = attributes.specType as string | undefined;
    if (specType === 'field') {
      log.info(`Spec ${specId} is a field spec — skipping`);
      continue;
    }

    let ref = attributes.ref as { module?: string; name?: string } | undefined;
    if (!ref?.module || !ref?.name) {
      log.warn(`Spec ${specId} has no valid ref — skipping`);
      continue;
    }

    // Resolve relative module URL against the spec card's own URL.
    let specCardUrl = new URL(specId, ensureTrailingSlash(realmUrl)).href;
    let moduleUrl = new URL(ref.module, specCardUrl).href;

    let relationships = (card as Record<string, unknown>).relationships as
      | Record<string, unknown>
      | undefined;
    let rawExampleUrls = extractLinkedExamples(relationships);
    let normalizedRealmUrl = ensureTrailingSlash(realmUrl);
    let exampleUrls: string[] = [];
    for (let rawUrl of rawExampleUrls) {
      let absoluteUrl = new URL(rawUrl, specCardUrl).href;
      if (absoluteUrl.startsWith(normalizedRealmUrl)) {
        let realmRelative = absoluteUrl.slice(normalizedRealmUrl.length);
        // Boxel relationship `self` links are extensionless (e.g.
        // `../ValidCard/example-1`) — example instances are always JSON
        // card documents, so normalize the path to a `.json`-suffixed
        // form so downstream consumers (`run_instantiate`'s
        // `instanceFiles`, per-record `exampleUrl`) report the same shape
        // whether the spec was discovered or a `path` argument was used.
        if (!realmRelative.endsWith('.json')) {
          realmRelative += '.json';
        }
        exampleUrls.push(realmRelative);
      } else {
        // Drop external URLs — prevents exfiltrating the realm auth token
        // to origins outside the target realm.
        log.warn(
          `Spec ${specId}: dropping linkedExample ${rawUrl} — resolves outside target realm`,
        );
      }
    }

    specs.push({
      specId,
      moduleUrl,
      cardName: ref.name,
      exampleUrls,
    });
  }

  return { specs };
}

/**
 * Extract all `linkedExamples` relationship URLs from a card's
 * relationships. Boxel encodes `linksToMany` with dotted keys:
 * `"linkedExamples.0": { "links": { "self": "..." } }`
 */
function extractLinkedExamples(
  relationships: Record<string, unknown> | undefined,
): string[] {
  if (!relationships) {
    return [];
  }

  let urls: string[] = [];

  for (let i = 0; ; i++) {
    let entry = relationships[`linkedExamples.${i}`] as
      | { links?: { self?: string } }
      | undefined;
    if (!entry?.links?.self) {
      break;
    }
    urls.push(entry.links.self);
  }

  // Fallback: JSON:API array format.
  if (urls.length === 0) {
    let examples = relationships['linkedExamples'] as
      | { links?: { self?: string } }
      | undefined;
    if (examples?.links?.self) {
      urls.push(examples.links.self);
    }
  }

  return urls;
}

async function defaultInstantiateCard(
  client: BoxelCLIClient,
  realmServerUrl: string,
  moduleUrl: string,
  cardName: string,
  realmUrl: string,
  instanceData?: string,
): Promise<InstantiateModuleResult> {
  // Source POSTs return before realm indexing settles, so a load attempt
  // immediately after a write can transiently fail with "module URL not
  // found" until the in-memory module map is populated. Bound-poll past
  // that race; isTransientIndexNotFound stops matching the moment
  // indexing resolves either way (success or error_doc), so retries
  // never persist past a real indexer failure.
  return retryWithPoll(
    () =>
      attemptInstantiateCard(
        client,
        realmServerUrl,
        moduleUrl,
        cardName,
        realmUrl,
        instanceData,
      ),
    (r) => !r.passed && isTransientIndexNotFound(r.error),
  );
}

async function attemptInstantiateCard(
  client: BoxelCLIClient,
  realmServerUrl: string,
  moduleUrl: string,
  cardName: string,
  realmUrl: string,
  instanceData?: string,
): Promise<InstantiateModuleResult> {
  let commandInput: Record<string, unknown> = {
    moduleIdentifier: moduleUrl,
    cardName,
    realmIdentifier: realmUrl,
  };
  if (instanceData) {
    commandInput.instanceData = instanceData;
  }

  let response = await client.runCommand(
    realmServerUrl,
    realmUrl,
    INSTANTIATE_CARD_COMMAND,
    commandInput,
  );

  // The serialized `response.result` can contain card attributes (user
  // data) and bloats logs when the tool is called repeatedly mid-turn,
  // so it stays out of the default log stream. --debug raises the logger
  // level to see the full body.
  log.debug(
    `run-command response for ${cardName}: status=${response.status}, error=${response.error}, result=${response.result}`,
  );

  if (response.status !== 'ready') {
    return {
      passed: false,
      error: response.error ?? `run-command returned ${response.status} status`,
    };
  }

  if (response.result) {
    try {
      let cardDoc = JSON.parse(response.result);
      let attrs = cardDoc?.data?.attributes ?? cardDoc;
      if (attrs.passed === false) {
        return {
          passed: false,
          error: attrs.error ?? 'Card instantiation failed',
          stackTrace: attrs.stackTrace,
        };
      }
      return { passed: true };
    } catch {
      log.warn(
        `Failed to parse run-command result for ${cardName}: ${response.result?.slice(0, 200)}`,
      );
      return {
        passed: false,
        error:
          'run-command returned an unparsable result — treating as failure',
      };
    }
  }

  return {
    passed: false,
    error: 'run-command did not return a result — treating as failure',
  };
}
