import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstantiateCardEntryData {
  codeRef: { module: string; name: string };
  instanceId: string;
  error: string;
  stackTrace?: string;
}

export interface InstantiateResultAttributes {
  status: 'running' | 'passed' | 'failed' | 'error';
  durationMs?: number;
  cardResults?: InstantiateCardEntryData[];
  errorMessage?: string;
}

export interface InstantiateResultRealmOptions {
  targetRealmUrl: string;
  client: BoxelCLIClient;
}

export interface CreateInstantiateResultOptions {
  sequenceNumber?: number;
  issueURL?: string;
  projectCardUrl?: string;
}

// ---------------------------------------------------------------------------
// Card lifecycle
// ---------------------------------------------------------------------------

/**
 * Create an `InstantiateResult` card with `status: running`.
 * Returns the card path as the handle.
 */
export async function createInstantiateResult(
  slug: string,
  instantiateResultsModuleUrl: string,
  options: InstantiateResultRealmOptions & CreateInstantiateResultOptions,
): Promise<{
  instantiateResultId: string;
  created: boolean;
  error?: string;
}> {
  let seq = options.sequenceNumber ?? 1;
  let instantiateResultId = `Validations/instantiate_${slug}-${seq}`;

  let document = buildInstantiateResultCardDocument(
    instantiateResultsModuleUrl,
    {
      sequenceNumber: seq,
      issueURL: options.issueURL,
      projectCardUrl: options.projectCardUrl,
    },
  );

  let result = await options.client.write(
    options.targetRealmUrl,
    `${instantiateResultId}.json`,
    JSON.stringify(document, null, 2),
  );

  if (!result.ok) {
    return { instantiateResultId, created: false, error: result.error };
  }

  return { instantiateResultId, created: true };
}

/**
 * Update an existing `InstantiateResult` card with instantiation results and final status.
 */
export async function completeInstantiateResult(
  instantiateResultId: string,
  attrs: InstantiateResultAttributes,
  options: InstantiateResultRealmOptions & { projectCardUrl?: string },
): Promise<{ updated: boolean; error?: string }> {
  let readResult = await options.client.read(
    options.targetRealmUrl,
    instantiateResultId,
  );

  if (!readResult.ok || !readResult.document) {
    return {
      updated: false,
      error: `Failed to read InstantiateResult: ${readResult.error}`,
    };
  }

  let document = readResult.document as unknown as LooseSingleCardDocument;
  let completionAttrs: Record<string, unknown> = {
    status: attrs.status,
    completedAt: new Date().toISOString(),
    durationMs: attrs.durationMs,
    cardResults: attrs.cardResults,
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

  let writeResult = await options.client.write(
    options.targetRealmUrl,
    `${instantiateResultId}.json`,
    JSON.stringify(document, null, 2),
  );

  if (!writeResult.ok) {
    return {
      updated: false,
      error: `Failed to update InstantiateResult: ${writeResult.error}`,
    };
  }

  return { updated: true };
}

/**
 * Build the initial card document for an InstantiateResult with `status: running`.
 */
export function buildInstantiateResultCardDocument(
  instantiateResultsModuleUrl: string,
  options?: CreateInstantiateResultOptions,
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
          module: instantiateResultsModuleUrl,
          name: 'InstantiateResult',
        },
      },
    },
  } as LooseSingleCardDocument;
}
