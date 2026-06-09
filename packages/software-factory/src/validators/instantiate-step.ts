/**
 * Instantiate validation step — verifies that card instances can be created
 * from their definitions at runtime.
 *
 * Discovery and per-instance execution live in `../instantiate-execution.ts`
 * (shared with the in-memory `run_instantiate` agent tool). This step adds
 * the `InstantiateResult` card lifecycle (create → complete) and sequence-
 * number bookkeeping, plus the "bootstrap" short-circuit that suppresses
 * artifact creation when the realm is empty.
 *
 * This catches errors that the eval step misses — eval only verifies modules
 * *load*, instantiate verifies cards can be *created from JSON*.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import type { ValidationStepResult } from '../factory-agent/index.ts';
import { deriveIssueSlug } from '../factory-agent/index.ts';
import {
  discoverRealmSpecs,
  instantiateRealmSpecs,
  type InstantiateCardFn,
  type InstanceInstantiationRecord,
  type SpecInfo,
} from '../instantiate-execution.ts';
import {
  createInstantiateResult,
  completeInstantiateResult,
  type InstantiateCardEntryData,
} from '../instantiate-result-cards.ts';
import { logger } from '../logger.ts';

import { getNextValidationSequenceNumber } from '../realm-operations.ts';

import type { ValidationStepRunner } from './validation-pipeline.ts';

let log = logger('instantiate-validation-step');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  InstantiateModuleResult,
  SpecInfo,
} from '../instantiate-execution.ts';

export interface InstantiateValidationStepConfig {
  client: BoxelCLIClient;
  realmServerUrl: string;
  instantiateResultsModuleUrl: string;
  /**
   * Local workspace directory mirroring the target realm. Example instance
   * JSON is read from here; InstantiateResult cards are written here for
   * the orchestrator to sync.
   */
  workspaceDir: string;
  issueId?: string;
  /** Injected for testing — defaults to client.listFiles. */
  fetchFilenames?: (
    realmUrl: string,
  ) => Promise<{ filenames: string[]; error?: string }>;
  /** Injected for testing — defaults to a spec search via the shared engine. */
  searchSpecsFn?: (
    realmUrl: string,
  ) => Promise<{ specs: SpecInfo[]; error?: string }>;
  /** Injected for testing — defaults to the shared engine's instantiate-card caller. */
  instantiateCardFn?: InstantiateCardFn;
  /** Injected for testing — defaults to getNextValidationSequenceNumber. */
  getNextSequenceNumber?: (
    slug: string,
    targetRealm: string,
  ) => Promise<number>;
}

/** Flattened POJO for instantiate validation details — not a card, just data. */
export interface InstantiateValidationDetails {
  instantiateResultId: string;
  cardsChecked: number;
  cardsWithErrors: number;
  cards: {
    instanceId: string;
    cardName: string;
    error: string;
    stackTrace?: string;
  }[];
}

// ---------------------------------------------------------------------------
// InstantiateValidationStep
// ---------------------------------------------------------------------------

export class InstantiateValidationStep implements ValidationStepRunner {
  readonly step = 'instantiate' as const;

  private config: InstantiateValidationStepConfig;
  private lastSequenceNumber = 0;

  private fetchFilenamesFn: (
    realmUrl: string,
  ) => Promise<{ filenames: string[]; error?: string }>;
  private getNextSeqFn: (slug: string, targetRealm: string) => Promise<number>;

  constructor(config: InstantiateValidationStepConfig) {
    this.config = config;
    this.fetchFilenamesFn =
      config.fetchFilenames ??
      ((realmUrl: string) => config.client.listFiles(realmUrl));
    this.getNextSeqFn =
      config.getNextSequenceNumber ??
      ((slug: string, targetRealm: string) =>
        getNextValidationSequenceNumber(
          config.client,
          slug,
          'Validations/instantiate_',
          config.instantiateResultsModuleUrl,
          'InstantiateResult',
          targetRealm,
        ));
  }

