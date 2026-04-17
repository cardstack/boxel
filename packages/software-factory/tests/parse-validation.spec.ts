import { resolve } from 'node:path';

import { expect, test } from './fixtures';

import { readFile, writeFile, waitForRealmFile } from '../src/realm-operations';
import { ParseValidationStep } from '../src/validators/parse-step';
import type { ParseValidationDetails } from '../src/validators/parse-step';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

// A valid .gts card module — intentionally simple (no Component<typeof X>)
// to avoid BaseDef constraint errors that vary between CI and local type
// resolution environments.
const VALID_MODULE_GTS = `import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class ParseTestCard extends CardDef {
  static displayName = 'Parse Test Card';
  @field name = contains(StringField);
}
`;

// A .gts module with an unclosed template tag (GTS syntax error)
const BROKEN_TEMPLATE_GTS = `import {
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';

export class BrokenCard extends CardDef {
  static displayName = 'Broken Card';
  static isolated = class Isolated extends Component<typeof BrokenCard> {
    <template>
      <div>Hello world</div>
  };
}
`;

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

test.describe('parse-validation e2e', () => {
  test('ParseValidationStep e2e: valid GTS and valid JSON example pass', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let parseResultsModuleUrl = `${realmServerUrl}software-factory/parse-result`;

    // Write a valid card module
    let writeResult = await writeFile(
      realmUrl,
      'parse-test-card.gts',
      VALID_MODULE_GTS,
      { authorization },
    );
    expect(writeResult.ok).toBe(true);

    await waitForRealmFile(realmUrl, 'parse-test-card.gts', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    // Write a valid example instance
    let exampleDoc = {
      data: {
        type: 'card',
        attributes: { name: 'Valid Example' },
        meta: {
          adoptsFrom: {
            module: '../parse-test-card',
            name: 'ParseTestCard',
          },
        },
      },
    };
    let exampleWrite = await writeFile(
      realmUrl,
      'ParseTestCard/example-1.json',
      JSON.stringify(exampleDoc, null, 2),
      { authorization },
    );
    expect(exampleWrite.ok).toBe(true);

    await waitForRealmFile(realmUrl, 'ParseTestCard/example-1.json', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    // Write a Spec card linking to the example
    let specDoc = {
      data: {
        type: 'card',
        attributes: {
          specType: 'card',
          ref: {
            module: '../parse-test-card',
            name: 'ParseTestCard',
          },
        },
        relationships: {
          'linkedExamples.0': {
            links: { self: '../ParseTestCard/example-1' },
          },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/spec',
            name: 'Spec',
          },
        },
      },
    };
    let specWrite = await writeFile(
      realmUrl,
      'Spec/parse-test-spec.json',
      JSON.stringify(specDoc, null, 2),
      { authorization },
    );
    expect(specWrite.ok).toBe(true);

    await waitForRealmFile(realmUrl, 'Spec/parse-test-spec.json', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    // Scope to only the file we wrote — the fixture realm has pre-existing
    // .gts files that may produce glint errors in CI due to type resolution
    // differences. We only want to validate our test file.
    let step = new ParseValidationStep({
      authorization,
      fetch: globalThis.fetch,
      realmServerUrl,
      parseResultsModuleUrl,
      issueId: 'Issues/parse-e2e',
      fetchFilenames: async () => ({
        filenames: ['parse-test-card.gts', 'ParseTestCard/example-1.json'],
      }),
    });

    let result = await step.run(realmUrl);

    // Must pass — valid GTS + valid JSON example
    expect(result.step).toBe('parse');
    if (!result.passed) {
      console.log(
        'PARSE TEST 1 ERRORS:',
        JSON.stringify(result.errors.slice(0, 5), null, 2),
      );
    }
    expect(result.passed).toBe(true);
    expect(result.files).toBeTruthy();
    expect(result.files!.length).toBeGreaterThan(0);

    let details = result.details as unknown as ParseValidationDetails;
    expect(details).toBeTruthy();
    expect(details.parseResultId).toContain('Validations/parse_parse-e2e');
    expect(details.filesChecked).toBeGreaterThan(0);
    expect(details.filesWithErrors).toBe(0);

    // Read back the ParseResult card to verify persistence
    let cardRead = await readFile(realmUrl, details.parseResultId, {
      authorization,
    });
    expect(cardRead.ok).toBe(true);

    let attrs = cardRead.document?.data.attributes;
    expect(attrs).toBeTruthy();
    expect(attrs?.status).toBe('passed');
    expect(attrs?.sequenceNumber).toBe(1);
    expect(attrs?.completedAt).toBeTruthy();
  });

  test('ParseValidationStep e2e: broken GTS template syntax fails parse', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let parseResultsModuleUrl = `${realmServerUrl}software-factory/parse-result`;

    // Write a GTS file with an unclosed template tag
    let writeResult = await writeFile(
      realmUrl,
      'broken-card.gts',
      BROKEN_TEMPLATE_GTS,
      { authorization },
    );
    expect(writeResult.ok).toBe(true);

    await waitForRealmFile(realmUrl, 'broken-card.gts', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    // Scope to only the broken file we wrote
    let step = new ParseValidationStep({
      authorization,
      fetch: globalThis.fetch,
      realmServerUrl,
      parseResultsModuleUrl,
      issueId: 'Issues/parse-fail-e2e',
      fetchFilenames: async () => ({ filenames: ['broken-card.gts'] }),
    });

    let result = await step.run(realmUrl);

    // Must fail — unclosed template tag
    expect(result.step).toBe('parse');
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    // Check that the error references the broken file
    let brokenError = result.errors.find((e) =>
      e.message?.includes('broken-card.gts'),
    );
    expect(brokenError).toBeTruthy();

    let details = result.details as unknown as ParseValidationDetails;
    expect(details).toBeTruthy();
    expect(details.filesWithErrors).toBeGreaterThan(0);

    // Read back the ParseResult card to verify it was persisted as failed
    let cardRead = await readFile(realmUrl, details.parseResultId, {
      authorization,
    });
    expect(cardRead.ok).toBe(true);

    let attrs = cardRead.document?.data.attributes;
    expect(attrs).toBeTruthy();
    expect(attrs?.status).toBe('failed');
  });

  test('ParseValidationStep e2e: no files to validate passes vacuously (bootstrap)', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let parseResultsModuleUrl = `${realmServerUrl}software-factory/parse-result`;

    // Simulate a bootstrap scenario: no .gts files and no specs.
    // Inject empty file list so pre-existing fixture files don't interfere.
    let step = new ParseValidationStep({
      authorization,
      fetch: globalThis.fetch,
      realmServerUrl,
      parseResultsModuleUrl,
      issueId: 'Issues/parse-bootstrap-e2e',
      fetchFilenames: async () => ({ filenames: [] }),
      searchSpecsFn: async () => ({ specs: [] }),
    });

    let result = await step.run(realmUrl);

    // Nothing to validate → pass with no files checked, no artifact created
    expect(result.step).toBe('parse');
    expect(result.passed).toBe(true);
    expect(result.files).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
