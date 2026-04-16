/**
 * Instantiate validation step — verifies that card instances can be created
 * from their definitions at runtime.
 *
 * For each Spec card discovered in the realm, resolves the card definition
 * module and attempts to instantiate it via the `instantiate-card` host
 * command running in the prerenderer sandbox (headless Chrome).
 *
 * Discovery is spec-based: the step searches for Spec cards (from
 * `https://cardstack.com/base/spec`), uses each spec's `ref` to identify the
 * card definition, and the first `linkedExamples` entry as instance data.
 * If no example exists, a minimal empty instance is used.
 *
 * This catches errors that the eval step misses — eval only verifies modules
 * *load*, instantiate verifies cards can be *created from JSON*.
 */

import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import { specRef } from '@cardstack/runtime-common/constants';

import type { ValidationStepResult } from '../factory-agent';
import { deriveIssueSlug } from '../factory-agent-types';

import {
  searchRealm,
  readFile,
  getNextValidationSequenceNumber,
  runRealmCommand,
  type RealmFetchOptions,
} from '../realm-operations';
import {
  createInstantiateResult,
  completeInstantiateResult,
  type InstantiateCardEntryData,
} from '../instantiate-result-cards';
import { logger } from '../logger';

import type { ValidationStepRunner } from './validation-pipeline';

let log = logger('instantiate-validation-step');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstantiateModuleResult {
  passed: boolean;
  error?: string;
  stackTrace?: string;
}

export interface InstantiateValidationStepConfig {
  /** Realm-scoped authorization token for realm API calls (searchRealm, readFile, writeFile). */
  authorization?: string;
  /** Realm server token for _run-command calls (prerenderer). Distinct from realm-scoped authorization. */
  serverToken?: string;
  fetch?: typeof globalThis.fetch;
  realmServerUrl: string;
  instantiateResultsModuleUrl: string;
  issueId?: string;
  /** Injected for testing — defaults to searchRealm-based spec discovery. */
  searchSpecsFn?: (
    realmUrl: string,
  ) => Promise<{ specs: SpecInfo[]; error?: string }>;
  /** Injected for testing — defaults to runRealmCommand calling the instantiate-card host command. */
  instantiateCardFn?: (
    moduleUrl: string,
    cardName: string,
    realmUrl: string,
    instanceData?: string,
  ) => Promise<InstantiateModuleResult>;
  /** Injected for testing — defaults to getNextValidationSequenceNumber. */
  getNextSequenceNumber?: (
    slug: string,
    targetRealmUrl: string,
  ) => Promise<number>;
}

export interface SpecInfo {
  specId: string;
  moduleUrl: string;
  cardName: string;
  exampleUrls: string[];
}

/** Flattened POJO for instantiate validation details — not a card, just data. */
export interface InstantiateValidationDetails {
  instantiateResultId: string;
  cardsChecked: number;
  cardsWithErrors: number;
  cards: {
    specId: string;
    cardName: string;
    error: string;
    stackTrace?: string;
  }[];
}

const INSTANTIATE_CARD_COMMAND =
  '@cardstack/boxel-host/commands/instantiate-card/default';

// ---------------------------------------------------------------------------
// InstantiateValidationStep
// ---------------------------------------------------------------------------

export class InstantiateValidationStep implements ValidationStepRunner {
  readonly step = 'instantiate' as const;

  private config: InstantiateValidationStepConfig;
  private lastSequenceNumber = 0;

  private searchSpecsFn: (
    realmUrl: string,
  ) => Promise<{ specs: SpecInfo[]; error?: string }>;
  private instantiateCardFn: (
    moduleUrl: string,
    cardName: string,
    realmUrl: string,
    instanceData?: string,
  ) => Promise<InstantiateModuleResult>;
  private getNextSeqFn: (
    slug: string,
    targetRealmUrl: string,
  ) => Promise<number>;