  async run(
    targetRealm: string,
    iteration?: number,
  ): Promise<ValidationStepResult> {
    // Step 1: Discover specs in the realm
    let specInfos: SpecInfo[];
    try {
      let result = await discoverRealmSpecs({
        targetRealm,
        client: this.config.client,
        searchSpecsFn: this.config.searchSpecsFn,
      });
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

    // Check if there's anything to validate before creating artifacts
    if (specInfos.length === 0) {
      let hasModules = false;
      let filenames: string[] = [];
      let listError: string | undefined;
      try {
        let filesResult = await this.fetchFilenamesFn(targetRealm);
        // `fetchFilenamesFn` (defaults to `client.listFiles`) reports
        // failures via a returned `error` field, not by throwing. Treat
        // either path as "we don't actually know what's in the realm" and
        // fall back to the no-modules branch so we don't fail the step
        // with a misleading "modules exist but no specs" message.
        if (filesResult.error) {
          listError = filesResult.error;
        } else {
          filenames = filesResult.filenames ?? [];
          hasModules = filenames.some(
            (f) => f.endsWith('.gts') && !f.endsWith('.test.gts'),
          );
        }
      } catch (err) {
        listError = err instanceof Error ? err.message : String(err);
      }
      if (listError) {
        log.warn(
          `Failed to list realm files while diagnosing empty spec search: ${listError}`,
        );
      }

      if (!hasModules) {
        // Truly nothing to validate (e.g., bootstrap) — no artifact
        log.info('No Spec cards or card modules found — nothing to validate');
        return { step: 'instantiate', passed: true, files: [], errors: [] };
      }

      // Modules exist but no specs — likely either a real "no Catalog Spec"
      // configuration miss OR an indexer/search-readiness lag where the
      // Spec source file is on disk but `_federated-search` hasn't picked
      // it up yet. Dump the filename list (filtered to spec-like paths)
      // and the count of total files so future flakes can be triaged
      // against an actual log line instead of an assertion that swallows
      // the context.
      let specLikeFilenames = filenames.filter(
        (f) =>
          f.endsWith('.json') &&
          (f.startsWith('Spec/') || f.includes('-spec.json')),
      );
      log.warn(
        `Card modules exist but no Spec cards found in search — failing. ` +
          `realm=${targetRealm} totalFiles=${filenames.length} specLikeFiles=${JSON.stringify(specLikeFilenames)}`,
      );
      return {
        step: 'instantiate',
        passed: false,
        files: [],
        errors: [
          {
            message:
              'Card modules (.gts) exist but no Spec cards were found. Each entrypoint card needs a Catalog Spec with linkedExamples for instantiation validation.',
          },
        ],
      };
    }

    log.info(
      `Found ${specInfos.length} spec(s): ${specInfos.map((s) => s.cardName).join(', ')}`,
    );

    // Step 2: Create the InstantiateResult card (status: running)
    let slug = this.config.issueId
      ? deriveIssueSlug(this.config.issueId)
      : 'validation';

    let issueURL = this.config.issueId
      ? new URL(this.config.issueId, targetRealm).href
      : undefined;

    let seq: number;
    if (iteration != null) {
      seq = iteration;
    } else {
      try {
        let realmSeq = await this.getNextSeqFn(slug, targetRealm);
        seq = Math.max(realmSeq, this.lastSequenceNumber + 1);
      } catch (err) {
        log.warn(
          `Failed to resolve sequence number, using floor: ${err instanceof Error ? err.message : String(err)}`,
        );
        seq = this.lastSequenceNumber + 1;
      }
    }

    let instantiateResultId: string;
    let artifactCreated = false;
    try {
      let createResult = await createInstantiateResult(
        slug,
        this.config.instantiateResultsModuleUrl,
        {
          targetRealm,
          client: this.config.client,
          workspaceDir: this.config.workspaceDir,
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

    // Step 3: Instantiate each spec's examples via the shared engine.
    let { records, durationMs } = await instantiateRealmSpecs(
      {
        targetRealm,
        realmServerUrl: this.config.realmServerUrl,
        client: this.config.client,
        workspaceDir: this.config.workspaceDir,
        instantiateCardFn: this.config.instantiateCardFn,
      },
      specInfos,
    );

    let allCardResults: InstantiateCardEntryData[] = records.map((r) =>
      toEntryData(r),
    );
    let failedCards: InstantiateValidationDetails['cards'] = records
      .filter((r) => !r.passed)
      .map((r) => ({
        instanceId: r.instanceId,
        cardName: r.cardName,
        error: r.error || 'Card instantiation failed',
        stackTrace: r.stackTrace,
      }));

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
          targetRealm,
          client: this.config.client,
          workspaceDir: this.config.workspaceDir,
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
      file: c.instanceId,
      message: `${c.cardName} (${c.instanceId}): ${c.error}`,
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
      lines.push(`  ${card.cardName} (${card.instanceId}): ${card.error}`);
    }

    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toEntryData(
  record: InstanceInstantiationRecord,
): InstantiateCardEntryData {
  return {
    codeRef: record.codeRef,
    instanceId: record.instanceId,
    error: record.error,
    ...(record.stackTrace ? { stackTrace: record.stackTrace } : {}),
  };
}
