/**
 * Parse validation step — verifies that `.gts` / `.gjs` / `.ts` and `.json`
 * files in the target realm are syntactically valid.
 *
 * GTS/TS files are run through glint (ember-tsc) for template-aware type
 * checking. JSON files (discovered as Spec `linkedExamples`) are validated
 * for JSON syntax and card document structure.
 *
 * Discovery + per-file parsing lives in `../parse-execution.ts` so the
 * in-memory `run_parse` agent tool can share the same engine.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import type { ValidationStepResult } from '../factory-agent';
import { deriveIssueSlug } from '../factory-agent';
import { logger } from '../logger';
import {
  discoverJsonExampleFiles,
  discoverParseableGtsFiles,
  parseRealmFiles,
  type ParseErrorViolation,
  type ParseRealmFilesOptions,
  type SpecExampleInfo,
} from '../parse-execution';
import {
  createParseResult,
  completeParseResult,
  type ParseErrorData,
} from '../parse-result-cards';
import { getNextValidationSequenceNumber } from '../realm-operations';

import type { ValidationStepRunner } from './validation-pipeline';

let log = logger('parse-validation-step');

// Re-export helpers kept for existing unit tests and callers.
export {
  parseJsonFile,
  validateCardDocumentStructure,
} from '../parse-execution';
export type { SpecExampleInfo } from '../parse-execution';
export type { ParseErrorData };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParseValidationStepConfig {
  client: BoxelCLIClient;
  realmServerUrl: string;
  /** Memoizes the engine run per workspace fingerprint — see ValidationRunCache. */
  cache?: import('../validation-run-cache').ValidationRunCache;
  parseResultsModuleUrl: string;
  /**
   * Local workspace directory mirroring the target realm. Source files are
   * read from here (glint still runs in its own tmp dir); ParseResult
   * cards are written here for the orchestrator to sync.
   */
  workspaceDir: string;
  issueId?: string;
  /** Injected for testing — defaults to client.listFiles. */
  fetchFilenames?: (
    realmUrl: string,
  ) => Promise<{ filenames: string[]; error?: string }>;
  /** Injected for testing — defaults to client.read. */
  readFileFn?: ParseRealmFilesOptions['readFileFn'];
  /** Injected for testing — defaults to client.search-based spec discovery. */
  searchSpecsFn?: (
    realmUrl: string,
  ) => Promise<{ specs: SpecExampleInfo[]; error?: string }>;
  /** Injected for testing — defaults to getNextValidationSequenceNumber. */
  getNextSequenceNumber?: (
    slug: string,
    targetRealm: string,
  ) => Promise<number>;
  /**
   * Injected for testing — runs glint (ember-tsc) on .gts files.
   * Defaults to downloading files to a temp dir and running ember-tsc.
   */
  runGlintCheckFn?: ParseRealmFilesOptions['runGlintCheckFn'];
}

/** Flattened POJO for parse validation details — not a card, just data. */
export interface ParseValidationDetails {
  parseResultId: string;
  filesChecked: number;
  filesWithErrors: number;
  totalErrors: number;
  errors: ParseErrorViolation[];
}

// ---------------------------------------------------------------------------
// ParseValidationStep
// ---------------------------------------------------------------------------

export class ParseValidationStep implements ValidationStepRunner {
  readonly step = 'parse' as const;

  private config: ParseValidationStepConfig;
  private lastSequenceNumber = 0;

  private getNextSeqFn: (slug: string, targetRealm: string) => Promise<number>;

  constructor(config: ParseValidationStepConfig) {
    this.config = config;
    this.getNextSeqFn =
      config.getNextSequenceNumber ??
      ((slug: string, targetRealm: string) =>
        getNextValidationSequenceNumber(
          config.client,
          slug,
          'Validations/parse_',
          config.parseResultsModuleUrl,
          'ParseResult',
          targetRealm,
        ));
  }

