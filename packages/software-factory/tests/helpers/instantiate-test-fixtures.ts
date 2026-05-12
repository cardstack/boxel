/**
 * Shared fixtures for instantiate-related Playwright specs —
 * `instantiate-validation.spec.ts` (validation pipeline + `InstantiateResult`
 * artifact) and `run-instantiate-in-memory.spec.ts` (in-memory `run_instantiate`
 * tool). Keeping the card modules, examples, and specs in one place ensures
 * the two surfaces are exercised against identical inputs.
 */
import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { specRef } from '@cardstack/runtime-common/constants';
import { expect } from '@playwright/test';

import { retryWithPoll } from '../../src/retry-with-poll';

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
 * Write a file + await the realm to ack it back via GET. The file is
 * readable here, but realm-side search-index ingestion happens out-of-band
 * — `awaitSpecSearchable` covers that separately for the Spec card the
 * downstream `InstantiateValidationStep` queries for.
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
 * Poll the realm's federated search until the just-seeded Spec card surfaces
 * as a Spec-type result. `waitForFile` only guarantees the source file is
 * GET-able; the realm runs source POST indexing asynchronously, so there is
 * a window where the file is readable but `client.search({type: spec})`
 * still returns an empty list. Without this gate the downstream
 * `InstantiateValidationStep`'s 30s discovery poll has been observed
 * timing out in CI under load (the test falls into the "modules exist but
 * no Spec cards" branch, where `result.details` is undefined). The
 * 60s budget here gives the realm headroom even when its indexer is
 * queued behind from-scratch index work from test setup.
 */
async function awaitSpecSearchable(
  client: BoxelCLIClient,
  realmUrl: string,
  specPath: string,
): Promise<void> {
  let expectedSuffix = specPath.replace(/\.json$/, '');
  let lastResult: Awaited<ReturnType<typeof client.search>> | undefined;
  let result = await retryWithPoll(
    async () => {
      lastResult = await client.search(realmUrl, {
        filter: { type: specRef },
      });
      return lastResult;
    },
    (r) => {
      if (!r.ok) return false;
      let found = (r.data ?? []).some((card) => {
        let id = (card as { id?: unknown }).id;
        return typeof id === 'string' && id.endsWith(expectedSuffix);
      });
      return !found;
    },
    { totalWaitMs: 60_000, pollMs: 250 },
  );
  expect(
    result.ok,
    `search for Spec at ${specPath} failed: ${result.error}`,
  ).toBe(true);
  let cardIds = (result.data ?? []).map(
    (c) => (c as { id?: unknown }).id ?? '(no id)',
  );
  expect(
    cardIds.some((id) => typeof id === 'string' && id.endsWith(expectedSuffix)),
    `Spec ${specPath} did not show up in search within 60s; got: ${JSON.stringify(cardIds)}`,
  ).toBe(true);
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
  await awaitSpecSearchable(client, realmUrl, 'Spec/valid-card-spec.json');
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
  // Gate on the Spec actually appearing in search results before we drop
  // the broken example. The broken example deliberately fails indexing
  // (containsMany received a string), and a still-queued realm indexer
  // can keep the Spec out of search results past `discoverRealmSpecs`'s
  // own 30s poll budget — that is the historical flake.
  await awaitSpecSearchable(client, realmUrl, 'Spec/tags-card-spec.json');
  await writeAndAwaitIndex(
    client,
    realmUrl,
    'TagsCard/bad-example.json',
    brokenTagsExampleJson(),
  );
}
