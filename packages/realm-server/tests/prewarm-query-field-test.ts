import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { rri } from '@cardstack/runtime-common';
import { setupPermissionedRealmsCached } from './helpers/index.ts';

// The module pre-warm exists so that when a card's query-backed field renders,
// the mid-render `lookupDefinition` for a *string-referenced* sibling type is
// already cached — otherwise it would spawn a same-affinity sub-prerender that
// can stall the tab pool. This test proves the from-scratch prerender job's
// sweep warms exactly that kind of module.
//
// `widget.gts` defines `Widget`, but nothing adopts it (no instances) and no
// module imports it — `gallery.gts` references it only by a string module URL
// inside its query-backed field's `on` filter. So every other caching path is
// closed: instance indexing never touches it (there are no Widget instances,
// and the index visit skips query fields), and the prerender search runs
// cache-only (it never populates on a miss). The realm-wide `.gts` sweep the
// prerender job runs before its format renders is the *only* thing that can
// land `Widget` in the `modules` cache — so its presence there after a
// from-scratch is a clean signal the sweep warmed the query-consumed module.
module(basename(import.meta.filename), function () {
  module('prerender pre-warm — query-backed field target', function (hooks) {
    let realmURL = 'http://127.0.0.1:4459/prewarm-query/';
    let testUserId = '@user1:localhost';
    let dbAdapter: PgAdapter;

    let widgetAliases = [`${realmURL}widget`, `${realmURL}widget.gts`];

    async function widgetIsCached(): Promise<boolean> {
      let rows = (await dbAdapter.execute(
        `SELECT url FROM modules WHERE url = ANY($1) OR file_alias = ANY($1)`,
        { bind: [widgetAliases] },
      )) as { url: string }[];
      return rows.length > 0;
    }

    setupPermissionedRealmsCached(hooks, {
      realms: [
        {
          realmURL,
          permissions: {
            '*': ['read'],
            [testUserId]: ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            // The query target: a CardDef with no instances, imported by
            // nothing. Only the realm-wide sweep can warm its definition.
            'widget.gts': `
              import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';
              export class Widget extends CardDef {
                static displayName = 'Widget';
                @field label = contains(StringField);
                static isolated = class extends Component<typeof this> {
                  <template><span data-test-widget-label>{{@model.label}}</span></template>
                };
              }
            `,
            // The consumer: a query-backed field whose filter references Widget
            // only by a string module URL (never a static import), matching the
            // sibling-module pattern the pre-warm protects. `on` + a field
            // predicate forces the query compiler to resolve Widget's
            // definition (its `label` field) at render time.
            'gallery.gts': `
              import { CardDef, Component } from '@cardstack/base/card-api';
              export class Gallery extends CardDef {
                static displayName = 'Gallery';
                static isolated = class extends Component<typeof this> {
                  get query() {
                    return {
                      filter: {
                        on: {
                          module: new URL('./widget', import.meta.url).href,
                          name: 'Widget',
                        },
                        eq: { label: 'no-such-widget' },
                      },
                      realms: [new URL('./', import.meta.url).href],
                    };
                  }
                  <template>
                    <div data-test-gallery-host-ran>gallery ran</div>
                    {{#if @context.searchResultsComponent}}
                      <@context.searchResultsComponent @query={{this.query}} @mode='none' />
                    {{/if}}
                  </template>
                };
              }
            `,
            'gallery-1.json': {
              data: {
                meta: {
                  adoptsFrom: {
                    module: rri('./gallery'),
                    name: 'Gallery',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup({ dbAdapter: setupDbAdapter }) {
        dbAdapter = setupDbAdapter;
      },
    });

    test('the prerender sweep warms the module a query-backed field references by string', async function (assert) {
      // The realm was from-scratch indexed during setup; the spawned prerender
      // job ran the realm-wide sweep. Widget is reachable only through that
      // sweep, so its presence in the cache is proof the sweep warmed the
      // query-consumed module.
      assert.true(
        await widgetIsCached(),
        'the prerender pre-warm sweep cached the query-backed field target module',
      );
    });
  });
});
