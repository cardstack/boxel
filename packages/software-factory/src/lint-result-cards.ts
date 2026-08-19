import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import { readCard, writeCard } from './workspace-fs.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LintViolationData {
  rule: string | null;
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface LintFileResultData {
  file: string;
  violations: LintViolationData[];
}

export interface LintResultAttributes {
  status: 'running' | 'passed' | 'failed' | 'error';
  durationMs?: number;
  fileResults?: LintFileResultData[];
  errorMessage?: string;
}

export interface LintResultRealmOptions {
  targetRealm: string;
  client: BoxelCLIClient;
  /** Local workspace directory — LintResult cards are written here. */
  workspaceDir: string;
}

export interface CreateLintResultOptions {
  sequenceNumber?: number;
  issueURL?: string;
  projectCardUrl?: string;
}

// ---------------------------------------------------------------------------
// Card lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a `LintResult` card with `status: running`.
 * Returns the card path as the handle.
 */
export async function createLintResult(
  slug: string,
  lintResultsModuleUrl: string,
  options: LintResultRealmOptions & CreateLintResultOptions,
): Promise<{ lintResultId: string; created: boolean; error?: string }> {
  let seq = options.sequenceNumber ?? 1;
  let lintResultId = `Validations/lint_${slug}-${seq}`;

  let document = buildLintResultCardDocument(lintResultsModuleUrl, {
    sequenceNumber: seq,
    issueURL: options.issueURL,
    projectCardUrl: options.projectCardUrl,
  });

  let result = await writeCard(
    options.workspaceDir,
    `${lintResultId}.json`,
    JSON.stringify(document, null, 2),
  );

  if (!result.ok) {
    return { lintResultId, created: false, error: result.error };
  }

  return { lintResultId, created: true };
}

/**
 * Update an existing `LintResult` card with lint results and final status.
 */
export async function completeLintResult(
  lintResultId: string,
  attrs: LintResultAttributes,
  options: LintResultRealmOptions & { projectCardUrl?: string },
): Promise<{ updated: boolean; error?: string }> {
  let readResult = await readCard(options.workspaceDir, `${lintResultId}.json`);

  if (!readResult.ok || !readResult.document) {
    return {
      updated: false,
      error: `Failed to read LintResult: ${readResult.error ?? 'not found'}`,
    };
  }

  let document = readResult.document as unknown as LooseSingleCardDocument;
  let completionAttrs: Record<string, unknown> = {
    status: attrs.status,
    completedAt: new Date().toISOString(),
    durationMs: attrs.durationMs,
    fileResults: attrs.fileResults,
  };
  if (attrs.errorMessage) {
    completionAttrs.errorMessage = attrs.errorMessage;
  }

  document.data.attributes = {
    ...document.data.attributes,
    ...completionAttrs,
  };

  if (options.projectCardUrl) {
    let existingRelationships =
      (document.data as Record<string, unknown>).relationships ?? {};
    (document.data as Record<string, unknown>).relationships = {
      ...(existingRelationships as Record<string, unknown>),
      project: { links: { self: options.projectCardUrl } },
    };
  }

  let writeResult = await writeCard(
    options.workspaceDir,
    `${lintResultId}.json`,
    JSON.stringify(document, null, 2),
  );

  if (!writeResult.ok) {
    return {
      updated: false,
      error: `Failed to update LintResult: ${writeResult.error}`,
    };
  }

  return { updated: true };
}

/**
 * Build the initial card document for a LintResult with `status: running`.
 */
export function buildLintResultCardDocument(
  lintResultsModuleUrl: string,
  options?: CreateLintResultOptions,
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
          module: lintResultsModuleUrl,
          name: 'LintResult',
        },
      },
    },
  } as LooseSingleCardDocument;
}
