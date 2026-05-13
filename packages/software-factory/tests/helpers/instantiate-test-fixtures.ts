/**
 * Shared fixtures for instantiate-related Playwright specs —
 * `instantiate-validation.spec.ts` (validation pipeline + `InstantiateResult`
 * artifact) and `run-instantiate-in-memory.spec.ts` (in-memory `run_instantiate`
 * tool). Keeping the card modules, examples, and specs in one place ensures
 * the two surfaces are exercised against identical inputs.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { specRef } from '@cardstack/runtime-common/constants';
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
 * Stage the given files in a fresh temp dir and push them to the realm
 * with `client.sync(..., { preferLocal: true, waitForIndex: true })`.
 * The `_atomic` upload appends `?waitForIndex=true`, so the realm-server
 * returns only after the indexer has processed every uploaded file.
 *
 * Why this shape instead of per-file `client.write` + a search-poll
 * gate: realm-side source POST indexing is async, so writing files
 * one-by-one and waiting for the realm to ack with GET (or for the
 * downstream `_federated-search` to surface them) is a polling race —
 * which is exactly the flake this skill was filed to address. CI
 * evidence on PR #4782 (run 25768256725) showed even a 90s poll
 * sometimes never sees the Spec surface in search. The `_atomic`
 * waitForIndex query param is the realm-server's first-class hook for
 * read-after-write consistency in tests; using it here trades a
 * one-shot push latency for a deterministic "indexer is settled"
 * boundary.
 */
async function seedFilesAndWaitForIndex(
  client: BoxelCLIClient,
  realmUrl: string,
  files: { path: string; content: string }[],
): Promise<void> {
  let stagingDir = mkdtempSync(join(tmpdir(), 'sf-instantiate-seed-'));
  try {
    for (let { path, content } of files) {
      let absolute = join(stagingDir, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    let syncResult = await client.sync(realmUrl, stagingDir, {
      preferLocal: true,
      waitForIndex: true,
    });
    expect(
      syncResult.hasError,
      `seed sync to ${realmUrl} reported an error: ${syncResult.error ?? '(no error message)'}`,
    ).toBe(false);
    console.log(
      `[seedFilesAndWaitForIndex] realm=${realmUrl} pushed=${JSON.stringify(syncResult.pushed)} skipped=${JSON.stringify(syncResult.skippedConflicts)}`,
    );
    // Confirm the realm sees the freshly-seeded Spec in search before
    // returning. waitForIndex on `_atomic` returns once `performIndex()`
    // resolves, but the test fixture's `_federated-search` callers
    // sometimes still get an empty list immediately after — log what
    // the realm actually has under those conditions.
    let listing = await client.listFiles(realmUrl).catch((err) => ({
      filenames: [] as string[],
      error: err instanceof Error ? err.message : String(err),
    }));
    let search = await client
      .search(realmUrl, { filter: { type: specRef } })
      .catch((err) => ({
        ok: false,
        data: undefined,
        error: err instanceof Error ? err.message : String(err),
      }));
    let cardIds = (search.data ?? []).map(
      (c) => (c as { id?: unknown }).id ?? '(no id)',
    );
    console.log(
      `[seedFilesAndWaitForIndex] post-sync state: realmFiles=${JSON.stringify(listing.filenames ?? [])} ` +
        `searchOk=${search.ok ?? false} specHits=${JSON.stringify(cardIds)}`,
    );
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

/**
 * Seed `instantiate-test-card.gts` + one linked example + a Spec that
 * instantiates cleanly.
 */
export async function seedValidCardWithSpec(
  client: BoxelCLIClient,
  realmUrl: string,
): Promise<void> {
  await seedFilesAndWaitForIndex(client, realmUrl, [
    { path: 'instantiate-test-card.gts', content: VALID_MODULE_GTS },
    { path: 'ValidCard/example-1.json', content: validExampleJson() },
    { path: 'Spec/valid-card-spec.json', content: validCardSpecJson() },
  ]);
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
  await seedFilesAndWaitForIndex(client, realmUrl, [
    { path: 'tags-card.gts', content: TAGS_CARD_MODULE_GTS },
    { path: 'TagsCard/bad-example.json', content: brokenTagsExampleJson() },
    { path: 'Spec/tags-card-spec.json', content: tagsCardSpecJson() },
  ]);
}
