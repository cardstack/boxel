/**
 * Parse validation step — verifies that `.gts` and `.json` files in the
 * target realm are syntactically valid.
 *
 * For `.gts` files: uses `content-tag` to preprocess the GTS source
 * (extracting TypeScript from `<template>` tags), then runs TypeScript's
 * parser to detect syntax errors. This catches both GTS template-level
 * errors (unclosed `<template>` tags, malformed expressions) and
 * TypeScript syntax errors (missing brackets, malformed type annotations).
 *
 * For `.json` files: validates JSON syntax via `JSON.parse()` and checks
 * card document structure (presence of `data.type` and `data.meta.adoptsFrom`).
 * JSON validation runs against spec `linkedExamples` — the same discovery
 * mechanism as the instantiate step — so it validates the example instances
 * that the factory agent creates alongside card definitions.
 */

import * as ts from 'typescript';
import { Preprocessor } from 'content-tag';
import { specRef } from '@cardstack/runtime-common/constants';

import type { ValidationStepResult } from '../factory-agent';
import { deriveIssueSlug } from '../factory-agent-types';

import {
  fetchRealmFilenames,
  getNextValidationSequenceNumber,
  readFile,
  searchRealm,
  type RealmFetchOptions,
} from '../realm-operations';
import {
  createParseResult,
  completeParseResult,
  type ParseFileResultData,
  type ParseErrorData,
} from '../parse-result-cards';
import { logger } from '../logger';

import type { ValidationStepRunner } from './validation-pipeline';

let log = logger('parse-validation-step');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParseValidationStepConfig {
  authorization?: string;
  fetch?: typeof globalThis.fetch;
  realmServerUrl: string;
  parseResultsModuleUrl: string;
  issueId?: string;
  /** Injected for testing — defaults to fetchRealmFilenames. */
  fetchFilenames?: (
    realmUrl: string,
    options?: RealmFetchOptions,
  ) => Promise<{ filenames: string[]; error?: string }>;
  /** Injected for testing — defaults to readFile from realm-operations. */
  readFileFn?: (
    realmUrl: string,
    path: string,
    options?: RealmFetchOptions,
  ) => Promise<{
    ok: boolean;
    content?: string;
    document?: { data: Record<string, unknown> };
    error?: string;
  }>;
  /** Injected for testing — defaults to searchRealm-based spec discovery. */
  searchSpecsFn?: (
    realmUrl: string,
  ) => Promise<{ specs: SpecExampleInfo[]; error?: string }>;
  /** Injected for testing — defaults to getNextValidationSequenceNumber. */
  getNextSequenceNumber?: (
    slug: string,
    targetRealmUrl: string,
  ) => Promise<number>;
}

export interface SpecExampleInfo {
  specId: string;
  exampleUrls: string[];
}

/** Flattened POJO for parse validation details — not a card, just data. */
export interface ParseValidationDetails {
  parseResultId: string;
  filesChecked: number;
  filesWithErrors: number;
  totalErrors: number;
  errors: { file: string; line: number; message: string }[];
}

const GTS_EXTENSIONS = ['.gts', '.gjs'];

// ---------------------------------------------------------------------------
// ParseValidationStep
// ---------------------------------------------------------------------------

export class ParseValidationStep implements ValidationStepRunner {
  readonly step = 'parse' as const;

  private config: ParseValidationStepConfig;
  private lastSequenceNumber = 0;
  private preprocessor: Preprocessor;

  private fetchFilenamesFn: (
    realmUrl: string,
    options?: RealmFetchOptions,
  ) => Promise<{ filenames: string[]; error?: string }>;
  private readFileFn: (
    realmUrl: string,
    path: string,
    options?: RealmFetchOptions,
  ) => Promise<{
    ok: boolean;
    content?: string;
    document?: { data: Record<string, unknown> };
    error?: string;
  }>;
  private searchSpecsFn: (
    realmUrl: string,
  ) => Promise<{ specs: SpecExampleInfo[]; error?: string }>;
  private getNextSeqFn: (
    slug: string,
    targetRealmUrl: string,
  ) => Promise<number>;

