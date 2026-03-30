import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import { readCardSource, writeCardSource } from './realm-operations';
import type {
  CreateTestRunOptions,
  TestResultEntryData,
  TestRunAttributes,
  TestRunRealmOptions,
} from './test-run-types';

/**
 * Create a `TestRun` card with `status: running` and pre-populated
 * `pending` result entries. Returns the card path as the handle.
 */
export async function createTestRun(
  slug: string,
  testNames: string[],
  options: TestRunRealmOptions & CreateTestRunOptions,
): Promise<{ testRunId: string; created: boolean; error?: string }> {
  let seq = options.sequenceNumber ?? 1;
  let testRunId = `Test Runs/${slug}-${seq}`;

  let document = buildTestRunCardDocument(
    testNames,
    options.testResultsModuleUrl,
    {
      sequenceNumber: seq,
      ticketURL: options.ticketURL,
      specRef: options.specRef,
    },
  );

  let result = await writeCardSource(
    options.testRealmUrl,
    `${testRunId}.json`,
    document,
    { authorization: options.authorization, fetch: options.fetch },
  );

  if (!result.ok) {
    return { testRunId, created: false, error: result.error };
  }

  return { testRunId, created: true };
}

/**
 * Update an existing `TestRun` card with test results and final status.
 */
export async function completeTestRun(
  testRunId: string,
  attrs: TestRunAttributes,
  options: TestRunRealmOptions,
): Promise<{ updated: boolean; error?: string }> {
  let fetchOptions = {
    authorization: options.authorization,
    fetch: options.fetch,
  };

  let readResult = await readCardSource(
    options.testRealmUrl,
    testRunId,
    fetchOptions,
  );

  if (!readResult.ok || !readResult.document) {
    return {
      updated: false,
      error: `Failed to read TestRun: ${readResult.error}`,
    };
  }

  let completionAttrs: Record<string, unknown> = {
    status: attrs.status,
    completedAt: new Date().toISOString(),
    durationMs: attrs.durationMs,
    results: attrs.results,
  };
  if (attrs.errorMessage) {
    completionAttrs.errorMessage = attrs.errorMessage;
  }

  readResult.document.data.attributes = {
    ...readResult.document.data.attributes,
    ...completionAttrs,
  };

  let writeResult = await writeCardSource(
    options.testRealmUrl,
    `${testRunId}.json`,
    readResult.document,
    fetchOptions,
  );

  if (!writeResult.ok) {
    return {
      updated: false,
      error: `Failed to update TestRun: ${writeResult.error}`,
    };
  }

  return { updated: true };
}

/**
 * Build the initial card document for a TestRun with `status: running`
 * and pre-populated `pending` result entries.
 */
export function buildTestRunCardDocument(
  testNames: string[],
  testResultsModuleUrl: string,
  options?: CreateTestRunOptions,
): LooseSingleCardDocument {
  let results: TestResultEntryData[] = testNames.map((name) => ({
    testName: name,
    status: 'pending' as const,
  }));

  let attributes: Record<string, unknown> = {
    sequenceNumber: options?.sequenceNumber ?? 1,
    runAt: new Date().toISOString(),
    status: 'running',
    results,
  };

  if (options?.specRef) {
    attributes.specRef = options.specRef;
  }

  let relationships:
    | Record<string, { links: { self: string | null } }>
    | undefined;
  if (options?.projectCardUrl || options?.ticketURL) {
    relationships = {};
    if (options?.projectCardUrl) {
      relationships.project = { links: { self: options.projectCardUrl } };
    }
    if (options?.ticketURL) {
      relationships.ticket = { links: { self: options.ticketURL } };
    }
  }

  return {
    data: {
      type: 'card',
      attributes,
      ...(relationships ? { relationships } : {}),
      meta: {
        adoptsFrom: {
          module: testResultsModuleUrl,
          name: 'TestRun',
        },
      },
    },
  } as LooseSingleCardDocument;
}