  async run(
    targetRealm: string,
    iteration?: number,
  ): Promise<ValidationStepResult> {
    // Step 1: Discover files to validate via the shared engine.
    let gtsFiles: string[];
    let jsonExampleUrls: string[];
    try {
      let [gts, json] = await Promise.all([
        discoverParseableGtsFiles({
          targetRealm,
          client: this.config.client,
          fetchFilenames: this.config.fetchFilenames,
        }),
        discoverJsonExampleFiles({
          targetRealm,
          client: this.config.client,
          searchSpecsFn: this.config.searchSpecsFn,
        }),
      ]);
      gtsFiles = gts;
      jsonExampleUrls = json;
    } catch (err) {
      return {
        step: 'parse',
        passed: false,
        errors: [
          {
            message: `Failed to discover files: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }

    if (gtsFiles.length === 0 && jsonExampleUrls.length === 0) {
      log.info('No parseable files found — nothing to validate');
      return { step: 'parse', passed: true, files: [], errors: [] };
    }

    log.info(
      `Found ${gtsFiles.length} GTS file(s) and ${jsonExampleUrls.length} JSON example(s) to parse`,
    );

    // Step 2: Create the ParseResult card (status: running)
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

    let parseResultId: string;
    let artifactCreated = false;
    try {
      let createResult = await createParseResult(
        slug,
        this.config.parseResultsModuleUrl,
        {
          targetRealm,
          client: this.config.client,
          workspaceDir: this.config.workspaceDir,
          sequenceNumber: seq,
          issueURL,
        },
      );
      parseResultId = createResult.parseResultId;
      if (!createResult.created) {
        log.warn(
          `ParseResult card creation returned created: false: ${createResult.error ?? 'unknown'}`,
        );
      } else {
        artifactCreated = true;
        this.lastSequenceNumber = seq;
      }
    } catch (err) {
      log.warn(
        `Failed to create ParseResult card: ${err instanceof Error ? err.message : String(err)}`,
      );
      parseResultId = `Validations/parse_${slug}-${seq}`;
    }

    // Step 3: Parse each file via the shared engine.
    let {
      fileResults: allFileResults,
      errorViolations: allErrors,
      durationMs,
    } = await parseRealmFiles(
      {
        targetRealm,
        client: this.config.client,
        workspaceDir: this.config.workspaceDir,
        readFileFn: this.config.readFileFn,
        runGlintCheckFn: this.config.runGlintCheckFn,
        cache: this.config.cache,
      },
      gtsFiles,
      jsonExampleUrls,
    );

    let passed = allErrors.length === 0;

    // Step 4: Complete the ParseResult card
    if (artifactCreated) {
      let completeResult = await completeParseResult(
        parseResultId,
        {
          status: passed ? 'passed' : 'failed',
          durationMs,
          fileResults: allFileResults,
        },
        {
          targetRealm,
          client: this.config.client,
          workspaceDir: this.config.workspaceDir,
        },
      );
      if (!completeResult.updated) {
        log.warn(
          `Failed to complete ParseResult card ${parseResultId}: ${completeResult.error ?? 'unknown'}`,
        );
      }
    }

    // Step 5: Build result
    let details: ParseValidationDetails = {
      parseResultId,
      filesChecked: allFileResults.length,
      filesWithErrors: allFileResults.filter((fr) => fr.errors.length > 0)
        .length,
      totalErrors: allErrors.length,
      errors: allErrors,
    };

    let errors = allErrors.map((e) => ({
      file: e.file,
      message: `${e.file}${e.line ? `:${e.line}` : ''} ${e.message}`,
    }));

    return {
      step: 'parse',
      passed,
      files: [...gtsFiles, ...jsonExampleUrls],
      errors,
      details: details as unknown as Record<string, unknown>,
    };
  }

  formatForContext(result: ValidationStepResult): string {
    if (result.passed) {
      let details = result.details as unknown as
        | ParseValidationDetails
        | undefined;
      if (details && details.filesChecked > 0) {
        return `## Parse Validation: PASSED\n${details.filesChecked} file(s) checked, no parse errors. (ParseResult: ${details.parseResultId})`;
      }
      return '';
    }

    let details = result.details as unknown as
      | ParseValidationDetails
      | undefined;
    if (!details) {
      let errorLines = result.errors.map((e) => `- ${e.message}`).join('\n');
      return `## Parse Validation: FAILED\n${errorLines}`;
    }

    let lines: string[] = [
      `## Parse Validation: FAILED`,
      `${details.filesChecked} file(s) checked, ${details.totalErrors} error(s) in ${details.filesWithErrors} file(s) (ParseResult: ${details.parseResultId})`,
    ];

    for (let error of details.errors) {
      lines.push(
        `  ${error.file}${error.line ? `:${error.line}` : ''} ${error.message}`,
      );
    }

    return lines.join('\n');
  }
}
