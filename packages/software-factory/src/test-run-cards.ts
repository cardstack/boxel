import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import type {
  CreateTestRunOptions,
  TestModuleResultData,
  TestResultEntryData,
  TestRunAttributes,
  TestRunRealmOptions,
} from './test-run-types.ts';
import { readCard, writeCard } from './workspace-fs.ts';

/**
 * Create a `TestRun` card in the local workspace with `status: running`
 * and pre-populated `pending` result entries. Returns the card path as
 * the handle; the orchestrator syncs to the realm before subsequent steps.
 */
export async function createTestRun(
  slug: string,
  testNames: string[],
  options: TestRunRealmOptions & CreateTestRunOptions,
): Promise<{ testRunId: string; created: boolean; error?: string }> {
  let seq = options.sequenceNumber ?? 1;
  let testRunId = `Validations/test_${slug}-${seq}`;

  let document = buildTestRunCardDocument(
    testNames,
    options.testResultsModuleUrl,
    {
      sequenceNumber: seq,
      issueURL: options.issueURL,
      moduleRef: options.moduleRef,
      projectCardUrl: options.projectCardUrl,
    },
  );

  let result = await writeCard(
    options.workspaceDir,
    `${testRunId}.json`,
    JSON.stringify(document, null, 2),
  );

  if (!result.ok) {
    return { testRunId, created: false, error: result.error };
  }

  return { testRunId, created: true };
}

/**
 * Update an existing `TestRun` card in the local workspace with test
 * results and final status.
 */
export async function completeTestRun(
  testRunId: string,
  attrs: TestRunAttributes,
  options: TestRunRealmOptions & { projectCardUrl?: string },
): Promise<{ updated: boolean; error?: string }> {
  let readResult = await readCard(options.workspaceDir, `${testRunId}.json`);

  if (!readResult.ok || !readResult.document) {
    return {
      updated: false,
      error: `Failed to read TestRun: ${readResult.error ?? 'not found'}`,
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

  // Preserve the project relationship on update — fresh writes below.
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
    `${testRunId}.json`,
    JSON.stringify(document, null, 2),
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

  let moduleResults: TestModuleResultData[] = [
    {
      ...(options?.moduleRef ? { moduleRef: options.moduleRef } : {}),
      results,
    },
  ];

  let attributes: Record<string, unknown> = {
    sequenceNumber: options?.sequenceNumber ?? 1,
    runAt: new Date().toISOString(),
    status: 'running',
    moduleResults,
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
          module: testResultsModuleUrl,
          name: 'TestRun',
        },
      },
    },
  } as LooseSingleCardDocument;
}
