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

// A FieldDef — evaluates fine on its own.
const PHONE_NUMBER_FIELD_GTS = `import {
  FieldDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class PhoneNumber extends FieldDef {
  static displayName = 'Phone Number';
  @field number = contains(StringField);
}
`;

// A card that uses linksTo with a FieldDef. The module evaluates fine
// (eval step passes) but instantiation fails when the example instance
// provides a linked phone value — linksTo expects a CardDef, not a FieldDef.
const BAD_LINKS_TO_MODULE_GTS = `import {
  CardDef,
  field,
  linksTo,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { PhoneNumber } from './phone-number-field';

export class ContactCard extends CardDef {
  static displayName = 'Contact Card';
  @field name = contains(StringField);
  @field phone = linksTo(PhoneNumber);
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

  test('InstantiateValidationStep e2e: linksTo consuming a FieldDef fails instantiation', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;
    let instantiateResultsModuleUrl = `${realmServerUrl}software-factory/instantiate-result`;

    // Write the FieldDef module (evaluates fine on its own)
    let fieldWrite = await writeFile(
      realmUrl,
      'phone-number-field.gts',
      PHONE_NUMBER_FIELD_GTS,
      { authorization },
    );
    expect(fieldWrite.ok).toBe(true);
    await waitForRealmFile(realmUrl, 'phone-number-field.gts', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    // Write the card with linksTo(FieldDef) — evaluates fine
    let cardWrite = await writeFile(
      realmUrl,
      'bad-contact-card.gts',
      BAD_LINKS_TO_MODULE_GTS,
      { authorization },
    );
    expect(cardWrite.ok).toBe(true);
    await waitForRealmFile(realmUrl, 'bad-contact-card.gts', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    // Write a PhoneNumber instance to link to
    let phoneDoc = {
      data: {
        type: 'card',
        attributes: { number: '555-1234' },
        meta: {
          adoptsFrom: {
            module: '../phone-number-field',
            name: 'PhoneNumber',
          },
        },
      },
    };
    let phoneWrite = await writeFile(
      realmUrl,
      'PhoneNumber/phone-1.json',
      JSON.stringify(phoneDoc, null, 2),
      { authorization },
    );
    expect(phoneWrite.ok).toBe(true);
    await waitForRealmFile(realmUrl, 'PhoneNumber/phone-1.json', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    // Write an example instance that links to the PhoneNumber instance
    let exampleDoc = {
      data: {
        type: 'card',
        attributes: { name: 'Bad Contact' },
        relationships: {
          phone: {
            links: { self: '../PhoneNumber/phone-1' },
          },
        },
        meta: {
          adoptsFrom: {
            module: '../bad-contact-card',
            name: 'ContactCard',
          },
        },
      },
    };
    let exampleWrite = await writeFile(
      realmUrl,
      'ContactCard/example-1.json',
      JSON.stringify(exampleDoc, null, 2),
      { authorization },
    );
    expect(exampleWrite.ok).toBe(true);
    await waitForRealmFile(realmUrl, 'ContactCard/example-1.json', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });

    // Write a Spec card pointing to the bad card def
    let specDoc = {
      data: {
        type: 'card',
        attributes: {
          specType: 'card',
          ref: {
            module: '../bad-contact-card',
            name: 'ContactCard',
          },
        },
        relationships: {
          'linkedExamples.0': {
            links: { self: '../ContactCard/example-1' },
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
      'Spec/contact-card-spec.json',
      JSON.stringify(specDoc, null, 2),
      { authorization },
    );
    expect(specWrite.ok).toBe(true);
    await waitForRealmFile(realmUrl, 'Spec/contact-card-spec.json', {
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

    // Must fail — linksTo with FieldDef is a semantic error caught at instantiation
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
