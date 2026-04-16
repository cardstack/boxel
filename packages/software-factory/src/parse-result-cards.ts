import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import { readFile, writeFile } from './realm-operations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParseErrorData {
  file: string;
  line: number;
  column: number;
  message: string;
}

export interface ParseFileResultData {
  file: string;
  errors: ParseErrorData[];
}

export interface ParseResultAttributes {
  status: 'running' | 'passed' | 'failed' | 'error';
  durationMs?: number;
  fileResults?: ParseFileResultData[];
  errorMessage?: string;
}

export interface ParseResultRealmOptions {
  targetRealmUrl: string;
  authorization?: string;
  fetch?: typeof globalThis.fetch;
}

export interface CreateParseResultOptions {
  sequenceNumber?: number;
  issueURL?: string;
  projectCardUrl?: string;
}

// ---------------------------------------------------------------------------
// Card lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a `ParseResult` card with `status: running`.
 * Returns the card path as the handle.
 */
export async function createParseResult(
  slug: string,
  parseResultsModuleUrl: string,
  options: ParseResultRealmOptions & CreateParseResultOptions,
): Promise<{ parseResultId: string; created: boolean; error?: string }> {
  let seq = options.sequenceNumber ?? 1;
  let parseResultId = `Validations/parse_${slug}-${seq}`;

  let document = buildParseResultCardDocument(parseResultsModuleUrl, {
    sequenceNumber: seq,
    issueURL: options.issueURL,
    projectCardUrl: options.projectCardUrl,
  });

  let result = await writeFile(
    options.targetRealmUrl,
    `${parseResultId}.json`,
    JSON.stringify(document, null, 2),
    { authorization: options.authorization, fetch: options.fetch },
  );

  if (!result.ok) {
    return { parseResultId, created: false, error: result.error };
  }

  return { parseResultId, created: true };
}

/**
 * Update an existing `ParseResult` card with parse results and final status.
 */
export async function completeParseResult(
  parseResultId: string,
  attrs: ParseResultAttributes,
  options: ParseResultRealmOptions & { projectCardUrl?: string },
): Promise<{ updated: boolean; error?: string }> {
  let fetchOptions = {
    authorization: options.authorization,
    fetch: options.fetch,
  };

  let readResult = await readFile(
    options.targetRealmUrl,
    parseResultId,
    fetchOptions,
  );

  if (!readResult.ok || !readResult.document) {
    return {
      updated: false,
      error: `Failed to read ParseResult: ${readResult.error}`,
    };
  }

  let completionAttrs: Record<string, unknown> = {
    status: attrs.status,
    completedAt: new Date().toISOString(),
    durationMs: attrs.durationMs,
    fileResults: attrs.fileResults,
  };
  if (attrs.errorMessage) {
    completionAttrs.errorMessage = attrs.errorMessage;
  }

  readResult.document.data.attributes = {
    ...readResult.document.data.attributes,
    ...completionAttrs,
  };

  if (options.projectCardUrl) {
    let existingRelationships =
      (readResult.document.data as Record<string, unknown>).relationships ?? {};
    (readResult.document.data as Record<string, unknown>).relationships = {
      ...(existingRelationships as Record<string, unknown>),
      project: { links: { self: options.projectCardUrl } },
    };
  }

  let writeResult = await writeFile(
    options.targetRealmUrl,
    `${parseResultId}.json`,
    JSON.stringify(readResult.document, null, 2),
    fetchOptions,
  );

  if (!writeResult.ok) {
    return {
      updated: false,
      error: `Failed to update ParseResult: ${writeResult.error}`,
    };
  }

  return { updated: true };
}

/**
 * Build the initial card document for a ParseResult with `status: running`.
 */
export function buildParseResultCardDocument(
  parseResultsModuleUrl: string,
  options?: CreateParseResultOptions,
): LooseSingleCardDocument {
  let attributes: Record<string, unknown> = {
    sequenceNumber: options?.sequenceNumber ?? 1,
    runAt: new Date().toISOString(),
    status: 'running',
  };

  let relationships:
    | Record<string, { links: { self: string | null } }>
    | undefined;
  if (options?.projectCardUrl || options?.issueURL) {
    relationships = {};
    if (options?.projectCardUrl) {
      relationships.project = { links: { self: options.projectCardUrl } };
    }
    if (options?.issueURL) {
      relationships.issue = { links: { self: options.issueURL } };
    }
  }

  return {
    data: {
      type: 'card',
      attributes,
      ...(relationships ? { relationships } : {}),
      meta: {
        adoptsFrom: {
          module: parseResultsModuleUrl,
          name: 'ParseResult',
        },
      },
    },
  } as LooseSingleCardDocument;
}