  constructor(config: ParseValidationStepConfig) {
    this.config = config;
    this.preprocessor = new Preprocessor();
    this.fetchFilenamesFn = config.fetchFilenames ?? fetchRealmFilenames;
    this.readFileFn = config.readFileFn ?? readFile;
    this.searchSpecsFn =
      config.searchSpecsFn ??
      ((realmUrl: string) => this.defaultSearchSpecs(realmUrl));
    this.getNextSeqFn =
      config.getNextSequenceNumber ??
      ((slug: string, targetRealmUrl: string) =>
        getNextValidationSequenceNumber(
          slug,
          'Validations/parse_',
          config.parseResultsModuleUrl,
          'ParseResult',
          {
            targetRealmUrl,
            authorization: config.authorization,
            fetch: config.fetch,
          },
        ));
  }

  async run(targetRealmUrl: string): Promise<ValidationStepResult> {
    // Step 1: Discover files to validate
    let gtsFiles: string[];
    let jsonExampleUrls: string[];
    try {
      let [gts, json] = await Promise.all([
        this.discoverGtsFiles(targetRealmUrl),
        this.discoverJsonExampleFiles(targetRealmUrl),
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

    let parseResultId: string;
    let artifactCreated = false;
    try {
      let createResult = await createParseResult(
        slug,
        this.config.parseResultsModuleUrl,
        {
          targetRealmUrl,
          authorization: this.config.authorization,
          fetch: this.config.fetch,
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

    // Step 3: Parse each file
    let startedAt = Date.now();
    let allFileResults: ParseFileResultData[] = [];
    let allErrors: ParseValidationDetails['errors'] = [];
    let fetchOpts: RealmFetchOptions = {
      authorization: this.config.authorization,
      fetch: this.config.fetch,
    };

    // 3a: Parse GTS files
    for (let file of gtsFiles) {
      try {
        let readResult = await this.readFileFn(targetRealmUrl, file, fetchOpts);
        if (!readResult.ok) {
          let message = `Could not read ${file}: ${readResult.error ?? 'read failed'}`;
          log.warn(message);
          allFileResults.push({
            file,
            errors: [{ file, line: 0, column: 0, message }],
          });
          allErrors.push({ file, line: 0, message });
          continue;
        }
        if (readResult.content == null) {
          let message = `Could not read ${file}: no content`;
          log.warn(message);
          allFileResults.push({
            file,
            errors: [{ file, line: 0, column: 0, message }],
          });
          allErrors.push({ file, line: 0, message });
          continue;
        }

        let errors = this.parseGtsFile(file, readResult.content);
        allFileResults.push({ file, errors });
        for (let e of errors) {
          allErrors.push({ file: e.file, line: e.line, message: e.message });
        }
      } catch (err) {
        let message = `Parse failed: ${err instanceof Error ? err.message : String(err)}`;
        log.warn(`Error parsing ${file}: ${message}`);
        allFileResults.push({
          file,
          errors: [{ file, line: 0, column: 0, message }],
        });
        allErrors.push({ file, line: 0, message });
      }
    }

    // 3b: Parse JSON example files
    // readFile returns `.json` files as `document` (parsed object) not `content`
    // (raw string), since the realm API parses JSON before returning. When a
    // `document` is present, JSON syntax is already validated — we only need to
    // check card document structure. When raw `content` is present (e.g., from
    // mocks), we parse it ourselves.
    for (let jsonUrl of jsonExampleUrls) {
      try {
        let readResult = await this.readFileFn(
          targetRealmUrl,
          jsonUrl,
          fetchOpts,
        );
        if (!readResult.ok) {
          let message = `Could not read ${jsonUrl}: ${readResult.error ?? 'read failed'}`;
          log.warn(message);
          allFileResults.push({
            file: jsonUrl,
            errors: [{ file: jsonUrl, line: 0, column: 0, message }],
          });
          allErrors.push({ file: jsonUrl, line: 0, message });
          continue;
        }

        let errors: ParseErrorData[];
        if (readResult.document) {
          // Realm returned a parsed document — JSON is valid, validate structure
          errors = this.validateCardDocumentStructure(
            jsonUrl,
            readResult.document,
          );
        } else if (readResult.content != null) {
          // Raw content (from mocks or non-standard readFile) — full parse + validate
          errors = this.parseJsonFile(jsonUrl, readResult.content);
        } else {
          let message = `Could not read ${jsonUrl}: no content or document`;
          log.warn(message);
          allFileResults.push({
            file: jsonUrl,
            errors: [{ file: jsonUrl, line: 0, column: 0, message }],
          });
          allErrors.push({ file: jsonUrl, line: 0, message });
          continue;
        }

        allFileResults.push({ file: jsonUrl, errors });
        for (let e of errors) {
          allErrors.push({ file: e.file, line: e.line, message: e.message });
        }
      } catch (err) {
        let message = `Parse failed: ${err instanceof Error ? err.message : String(err)}`;
        log.warn(`Error parsing ${jsonUrl}: ${message}`);
        allFileResults.push({
          file: jsonUrl,
          errors: [{ file: jsonUrl, line: 0, column: 0, message }],
        });
        allErrors.push({ file: jsonUrl, line: 0, message });
      }
    }

    let durationMs = Date.now() - startedAt;
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
          targetRealmUrl,
          authorization: this.config.authorization,
          fetch: this.config.fetch,
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

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Discover .gts and .gjs files in the realm.
   */
  private async discoverGtsFiles(targetRealmUrl: string): Promise<string[]> {
    let result = await this.fetchFilenamesFn(targetRealmUrl, {
      authorization: this.config.authorization,
      fetch: this.config.fetch,
    });

    if (result.error) {
      throw new Error(result.error);
    }

    return result.filenames
      .filter((f) => GTS_EXTENSIONS.some((ext) => f.endsWith(ext)))
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * Discover JSON example files to validate by searching for Spec cards
   * and extracting their linkedExamples — same discovery as instantiate step.
   */
  private async discoverJsonExampleFiles(
    targetRealmUrl: string,
  ): Promise<string[]> {
    let result = await this.searchSpecsFn(targetRealmUrl);
    if (result.error) {
      log.warn(`Failed to discover specs for JSON validation: ${result.error}`);
      return [];
    }

    let urls: string[] = [];
    for (let spec of result.specs) {
      for (let url of spec.exampleUrls) {
        if (!urls.includes(url)) {
          urls.push(url);
        }
      }
    }
    return urls.sort((a, b) => a.localeCompare(b));
  }

  /**
   * Parse a .gts/.gjs file using content-tag + TypeScript.
   *
   * Phase 1: content-tag preprocesses GTS → TS (catches template-level errors)
   * Phase 2: TypeScript parser checks the preprocessed output (catches TS syntax errors)
   */
  parseGtsFile(filename: string, source: string): ParseErrorData[] {
    let errors: ParseErrorData[] = [];

    // Phase 1: content-tag preprocessing
    let preprocessed: { code: string };
    try {
      preprocessed = this.preprocessor.process(source, { filename });
    } catch (err) {
      let message = err instanceof Error ? err.message : String(err);
      // content-tag errors include "Parse Error at file:line:col" — extract line info
      let lineMatch = message.match(/Parse Error at [^:]+:(\d+):(\d+)/);
      let line = lineMatch ? parseInt(lineMatch[1], 10) : 0;
      let column = lineMatch ? parseInt(lineMatch[2], 10) : 0;
      errors.push({
        file: filename,
        line,
        column,
        message: `GTS preprocessing error: ${message}`,
      });
      return errors;
    }

    // Phase 2: TypeScript syntax check on preprocessed output
    let tsFilename = filename.replace(/\.gts$/, '.ts').replace(/\.gjs$/, '.js');
    let sourceFile = ts.createSourceFile(
      tsFilename,
      preprocessed.code,
      ts.ScriptTarget.Latest,
      true,
    );

    // parseDiagnostics is populated by createSourceFile — these are syntax errors
    let diagnostics =
      (
        sourceFile as unknown as {
          parseDiagnostics?: ts.DiagnosticWithLocation[];
        }
      ).parseDiagnostics ?? [];

    for (let diag of diagnostics) {
      let pos = sourceFile.getLineAndCharacterOfPosition(diag.start);
      errors.push({
        file: filename,
        line: pos.line + 1,
        column: pos.character + 1,
        message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
      });
    }

    return errors;
  }

  /**
   * Parse a JSON file and validate card document structure.
   *
   * Checks:
   * 1. Valid JSON syntax
   * 2. Card document structure (data.type, data.meta.adoptsFrom)
   */
  parseJsonFile(filename: string, source: string): ParseErrorData[] {
    // Phase 1: JSON syntax
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (err) {
      let message = err instanceof Error ? err.message : String(err);
      return [
        {
          file: filename,
          line: 0,
          column: 0,
          message: `Invalid JSON: ${message}`,
        },
      ];
    }

    // Phase 2: Card document structure
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return [
        {
          file: filename,
          line: 0,
          column: 0,
          message: 'Card document must be a JSON object',
        },
      ];
    }

    return this.validateCardDocumentStructure(
      filename,
      parsed as { data: Record<string, unknown> },
    );
  }

  /**
   * Validate card document structure from an already-parsed object.
   * Used both by `parseJsonFile` (from raw content) and the run() method
   * (when readFile returns a `document` directly).
   */
  validateCardDocumentStructure(
    filename: string,
    doc: { data: Record<string, unknown> },
  ): ParseErrorData[] {
    let errors: ParseErrorData[] = [];
    let data = doc.data;

    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      errors.push({
        file: filename,
        line: 0,
        column: 0,
        message: 'Card document must have a "data" object',
      });
      return errors;
    }

    let dataObj = data as Record<string, unknown>;

    if (typeof dataObj.type !== 'string') {
      errors.push({
        file: filename,
        line: 0,
        column: 0,
        message: 'Card document "data.type" must be a string',
      });
    }

    let meta = dataObj.meta as Record<string, unknown> | undefined;
    if (typeof meta !== 'object' || meta === null) {
      errors.push({
        file: filename,
        line: 0,
        column: 0,
        message: 'Card document must have a "data.meta" object',
      });
    } else {
      let adoptsFrom = meta.adoptsFrom as Record<string, unknown> | undefined;
      if (typeof adoptsFrom !== 'object' || adoptsFrom === null) {
        errors.push({
          file: filename,
          line: 0,
          column: 0,
          message:
            'Card document must have a "data.meta.adoptsFrom" object with "module" and "name"',
        });
      } else {
        if (typeof adoptsFrom.module !== 'string') {
          errors.push({
            file: filename,
            line: 0,
            column: 0,
            message: '"data.meta.adoptsFrom.module" must be a string',
          });
        }
        if (typeof adoptsFrom.name !== 'string') {
          errors.push({
            file: filename,
            line: 0,
            column: 0,
            message: '"data.meta.adoptsFrom.name" must be a string',
          });
        }
      }
    }

    return errors;
  }

  /**
   * Default spec discovery: search the realm for Spec cards and extract
   * linkedExamples URLs. Same pattern as InstantiateValidationStep.
   */
  private async defaultSearchSpecs(
    realmUrl: string,
  ): Promise<{ specs: SpecExampleInfo[]; error?: string }> {
    let fetchOptions: RealmFetchOptions = {
      authorization: this.config.authorization,
      fetch: this.config.fetch,
    };

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

    let specs: SpecExampleInfo[] = [];
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

      // Skip field specs
      let specType = attributes.specType as string | undefined;
      if (specType === 'field') {
        continue;
      }

      let relationships = (card as Record<string, unknown>).relationships as
        | Record<string, unknown>
        | undefined;
      let rawExampleUrls = extractLinkedExamples(relationships);
      let specCardUrl = new URL(specId, ensureTrailingSlash(realmUrl)).href;
      let normalizedRealmUrl = ensureTrailingSlash(realmUrl);
      let exampleUrls: string[] = [];
      for (let rawUrl of rawExampleUrls) {
        let absoluteUrl = new URL(rawUrl, specCardUrl).href;
        if (absoluteUrl.startsWith(normalizedRealmUrl)) {
          exampleUrls.push(absoluteUrl.slice(normalizedRealmUrl.length));
        }
      }

      specs.push({ specId, exampleUrls });
    }

    return { specs };
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
 * relationships. Boxel encodes `linksToMany` with dotted keys.
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
