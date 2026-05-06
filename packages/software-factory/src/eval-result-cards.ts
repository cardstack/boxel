import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import { readCard, writeCard } from './workspace-fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalModuleErrorData {
  path: string;
  error: string;
  stackTrace?: string;
}

export interface EvalResultAttributes {
  status: 'running' | 'passed' | 'failed' | 'error';
  durationMs?: number;
  moduleResults?: EvalModuleErrorData[];
  errorMessage?: string;
}

export interface EvalResultRealmOptions {
  targetRealm: string;
  client: BoxelCLIClient;
  /** Local workspace directory — EvalResult cards are written here. */
  workspaceDir: string;
}

export interface CreateEvalResultOptions {
  sequenceNumber?: number;
  issueURL?: string;
  projectCardUrl?: string;
}

// ---------------------------------------------------------------------------
// Card lifecycle
// ---------------------------------------------------------------------------

/**
 * Create an `EvalResult` card with `status: running`.
 * Returns the card path as the handle.
 */
export async function createEvalResult(
  slug: string,
  evalResultsModuleUrl: string,
  options: EvalResultRealmOptions & CreateEvalResultOptions,
): Promise<{ evalResultId: string; created: boolean; error?: string }> {
  let seq = options.sequenceNumber ?? 1;
  let evalResultId = `Validations/eval_${slug}-${seq}`;

  let document = buildEvalResultCardDocument(evalResultsModuleUrl, {
    sequenceNumber: seq,
    issueURL: options.issueURL,
    projectCardUrl: options.projectCardUrl,
  });

  let result = await writeCard(
    options.workspaceDir,
    `${evalResultId}.json`,
    JSON.stringify(document, null, 2),
  );

  if (!result.ok) {
    return { evalResultId, created: false, error: result.error };
  }

  return { evalResultId, created: true };
}

/**
 * Update an existing `EvalResult` card with evaluation results and final status.
 */
export async function completeEvalResult(
  evalResultId: string,
  attrs: EvalResultAttributes,
  options: EvalResultRealmOptions & { projectCardUrl?: string },
): Promise<{ updated: boolean; error?: string }> {
  let readResult = await readCard(options.workspaceDir, `${evalResultId}.json`);

  if (!readResult.ok || !readResult.document) {
    return {
      updated: false,
      error: `Failed to read EvalResult: ${readResult.error ?? 'not found'}`,
    };
  }

  let document = readResult.document as unknown as LooseSingleCardDocument;
  let completionAttrs: Record<string, unknown> = {
    status: attrs.status,
    completedAt: new Date().toISOString(),
    durationMs: attrs.durationMs,
    moduleResults: attrs.moduleResults,
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
    `${evalResultId}.json`,
    JSON.stringify(document, null, 2),
  );

  if (!writeResult.ok) {
    return {
      updated: false,
      error: `Failed to update EvalResult: ${writeResult.error}`,
    };
  }

  return { updated: true };
}

/**
 * Build the initial card document for an EvalResult with `status: running`.
 */
export function buildEvalResultCardDocument(
  evalResultsModuleUrl: string,
  options?: CreateEvalResultOptions,
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
          module: evalResultsModuleUrl,
          name: 'EvalResult',
        },
      },
    },
  } as LooseSingleCardDocument;
}
