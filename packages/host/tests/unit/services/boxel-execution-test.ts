import Service from '@ember/service';

import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import {
  rri,
  type LooseSingleCardDocument,
  type LooseSingleFileMetaDocument,
} from '@cardstack/runtime-common';

import {
  hydrateBoxelDocumentGraph,
  type default as BoxelExecutionService,
} from '@cardstack/host/services/boxel-execution';

import type { BaseDef } from '@cardstack/base/card-api';

// The `css` resources returned by the store encode their whole stylesheet in
// the href (`decodeScopedCSSRequest` in `@cardstack/runtime-common`); a real
// href always ends in `.glimmer-scoped.css` with the compiled CSS base64'd
// into the preceding path segment. Build one exactly like the compiler does.
function scopedCSSHref(
  css: string,
  fromFile = 'https://realm.example/card.gts',
): string {
  return `${fromFile}.${encodeURIComponent(btoa(css))}.glimmer-scoped.css`;
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
      ['isolated', 'embedded'],
      'isolated tries its own stored prerender first, falling back to embedded',
    );
    assert.deepEqual(imported, [cssHref]);
  });

  test('hydrates declared card and file-meta relationships without materializing instances', async function (assert) {
    let rootURL = 'https://realm.example/Album/one';
    let trackURL = 'https://realm.example/Track/one';
    let coverURL = 'https://realm.example/assets/cover.png';
    let documents = new Map<
      string,
      LooseSingleCardDocument | LooseSingleFileMetaDocument
    >();
    documents.set(trackURL, {
      data: {
        type: 'card',
        id: trackURL,
        attributes: { title: 'First track' },
        relationships: {
          cover: { links: { self: coverURL } },
        },
        meta: {
          adoptsFrom: {
            module: rri('https://realm.example/track'),
            name: 'Track',
          },
        },
      },
    });
    documents.set(coverURL, {
      data: {
        type: 'file-meta',
        id: coverURL,
        attributes: {
          name: 'cover.png',
          contentType: 'image/png',
          width: 800,
          height: 800,
        },
        meta: {
          adoptsFrom: {
            module: rri('https://base.example/image-file-def'),
            name: 'ImageFileDef',
          },
        },
      },
    });
    let fetched: string[] = [];

    let hydrated = await hydrateBoxelDocumentGraph(
      {
        data: {
          type: 'card',
          id: rootURL,
          relationships: {
            track: { links: { self: trackURL } },
          },
          meta: {
            adoptsFrom: {
              module: rri('https://realm.example/album'),
              name: 'Album',
            },
          },
        },
      },
      rri(rootURL),
      async (url) => {
        fetched.push(url);
        return documents.get(url);
      },
    );

    assert.deepEqual(
      fetched,
      [trackURL, coverURL],
      'only the exact declared relationship graph is fetched',
    );
    assert.deepEqual(
      hydrated.data.relationships?.track,
      {
        links: { self: trackURL },
        data: { type: 'card', id: trackURL },
      },
      'the root relationship is connected to its card resource',
    );
    assert.deepEqual(
      hydrated.included?.map((resource) => ({
        id: resource.id,
        type: resource.type,
      })),
      [
        { id: rri(trackURL), type: 'card' },
        { id: rri(coverURL), type: 'file-meta' },
      ],
      'card and indexed file metadata cross the same inert document boundary',
    );
    assert.deepEqual(
      hydrated.included?.[0]?.relationships?.cover,
      {
        links: { self: coverURL },
        data: { type: 'file-meta', id: coverURL },
      },
      'the nested file relationship carries file-meta identity',
    );
  });

  test('relationship graph hydration terminates cycles at the known root', async function (assert) {
    let rootURL = 'https://realm.example/Node/root';
    let childURL = 'https://realm.example/Node/child';
    let fetchCount = 0;

    let hydrated = await hydrateBoxelDocumentGraph(
      {
        data: {
          type: 'card',
          id: rootURL,
          relationships: {
            child: { links: { self: childURL } },
          },
          meta: {
            adoptsFrom: {
              module: rri('https://realm.example/node'),
              name: 'Node',
            },
          },
        },
      },
      rri(rootURL),
      async (url) => {
        fetchCount++;
        return {
          data: {
            type: 'card',
            id: url,
            relationships: {
              parent: { links: { self: rootURL } },
            },
            meta: {
              adoptsFrom: {
                module: rri('https://realm.example/node'),
                name: 'Node',
              },
            },
          },
        };
      },
    );

    assert.strictEqual(fetchCount, 1, 'the known root is not fetched again');
    assert.strictEqual(
      hydrated.included?.length,
      1,
      'the cycle adds one child',
    );
    assert.deepEqual(
      hydrated.included?.[0]?.relationships?.parent,
      {
        links: { self: rootURL },
        data: { type: 'card', id: rootURL },
      },
      'the back edge points at the existing root resource',
    );
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

  test('a trusted Cardstack component stylesheet is installed without going through the Capsule CSS policy', async function (assert) {
    let imported: string[] = [];
    let loggedErrors: unknown[][] = [];
    let originalConsoleError = console.error;
    // `@layer reset { :global(h1) { ... } }` is the real shape of
    // `@cardstack/boxel-ui/components/card-container/index.gts`'s own
    // scoped CSS: a named `@layer` for cascade ordering plus a `:global()`
    // reset selector that opts out of scoping. Both are document-global /
    // scope-escaping under the Capsule CSS policy, which would reject an
    // authored card writing them — but this is the Host's own trusted
    // component (docs/boxel-execution-runtime-architecture.md, "Trusted
    // Cardstack components are one-way portals"), so the policy must not
    // apply to it at all.
    let trustedHref = scopedCSSHref(
      '@layer reset { :global(h1) { margin: 0; } }',
      '@cardstack/boxel-ui/components/card-container/index.gts',
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
              id: 'https://realm.example/Card/three',
              relationships: {
                html: { data: [{ type: 'html', id: 'card#embedded' }] },
              },
            },
            included: [
              {
                type: 'html',
                id: 'card#embedded',
                attributes: {
                  html: '<article>Themed card</article>',
                  cardType: 'Card',
                  format: 'embedded',
                },
                relationships: {
                  styles: { data: [{ type: 'css', id: 'style:trusted' }] },
                },
              },
              {
                type: 'css',
                id: 'style:trusted',
                attributes: {
                  href: trustedHref,
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
      id: 'https://realm.example/Card/three',
    } as unknown as BaseDef;

    console.error = (...args: unknown[]) => {
      loggedErrors.push(args);
    };
    try {
      let component = await service.prerenderedComponentFor(card, 'isolated');

      assert.ok(component, 'the placeholder renders using the trusted style');
      assert.deepEqual(
        imported,
        [trustedHref],
        'the trusted stylesheet is installed exactly as requested, unmodified by the policy',
      );
      assert.strictEqual(
        loggedErrors.length,
        0,
        'a trusted origin never reaches the policy, so nothing is rejected or logged',
      );
    } finally {
      console.error = originalConsoleError;
    }
  });
});
