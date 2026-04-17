import { resolve } from 'node:path';

import { expect, test } from './fixtures';

import { InstantiateValidationStep } from '../src/validators/instantiate-step';
import type { InstantiateValidationDetails } from '../src/validators/instantiate-step';
import { buildTestClient } from './helpers/test-client';

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

// A card with a containsMany field — evaluates fine, but instantiation
// should fail when the example provides a non-array value.
const TAGS_CARD_MODULE_GTS = `import {
  CardDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class TagsCard extends CardDef {
  static displayName = 'Tags Card';
  @field name = contains(StringField);
  @field tags = containsMany(StringField);
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

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl,
      realmServerToken: serverToken,
    });

    try {
      // Write a valid card module
      let writeResult = await client.write(
        realmUrl,
        'instantiate-test-card.gts',
        VALID_MODULE_GTS,
      );
      expect(writeResult.ok).toBe(true);

      await client.waitForFile(realmUrl, 'instantiate-test-card.gts', {
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
      let exampleWrite = await client.write(
        realmUrl,
        'ValidCard/example-1.json',
        JSON.stringify(exampleDoc, null, 2),
      );
      expect(exampleWrite.ok).toBe(true);

      await client.waitForFile(realmUrl, 'ValidCard/example-1.json', {
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
      let specWrite = await client.write(
        realmUrl,
        'Spec/valid-card-spec.json',
        JSON.stringify(specDoc, null, 2),
      );
      expect(specWrite.ok).toBe(true);

      await client.waitForFile(realmUrl, 'Spec/valid-card-spec.json', {
        pollMs: 300,
        timeoutMs: 30_000,
      });

      let step = new InstantiateValidationStep({
        client,
        realmServerUrl,
        instantiateResultsModuleUrl,
        issueId: 'Issues/instantiate-e2e',
      });

      let result = await step.run(realmUrl);

      // Must pass — valid card with valid example instance
      expect(result.step).toBe('instantiate');
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
      let cardRead = await client.read(realmUrl, details.instantiateResultId);
      expect(cardRead.ok).toBe(true);

      let attrs = (
        cardRead.document as unknown as {
          data?: { attributes?: Record<string, unknown> };
        }
      )?.data?.attributes;
      expect(attrs).toBeTruthy();
      expect(attrs?.status).toBe('passed');
      expect(attrs?.sequenceNumber).toBe(1);
      expect(attrs?.completedAt).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  test('InstantiateValidationStep e2e: containsMany with non-array value fails instantiation', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;
    let instantiateResultsModuleUrl = `${realmServerUrl}software-factory/instantiate-result`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl,
      realmServerToken: serverToken,
    });

    try {
      // Write a card with a containsMany field (evaluates fine)
      let cardWrite = await client.write(
        realmUrl,
        'tags-card.gts',
        TAGS_CARD_MODULE_GTS,
      );
      expect(cardWrite.ok).toBe(true);
      await client.waitForFile(realmUrl, 'tags-card.gts', {
        pollMs: 300,
        timeoutMs: 30_000,
      });

      // Write the Spec card FIRST (before the bad example) so it gets
      // indexed before the bad example potentially stalls the indexer.
      let specDoc = {
        data: {
          type: 'card',
          attributes: {
            specType: 'card',
            ref: {
              module: '../tags-card',
              name: 'TagsCard',
            },
          },
          relationships: {
            'linkedExamples.0': {
              links: { self: '../TagsCard/bad-example' },
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
      let specWrite = await client.write(
        realmUrl,
        'Spec/tags-card-spec.json',
        JSON.stringify(specDoc, null, 2),
      );
      expect(specWrite.ok).toBe(true);
      await client.waitForFile(realmUrl, 'Spec/tags-card-spec.json', {
        pollMs: 300,
        timeoutMs: 30_000,
      });

      // Now write the bad example (after the Spec is indexed)
      let exampleDoc = {
        data: {
          type: 'card',
          attributes: {
            name: 'Bad Tags Card',
            tags: 'not-an-array',
          },
          meta: {
            adoptsFrom: {
              module: '../tags-card',
              name: 'TagsCard',
            },
          },
        },
      };
      let exampleWrite = await client.write(
        realmUrl,
        'TagsCard/bad-example.json',
        JSON.stringify(exampleDoc, null, 2),
      );
      expect(exampleWrite.ok).toBe(true);
      await client.waitForFile(realmUrl, 'TagsCard/bad-example.json', {
        pollMs: 300,
        timeoutMs: 30_000,
      });

      let step = new InstantiateValidationStep({
        client,
        realmServerUrl,
        instantiateResultsModuleUrl,
        issueId: 'Issues/instantiate-fail-e2e',
      });

      let result = await step.run(realmUrl);

      // Must fail — containsMany field received a string instead of an array
      expect(result.step).toBe('instantiate');
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      let details = result.details as unknown as InstantiateValidationDetails;
      expect(details).toBeTruthy();
      expect(details.cardsWithErrors).toBeGreaterThan(0);

      // Read back the InstantiateResult card to verify it was persisted as failed
      let cardRead = await client.read(realmUrl, details.instantiateResultId);
      expect(cardRead.ok).toBe(true);

      let attrs = (
        cardRead.document as unknown as {
          data?: { attributes?: Record<string, unknown> };
        }
      )?.data?.attributes;
      expect(attrs).toBeTruthy();
      expect(attrs?.status).toBe('failed');
    } finally {
      cleanup();
    }
  });
});
