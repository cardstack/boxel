import { module, test } from 'qunit';

import {
  InstantiateValidationStep,
  type InstantiateValidationStepConfig,
  type InstantiateValidationDetails,
  type SpecInfo,
} from '../src/validators/instantiate-step.ts';
import { createMockClient } from './helpers/mock-client.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: Partial<InstantiateValidationStepConfig> = {},
): InstantiateValidationStepConfig {
  return {
    client: createMockClient(),
    realmServerUrl: 'https://example.test/',
    instantiateResultsModuleUrl: 'https://example.test/instantiate-result',
    workspaceDir: createTestWorkspace().dir,
    getNextSequenceNumber: async () => 1,
    ...overrides,
  };
}

function makeFetchFilenames(
  filenames: string[],
): (realmUrl: string) => Promise<{ filenames: string[]; error?: string }> {
  return async () => ({ filenames });
}

function makeSearchSpecs(
  specs: SpecInfo[],
): () => Promise<{ specs: SpecInfo[]; error?: string }> {
  return async () => ({ specs });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

module('InstantiateValidationStep', function () {
  test('spec with linkedExamples that all fail to read is a validation failure', async function (assert) {
    // A spec declares 2 linkedExamples but both fail to read (e.g., typoed paths).
    // The step should report this as a failure, NOT silently fall back to
    // empty-data instantiation.
    let instantiateCardCalled = false;

    // Mock client whose reads always fail — simulates missing linkedExamples.
    let failingFetch = (async () =>
      new Response('not found', { status: 404 })) as typeof globalThis.fetch;

    let step = new InstantiateValidationStep(
      makeConfig({
        client: createMockClient({ fetch: failingFetch }),
        fetchFilenames: makeFetchFilenames(['my-card.gts']),
        searchSpecsFn: makeSearchSpecs([
          {
            specId: 'Spec/my-card',
            moduleUrl: 'https://example.test/realm/my-card',
            cardName: 'MyCard',
            exampleUrls: ['MyCard/example-1', 'MyCard/example-2'],
          },
        ]),
        instantiateCardFn: async () => {
          instantiateCardCalled = true;
          return { passed: true };
        },
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed, 'step should fail');
    assert.ok(result.errors.length > 0, 'should have errors');
    assert.ok(
      result.errors[0].message.includes('failed to read'),
      'error mentions failed reads',
    );
    assert.false(
      instantiateCardCalled,
      'should NOT fall back to empty-data instantiation',
    );
  });

  test('spec with no linkedExamples falls back to empty-data instantiation', async function (assert) {
    // A spec has no linkedExamples at all — this is the legitimate fallback
    // case where we instantiate with no field data to verify the card class loads.
    let instantiateCardCalled = false;

    let step = new InstantiateValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['my-card.gts']),
        searchSpecsFn: makeSearchSpecs([
          {
            specId: 'Spec/my-card',
            moduleUrl: 'https://example.test/realm/my-card',
            cardName: 'MyCard',
            exampleUrls: [],
          },
        ]),
        instantiateCardFn: async () => {
          instantiateCardCalled = true;
          return { passed: true };
        },
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed, 'step should pass');
    assert.true(
      instantiateCardCalled,
      'should call instantiate with empty data',
    );

    let details = result.details as unknown as InstantiateValidationDetails;
    assert.strictEqual(details.cardsChecked, 1);
    assert.strictEqual(details.cardsWithErrors, 0);
  });
});
