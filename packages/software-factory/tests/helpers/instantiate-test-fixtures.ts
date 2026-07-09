/**
 * Shared fixtures for instantiate-related Playwright specs —
 * `instantiate-validation.spec.ts` (validation pipeline + `InstantiateResult`
 * artifact) and `run-instantiate-in-memory.spec.ts` (in-memory `run_instantiate`
 * tool). Keeping the card modules, examples, and specs in one place ensures
 * the two surfaces are exercised against identical inputs.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

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
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

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
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

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

/**
 * A well-formed `TagsCard` example with an empty tags array. Seeded to
 * the realm so the indexer's `linkedExamples` walk on the Spec succeeds
 * cleanly and the Spec actually surfaces in `_federated-search`. The
 * test then overwrites the *workspace* copy with `brokenTagsExampleJson`
 * before the validation step reads it — the bad shape never reaches
 * realm-side indexing.
 */
export function validTagsExampleJson(): string {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          name: 'Tags Card Placeholder',
          tags: [],
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
            module: '@cardstack/base/spec',
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
            module: '@cardstack/base/spec',
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
  for (let { path } of files) {
    if (isAbsolute(path) || path.split('/').includes('..')) {
      throw new Error(
        `seedFilesAndWaitForIndex path must be a realm-relative path under the staging dir; got ${JSON.stringify(path)}`,
      );
    }
  }

  // Retry the sync once on failure. The realm-server's /_atomic
  // endpoint can return 500 ("Write Error") for transient causes —
  // for example a concurrent indexing pass or a worker-side
  // fileSerialization that doesn't recur on retry — and a one-shot
  // retry with a short backoff lets the helper recover instead of
  // surfacing the failure as a confusing test flake.
  //
  // Each attempt uses a fresh staging dir: `RealmSyncer` writes
  // `.boxel-sync.json` even when the batch failed, recording hashes
  // for the staged files. A retry against the same dir would see
  // those hashes match the (unchanged) local files, classify the
  // entries as "unchanged locally / deleted remotely" (since the
  // failed batch never actually wrote them), and with `preferLocal:
  // true` resolve as a noop — silently skipping the upload while
  // reporting success. Fresh dir = no stale manifest = honest
  // re-upload on attempt 2.
  const maxAttempts = 2;
  let syncResult: Awaited<ReturnType<typeof client.sync>> | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let stagingDir = mkdtempSync(join(tmpdir(), 'sf-instantiate-seed-'));
    try {
      for (let { path, content } of files) {
        let absolute = join(stagingDir, path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, content);
      }
      syncResult = await client.sync(realmUrl, stagingDir, {
        preferLocal: true,
        waitForIndex: true,
      });
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
    if (!syncResult.hasError) {
      if (attempt > 1) {
        console.log(
          `seedFilesAndWaitForIndex: sync succeeded on attempt ${attempt}/${maxAttempts} for ${realmUrl}`,
        );
      }
      break;
    }
    console.log(
      `seedFilesAndWaitForIndex: sync attempt ${attempt}/${maxAttempts} for ${realmUrl} failed: ${
        syncResult.error ?? '(no error message)'
      }`,
    );
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  expect(
    syncResult!.hasError,
    `seed sync to ${realmUrl} reported an error after ${maxAttempts} attempt(s): ${
      syncResult!.error ?? '(no error message)'
    }`,
  ).toBe(false);
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
 * A support module shaped like the ones catalog cards ship: a plain
 * Glimmer component plus a helper function — neither is a CardDef.
 */
export const CHART_COMPONENT_MODULE_GTS = `import GlimmerComponent from '@glimmer/component';

export class ChartComponent extends GlimmerComponent {
  <template>
    <div>chart</div>
  </template>
}

export function formatChartLabel(value: number): string {
  return String(value);
}
`;

/** A component Spec — references a Glimmer component, not a CardDef. */
export function componentSpecJson(): string {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          specType: 'component',
          ref: { module: '../chart-component', name: 'ChartComponent' },
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

/** A command Spec — references a plain function export, not a CardDef. */
export function commandSpecJson(): string {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          specType: 'command',
          ref: { module: '../chart-component', name: 'formatChartLabel' },
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

/**
 * Seed the valid card + example + card Spec alongside a component
 * module with component and command Specs — the mix a catalog card
 * seeded by `boxel realm pull` (rather than `ingest-card`) presents to
 * the instantiate validator.
 */
export async function seedValidCardWithMixedSpecs(
  client: BoxelCLIClient,
  realmUrl: string,
): Promise<void> {
  await seedFilesAndWaitForIndex(client, realmUrl, [
    { path: 'instantiate-test-card.gts', content: VALID_MODULE_GTS },
    { path: 'ValidCard/example-1.json', content: validExampleJson() },
    { path: 'Spec/valid-card-spec.json', content: validCardSpecJson() },
    { path: 'chart-component.gts', content: CHART_COMPONENT_MODULE_GTS },
    { path: 'Spec/chart-component-spec.json', content: componentSpecJson() },
    { path: 'Spec/format-chart-label-spec.json', content: commandSpecJson() },
  ]);
}

/**
 * Seed `tags-card.gts`, a well-formed `TagsCard/bad-example.json`, and
 * a Spec linking to that file. The realm-side example is intentionally
 * the WELL-FORMED placeholder (`validTagsExampleJson`) — the test
 * substitutes the broken shape into the workspace copy after
 * `client.pull` via `overwriteTagsExampleWithBadShape`.
 *
 * Why this two-step shape: the realm indexer drops a Spec from
 * `_federated-search` whenever its `linkedExamples` `loadLinks` walk
 * can't resolve a target — either the file is missing entirely or the
 * card is in error_doc state. Writing the broken `containsMany` shape
 * straight to the realm puts the example in error_doc and silently
 * disqualifies the Spec from search, which is the original flake this
 * skill chased. The validation pipeline reads example JSON from the
 * workspace path (not the realm index), so the bad shape only needs
 * to live in the workspace at the moment the step reads it.
 */
export async function seedTagsCardWithBrokenExampleAndSpec(
  client: BoxelCLIClient,
  realmUrl: string,
): Promise<void> {
  await seedFilesAndWaitForIndex(client, realmUrl, [
    { path: 'tags-card.gts', content: TAGS_CARD_MODULE_GTS },
    { path: 'TagsCard/bad-example.json', content: validTagsExampleJson() },
    { path: 'Spec/tags-card-spec.json', content: tagsCardSpecJson() },
  ]);
}

/**
 * Overwrite the workspace copy of `TagsCard/bad-example.json` with the
 * broken-shape data the test actually wants to exercise. Call after
 * `client.pull` (so the pull doesn't immediately overwrite this) and
 * before constructing the validation step / running runInstantiate. See
 * `seedTagsCardWithBrokenExampleAndSpec` for why the realm-side copy
 * stays well-formed.
 */
export function overwriteTagsExampleWithBadShape(workspaceDir: string): void {
  let absolute = join(workspaceDir, 'TagsCard', 'bad-example.json');
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, brokenTagsExampleJson());
}
