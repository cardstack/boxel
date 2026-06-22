import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// A grep-style guard that the superseded pre-v2 unified-search surfaces stay
// removed. The platform's search relationships live on `search-entry` (v2), the
// existing endpoints keep their original contracts through the compat layer,
// and a card needs no reserved-key guard — so the pre-v2 in-place additions to
// `/_search` and the card resource must not reappear. Each entry asserts a
// removed identifier is absent from the source file that used to define it.
//
// (The prerendered compat machinery — `IndexQueryEngine.searchPrerendered`, the
// `kind: 'render'` SQL projection, `<PrerenderedCardSearch>` — is intentionally
// out of scope here; it is retired separately when the legacy endpoints are.)

const packagesDir = resolve(import.meta.dirname, '..', '..');

function source(relativePath: string): string {
  return readFileSync(resolve(packagesDir, relativePath), 'utf8');
}

const GUARDS: { file: string; forbidden: string[] }[] = [
  {
    // The `rendered-html` resource type, its on-`card` relationship, and the
    // identity-only marker — superseded by the `search-entry` → `html` / `item`
    // model.
    file: 'runtime-common/resource-types.ts',
    forbidden: ['RenderedHtmlResource', "'rendered-html'", 'identityOnly'],
  },
  {
    // The pre-v2 result-mapper builders.
    file: 'runtime-common/unified-search.ts',
    forbidden: [
      'buildRenderedHtmlResource',
      'buildIdentityOnlyCard',
      'buildIdentityOnlyFileMeta',
    ],
  },
  {
    // The pre-v2 shape predicates.
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
    // The pre-v2 federated document type — narrowed back to the original
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
  module('pre-v2 search surfaces removed', function () {
    for (let { file, forbidden } of GUARDS) {
      test(`${file} carries no pre-v2 search surface`, function (assert) {
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
