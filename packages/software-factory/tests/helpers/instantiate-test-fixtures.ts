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
 * Diagnostic gate: poll federated search until the just-seeded Spec card
 * surfaces as a Spec-type result, with a generous budget. `waitForFile`
 * only guarantees the file is GET-able; realm-side source POST indexing
 * is async, so there's a window where the file is readable but
 * `client.search({type: spec})` still returns an empty list. The
 * downstream `InstantiateValidationStep`'s 30s discovery poll has been
 * observed timing out in CI under load (the test falls into the
 * "modules exist but no Spec cards" branch, where `result.details` is
 * undefined, and the e2e assertion that triggered this skill's
 * investigation trips on it).
 *
 * Important: this gate is SOFT. If polling times out, we log a
 * diagnostic dump (current search hits, realm file listing, file
 * readability checks) and return — the test then proceeds to its real
 * assertions. The reason: CI evidence shows the realm sometimes never
 * surfaces the Spec for this fixture's containsMany card no matter how
 * long we wait (likely an indexer bug interacting with the broken
 * example's error_doc state). A hard gate just shifts the failure
 * upstream without adding information. The log it emits on the way out
 * is the real value here — pairs with the warn-log in
 * `InstantiateValidationStep` when its discovery poll also comes back
 * empty.
 */
async function awaitSpecSearchable(
  client: BoxelCLIClient,
  realmUrl: string,
  specPath: string,
): Promise<void> {
  let expectedSuffix = specPath.replace(/\.json$/, '');
  let totalWaitMs = 90_000;
  let startedAt = Date.now();
  let result = await retryWithPoll(
    () => client.search(realmUrl, { filter: { type: specRef } }),
    (r) => {
      if (!r.ok) return false;
      let found = (r.data ?? []).some((card) => {
        let id = (card as { id?: unknown }).id;
        return typeof id === 'string' && id.endsWith(expectedSuffix);
      });
      return !found;
    },
    { totalWaitMs, pollMs: 250 },
  );
  let elapsedMs = Date.now() - startedAt;

  if (!result.ok) {
    console.warn(
      `[awaitSpecSearchable] search for ${specPath} returned not-ok after ${elapsedMs}ms: ${result.error ?? '(no error message)'}`,
    );
    return;
  }
  let cardIds = (result.data ?? []).map(
    (c) => (c as { id?: unknown }).id ?? '(no id)',
  );
  let found = cardIds.some(
    (id) => typeof id === 'string' && id.endsWith(expectedSuffix),
  );
  if (found) {
    return;
  }

  // Soft-fail diagnostic dump. The test will likely fail downstream
  // when InstantiateValidationStep can't find the Spec either — at
  // which point this log shows the realm's actual state at the time
  // we gave up waiting.
  let readSpecFile = await client.read(realmUrl, specPath).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  }));
  let listing = await client.listFiles(realmUrl).catch((err) => ({
    filenames: [] as string[],
    error: err instanceof Error ? err.message : String(err),
  }));
  let specLikeFilenames = (listing.filenames ?? []).filter(
    (f) =>
      f.endsWith('.json') && (f.startsWith('Spec/') || f.includes('-spec')),
  );
  console.warn(
    `[awaitSpecSearchable] Spec ${specPath} did not surface in search within ${elapsedMs}ms. ` +
      `realm=${realmUrl} searchHits=${JSON.stringify(cardIds)} ` +
      `specSourceFileReadable=${(readSpecFile as { ok?: boolean }).ok ?? false} ` +
      `totalFiles=${(listing.filenames ?? []).length} ` +
      `specLikeFilenames=${JSON.stringify(specLikeFilenames)}` +
      ((listing as { error?: string }).error
        ? ` listFilesError=${(listing as { error?: string }).error}`
        : ''),
  );
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
  // Write the Spec BEFORE the bad example. Reordering was attempted to
  // give the indexer a stable Spec target; locally and in CI both
  // orderings produced the same flake (Spec never surfaces in search
  // within the budget), so the historic order stands and the
  // diagnostic gate below documents what we saw when it didn't.
  await writeAndAwaitIndex(
    client,
    realmUrl,
    'Spec/tags-card-spec.json',
    tagsCardSpecJson(),
  );
  await awaitSpecSearchable(client, realmUrl, 'Spec/tags-card-spec.json');
  await writeAndAwaitIndex(
    client,
    realmUrl,
    'TagsCard/bad-example.json',
    brokenTagsExampleJson(),
  );
}