  constructor(config: InstantiateValidationStepConfig) {
    this.config = config;
    this.searchSpecsFn =
      config.searchSpecsFn ??
      ((realmUrl: string) => this.defaultSearchSpecs(realmUrl));
    this.instantiateCardFn =
      config.instantiateCardFn ??
      ((
        moduleUrl: string,
        cardName: string,
        realmUrl: string,
        instanceData?: string,
      ) =>
        this.defaultInstantiateCard(
          moduleUrl,
          cardName,
          realmUrl,
          instanceData,
        ));
    this.getNextSeqFn =
      config.getNextSequenceNumber ??
      ((slug: string, targetRealmUrl: string) =>
        getNextValidationSequenceNumber(
          slug,
          'Validations/instantiate_',
          config.instantiateResultsModuleUrl,
          'InstantiateResult',
          {
            targetRealmUrl,
            authorization: config.authorization,
            fetch: config.fetch,
          },
        ));
  }

  async run(targetRealmUrl: string): Promise<ValidationStepResult> {
    // Step 1: Discover specs in the realm
    let specInfos: SpecInfo[];
    try {
      let result = await this.searchSpecsFn(targetRealmUrl);
      if (result.error) {
        throw new Error(result.error);
      }
      specInfos = result.specs;
    } catch (err) {
      return {
        step: 'instantiate',
        passed: false,
        errors: [
          {
            message: `Failed to discover specs: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }

    if (specInfos.length === 0) {
      log.info('No Spec cards found — nothing to validate');
      return { step: 'instantiate', passed: true, files: [], errors: [] };
    }

    log.info(
      `Found ${specInfos.length} spec(s): ${specInfos.map((s) => s.cardName).join(', ')}`,
    );

    // Step 2: Create the InstantiateResult card (status: running)
    let slug = this.config.issueId
      ? deriveIssueSlug(this.config.issueId)
      : 'validation';

    let issueURL = this.config.issueId
      ? new URL(this.config.issueId, targetRealmUrl).href
      : undefined;

    let seq: number;
    try {
      let realmSeq = await this.getNextSeqFn(slug, targetRealmUrl);
      seq = Math.max(realmSeq, this.lastSequenceNumber + 1);
    } catch (err) {
      log.warn(
        `Failed to resolve sequence number, using floor: ${err instanceof Error ? err.message : String(err)}`,
      );
      seq = this.lastSequenceNumber + 1;
    }

    let instantiateResultId: string;
    let artifactCreated = false;
    try {
      let createResult = await createInstantiateResult(
        slug,
        this.config.instantiateResultsModuleUrl,
        {
          targetRealmUrl,
          authorization: this.config.authorization,
          fetch: this.config.fetch,
          sequenceNumber: seq,
          issueURL,
        },
      );
      instantiateResultId = createResult.instantiateResultId;
      if (!createResult.created) {
        log.warn(
          `InstantiateResult card creation returned created: false: ${createResult.error ?? 'unknown'}`,
        );
      } else {
        artifactCreated = true;
        this.lastSequenceNumber = seq;
      }
    } catch (err) {
      log.warn(
        `Failed to create InstantiateResult card: ${err instanceof Error ? err.message : String(err)}`,
      );
      instantiateResultId = `Validations/instantiate_${slug}-${seq}`;
    }

    // Step 3: Instantiate each spec's card via sandbox (_run-command → host command)
    let startedAt = Date.now();
    let allCardResults: InstantiateCardEntryData[] = [];
    let failedCards: InstantiateValidationDetails['cards'] = [];

    for (let spec of specInfos) {
      // Collect instance data for all linked examples
      let exampleInstances: { url: string; data: string }[] = [];
      for (let exampleUrl of spec.exampleUrls) {
        try {
          let exampleRead = await readFile(targetRealmUrl, exampleUrl, {
            authorization: this.config.authorization,
            fetch: this.config.fetch,
          });
          if (exampleRead.ok && exampleRead.document) {
            // The card+source format uses relative adoptsFrom.module paths
            // and has no id field (the id IS the file path). Resolve the
            // adoptsFrom.module to an absolute URL using codeRefWithAbsoluteURL
            // logic so the host command can instantiate without relativeTo context.
            let exampleCardUrl = new URL(
              exampleUrl,
              ensureTrailingSlash(targetRealmUrl),
            ).href;
            let adoptsFrom = exampleRead.document.data.meta?.adoptsFrom as
              | ResolvedCodeRef
              | undefined;
            if (adoptsFrom && typeof adoptsFrom.module === 'string') {
              adoptsFrom.module = new URL(
                adoptsFrom.module,
                exampleCardUrl,
              ).href;
            }
            exampleRead.document.data.id = exampleCardUrl;
            exampleInstances.push({
              url: exampleUrl,
              data: JSON.stringify(exampleRead.document),
            });
          } else {
            log.warn(
              `Failed to read example ${exampleUrl} for spec ${spec.specId}: ${exampleRead.error ?? 'unknown'}`,
            );
          }
        } catch (err) {
          log.warn(
            `Error reading example ${exampleUrl} for spec ${spec.specId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // If no examples were found/read, try instantiating with no field data
      if (exampleInstances.length === 0) {
        exampleInstances.push({ url: '', data: '' });
      }

      // Instantiate all examples in parallel
      let settled = await Promise.allSettled(
        exampleInstances.map(async (example) => {
          let instanceData = example.data || undefined;
          return this.instantiateCardFn(
            spec.moduleUrl,
            spec.cardName,
            targetRealmUrl,
            instanceData,
          );
        }),
      );

      for (let i = 0; i < settled.length; i++) {
        let outcome = settled[i];
        let hasExample = !!exampleInstances[i].data;

        if (outcome.status === 'fulfilled') {
          let result = outcome.value;
          allCardResults.push({
            specId: spec.specId,
            moduleUrl: spec.moduleUrl,
            cardName: spec.cardName,
            hasExample,
            error: result.error ?? '',
            stackTrace: result.stackTrace,
          });
          if (!result.passed) {
            failedCards.push({
              specId: spec.specId,
              cardName: spec.cardName,
              error: result.error ?? 'Card instantiation failed',
              stackTrace: result.stackTrace,
            });
          }
        } else {
          let message = `Instantiate failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`;
          log.warn(`Error instantiating ${spec.cardName}: ${message}`);
          allCardResults.push({
            specId: spec.specId,
            moduleUrl: spec.moduleUrl,
            cardName: spec.cardName,
            hasExample,
            error: message,
          });
          failedCards.push({
            specId: spec.specId,
            cardName: spec.cardName,
            error: message,
          });
        }
      }
    }

    let durationMs = Date.now() - startedAt;
    let passed = failedCards.length === 0;

    // Step 4: Complete the InstantiateResult card
    if (artifactCreated) {
      let completeResult = await completeInstantiateResult(
        instantiateResultId,
        {
          status: passed ? 'passed' : 'failed',
          durationMs,
          cardResults: allCardResults,
        },
        {
          targetRealmUrl,
          authorization: this.config.authorization,
          fetch: this.config.fetch,
        },
      );
      if (!completeResult.updated) {
        log.warn(
          `Failed to complete InstantiateResult card ${instantiateResultId}: ${completeResult.error ?? 'unknown'}`,
        );
      }
    }

    // Step 5: Build result
    let details: InstantiateValidationDetails = {
      instantiateResultId,
      cardsChecked: allCardResults.length,
      cardsWithErrors: failedCards.length,
      cards: failedCards,
    };

    let errors = failedCards.map((c) => ({
      file: c.specId,
      message: `${c.cardName}: ${c.error}`,
    }));

    return {
      step: 'instantiate',
      passed,
      files: specInfos.map((s) => s.specId),
      errors,
      details: details as unknown as Record<string, unknown>,
    };
  }

  formatForContext(result: ValidationStepResult): string {
    if (result.passed) {
      let details = result.details as unknown as
        | InstantiateValidationDetails
        | undefined;
      if (details && details.cardsChecked > 0) {
        return `## Instantiate Validation: PASSED\n${details.cardsChecked} card(s) checked, no instantiation errors. (InstantiateResult: ${details.instantiateResultId})`;
      }
      return '';
    }

    let details = result.details as unknown as
      | InstantiateValidationDetails
      | undefined;
    if (!details) {
      let errorLines = result.errors.map((e) => `- ${e.message}`).join('\n');
      return `## Instantiate Validation: FAILED\n${errorLines}`;
    }

    let lines: string[] = [
      `## Instantiate Validation: FAILED`,
      `${details.cardsChecked} card(s) checked, ${details.cardsWithErrors} with instantiation errors (InstantiateResult: ${details.instantiateResultId})`,
    ];

    for (let card of details.cards) {
      lines.push(`  ${card.cardName}: ${card.error}`);
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Default spec discovery: search the realm for Spec cards using
   * the realm server's local base module URL and extract ref + first example.
   *
   * The `type` filter uses the realm server's base URL (not the canonical
   * `https://cardstack.com/base/spec`) because the canonical URL may not
   * be indexed in isolated test realms or fresh realms.
   */
  private async defaultSearchSpecs(
    realmUrl: string,
  ): Promise<{ specs: SpecInfo[]; error?: string }> {
    let fetchOptions: RealmFetchOptions = {
      authorization: this.config.authorization,
      fetch: this.config.fetch,
    };

    // Search the target realm for Spec cards using the canonical code ref.
    let searchResult = await searchRealm(
      realmUrl,
      {
        filter: {
          type: specRef,
        },
      },
      fetchOptions,
    );

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

      // Skip field specs — only card/app specs produce instantiable instances
      let specType = attributes.specType as string | undefined;
      if (specType === 'field') {
        log.info(`Spec ${specId} is a field spec — skipping`);
        continue;
      }

      let ref = attributes.ref as
        | { module?: string; name?: string }
        | undefined;
      if (!ref?.module || !ref?.name) {
        log.warn(`Spec ${specId} has no valid ref — skipping`);
        continue;
      }

      // Resolve relative module URL against the spec card's own URL
      let specCardUrl = new URL(specId, ensureTrailingSlash(realmUrl)).href;
      let moduleUrl = new URL(ref.module, specCardUrl).href;

      // Find all linked examples — resolve relative URLs against the spec card's URL
      let relationships = (card as Record<string, unknown>).relationships as
        | Record<string, unknown>
        | undefined;
      let rawExampleUrls = extractLinkedExamples(relationships);
      let normalizedRealmUrl = ensureTrailingSlash(realmUrl);
      let exampleUrls: string[] = [];
      for (let rawUrl of rawExampleUrls) {
        let absoluteUrl = new URL(rawUrl, specCardUrl).href;
        if (absoluteUrl.startsWith(normalizedRealmUrl)) {
          exampleUrls.push(absoluteUrl.slice(normalizedRealmUrl.length));
        } else {
          exampleUrls.push(rawUrl);
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
   * Default instantiateCardFn: calls the instantiate-card host command
   * via `_run-command` on the realm server.
   */
  private async defaultInstantiateCard(
    moduleUrl: string,
    cardName: string,
    realmUrl: string,
    instanceData?: string,
  ): Promise<InstantiateModuleResult> {
    if (!this.config.serverToken) {
      return {
        passed: false,
        error:
          'serverToken is required for instantiate validation via _run-command',
      };
    }

    let commandInput: Record<string, unknown> = {
      moduleUrl,
      cardName,
      realmUrl,
    };
    if (instanceData) {
      commandInput.instanceData = instanceData;
    }

    let response = await runRealmCommand(
      this.config.realmServerUrl,
      realmUrl,
      INSTANTIATE_CARD_COMMAND,
      commandInput,
      {
        authorization: this.config.serverToken,
        fetch: this.config.fetch,
      },
    );

    log.info(
      `run-command response for ${cardName}: status=${response.status}, error=${response.error}, result=${response.result?.slice(0, 300)}`,
    );

    if (response.status !== 'ready') {
      return {
        passed: false,
        error:
          response.error ?? `run-command returned ${response.status} status`,
      };
    }

    // Parse the cardResultString to extract InstantiateCardResult fields
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
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
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

  // Iterate dotted keys: linkedExamples.0, linkedExamples.1, ...
  for (let i = 0; ; i++) {
    let entry = relationships[`linkedExamples.${i}`] as
      | { links?: { self?: string } }
      | undefined;
    if (!entry?.links?.self) {
      break;
    }
    urls.push(entry.links.self);
  }

  // Fallback: try JSON:API array format
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
