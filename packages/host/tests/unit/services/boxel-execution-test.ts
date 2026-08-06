import Service from '@ember/service';

import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import type BoxelExecutionService from '@cardstack/host/services/boxel-execution';

import type { BaseDef } from '@cardstack/base/card-api';

// The `css` resources returned by the store encode their whole stylesheet in
// the href (`decodeScopedCSSRequest` in `@cardstack/runtime-common`); a real
// href always ends in `.glimmer-scoped.css` with the compiled CSS base64'd
// into the preceding path segment. Build one exactly like the compiler does.
function scopedCSSHref(css: string): string {
  return `https://realm.example/card.gts.${encodeURIComponent(btoa(css))}.glimmer-scoped.css`;
}

module('Unit | Service | boxel-execution', function (hooks) {
  setupTest(hooks);

  test('uses scoped server prerender as an inert execution placeholder', async function (assert) {
    let formats: string[] = [];
    let imported: string[] = [];
    let cssHref = scopedCSSHref(
      '.card[data-scopedcss-card-template] { color: teal; }',
    );

    class MockStore extends Service {
      async fetchCardEntry(_url: string, opts: { format?: string }) {
        formats.push(opts.format ?? '');
        let htmlId = `card#${opts.format}`;
        let hasRendering = opts.format === 'embedded';
        return {
          notModified: false as const,
          doc: {
            data: {
              type: 'entry',
              id: 'https://realm.example/Card/one',
              relationships: {
                html: { data: [{ type: 'html', id: htmlId }] },
              },
            },
            included: hasRendering
              ? [
                  {
                    type: 'html',
                    id: htmlId,
                    attributes: {
                      html: '<article>Prerendered card</article>',
                      cardType: 'Card',
                      format: 'embedded',
                    },
                    relationships: {
                      styles: { data: [{ type: 'css', id: 'style:one' }] },
                    },
                  },
                  {
                    type: 'css',
                    id: 'style:one',
                    attributes: {
                      href: cssHref,
                    },
                  },
                ]
              : [],
          },
        };
      }
    }

    class MockLoaderService extends Service {
      loader = {
        import: async (identifier: string) => {
          imported.push(identifier);
          return {};
        },
      };
    }

    this.owner.register('service:store', MockStore);
    this.owner.register('service:loader-service', MockLoaderService);
    let service = this.owner.lookup(
      'service:boxel-execution',
    ) as BoxelExecutionService;
    let card = {
      id: 'https://realm.example/Card/one',
    } as unknown as BaseDef;

    let component = await service.prerenderedComponentFor(card, 'isolated');

    assert.ok(component, 'an inert HTML component is produced');
    assert.deepEqual(
      formats,
      ['embedded'],
      'isolated uses the indexed embedded prerender as its inert handoff',
    );
    assert.deepEqual(imported, [cssHref]);
  });

  test('a prerendered stylesheet that fails the Capsule CSS policy is dropped loudly, not silently', async function (assert) {
    let imported: string[] = [];
    let loggedErrors: unknown[][] = [];
    let originalConsoleError = console.error;
    // The href's compiled CSS is network-bearing (`@import`), which
    // `validateSharedDocumentScopedCSSRequest` rejects because the shared
    // Host document must never install network-bearing CSS. That rejection
    // must remain observable (a diagnostic), not disappear into the
    // placeholder's best-effort catch (RP-8-adjacent: unsupported semantics
    // fail loudly, never silently degrade).
    let networkBearingHref = scopedCSSHref(
      '@import "https://fonts.example/inter.css";',
    );

    class MockStore extends Service {
      async fetchCardEntry(_url: string, opts: { format?: string }) {
        if (opts.format !== 'embedded') {
          return { notModified: true as const, doc: undefined };
        }
        return {
          notModified: false as const,
          doc: {
            data: {
              type: 'entry',
              id: 'https://realm.example/Card/two',
              relationships: {
                html: { data: [{ type: 'html', id: 'card#embedded' }] },
              },
            },
            included: [
              {
                type: 'html',
                id: 'card#embedded',
                attributes: {
                  html: '<article>Prerendered card</article>',
                  cardType: 'Card',
                  format: 'embedded',
                },
                relationships: {
                  styles: { data: [{ type: 'css', id: 'style:font' }] },
                },
              },
              {
                type: 'css',
                id: 'style:font',
                attributes: {
                  href: networkBearingHref,
                },
              },
            ],
          },
        };
      }
    }

    class MockLoaderService extends Service {
      loader = {
        import: async (identifier: string) => {
          imported.push(identifier);
          return {};
        },
      };
    }

    this.owner.register('service:store', MockStore);
    this.owner.register('service:loader-service', MockLoaderService);
    let service = this.owner.lookup(
      'service:boxel-execution',
    ) as BoxelExecutionService;
    let card = {
      id: 'https://realm.example/Card/two',
    } as unknown as BaseDef;

    console.error = (...args: unknown[]) => {
      loggedErrors.push(args);
    };
    try {
      let component = await service.prerenderedComponentFor(card, 'isolated');

      assert.ok(
        component,
        'the placeholder still renders using the prerendered HTML even though one stylesheet was rejected',
      );
      assert.deepEqual(
        imported,
        [],
        'the rejected stylesheet is never installed in the shared Host document',
      );
      assert.strictEqual(
        loggedErrors.length,
        1,
        'the rejection is logged instead of silently disappearing',
      );
      assert.true(
        String(loggedErrors[0]?.[0]).includes(networkBearingHref),
        'the diagnostic names the dropped stylesheet',
      );
    } finally {
      console.error = originalConsoleError;
    }
  });
});
