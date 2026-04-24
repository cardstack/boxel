/**
 * Shared fixtures for instantiate-related Playwright specs —
 * `instantiate-validation.spec.ts` (validation pipeline + `InstantiateResult`
 * artifact) and `run-instantiate-in-memory.spec.ts` (in-memory `run_instantiate`
 * tool). Keeping the card modules, examples, and specs in one place ensures
 * the two surfaces are exercised against identical inputs.
 */
import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Card modules
// ---------------------------------------------------------------------------

/** A minimal valid .gts card that instantiates cleanly from `validExample()`. */
export const VALID_MODULE_GTS = `import {
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

/**
 * A card with a `containsMany` field. The module itself evaluates fine — but
 * instantiation fails when the linked example supplies a non-array value for
 * the field, which is what `brokenTagsExample()` below does.
 */
export const TAGS_CARD_MODULE_GTS = `import {
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

// ---------------------------------------------------------------------------
// Example instances and specs (JSON card documents)
// ---------------------------------------------------------------------------

/** A valid example instance for `ValidCard`. */
export function validExampleJson(): string {
  return JSON.stringify(
    {
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
    },
    null,
    2,
  );
}

/**
 * A broken example instance for `TagsCard` — supplies a plain string for a
 * `containsMany` field so instantiation surfaces a field-shape error.
 */
export function brokenTagsExampleJson(): string {
  return JSON.stringify(
    {
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
    },
    null,
    2,
  );
}

export function validCardSpecJson(): string {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          specType: 'card',
          ref: { module: '../instantiate-test-card', name: 'ValidCard' },
        },
        relationships: {
          'linkedExamples.0': { links: { self: '../ValidCard/example-1' } },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/spec',
            name: 'Spec',
          },
        },
      },
    },
    null,
    2,
  );
}

export function tagsCardSpecJson(): string {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          specType: 'card',
          ref: { module: '../tags-card', name: 'TagsCard' },
        },
        relationships: {
          'linkedExamples.0': { links: { self: '../TagsCard/bad-example' } },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/spec',
            name: 'Spec',
          },
        },
      },
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

/**
 * Write a file + await the realm's index to pick it up. Returns once the
 * file is visible to subsequent searches.
 */
async function writeAndAwaitIndex(
  client: BoxelCLIClient,
  realmUrl: string,
  path: string,
  content: string,
): Promise<void> {
  let writeResult = await client.write(realmUrl, path, content);
  expect(writeResult.ok, `write ${path} failed: ${writeResult.error}`).toBe(
    true,
  );
  let indexed = await client.waitForFile(realmUrl, path, {
    pollMs: 300,
    timeoutMs: 30_000,
  });
  expect(indexed, `waiting for ${path} to be indexed timed out`).toBe(true);
}

/**
 * Seed `instantiate-test-card.gts` + one linked example + a Spec that
 * instantiates cleanly.
 */
export async function seedValidCardWithSpec(
  client: BoxelCLIClient,
  realmUrl: string,
): Promise<void> {
  await writeAndAwaitIndex(
    client,
    realmUrl,
    'instantiate-test-card.gts',
    VALID_MODULE_GTS,
  );
  await writeAndAwaitIndex(
    client,
    realmUrl,
    'ValidCard/example-1.json',
    validExampleJson(),
  );
  await writeAndAwaitIndex(
    client,
    realmUrl,
    'Spec/valid-card-spec.json',
    validCardSpecJson(),
  );
}

/**
 * Seed `tags-card.gts` + the Spec (written first so it's indexed cleanly)
 * + the broken example. Instantiating the example surfaces a field-shape
 * error.
 */
export async function seedTagsCardWithBrokenExampleAndSpec(
  client: BoxelCLIClient,
  realmUrl: string,
): Promise<void> {
  await writeAndAwaitIndex(
    client,
    realmUrl,
    'tags-card.gts',
    TAGS_CARD_MODULE_GTS,
  );
  // Write the Spec BEFORE the bad example so it's indexed before the
  // example potentially stalls the indexer.
  await writeAndAwaitIndex(
    client,
    realmUrl,
    'Spec/tags-card-spec.json',
    tagsCardSpecJson(),
  );
  await writeAndAwaitIndex(
    client,
    realmUrl,
    'TagsCard/bad-example.json',
    brokenTagsExampleJson(),
  );
}
