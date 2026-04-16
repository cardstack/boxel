import { resolve } from 'node:path';

import { expect, test } from './fixtures';

import { readFile, writeFile, waitForRealmFile } from '../src/realm-operations';
import { InstantiateValidationStep } from '../src/validators/instantiate-step';
import type { InstantiateValidationDetails } from '../src/validators/instantiate-step';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

// A valid .gts card module that should instantiate successfully.
const VALID_MODULE_GTS = `import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class ValidCard extends CardDef {
  static displayName = 'Valid Card';
  @field name = contains(StringField);
}
`;

// A valid card module — evaluates fine.
const ANOTHER_VALID_MODULE_GTS = `import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class AnotherCard extends CardDef {
  static displayName = 'Another Card';
  @field title = contains(StringField);
}
`;

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

test.describe('instantiate-validation e2e', () => {
  test('InstantiateValidationStep e2e: card with spec and example instantiates successfully', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;
    let instantiateResultsModuleUrl = `${realmServerUrl}software-factory/instantiate-result`;

    // Write a valid card module
    let writeResult = await writeFile(
      realmUrl,
      'instantiate-test-card.gts',
      VALID_MODULE_GTS,
      { authorization },
    );
    expect(writeResult.ok).toBe(true);

    await waitForRealmFile(realmUrl, 'instantiate-test-card.gts', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    // Write an example instance card with relative adoptsFrom
    // (the step runner resolves to absolute before sending to host command)
    let exampleDoc = {
      data: {
        type: 'card',
        attributes: { name: 'Example Instance' },
        meta: {
          adoptsFrom: {
            module: '../instantiate-test-card',
            name: 'ValidCard',
          },
        },
      },
    };
    let exampleWrite = await writeFile(
      realmUrl,
      'ValidCard/example-1.json',
      JSON.stringify(exampleDoc, null, 2),
      { authorization },
    );
    expect(exampleWrite.ok).toBe(true);

    await waitForRealmFile(realmUrl, 'ValidCard/example-1.json', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    // Write a Spec card that points to the card module and links to the example
    let specDoc = {
      data: {
        type: 'card',
        attributes: {
          specType: 'card',
          ref: {
            module: '../instantiate-test-card',
            name: 'ValidCard',
          },
        },
        relationships: {
          'linkedExamples.0': {
            links: { self: '../ValidCard/example-1' },
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
      'Spec/valid-card-spec.json',
      JSON.stringify(specDoc, null, 2),
      { authorization },
    );
    expect(specWrite.ok).toBe(true);

    await waitForRealmFile(realmUrl, 'Spec/valid-card-spec.json', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    let step = new InstantiateValidationStep({
      authorization,
      serverToken,
      fetch: globalThis.fetch,
      realmServerUrl,
      instantiateResultsModuleUrl,
      issueId: 'Issues/instantiate-e2e',
    });

    let result = await step.run(realmUrl);

    // Must pass — valid card with valid example instance
    expect(result.step).toBe('instantiate');
    if (!result.passed) {
      console.log(
        'DEBUG: valid card failed:',
        JSON.stringify({ errors: result.errors, details: result.details }, null, 2),
      );
    }
    expect(result.passed).toBe(true);
    expect(result.files).toBeTruthy();
    expect(result.files!.length).toBeGreaterThan(0);

    let details = result.details as unknown as InstantiateValidationDetails;
    expect(details).toBeTruthy();
    expect(details.instantiateResultId).toContain(
      'Validations/instantiate_instantiate-e2e',
    );
    expect(details.cardsChecked).toBeGreaterThan(0);
    expect(details.cardsWithErrors).toBe(0);

    // Read back the InstantiateResult card to verify persistence
    let cardRead = await readFile(realmUrl, details.instantiateResultId, {
      authorization,
    });
    expect(cardRead.ok).toBe(true);

    let attrs = cardRead.document?.data.attributes;
    expect(attrs).toBeTruthy();
    expect(attrs?.status).toBe('passed');
    expect(attrs?.sequenceNumber).toBe(1);
    expect(attrs?.completedAt).toBeTruthy();
  });

  test('InstantiateValidationStep e2e: example with wrong adoptsFrom name fails instantiation', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;
    let instantiateResultsModuleUrl = `${realmServerUrl}software-factory/instantiate-result`;

    // Write a valid card module (evaluates fine)
    let cardWrite = await writeFile(
      realmUrl,
      'another-valid-card.gts',
      ANOTHER_VALID_MODULE_GTS,
      { authorization },
    );
    expect(cardWrite.ok).toBe(true);

    await waitForRealmFile(realmUrl, 'another-valid-card.gts', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    // Write an example instance whose adoptsFrom references a non-existent
    // class name in a valid module. The module evaluates fine (eval step passes)
    // but instantiation fails because 'NonExistentCard' isn't exported.
    let exampleDoc = {
      data: {
        type: 'card',
        attributes: { title: 'Bad Example' },
        meta: {
          adoptsFrom: {
            module: '../another-valid-card',
            name: 'NonExistentCard',
          },
        },
      },
    };
    let exampleWrite = await writeFile(
      realmUrl,
      'AnotherCard/bad-example.json',
      JSON.stringify(exampleDoc, null, 2),
      { authorization },
    );
    expect(exampleWrite.ok).toBe(true);

    await waitForRealmFile(realmUrl, 'AnotherCard/bad-example.json', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    // Write a Spec card pointing to the valid module but with a bad example
    let specDoc = {
      data: {
        type: 'card',
        attributes: {
          specType: 'card',
          ref: {
            module: '../another-valid-card',
            name: 'AnotherCard',
          },
        },
        relationships: {
          'linkedExamples.0': {
            links: { self: '../AnotherCard/bad-example' },
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
      'Spec/another-card-spec.json',
      JSON.stringify(specDoc, null, 2),
      { authorization },
    );
    expect(specWrite.ok).toBe(true);

    await waitForRealmFile(realmUrl, 'Spec/another-card-spec.json', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    let step = new InstantiateValidationStep({
      authorization,
      serverToken,
      fetch: globalThis.fetch,
      realmServerUrl,
      instantiateResultsModuleUrl,
      issueId: 'Issues/instantiate-fail-e2e',
    });

    let result = await step.run(realmUrl);

    // Must fail — example card references non-existent class name
    expect(result.step).toBe('instantiate');
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    let details = result.details as unknown as InstantiateValidationDetails;
    expect(details).toBeTruthy();
    expect(details.cardsWithErrors).toBeGreaterThan(0);

    // Read back the InstantiateResult card to verify it was persisted as failed
    let cardRead = await readFile(realmUrl, details.instantiateResultId, {
      authorization,
    });
    expect(cardRead.ok).toBe(true);

    let attrs = cardRead.document?.data.attributes;
    expect(attrs).toBeTruthy();
    expect(attrs?.status).toBe('failed');
  });
});
