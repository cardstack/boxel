import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// A grep-style guard that the superseded search scaffolding stays
// removed. The platform's search relationships live on `entry`, so the
// superseded in-place additions to the card resource and the old result mappers must
// not reappear. Each entry asserts a removed identifier is absent from the
// source file that used to define it.

const packagesDir = resolve(import.meta.dirname, '..', '..');

function source(relativePath: string): string {
  return readFileSync(resolve(packagesDir, relativePath), 'utf8');
}

const GUARDS: { file: string; forbidden: string[] }[] = [
  {
    // The `rendered-html` resource type, its on-`card` relationship, and the
    // identity-only marker — superseded by the `entry` → `html` / `item`
    // model.
    file: 'runtime-common/resource-types.ts',
    forbidden: ['RenderedHtmlResource', "'rendered-html'", 'identityOnly'],
  },
  {
    // The superseded result-mapper builders.
    file: 'runtime-common/search-resource-helpers.ts',
    forbidden: [
      'buildRenderedHtmlResource',
      'buildIdentityOnlyCard',
      'buildIdentityOnlyFileMeta',
    ],
  },
  {
    // The superseded shape predicates.
    file: 'runtime-common/card-document-shape.ts',
    forbidden: [
      'isRenderedHtmlResource',
      'isIdentityOnlyCardResource',
      'isIdentityOnlyFileMetaResource',
    ],
  },
  {
    // The `render` / `dataOnly` request surface on `/_search` — restored to its
    // original (live-card) contract.
    file: 'runtime-common/search-utils.ts',
    forbidden: [
      'parseUnifiedSearchRequest',
      'SearchRenderSpec',
      'UnifiedSearchOpts',
      'normalizeRenderSpec',
      'DEFAULT_RENDER_FORMAT',
    ],
  },
  {
    // The dead prefer-HTML mapper.
    file: 'runtime-common/realm-index-query-engine.ts',
    forbidden: ['searchUnified'],
  },
  {
    // The superseded federated document type — narrowed back to the original
    // `LinkableCollectionDocument`.
    file: 'runtime-common/document-types.ts',
    forbidden: [
      'UnifiedSearchCollectionDocument',
      'UnifiedSearchIncludedResource',
    ],
  },
  {
    // The `@field rendered-html` reserved-key guard and the deserializer skip.
    file: 'base/card-api.gts',
    forbidden: ['RenderedHtmlResourceType', 'reserved relationship key'],
  },
];

module(basename(import.meta.filename), function () {
  module('superseded search surfaces removed', function () {
    for (let { file, forbidden } of GUARDS) {
      test(`${file} carries no superseded search surface`, function (assert) {
        let contents = source(file);
        for (let token of forbidden) {
          assert.false(
            contents.includes(token),
            `${file} must not reference \`${token}\``,
          );
        }
      });
    }
  });
});
